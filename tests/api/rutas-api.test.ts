// Pruebas de las rutas /api/* del Frente A (SPEC §5, §8.2 «rutas»): handlers reales con Request estándar,
// base SQLite en memoria, IA falsa, reloj fijo y carpeta TEMPORAL para el vault. Sin red; jamás toca el vault real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { crearIAFalsa, iaCaida } from '../fakes/ia-falsa';
import { ENV_PRUEBA, SECRETO_PRUEBA, TOKEN_PRUEBA } from '../seguridad/base-prueba';
import { fijarClienteIA, fijarRelojApi } from '@/lib/api';
import { marcarSeguridadConectada } from '@/lib/arranque';
import { abrirDB } from '@/lib/db';
import { fijarAlmacenSeguridad, fijarEntorno, reiniciarEstadoHTTP } from '@/lib/http';
import { crearAlmacenSQLite, firmarCookie, leerEntorno, nuevaFilaSesion, nuevoIdSesion } from '@/lib/seguridad';
import type { AvisoCrudo, ClienteIA } from '@/lib/tipos';
import * as avisos from '@/app/api/avisos/route';
import * as lote from '@/app/api/avisos/lote/route';
import * as salud from '@/app/api/salud/route';
import * as latido from '@/app/api/latido/route';
import * as estado from '@/app/api/estado/route';
import * as movs from '@/app/api/movimientos/route';
import * as movId from '@/app/api/movimientos/[id]/route';
import * as exportar from '@/app/api/movimientos/exportar/route';
import * as presupuestos from '@/app/api/presupuestos/route';
import * as metas from '@/app/api/metas/route';
import * as metaId from '@/app/api/metas/[id]/route';
import * as aportes from '@/app/api/metas/[id]/aportes/route';
import * as config from '@/app/api/config/route';
import * as deshacer from '@/app/api/deshacer/route';
import * as vault from '@/app/api/vault/exportar/route';
import * as alertas from '@/app/api/alertas/pendientes/route';
import * as porRevisar from '@/app/api/por-revisar/route';
import * as reintentar from '@/app/api/por-revisar/reintentar/route';
import * as resolver from '@/app/api/por-revisar/[id]/resolver/route';
import * as fijos from '@/app/api/fijos/route';
import * as fijoId from '@/app/api/fijos/[id]/route';
import * as categorias from '@/app/api/categorias/route';
import * as reglas from '@/app/api/reglas/route';
import * as espera from '@/app/api/lista-espera/route';
import * as esperaId from '@/app/api/lista-espera/[id]/route';
import * as metricas from '@/app/api/metricas/route';
import * as recomendaciones from '@/app/api/recomendaciones/route';
import * as tendencias from '@/app/api/tendencias/route';
import * as suscripciones from '@/app/api/suscripciones/route';

const AHORA = new Date('2026-10-15T17:00:00Z');   // 12:00 en Bogotá
const BASE = 'http://127.0.0.1:3010';
const ORIGEN = 'http://127.0.0.1:3010';
const dirs: string[] = [];
const fxAviso = (n: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/avisos', n + '.json'), 'utf8')) as {
  aviso: AvisoCrudo; ia?: unknown;
};

let db: DatabaseSync;
let cookie = '';

function temp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plata-api-'));
  dirs.push(d);
  return d;
}
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function preparar(ia: ClienteIA = crearIAFalsa({ json: null }), dirVault: string | null = null) {
  db = abrirDB(':memory:');
  (globalThis as { __plataDB?: DatabaseSync }).__plataDB = db;
  const almacen = crearAlmacenSQLite(db);
  fijarAlmacenSeguridad(almacen);
  marcarSeguridadConectada(true);
  fijarEntorno(leerEntorno({ ...ENV_PRUEBA, ...(dirVault ? { PLATA_VAULT_FINANZAS: dirVault } : {}) }));
  reiniciarEstadoHTTP();
  fijarClienteIA(ia);
  fijarRelojApi(() => AHORA);
  // sesión válida
  const id = nuevoIdSesion();
  almacen.crearSesion(nuevaFilaSesion(id, new Date()));
  cookie = `plata_sesion=${firmarCookie(id, SECRETO_PRUEBA)}`;
}
beforeEach(() => preparar());

type Manejador = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Opc { metodo?: string; cuerpo?: unknown; crudo?: string; headers?: Record<string, string>; params?: Record<string, string>; modo?: 'token' | 'sesion' | 'nada' }

