// Rutas /api/cuentas y /api/deudas (migración 5): handlers reales con Request estándar, base SQLite en memoria,
// reloj fijo, sesión sintética. Mismo arnés que rutas-api.test.ts. Sin red; nunca toca la base real.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { crearIAFalsa } from '../fakes/ia-falsa';
import { ENV_PRUEBA, SECRETO_PRUEBA, TOKEN_PRUEBA } from '../seguridad/base-prueba';
import { fijarClienteIA, fijarRelojApi } from '@/lib/api';
import { marcarSeguridadConectada } from '@/lib/arranque';
import { abrirDB } from '@/lib/db';
import { fijarAlmacenSeguridad, fijarEntorno, reiniciarEstadoHTTP } from '@/lib/http';
import { crearAlmacenSQLite, firmarCookie, leerEntorno, nuevaFilaSesion, nuevoIdSesion } from '@/lib/seguridad';
import * as cuentas from '@/app/api/cuentas/route';
import * as cuentaId from '@/app/api/cuentas/[id]/route';
import * as deudas from '@/app/api/deudas/route';
import * as deudaId from '@/app/api/deudas/[id]/route';
import * as metricas from '@/app/api/metricas/route';
import * as recomendaciones from '@/app/api/recomendaciones/route';
import * as config from '@/app/api/config/route';

const AHORA = new Date('2026-10-15T17:00:00Z');   // 12:00 en Bogotá
const BASE = 'http://127.0.0.1:3010';
const ORIGEN = 'http://127.0.0.1:3010';
let db: DatabaseSync;
let cookie = '';

beforeEach(() => {
  db = abrirDB(':memory:');
  (globalThis as { __plataDB?: DatabaseSync }).__plataDB = db;
  const almacen = crearAlmacenSQLite(db);
  fijarAlmacenSeguridad(almacen);
  marcarSeguridadConectada(true);
  fijarEntorno(leerEntorno({ ...ENV_PRUEBA }));
  reiniciarEstadoHTTP();
  fijarClienteIA(crearIAFalsa({ json: null }));
  fijarRelojApi(() => AHORA);
  const id = nuevoIdSesion();
  almacen.crearSesion(nuevaFilaSesion(id, new Date()));
  cookie = `plata_sesion=${firmarCookie(id, SECRETO_PRUEBA)}`;
});

type Manejador = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Opc { metodo?: string; cuerpo?: unknown; headers?: Record<string, string>; params?: Record<string, string>; modo?: 'token' | 'sesion' | 'nada' }

async function llamar(h: Manejador, ruta: string, o: Opc = {}): Promise<Response> {
  const modo = o.modo ?? 'sesion';
  const metodo = o.metodo ?? (o.cuerpo !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { host: '127.0.0.1:3010', ...o.headers };
  if (modo === 'token') headers.authorization = `Bearer ${TOKEN_PRUEBA}`;
  if (modo === 'sesion') {
    headers.cookie = cookie;
    if (metodo !== 'GET') { headers.origin = ORIGEN; headers['sec-fetch-site'] = 'same-origin'; }
  }
  let body: string | undefined;
  if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); headers['content-type'] = 'application/json'; }
  return h(new Request(BASE + ruta, { method: metodo, headers, body }), { params: Promise.resolve(o.params ?? {}) });
}
const json = async (r: Response) => r.json() as Promise<Record<string, any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const TARJETA = { nombre: 'Visa', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 30, pago_minimo: 100_000, dia_pago: 17 };
const PRESTAMO = { nombre: 'Moto', tipo: 'prestamo', saldo: 500_000, tasa_ea: 15, pago_minimo: 50_000, dia_pago: 5 };

describe('autenticación', () => {
  it('solo sesión: token → 401, sin nada → 401/403', async () => {
    expect((await llamar(cuentas.GET, '/api/cuentas', { modo: 'token' })).status).toBe(401);
    expect((await llamar(deudas.GET, '/api/deudas', { modo: 'nada' })).status).toBe(401);
    expect((await llamar(deudas.POST, '/api/deudas', { modo: 'nada', cuerpo: TARJETA })).status).toBe(403);
  });
});

