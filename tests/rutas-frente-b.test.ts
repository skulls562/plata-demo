// Rutas del Frente B con base temporal (SQLite en memoria, migración real) e IA falsa. Sin red ni Ollama.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { abrirDB } from '@/lib/db';
import { crearAccesoDatos } from '@/lib/datos';
import { aBogota } from '@/lib/formato';
import { fijarAlmacenSeguridad, fijarEntorno, reiniciarEstadoHTTP } from '@/lib/http';
import { crearAlmacenSQLite, leerEntorno } from '@/lib/seguridad';
import { fijarClienteIA } from '@/lib/api';
import { marcarSeguridadConectada } from '@/lib/arranque';
import type { AccesoDatos } from '@/lib/tipos';
import { POST as bot } from '@/app/api/bot/route';
import { GET as reportes } from '@/app/api/reportes/[tipo]/route';
import { POST as pregunta } from '@/app/api/pregunta/route';
import { POST as puedo } from '@/app/api/puedo/route';
import { crearIAFalsa } from './fakes/ia-falsa';
import { ENV_PRUEBA, TOKEN_PRUEBA } from './seguridad/base-prueba';

const BASE = 'http://127.0.0.1:3010';
const CHAT = 123456789;
let db: DatabaseSync;
let datos: AccesoDatos;
const hoy = () => aBogota(new Date()).fecha;