async function llamar(h: Manejador, ruta: string, o: Opc = {}): Promise<Response> {
  const modo = o.modo ?? 'token';
  const metodo = o.metodo ?? (o.cuerpo !== undefined || o.crudo !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { host: '127.0.0.1:3010', ...o.headers };
  if (modo === 'token') headers.authorization = `Bearer ${TOKEN_PRUEBA}`;
  if (modo === 'sesion') {
    headers.cookie = cookie;
    if (metodo !== 'GET') { headers.origin = ORIGEN; headers['sec-fetch-site'] = 'same-origin'; }
  }
  let body: string | undefined;
  if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); headers['content-type'] = 'application/json'; }
  if (o.crudo !== undefined) { body = o.crudo; headers['content-type'] = headers['content-type'] ?? 'application/json'; }
  return h(new Request(BASE + ruta, { method: metodo, headers, body }), { params: Promise.resolve(o.params ?? {}) });
}
const json = async (r: Response) => r.json() as Promise<Record<string, any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

describe('seguridad común de las rutas', () => {
  it('/api/salud es pública pero exige Host permitido', async () => {
    expect(await json(await llamar(salud.GET, '/api/salud', { modo: 'nada' }))).toEqual({ ok: true });
    expect((await llamar(salud.GET, '/api/salud', { modo: 'nada', headers: { host: 'evil.com' } })).status).toBe(403);
  });

  it('sin token → 401; token con Origin → 403; Host ajeno → 403', async () => {
    const a = fxAviso('bancolombia-compra-debito').aviso;
    // Mutación sin credenciales ni Origin: el control de Origen va primero (403). Con token incorrecto: 401.
    expect((await llamar(avisos.POST, '/api/avisos', { modo: 'nada', cuerpo: { aviso: a } })).status).toBe(403);
    expect((await llamar(avisos.POST, '/api/avisos', { modo: 'nada', cuerpo: { aviso: a }, headers: { authorization: 'Bearer incorrecto' } })).status).toBe(401);
    expect((await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: a }, headers: { origin: 'http://evil.com' } })).status).toBe(403);
    expect((await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: a }, headers: { host: '127.0.0.1:3010.evil.com' } })).status).toBe(403);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(0);
  });

  it('cuerpo de 300 KB → 413 y text/plain → 415', async () => {
    const grande = JSON.stringify({ aviso: { x: 'a'.repeat(300 * 1024) } });
    expect((await llamar(avisos.POST, '/api/avisos', { crudo: grande })).status).toBe(413);
    expect((await llamar(avisos.POST, '/api/avisos', { crudo: '{}', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await llamar(avisos.POST, '/api/avisos', { crudo: '{no es json' })).status).toBe(400);
  });

  it('rutas de panel con token solo se permiten si la política lo dice', async () => {
    expect((await llamar(config.GET, '/api/config', { modo: 'token' })).status).toBe(401);      // sesión
    expect((await llamar(config.GET, '/api/config', { modo: 'nada' })).status).toBe(401);
    expect((await llamar(config.GET, '/api/config', { modo: 'sesion' })).status).toBe(200);
    expect((await llamar(estado.GET, '/api/estado', { modo: 'token' })).status).toBe(200);      // token o sesión
    expect((await llamar(estado.GET, '/api/estado', { modo: 'sesion' })).status).toBe(200);
  });

  it('mutación de sesión sin Origin → 403', async () => {
    const r = await llamar(config.PATCH, '/api/config', { modo: 'nada', metodo: 'PATCH', cuerpo: { clave: 'pct_ahorro', valor: 15 }, headers: { cookie } });
    expect(r.status).toBe(403);
    const otro = await llamar(config.PATCH, '/api/config', { modo: 'nada', metodo: 'PATCH', cuerpo: { clave: 'pct_ahorro', valor: 15 }, headers: { cookie, origin: 'http://evil.com' } });
    expect(otro.status).toBe(403);
    expect(n("SELECT count(*) AS n FROM config")).toBe(0);
  });
});