describe('/api/cuentas', () => {
  it('crear, listar con saldo_total, editar y borrar', async () => {
    const r = await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Nequi', tipo: 'banco', saldo: 300_000 } });
    expect(r.status).toBe(201);
    const c = await json(r);
    expect(c).toMatchObject({ nombre: 'Nequi', tipo: 'banco', saldo: 300_000, creado_en: '2026-10-15T17:00:00Z' });
    await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Bolsillo', tipo: 'efectivo', saldo: 50_000 } });
    const l = await json(await llamar(cuentas.GET, '/api/cuentas'));
    expect(l.saldo_total).toBe(350_000);
    expect(l.items).toHaveLength(2);

    const p = { params: { id: String(c.id) } };
    const e = await llamar(cuentaId.PATCH, `/api/cuentas/${c.id}`, { ...p, metodo: 'PATCH', cuerpo: { saldo: 280_000 } });
    expect(e.status).toBe(200);
    expect((await json(e)).saldo).toBe(280_000);
    expect((await json(await llamar(cuentaId.GET, `/api/cuentas/${c.id}`, p))).saldo).toBe(280_000);
    expect((await llamar(cuentaId.DELETE, `/api/cuentas/${c.id}`, { ...p, metodo: 'DELETE' })).status).toBe(204);
    expect((await llamar(cuentaId.DELETE, `/api/cuentas/${c.id}`, { ...p, metodo: 'DELETE' })).status).toBe(404);
    expect((await llamar(cuentaId.GET, '/api/cuentas/abc', { params: { id: 'abc' } })).status).toBe(404);
  });

  it('422 por campo no permitido, tipo inválido, saldo negativo o nombre repetido', async () => {
    expect((await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'X', tipo: 'banco', saldo: 1, banco: 'x' } })).status).toBe(422);
    expect((await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'X', tipo: 'cdt', saldo: 1 } })).status).toBe(422);
    expect((await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'X', tipo: 'banco', saldo: -1 } })).status).toBe(422);
    await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Nequi', tipo: 'banco', saldo: 1 } });
    const r = await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'NEQUI', tipo: 'banco', saldo: 1 } });
    expect(r.status).toBe(422);
    expect((await json(r)).error.codigo).toBe('cuenta_existente');
  });

  it('Idempotency-Key: la repetición no crea otra cuenta', async () => {
    const h = { 'idempotency-key': 'clave-cuenta-0001' };
    const a = await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Nequi', tipo: 'banco', saldo: 1 }, headers: h });
    const b = await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Nequi', tipo: 'banco', saldo: 1 }, headers: h });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    expect(Number((db.prepare('SELECT count(*) AS n FROM cuentas').get() as { n: number }).n)).toBe(1);
  });
});

describe('/api/deudas', () => {
  it('crear y listar con resumen, solo-mínimo, planes y nota', async () => {
    const r = await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA });
    expect(r.status).toBe(201);
    const d = await json(r);
    expect(d).toMatchObject({ ...TARJETA, activa: true });
    await llamar(deudas.POST, '/api/deudas', { cuerpo: PRESTAMO });

    const g = await json(await llamar(deudas.GET, '/api/deudas'));
    expect(g.items).toHaveLength(2);
    expect(g.resumen).toMatchObject({
      deuda_total: 2_500_000, minimos_mes: 150_000,
      proximo_vencimiento: { deuda_id: d.id, nombre: 'Visa', fecha: '2026-10-17', dias: 2, pago_minimo: 100_000 },
    });
    expect(g.resumen.vencimientos.map((v: { fecha: string }) => v.fecha)).toEqual(['2026-10-17', '2026-11-05']);
    expect(g.solo_minimo).toHaveLength(2);
    expect(g.planes.avalancha.pago_mensual).toBe(150_000);
    expect(g.planes.avalancha.orden[0].nombre).toBe('Visa');
    expect(g.planes.bola_nieve.orden[0].nombre).toBe('Moto');
    expect(g.estrategia).toBe('avalancha');
    expect(g.pago_mensual_config).toBeNull();
    expect(g.nota).toMatch(/no es asesoría financiera/);

    const sim = await json(await llamar(deudas.GET, '/api/deudas?pago_mensual=400000'));
    expect(sim.planes.avalancha.pago_mensual).toBe(400_000);
    expect(sim.planes.avalancha.meses).toBeLessThan(g.planes.avalancha.meses);
    expect((await llamar(deudas.GET, '/api/deudas?pago_mensual=abc')).status).toBe(422);
    expect((await llamar(deudas.GET, '/api/deudas?pago_mensual=0')).status).toBe(422);
  });

  it('422 de validación', async () => {
    for (const malo of [
      { ...TARJETA, tasa_ea: -1 }, { ...TARJETA, dia_pago: 32 }, { ...TARJETA, tipo: 'hipoteca' },
      { ...TARJETA, pago_minimo: 1.5 }, { ...TARJETA, saldo: '2000000' }, { ...TARJETA, extra: 1 },
    ]) {
      expect((await llamar(deudas.POST, '/api/deudas', { cuerpo: malo })).status).toBe(422);
    }
    await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA });
    expect((await json(await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA }))).error.codigo).toBe('deuda_existente');
  });

  it('PATCH, DELETE archiva, ?todas=1 la muestra y PATCH { activa: true } la revive', async () => {
    const d = await json(await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA }));
    const p = { params: { id: String(d.id) } };
    const e = await json(await llamar(deudaId.PATCH, `/api/deudas/${d.id}`, { ...p, metodo: 'PATCH', cuerpo: { saldo: 1_800_000, dia_pago: null } }));
    expect(e).toMatchObject({ saldo: 1_800_000, dia_pago: null, tasa_ea: 30 });
    const uno = await json(await llamar(deudaId.GET, `/api/deudas/${d.id}`, p));
    expect(uno.deuda.id).toBe(d.id);
    expect(uno.solo_minimo).toMatchObject({ deuda_id: d.id, se_paga: true });

    expect((await llamar(deudaId.DELETE, `/api/deudas/${d.id}`, { ...p, metodo: 'DELETE' })).status).toBe(204);
    expect((await json(await llamar(deudas.GET, '/api/deudas'))).items).toHaveLength(0);
    expect((await json(await llamar(deudas.GET, '/api/deudas?todas=1'))).items[0]).toMatchObject({ id: d.id, activa: false });
    const v = await json(await llamar(deudaId.PATCH, `/api/deudas/${d.id}`, { ...p, metodo: 'PATCH', cuerpo: { activa: true } }));
    expect(v.activa).toBe(true);
    expect((await llamar(deudaId.DELETE, '/api/deudas/999', { params: { id: '999' }, metodo: 'DELETE' })).status).toBe(404);
    expect((await llamar(deudaId.PATCH, '/api/deudas/999', { params: { id: '999' }, metodo: 'PATCH', cuerpo: { saldo: 1 } })).status).toBe(404);
  });
});