function req(ruta: string, o: { method?: string; body?: unknown; token?: boolean; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ host: '127.0.0.1:3010', ...o.headers });
  if (o.token !== false) headers.set('authorization', `Bearer ${TOKEN_PRUEBA}`);
  if (o.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${BASE}${ruta}`, { method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}
const ctx = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });
const upd = (update_id: number, texto: string, chat_id: number | string = CHAT) => ({ update_id, chat_id, tipo: 'texto', texto });
const llamarBot = (b: unknown, extra: Parameters<typeof req>[1] = {}) => bot(req('/api/bot', { body: b, ...extra }), ctx());

beforeEach(() => {
  db = abrirDB(':memory:');
  datos = crearAccesoDatos(db);
  fijarEntorno(leerEntorno(ENV_PRUEBA));
  fijarAlmacenSeguridad(crearAlmacenSQLite(db));
  reiniciarEstadoHTTP();
  globalThis.__plataDB = db;
  marcarSeguridadConectada(true);
  fijarClienteIA(crearIAFalsa({ disponible: false }));
  datos.fijarConfig('ingreso_mensual', 4_000_000, 'sistema');
});

describe('POST /api/bot', () => {
  it('exige token', async () => {
    expect((await llamarBot(upd(1, '/hoy'), { token: false, headers: { authorization: 'Bearer incorrecto' } })).status).toBe(401);
    // sin Authorization una mutación se trata como de navegador: exige Origin
    expect((await llamarBot(upd(1, '/hoy'), { token: false })).status).toBe(403);
  });

  it('/hoy responde con el semáforo y registra el latido', async () => {
    const res = await llamarBot(upd(10, '/hoy'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.respuestas[0].texto).toContain('<b>Hoy</b>');
    const l = db.prepare("SELECT flujo FROM latidos WHERE flujo = 'bot'").get();
    expect(l).toBeTruthy();
  });

  it('chat ajeno → 200 vacío + evento con el id enmascarado', async () => {
    const res = await llamarBot(upd(11, '/hoy', 999888777666));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ respuestas: [], ignorado: 'chat_no_autorizado' });
    const ev = db.prepare("SELECT detalle FROM eventos WHERE tipo = 'chat_no_autorizado'").get() as { detalle: string };
    expect(ev.detalle).not.toContain('999888777666');
  });

  it('el mismo update_id devuelve la misma respuesta sin repetir efectos', async () => {
    const a = await (await llamarBot(upd(20, '/gasto 20k almuerzo'))).text();
    const b = await (await llamarBot(upd(20, '/gasto 20k almuerzo'))).text();
    expect(b).toBe(a);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM movimientos WHERE origen = 'manual'").get() as { n: number }).n;
    expect(n).toBe(1);
    await llamarBot(upd(21, '/gasto 20k almuerzo'));
    expect((db.prepare("SELECT COUNT(*) AS n FROM movimientos WHERE origen = 'manual'").get() as { n: number }).n).toBe(2);
  });

  it('callbacks: texto vacío con answer_callback; data inválida no es 4xx', async () => {
    const ok = await (await llamarBot({ update_id: 30, chat_id: CHAT, tipo: 'callback', callback_data: 'ok', callback_query_id: 'q1', message_id: 5 })).json();
    expect(ok.respuestas).toEqual([{ texto: '', answer_callback: {} }]);
    const malo = await llamarBot({ update_id: 31, chat_id: CHAT, tipo: 'callback', callback_data: 'DROP;--', message_id: 5 });
    expect(malo.status).toBe(200);
  });

  it('cat: cambia categoría y aprende vía la base real', async () => {
    await llamarBot(upd(40, '/gasto 20k tienda xyz'));
    const j = await (await llamarBot(upd(41, '/cat comida'))).json();
    expect(j.respuestas[0].texto).toContain('ahora es <b>Comida</b>');
    const fila = db.prepare("SELECT categoria_id FROM movimientos WHERE origen = 'manual'").get() as { categoria_id: string };
    expect(fila.categoria_id).toBe('comida');
  });

  it('cuerpo mal formado → 422; 415 sin JSON', async () => {
    expect((await llamarBot({ update_id: 'x' })).status).toBe(422);
    const r = new Request(`${BASE}/api/bot`, { method: 'POST', headers: { host: '127.0.0.1:3010', authorization: `Bearer ${TOKEN_PRUEBA}`, 'content-type': 'text/plain' }, body: 'hola' });
    expect((await bot(r, ctx())).status).toBe(415);
  });
});

describe('POST /api/bot: sin comandos (base real en memoria)', () => {
  let uid = 5000;
  const cbq = (data: string, message_id = 90) => ({ update_id: uid++, chat_id: CHAT, tipo: 'callback', callback_data: data, callback_query_id: 'q', message_id });
  const txt = (t: string) => ({ update_id: uid++, chat_id: CHAT, tipo: 'texto', texto: t, message_id: 5 });
  const resp = async (b: unknown) => (await (await llamarBot(b)).json()).respuestas as { texto: string; botones?: { texto: string; callback_data: string }[][]; teclado?: string[][]; editar_message_id?: number; answer_callback?: { texto?: string; alerta?: boolean } }[];
  const datosBtn = (r: { botones?: { callback_data: string }[][] }) => (r.botones ?? []).flat().map((b) => b.callback_data);

  it('POST /api/bot con tipo texto y «/start» devuelve el menú fijo (teclado de 3 filas)', async () => {
    const rs = await resp(txt('/start'));
    const r = rs.find((x) => x.teclado);
    expect(r, 'ninguna respuesta trae teclado').toBeDefined();
    expect(r!.teclado).toHaveLength(3);
    expect(r!.teclado!.flat().slice(0, 3)).toEqual(['💰 Hoy', '📅 Mes', '➕ Gasto']);
    expect(r!.botones).toBeUndefined();
  });

  it('el menú fijo llega como mensaje sin botones en línea', async () => {
    const [r] = await resp(txt('/menu'));
    expect(r.teclado).toHaveLength(3);
    expect(r.botones).toBeUndefined();
  });

  it('Gasto con teclado numérico: el estado vive en bot_estado y el gasto queda en la base', async () => {
    const [k] = await resp(txt('➕ Gasto'));
    const n = /^k:([a-z0-9]+):/.exec(datosBtn(k)[0])![1];
    expect((db.prepare('SELECT flujo FROM bot_estado').get() as { flujo: string }).flujo).toBe('gasto');
    for (const t of ['2', '5', 't']) await resp(cbq(`k:${n}:${t}`));
    const [cat] = await resp(cbq(`k:${n}:l`));
    expect(cat.texto).toContain('Gasto de $25.000');
    expect(cat.editar_message_id).toBe(90);
    const [ok] = await resp(cbq(`c:${n}:comida`));
    expect(ok.texto).toBe('✅ Anotado <b>$25.000</b> · 🍔 Comida');
    expect(datosBtn(ok)[0]).toMatch(/^und:\d+$/);
    const fila = db.prepare("SELECT monto, categoria_id, origen FROM movimientos WHERE origen = 'manual'").get() as { monto: number; categoria_id: string; origen: string };
    expect(fila).toEqual({ monto: 25_000, categoria_id: 'comida', origen: 'manual' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bot_estado').get()).toEqual({ n: 0 });
    // Deshacer
    await resp(cbq(datosBtn(ok)[0]));
    expect(db.prepare('SELECT COUNT(*) AS n FROM movimientos WHERE borrado_en IS NULL').get()).toEqual({ n: 0 });
  });

  it('callback viejo: «Eso ya pasó» (estado vencido o terminado) sin crear nada', async () => {
    const [k] = await resp(txt('➕ Gasto'));
    const n = /^k:([a-z0-9]+):/.exec(datosBtn(k)[0])![1];
    db.prepare("UPDATE bot_estado SET expira_en = '2000-01-01T00:00:00Z'").run();   // vencido
    expect(await resp(cbq(`k:${n}:5`))).toEqual([{ texto: '', answer_callback: { texto: 'Eso ya pasó' } }]);
    expect(await resp(cbq(`c:${n}:comida`))).toEqual([{ texto: '', answer_callback: { texto: 'Eso ya pasó' } }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM movimientos').get()).toEqual({ n: 0 });
  });

  it('el mismo update_id de un tecleo no lo repite (idempotencia)', async () => {
    const [k] = await resp(txt('➕ Gasto'));
    const n = /^k:([a-z0-9]+):/.exec(datosBtn(k)[0])![1];
    const u = cbq(`k:${n}:5`);
    await resp(u); await resp(u);
    const [r] = await resp(cbq(`k:${n}:b`));
    expect(r.texto).toContain('<b>$0</b>');   // se agregó un solo «5» y ahora se borró
  });

  it('un gasto por texto libre se anota; sin regla pregunta y «Sí, siempre» deja una regla aprendida en la base', async () => {
    const [a] = await resp(txt('uber 12.500'));
    expect(a.texto).toContain('🚕 Transporte');
    const [b] = await resp(txt('8k tienda doña rosa'));
    expect(b.texto).toContain('¿En qué se fue?');
    const id = Number(/^cs:(\d+):/.exec(datosBtn(b)[0])![1]);
    const [q] = await resp(cbq(`cs:${id}:mercado`));
    expect(q.texto).toContain('¿Recordar «tienda doña rosa» → 🛒 Mercado?');
    expect(db.prepare("SELECT COUNT(*) AS n FROM reglas_categoria WHERE origen = 'aprendida'").get()).toEqual({ n: 0 });
    await resp(cbq(`rm:${id}:mercado`));
    expect(db.prepare("SELECT categoria_id FROM reglas_categoria WHERE origen = 'aprendida'").get()).toEqual({ categoria_id: 'mercado' });
    expect((await resp(txt('tienda doña rosa 9000')))[0].texto).toContain('🛒 Mercado');
  });

  it('pendientes con la base real: lista, categoriza y queda al día', async () => {
    datos.crearMovimiento({ fecha: hoy(), hora: '10:00', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 18_000, comercio: 'Pago por QR', origen: 'aviso' }, 'n8n');
    datos.crearMovimiento({ fecha: hoy(), hora: '11:00', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 9_000, comercio: 'COMERCIO RARO XYZ', origen: 'aviso' }, 'n8n');
    const [m] = await resp(txt('/menu'));
    expect(m.teclado![1][2]).toBe('🧾 Pendientes (2)');
    const [p1] = await resp(txt('🧾 Pendientes (2)'));
    expect(p1.texto).toContain('quedan 1 más');
    const id1 = Number(/^pc:(\d+):/.exec(datosBtn(p1)[0])![1]);
    const [p2] = await resp(cbq(`pc:${id1}:ocio`));
    expect(p2.texto).toContain('es el último');
    const id2 = Number(/^pc:(\d+):/.exec(datosBtn(p2)[0])![1]);
    const [fin] = await resp(cbq(`pc:${id2}:compras`));
    expect(fin.texto).toContain('Todo al día');
    expect((await resp(txt('/menu')))[0].teclado![1][2]).toBe('🧾 Pendientes');
  });

  it('el chat ajeno no deja estado ni movimientos', async () => {
    const res = await llamarBot({ update_id: uid++, chat_id: 999888777, tipo: 'texto', texto: '➕ Gasto' });
    expect(await res.json()).toEqual({ respuestas: [], ignorado: 'chat_no_autorizado' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bot_estado').get()).toEqual({ n: 0 });
  });
});

describe('GET /api/reportes/{tipo}', () => {
  const get = (tipo: string, q = '') => reportes(req(`/api/reportes/${tipo}${q}`), ctx({ tipo }));

  it('cierre incluso sin gastos', async () => {
    const j = await (await get('cierre')).json();
    expect(j.tipo).toBe('cierre');
    expect(j.fecha).toBe(hoy());
    expect(j.respuestas[0].texto).toContain('Hoy no gastaste nada');
    expect(j.datos).toMatchObject({ gastado_hoy: 0, racha: 0 });
  });

  it('cierre con gasto y reportes semanal, mensual y suscripciones', async () => {
    datos.crearMovimiento({ fecha: hoy(), hora: '10:00', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 25_000, comercio: 'TIENDA D1', origen: 'aviso' }, 'n8n');
    expect((await (await get('cierre')).json()).respuestas[0].texto).toContain('Gastaste');
    expect((await (await get('semanal')).json()).respuestas[0].texto).toContain('Últimos 7 días');
    expect((await (await get('mensual')).json()).datos.mes).toMatch(/^\d{4}-\d{2}$/);
    expect((await (await get('suscripciones')).json()).respuestas).toEqual([]);
  });

  it('fecha opcional, validación y tipo desconocido', async () => {
    expect((await get('cierre', '?fecha=2026-10-06')).status).toBe(200);
    expect((await get('cierre', '?fecha=2999-01-01')).status).toBe(422);
    expect((await get('cierre', '?fecha=ayer')).status).toBe(422);
    expect((await get('inventado')).status).toBe(404);
    expect((await reportes(req('/api/reportes/cierre', { token: false }), ctx({ tipo: 'cierre' }))).status).toBe(401);
  });

  it('con pausa vigente no manda nada', async () => {
    datos.fijarConfig('pausa_hasta', new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'), 'bot');
    const j = await (await get('cierre')).json();
    expect(j).toMatchObject({ respuestas: [], pausado: true });
  });
});

describe('POST /api/pregunta y /api/puedo', () => {
  it('pregunta usa la IA falsa o la plantilla, sin red', async () => {
    const j = await (await pregunta(req('/api/pregunta', { body: { pregunta: '¿cuánto puedo gastar hoy?' } }), ctx())).json();
    expect(j).toMatchObject({ intencion: 'dinero_libre_hoy', fuente: 'plantilla' });
    fijarClienteIA(crearIAFalsa({ json: { intencion: 'metas', parametros: {} }, texto: null }));
    expect((await (await pregunta(req('/api/pregunta', { body: { pregunta: 'cómo van mis metas' } }), ctx())).json()).intencion).toBe('metas');
  });

  it('pregunta valida el cuerpo', async () => {
    for (const body of [{}, { pregunta: '' }, { pregunta: 'x'.repeat(501) }, { pregunta: 5 }]) {
      expect((await pregunta(req('/api/pregunta', { body }), ctx())).status).toBe(422);
    }
    expect((await pregunta(req('/api/pregunta', { body: { pregunta: 'hola' }, token: false, headers: { authorization: 'Bearer incorrecto' } }), ctx())).status).toBe(401);
  });

  it('puedo devuelve el veredicto y NO agrega a la lista de espera', async () => {
    const res = await puedo(req('/api/puedo', { body: { monto: 150_000, descripcion: 'audifonos' } }), ctx());
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v).toHaveProperty('decision');
    expect(v).toHaveProperty('regla_decisiva');
    expect(v.lista_espera_id).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM lista_espera').get() as { n: number }).n).toBe(0);
  });

  it('puedo valida monto y descripción', async () => {
    for (const body of [{}, { monto: 0 }, { monto: 'a' }, { monto: 1.5 }, { monto: 100, descripcion: 'x'.repeat(81) }]) {
      expect((await puedo(req('/api/puedo', { body }), ctx())).status).toBe(422);
    }
  });
});