describe('POST /api/avisos', () => {
  it('crea el movimiento (201) con el mensaje de Telegram y botones', async () => {
    const res = await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('bancolombia-compra-debito').aviso, origen: 'aviso' } });
    expect(res.status).toBe(201);
    const j = await json(res);
    expect(j.resultado).toMatchObject({ estado: 'creado', movimiento: { monto: 14730, categoria_id: 'mercado', banco: 'bancolombia' } });
    expect(j.notificar).toHaveLength(1);
    expect(j.notificar[0].texto).toContain('$14.730');
    expect(j.notificar[0].texto).toContain('TIENDA D1 ANT MARINI');
    expect(JSON.stringify(j.notificar[0].botones)).toContain(`cat:${j.resultado.movimiento.id}`);
    // el texto del correo crudo no se guarda
    expect(JSON.stringify(db.prepare('SELECT * FROM movimientos').all())).not.toContain('Si tienes dudas');
  });

  it('el mismo correo otra vez → 200 duplicado sin notificar', async () => {
    const cuerpo = { aviso: fxAviso('bancolombia-compra-debito').aviso };
    await llamar(avisos.POST, '/api/avisos', { cuerpo });
    const res = await llamar(avisos.POST, '/api/avisos', { cuerpo });
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.resultado.estado).toBe('duplicado');
    expect(j.notificar).toEqual([]);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(1);
  });

  it('remitente suplantado → 422 remitente_no_permitido y no se guarda nada', async () => {
    const res = await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('remitente-atacante').aviso } });
    expect(res.status).toBe(422);
    expect((await json(res)).error.codigo).toBe('remitente_no_permitido');
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(0);
    expect(n('SELECT count(*) AS n FROM avisos_procesados')).toBe(0);
  });

  it('origen historial: nunca notifica', async () => {
    const j = await json(await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('bancolombia-compra-debito').aviso, origen: 'historial' } }));
    expect(j.resultado.estado).toBe('creado');
    expect(j.notificar).toEqual([]);
  });

  it('ignorado y fusionado no notifican; validación de entrada → 422', async () => {
    const j = await json(await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('bancolombia-publicidad').aviso } }));
    expect(j.resultado).toMatchObject({ estado: 'ignorado', motivo: 'publicidad' });
    expect(j.notificar).toEqual([]);
    for (const cuerpo of [{}, { aviso: 'x' }, { aviso: { from: 'a' } }, { aviso: fxAviso('bancolombia-compra-debito').aviso, origen: 'zzz' }, { aviso: fxAviso('bancolombia-compra-debito').aviso, extra: 1 }]) {
      expect((await llamar(avisos.POST, '/api/avisos', { cuerpo })).status, JSON.stringify(cuerpo).slice(0, 40)).toBe(422);
    }
  });

  it('IA caída con un RappiCard: 200 por_revisar con aviso para Jero; luego se reintenta con la IA de vuelta', async () => {
    preparar(iaCaida());
    const f = fxAviso('rappicard-compra');
    const j = await json(await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: f.aviso } }));
    expect(j.resultado).toMatchObject({ estado: 'por_revisar', motivo: 'ia_no_disponible' });
    expect(j.notificar[0].texto).toContain('Por revisar');
    expect((await json(await llamar(porRevisar.GET, '/api/por-revisar', { modo: 'sesion' }))).items).toHaveLength(1);

    fijarClienteIA(crearIAFalsa({ json: f.ia }));
    const r = await json(await llamar(reintentar.POST, '/api/por-revisar/reintentar', { cuerpo: { max: 10 } }));
    expect(r).toEqual({ resueltos: 1, siguen: 0 });
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(1);
    expect((await llamar(reintentar.POST, '/api/por-revisar/reintentar', { cuerpo: { max: 0 } })).status).toBe(422);
  });

  it('por revisar: crear a mano y descartar', async () => {
    preparar(iaCaida());
    await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('rappicard-compra').aviso } });
    await llamar(avisos.POST, '/api/avisos', { cuerpo: { aviso: fxAviso('didi-viaje').aviso } });
    const [a, b] = (await json(await llamar(porRevisar.GET, '/api/por-revisar', { modo: 'sesion' }))).items as { id: number }[];
    const mov = { fecha: '2026-10-06', hora: '19:20', banco: 'rappicard', tipo: 'compra', sentido: 'salida', monto: 45000, comercio: 'Comercio prueba' };
    const r1 = await llamar(resolver.POST, `/api/por-revisar/${a.id}/resolver`, { modo: 'sesion', params: { id: String(a.id) }, cuerpo: { accion: 'crear', movimiento: mov } });
    expect(r1.status).toBe(201);
    const r2 = await llamar(resolver.POST, `/api/por-revisar/${b.id}/resolver`, { modo: 'sesion', params: { id: String(b.id) }, cuerpo: { accion: 'descartar' } });
    expect(r2.status).toBe(200);
    expect(n("SELECT count(*) AS n FROM por_revisar WHERE estado = 'pendiente'")).toBe(0);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(1);
    // ya resuelto → 404; acción rara → 422
    expect((await llamar(resolver.POST, `/api/por-revisar/${a.id}/resolver`, { modo: 'sesion', params: { id: String(a.id) }, cuerpo: { accion: 'descartar' } })).status).toBe(404);
  });
});