describe('integración con métricas, recomendaciones y config', () => {
  it('/api/metricas expone saldos; /api/recomendaciones trae las reglas de deudas', async () => {
    await llamar(cuentas.POST, '/api/cuentas', { cuerpo: { nombre: 'Nequi', tipo: 'banco', saldo: 80_000 } });
    await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA });
    await llamar(deudas.POST, '/api/deudas', { cuerpo: PRESTAMO });
    const m = await json(await llamar(metricas.GET, '/api/metricas', { modo: 'token' }));
    expect(m.saldos).toMatchObject({
      hay_cuentas: true, hay_deudas: true, saldo_total: 80_000, deuda_total: 2_500_000, minimos_mes: 150_000,
      proximo_vencimiento: { nombre: 'Visa', dias: 2 },
    });
    expect(typeof m.saldos.gasto_diario).toBe('number');
    const recs = (await json(await llamar(recomendaciones.GET, '/api/recomendaciones', { modo: 'token' }))).items as { regla: string; severidad: string }[];
    const venc = recs.find((x) => x.regla === 'vencimiento_deuda');
    expect(venc?.severidad).toBe('alerta');   // 80.000 en cuentas no alcanzan para el mínimo de 100.000
    expect(recs.some((x) => x.regla === 'solo_minimo')).toBe(true);
    expect(recs.some((x) => x.regla === 'plan_deudas')).toBe(true);
  });

  it('config: tutorial_visto, estrategia y pago mensual a deudas', async () => {
    const patch = (clave: string, valor: unknown) => llamar(config.PATCH, '/api/config', { metodo: 'PATCH', cuerpo: { clave, valor } });
    expect((await json(await patch('tutorial_visto', true))).tutorial_visto).toBe(true);
    expect((await json(await patch('estrategia_deudas', 'bola_nieve'))).estrategia_deudas).toBe('bola_nieve');
    expect((await json(await patch('pago_deudas_mensual', 450_000))).pago_deudas_mensual).toBe(450_000);
    expect((await patch('estrategia_deudas', 'otra')).status).toBe(422);
    await llamar(deudas.POST, '/api/deudas', { cuerpo: TARJETA });
    const g = await json(await llamar(deudas.GET, '/api/deudas'));
    expect(g).toMatchObject({ estrategia: 'bola_nieve', pago_mensual_config: 450_000 });
    expect(g.planes.bola_nieve.pago_mensual).toBe(450_000);
  });
});