describe('POST /api/avisos/lote', () => {
  it('procesa en serie y resume', async () => {
    const lista = ['bancolombia-compra-debito', 'bancolombia-compra-credito', 'bancolombia-publicidad', 'remitente-atacante'].map((x) => fxAviso(x).aviso);
    const j = await json(await llamar(lote.POST, '/api/avisos/lote', { cuerpo: { avisos: [...lista, lista[0]], origen: 'historial' } }));
    expect(j.resumen).toEqual({ creado: 2, fusionado: 0, duplicado: 1, ignorado: 2, por_revisar: 0 });
    expect(j.resultados).toHaveLength(5);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(2);
  });

  it('valida: vacío, más de 50, o un elemento inválido (no procesa nada)', async () => {
    const ok = fxAviso('bancolombia-compra-debito').aviso;
    expect((await llamar(lote.POST, '/api/avisos/lote', { cuerpo: { avisos: [] } })).status).toBe(422);
    expect((await llamar(lote.POST, '/api/avisos/lote', { cuerpo: { avisos: Array(51).fill(ok) } })).status).toBe(422);
    expect((await llamar(lote.POST, '/api/avisos/lote', { cuerpo: { avisos: [ok, { from: 1 }] } })).status).toBe(422);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(0);
  });
});

describe('latido y estado', () => {
  it('latido → 204 y aparece en /api/estado; flujo inválido → 422', async () => {
    expect((await llamar(latido.POST, '/api/latido', { cuerpo: { flujo: 'bot' } })).status).toBe(204);
    expect((await llamar(latido.POST, '/api/latido', { cuerpo: { flujo: 'otro' } })).status).toBe(422);
    const e = await json(await llamar(estado.GET, '/api/estado'));
    expect(e).toMatchObject({ ok: true, version: '0.1.0', db: { ok: true, user_version: 6 }, por_revisar_pendientes: 0, avisos_24h: 0 });
    expect(e.latidos.bot).toBe('2026-10-15T17:00:00Z');
    expect(e.caidos.sort()).toEqual(['ingesta', 'reportes']);
    expect(e.ia).toMatchObject({ ok: true, modelo: 'qwen2.5:7b' });
    expect(typeof e.db.tamano_bytes).toBe('number');
  });
});

describe('movimientos', () => {
  const nuevo = { fecha: '2026-10-10', hora: '12:00', banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto: 20000, comercio: 'Kiosco prueba', origen: 'manual' };

  it('POST crea (201) con sesión y con token; exige origen manual; idempotente con Idempotency-Key', async () => {
    const r = await llamar(movs.POST, '/api/movimientos', { modo: 'sesion', cuerpo: nuevo, headers: { 'idempotency-key': 'clave-prueba-0001' } });
    expect(r.status).toBe(201);
    const m = await json(r);
    expect(m).toMatchObject({ id: 1, monto: 20000, origen: 'manual', version: 1 });
    const r2 = await llamar(movs.POST, '/api/movimientos', { modo: 'sesion', cuerpo: nuevo, headers: { 'idempotency-key': 'clave-prueba-0001' } });
    expect(await json(r2)).toEqual(m);
    expect(n('SELECT count(*) AS n FROM movimientos')).toBe(1);
    const r3 = await llamar(movs.POST, '/api/movimientos', { modo: 'sesion', cuerpo: { ...nuevo, monto: 5 }, headers: { 'idempotency-key': 'clave-prueba-0001' } });
    expect(r3.status).toBe(409);
    expect((await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, comercio: 'Otro' } })).status).toBe(201);
    expect((await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, origen: 'aviso' } })).status).toBe(422);
    expect((await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, monto: -1 } })).status).toBe(422);
    expect((await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, hack: 1 } })).status).toBe(422);
  });

  it('GET lista con cursor y filtros; cursor malo → 422', async () => {
    for (let i = 1; i <= 5; i++) await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, fecha: `2026-10-0${i}`, comercio: `Sitio ${i}` } });
    const p1 = await json(await llamar(movs.GET, '/api/movimientos?limite=2'));
    expect(p1.items.map((m: { comercio: string }) => m.comercio)).toEqual(['Sitio 5', 'Sitio 4']);
    const p2 = await json(await llamar(movs.GET, `/api/movimientos?limite=2&cursor=${p1.siguiente_cursor}`));
    expect(p2.items.map((m: { comercio: string }) => m.comercio)).toEqual(['Sitio 3', 'Sitio 2']);
    expect((await json(await llamar(movs.GET, '/api/movimientos?q=sitio%203'))).items).toHaveLength(1);
    expect((await json(await llamar(movs.GET, '/api/movimientos?desde=2026-10-04'))).items).toHaveLength(2);
    expect((await llamar(movs.GET, '/api/movimientos?cursor=basura')).status).toBe(422);
    expect((await llamar(movs.GET, '/api/movimientos?min=abc')).status).toBe(422);
    expect((await llamar(movs.GET, "/api/movimientos?banco=x'%20OR%201=1")).status).toBe(422);
  });

  it('PATCH computa marca/desmarca una transferencia como gasto (API del panel «Cuenta como gasto»)', async () => {
    const t = await json(await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, tipo: 'transferencia', computa: false, comercio: 'Juan Perez', fecha: '2026-10-03' } }));   // la API solo crea 'manual'
    expect(t).toMatchObject({ tipo: 'transferencia', computa: false, categoria_id: 'transferencias' });
    const ruta = `/api/movimientos/${t.id}`;
    const on = await json(await llamar(movId.PATCH, ruta, { params: { id: String(t.id) }, metodo: 'PATCH', cuerpo: { version: t.version, computa: true } }));
    expect(on).toMatchObject({ computa: true, version: t.version + 1 });
    const off = await json(await llamar(movId.PATCH, ruta, { params: { id: String(t.id) }, metodo: 'PATCH', cuerpo: { version: on.version, computa: false } }));
    expect(off.computa).toBe(false);
  });

  it('GET/PATCH/DELETE por id: 404, 409 por versión, recategorizar y deshacer', async () => {
    const a = await json(await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, comercio: 'Cafe del parque', fecha: '2026-10-01' } }));
    const b = await json(await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, comercio: 'Cafe del parque', fecha: '2026-10-02' } }));
    const p = (id: number) => ({ params: { id: String(id) } });

    expect((await llamar(movId.GET, '/api/movimientos/99', p(99))).status).toBe(404);
    expect((await llamar(movId.GET, '/api/movimientos/abc', p(0) && { params: { id: 'abc' } })).status).toBe(404);
    expect((await json(await llamar(movId.GET, '/api/movimientos/1', p(a.id)))).comercio).toBe('Cafe del parque');

    const mod = await llamar(movId.PATCH, '/api/movimientos/1', { ...p(a.id), metodo: 'PATCH', cuerpo: { version: 1, nota: 'con propina', monto: 22000 } });
    expect(await json(mod)).toMatchObject({ version: 2, nota: 'con propina', monto: 22000 });
    const viejo = await llamar(movId.PATCH, '/api/movimientos/1', { ...p(a.id), metodo: 'PATCH', cuerpo: { version: 1, monto: 1 } });
    expect(viejo.status).toBe(409);
    expect((await json(viejo)).error.detalles).toEqual({ version_actual: 2 });
    expect((await llamar(movId.PATCH, '/api/movimientos/1', { ...p(a.id), metodo: 'PATCH', cuerpo: { monto: 1 } })).status).toBe(422);   // falta version

    const cat = await json(await llamar(movId.PATCH, '/api/movimientos/2', { ...p(b.id), metodo: 'PATCH', cuerpo: { version: 1, categoria_id: 'comida' } }));
    expect(cat).toMatchObject({ aplicados_a: 1, movimiento: { categoria_id: 'comida', categoria_fuente: 'manual' } });

    const del = await json(await llamar(movId.DELETE, '/api/movimientos/2', { ...p(b.id), metodo: 'DELETE' }));
    expect(typeof del.accion_id).toBe('number');
    expect((await llamar(movId.GET, '/api/movimientos/2', p(b.id))).status).toBe(404);

    const und = await llamar(deshacer.POST, '/api/deshacer', { modo: 'sesion', cuerpo: { accion_id: del.accion_id } });
    expect(und.status).toBe(200);
    expect((await llamar(movId.GET, '/api/movimientos/2', p(b.id))).status).toBe(200);
    expect((await llamar(deshacer.POST, '/api/deshacer', { modo: 'sesion', cuerpo: { accion_id: 9999 } })).status).toBe(404);
    expect((await llamar(deshacer.POST, '/api/deshacer', { modo: 'sesion', cuerpo: {} })).status).toBe(200);
  });

  it('exportar CSV: BOM, columnas y fórmulas neutralizadas; solo sesión', async () => {
    await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, comercio: '=HYPERLINK("http://x")', nota: '+cmd, "con comillas"' } });
    await llamar(movs.POST, '/api/movimientos', { cuerpo: { ...nuevo, comercio: '@SUM(A1)', fecha: '2026-10-11' } });
    expect((await llamar(exportar.GET, '/api/movimientos/exportar?mes=2026-10', { modo: 'token' })).status).toBe(401);
    const res = await llamar(exportar.GET, '/api/movimientos/exportar?mes=2026-10', { modo: 'sesion' });
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);   // BOM
    const csv = '﻿' + new TextDecoder().decode(bytes);
    expect(csv.startsWith('﻿fecha,hora,banco,tipo,monto,comercio,categoria,nota\r\n')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain('"\'+cmd, ""con comillas"""');
    expect(csv).toContain(",'@SUM(A1),");
    expect((await llamar(exportar.GET, '/api/movimientos/exportar?mes=2026-13', { modo: 'sesion' })).status).toBe(422);
  });
});

describe('presupuestos, config, metas, fijos, categorías, reglas, espera', () => {
  it('presupuestos: PUT y GET con origen mes/siempre; quitar; validación', async () => {
    await llamar(presupuestos.PUT, '/api/presupuestos', { modo: 'sesion', metodo: 'PUT', cuerpo: { mes: '2026-10', categoria_id: 'comida', monto: 400000 } });
    await llamar(presupuestos.PUT, '/api/presupuestos', { modo: 'sesion', metodo: 'PUT', cuerpo: { mes: '*', categoria_id: '*', monto: 2000000 } });
    await llamar(presupuestos.PUT, '/api/presupuestos', { modo: 'sesion', metodo: 'PUT', cuerpo: { mes: '*', categoria_id: 'ocio', monto: 100000 } });
    const j = await json(await llamar(presupuestos.GET, '/api/presupuestos?mes=2026-10'));
    expect(j).toEqual({
      mes: '2026-10',
      items: [{ categoria_id: 'comida', monto: 400000, origen: 'mes' }, { categoria_id: 'ocio', monto: 100000, origen: 'siempre' }],
      total: { monto: 2000000, origen: 'siempre' },
    });
    const q = await json(await llamar(presupuestos.PUT, '/api/presupuestos', { metodo: 'PUT', cuerpo: { mes: '2026-10', categoria_id: 'comida', monto: null } }));
    expect(q.items.map((x: { categoria_id: string }) => x.categoria_id)).toEqual(['ocio']);   // queda solo el de «siempre»
  });

  it('config: leer, cambiar y rechazar', async () => {
    expect((await json(await llamar(config.GET, '/api/config', { modo: 'sesion' }))).pct_ahorro).toBe(10);
    const ok = await json(await llamar(config.PATCH, '/api/config', { modo: 'sesion', metodo: 'PATCH', cuerpo: { clave: 'pct_ahorro', valor: 15 } }));
    expect(ok.pct_ahorro).toBe(15);
    for (const c of [{ clave: 'pct_ahorro', valor: 99 }, { clave: 'pin_hash', valor: 'x' }, { clave: 'constructor', valor: 1 }, { clave: 'umbral_hormiga' }]) {
      expect((await llamar(config.PATCH, '/api/config', { modo: 'sesion', metodo: 'PATCH', cuerpo: c })).status, JSON.stringify(c)).toBe(422);
    }
    expect(JSON.stringify(await json(await llamar(config.GET, '/api/config', { modo: 'sesion' })))).not.toContain('scrypt');
  });

  it('metas: crear, aportar, retirar de más (422), editar, cancelar', async () => {
    const m = await json(await llamar(metas.POST, '/api/metas', { modo: 'sesion', cuerpo: { nombre: 'Viaje', objetivo: 3000000, fecha_objetivo: '2027-06-30', emoji: '✈️' } }));
    expect(m).toMatchObject({ nombre: 'Viaje', aportado: 0, estado: 'activa' });
    const p = { params: { id: String(m.id) } };
    expect((await llamar(metas.POST, '/api/metas', { modo: 'sesion', cuerpo: { nombre: 'viaje', objetivo: 1000 } })).status).toBe(422);
    const ap = await llamar(aportes.POST, `/api/metas/${m.id}/aportes`, { modo: 'sesion', ...p, cuerpo: { monto: 200000, fecha: '2026-10-06' } });
    expect(ap.status).toBe(201);
    expect((await llamar(aportes.POST, `/api/metas/${m.id}/aportes`, { modo: 'sesion', ...p, cuerpo: { monto: -900000 } })).status).toBe(422);
    expect((await llamar(aportes.POST, '/api/metas/99/aportes', { modo: 'sesion', params: { id: '99' }, cuerpo: { monto: 10 } })).status).toBe(404);
    const e = await json(await llamar(metaId.PATCH, `/api/metas/${m.id}`, { modo: 'sesion', ...p, metodo: 'PATCH', cuerpo: { objetivo: 4000000, estado: 'pausada' } }));
    expect(e).toMatchObject({ objetivo: 4000000, estado: 'pausada', aportado: 200000 });
    expect((await json(await llamar(metas.GET, '/api/metas', { modo: 'sesion' }))).items).toHaveLength(1);
    expect((await llamar(metaId.DELETE, `/api/metas/${m.id}`, { modo: 'sesion', ...p, metodo: 'DELETE' })).status).toBe(204);
    expect((await json(await llamar(metas.GET, '/api/metas', { modo: 'sesion' }))).items).toHaveLength(0);
  });

  it('fijos: guardar, listar, quitar', async () => {
    const f = await json(await llamar(fijos.POST, '/api/fijos', { modo: 'sesion', cuerpo: { nombre: 'Arriendo', monto: 1200000, dia_mes: 5, patron: 'arriendo' } }));
    expect(f).toMatchObject({ nombre: 'Arriendo', monto: 1200000 });
    expect((await json(await llamar(fijos.GET, '/api/fijos', { modo: 'sesion' }))).items).toHaveLength(1);
    expect((await llamar(fijoId.DELETE, `/api/fijos/${f.id}`, { modo: 'sesion', metodo: 'DELETE', params: { id: String(f.id) } })).status).toBe(204);
    expect((await llamar(fijoId.DELETE, `/api/fijos/${f.id}`, { modo: 'sesion', metodo: 'DELETE', params: { id: String(f.id) } })).status).toBe(404);
  });

  it('categorías y reglas', async () => {
    const c = await json(await llamar(categorias.POST, '/api/categorias', { modo: 'sesion', cuerpo: { id: 'mascotas', nombre: 'Mascotas', emoji: '🐶' } }));
    expect(c).toMatchObject({ id: 'mascotas', es_gasto: true, sistema: false });
    expect((await llamar(categorias.POST, '/api/categorias', { modo: 'sesion', cuerpo: { id: 'Mala-Id', nombre: 'x', emoji: 'x' } })).status).toBe(422);
    const r = await json(await llamar(reglas.POST, '/api/reglas', { modo: 'sesion', cuerpo: { patron: 'Veterinaria Pepe', categoria_id: 'mascotas' } }));
    expect(r).toMatchObject({ patron: 'veterinaria pepe', origen: 'manual' });
    const nuevoMov = await json(await llamar(movs.POST, '/api/movimientos', { cuerpo: { fecha: '2026-10-10', hora: null, banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto: 50000, comercio: 'Veterinaria Pepe sede 2', origen: 'manual' } }));
    expect(nuevoMov.categoria_id).toBe('mascotas');
    expect((await llamar(reglas.POST, '/api/reglas', { modo: 'sesion', cuerpo: { patron: 'x', categoria_id: 'mascotas' } })).status).toBe(422);
    expect((await llamar(reglas.POST, '/api/reglas', { modo: 'sesion', cuerpo: { patron: 'algo largo', categoria_id: 'inexistente' } })).status).toBe(422);
  });

  it('lista de espera: agregar, listar y descartar', async () => {
    const it = await json(await llamar(espera.POST, '/api/lista-espera', { modo: 'sesion', cuerpo: { descripcion: 'Audífonos', monto: 80000 } }));
    expect(it).toMatchObject({ estado: 'esperando', disponible_en: '2026-10-17T17:00:00Z' });
    expect((await json(await llamar(espera.GET, '/api/lista-espera', { modo: 'sesion' }))).items).toHaveLength(1);
    const d = await json(await llamar(esperaId.PATCH, `/api/lista-espera/${it.id}`, { modo: 'sesion', metodo: 'PATCH', params: { id: String(it.id) }, cuerpo: { accion: 'descartado' } }));
    expect(d.estado).toBe('descartado');
    expect((await llamar(esperaId.PATCH, `/api/lista-espera/${it.id}`, { modo: 'sesion', metodo: 'PATCH', params: { id: String(it.id) }, cuerpo: { accion: 'descartado' } })).status).toBe(404);
    expect((await llamar(esperaId.PATCH, '/api/lista-espera/1', { modo: 'sesion', metodo: 'PATCH', params: { id: '1' }, cuerpo: { accion: 'x' } })).status).toBe(422);
  });
});

describe('lecturas calculadas', () => {
  it('metricas, recomendaciones, tendencias y suscripciones responden con forma válida', async () => {
    await llamar(config.PATCH, '/api/config', { modo: 'sesion', metodo: 'PATCH', cuerpo: { clave: 'ingreso_mensual', valor: 4000000 } });
    await llamar(movs.POST, '/api/movimientos', { cuerpo: { fecha: '2026-10-14', hora: '12:00', banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto: 30000, comercio: 'Almuerzo', origen: 'manual' } });
    const m = await json(await llamar(metricas.GET, '/api/metricas'));
    expect(m).toMatchObject({ fecha: '2026-10-15', mes: '2026-10', dia: 15, dias_restantes: 17 });
    expect(m.base.modo).toBe('ingreso_configurado');
    expect((await llamar(metricas.GET, '/api/metricas?fecha=2026-12-31')).status).toBe(422);
    expect((await json(await llamar(metricas.GET, '/api/metricas?fecha=2026-10-14'))).fecha).toBe('2026-10-14');
    expect(Array.isArray((await json(await llamar(recomendaciones.GET, '/api/recomendaciones'))).items)).toBe(true);
    const t = await json(await llamar(tendencias.GET, '/api/tendencias?meses=3', { modo: 'sesion' }));
    expect(t.items.map((x: { mes: string }) => x.mes)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(t.items[2].gastado_variable).toBe(30000);
    expect((await llamar(tendencias.GET, '/api/tendencias?meses=99', { modo: 'sesion' })).status).toBe(422);
    expect((await json(await llamar(suscripciones.GET, '/api/suscripciones', { modo: 'sesion' }))).items).toEqual([]);
  });
});

describe('POST /api/vault/exportar', () => {
  it('escribe SOLO en la carpeta temporal y devuelve la ruta relativa', async () => {
    const dir = temp();
    preparar(crearIAFalsa({ json: null }), dir);
    await llamar(movs.POST, '/api/movimientos', { cuerpo: { fecha: '2026-09-10', hora: '22:41', banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto: 45000, comercio: 'Cena secreta', nota: 'NOTA PRIVADA', origen: 'manual' } });
    const res = await llamar(vault.POST, '/api/vault/exportar', { cuerpo: { mes: '2026-09' } });
    expect(res.status).toBe(200);
    const j = await json(res);
    expect(j.ruta).toBe('Finanzas/Plata/2026-09.md');
    expect(j.bytes).toBeGreaterThan(100);
    const archivo = path.join(dir, 'Plata', '2026-09.md');
    const nota = fs.readFileSync(archivo, 'utf8');
    expect(nota).toContain('mes: 2026-09');
    expect(nota).not.toContain('NOTA PRIVADA');
    expect(nota).not.toContain('22:41');
    expect(Buffer.byteLength(nota)).toBe(j.bytes);
    // idempotente (sobrescribe)
    expect((await llamar(vault.POST, '/api/vault/exportar', { modo: 'sesion', cuerpo: { mes: '2026-09' } })).status).toBe(200);
    expect(fs.readdirSync(path.join(dir, 'Plata'))).toEqual(['2026-09.md']);
  });

  it('mes inválido, futuro, traversal o sin vault configurado → 422', async () => {
    const dir = temp();
    preparar(crearIAFalsa({ json: null }), dir);
    for (const mes of ['../../x', '2026-13', '2026-11', 5, undefined]) {
      expect((await llamar(vault.POST, '/api/vault/exportar', { cuerpo: { mes } })).status, String(mes)).toBe(422);
    }
    expect(fs.existsSync(path.join(dir, 'Plata'))).toBe(false);
    preparar();   // sin PLATA_VAULT_FINANZAS
    const r = await llamar(vault.POST, '/api/vault/exportar', { cuerpo: { mes: '2026-09' } });
    expect(r.status).toBe(422);
    expect((await json(r)).error.codigo).toBe('vault_no_configurado');
  });
});

describe('POST /api/alertas/pendientes', () => {
  it('responde la forma del SPEC y deja la base consistente', async () => {
    const j = await json(await llamar(alertas.POST, '/api/alertas/pendientes', { cuerpo: {} }));
    expect(Array.isArray(j.respuestas)).toBe(true);
    expect(Array.isArray(j.enviadas)).toBe(true);
    expect(Array.isArray(j.suprimidas)).toBe(true);
    expect(n("SELECT count(*) AS n FROM eventos WHERE tipo = 'mantenimiento'")).toBe(1);
    expect((await llamar(alertas.POST, '/api/alertas/pendientes', { modo: 'nada', cuerpo: {}, headers: { authorization: 'Bearer incorrecto' } })).status).toBe(401);
  });

  it('el recordatorio de la lista de espera sale una vez y queda marcado', async () => {
    const it = await json(await llamar(espera.POST, '/api/lista-espera', { modo: 'sesion', cuerpo: { descripcion: 'Chaqueta', monto: 300000 } }));
    fijarRelojApi(() => new Date('2026-10-18T17:00:00Z'));   // pasaron más de 48 h (12:00 Bogotá, dentro del horario de push)
    const j1 = await json(await llamar(alertas.POST, '/api/alertas/pendientes', { cuerpo: {} }));
    expect(j1.enviadas).toContain(`espera_lista:${it.id}`);
    const botones = JSON.stringify(j1.respuestas);
    expect(botones).toContain('Chaqueta');
    expect(n('SELECT count(*) AS n FROM lista_espera WHERE recordado_en IS NOT NULL')).toBe(1);
    const j2 = await json(await llamar(alertas.POST, '/api/alertas/pendientes', { cuerpo: {} }));
    expect(j2.enviadas).not.toContain(`espera_lista:${it.id}`);
  });
});
