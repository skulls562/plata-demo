// Pruebas de rutas sin red (SPEC §8.2 «rutas»): /api/sesion, conAuth, leerJSON, idempotencia y proxy.
// Se llama a los handlers con Request estándar; la base es SQLite en memoria con las tablas de §1.2.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { ErrorConflicto, ErrorUsuario } from '@/lib/tipos';
import {
  ErrorHTTP, LIMITES_CUERPO, conAuth, conIdempotencia, fijarAlmacenSeguridad, fijarEntorno, leerJSON,
  reiniciarEstadoHTTP, respuestaError, respuestaJSON,
} from '@/lib/http';
import { crearAlmacenSQLite, firmarCookie, guardarPinNuevo, hashPin, leerEntorno, nuevoIdSesion } from '@/lib/seguridad';
import { DELETE as cerrarSesion, POST as entrar } from '@/app/api/sesion/route';
import { ENV_PRUEBA, SECRETO_PRUEBA, TOKEN_PRUEBA, TOKEN_VIEJO_PRUEBA, baseDePrueba } from './base-prueba';

const BASE = 'http://127.0.0.1:3010';
const ORIGEN = 'http://127.0.0.1:3010';
const PIN = '482916';
let HASH_PIN = '';
let db: DatabaseSync;
const sinParams = { params: Promise.resolve({}) };

function peticion(ruta: string, init: { method?: string; headers?: Record<string, string>; body?: string | ReadableStream } = {}) {
  const headers = new Headers({ host: '127.0.0.1:3010', ...init.headers });
  return new Request(`${BASE}${ruta}`, {
    method: init.method ?? 'GET', headers, body: init.body,
    ...(init.body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
}
function postSesion(cuerpo: unknown, headers: Record<string, string> = {}) {
  return entrar(peticion('/api/sesion', {
    method: 'POST', body: JSON.stringify(cuerpo),
    headers: { 'content-type': 'application/json', origin: ORIGEN, 'sec-fetch-site': 'same-origin', ...headers },
  }), sinParams);
}
async function cuerpo(res: Response) { return res.json() as Promise<{ error?: { codigo: string; mensaje?: string; detalles?: unknown } }>; }
function cookieDe(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}
function contar(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

// Rutas de prueba envueltas con cada política.
const rutaToken = conAuth('token', async (_r, c) => respuestaJSON({ actor: c.actor }));
const rutaSesion = conAuth('sesion', async (_r, c) => respuestaJSON({ actor: c.actor }));
const rutaMixta = conAuth('token_o_sesion', async (_r, c) => respuestaJSON({ actor: c.actor }));

beforeAll(async () => { HASH_PIN = await hashPin(PIN); });
beforeEach(() => {
  db = baseDePrueba();
  fijarEntorno(leerEntorno({ ...ENV_PRUEBA, PLATA_TOKEN_ANTERIOR: TOKEN_VIEJO_PRUEBA }));
  fijarAlmacenSeguridad(crearAlmacenSQLite(db));
  reiniciarEstadoHTTP();
});
afterEach(() => { vi.useRealTimers(); });

describe('POST /api/sesion', () => {
  it('sin PIN creado → 503 pin_no_configurado (nadie reclama el panel)', async () => {
    const res = await postSesion({ pin: PIN });
    expect(res.status).toBe(503);
    expect((await cuerpo(res)).error?.codigo).toBe('pin_no_configurado');
  });

  it('PIN correcto → 204 + cookie httpOnly firmada; en la base solo el hash del id', async () => {
    guardarPinNuevo(db, HASH_PIN);
    const res = await postSesion({ pin: PIN });
    expect(res.status).toBe(204);
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/^plata_sesion=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const id = cookieDe(res).split('=')[1].split('.')[0];
    const fila = db.prepare('SELECT id_hash FROM sesiones').get() as { id_hash: string };
    expect(fila.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.id_hash).not.toContain(id);
    // La cookie abre rutas de sesión.
    const r2 = await rutaSesion(peticion('/api/x', { headers: { cookie: cookieDe(res) } }), sinParams);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ actor: 'panel' });
  });

  it('PIN incorrecto → 401; al 5.º fallo, 429 con Retry-After y ni el PIN correcto entra', async () => {
    guardarPinNuevo(db, HASH_PIN);
    for (let i = 0; i < 5; i++) expect((await postSesion({ pin: '739182' })).status).toBe(401);
    const bloqueada = await postSesion({ pin: PIN });
    expect(bloqueada.status).toBe(429);
    expect(Number(bloqueada.headers.get('retry-after'))).toBeGreaterThan(290);
    expect((await cuerpo(bloqueada)).error?.codigo).toBe('demasiados_intentos');
    expect(contar('SELECT count(*) AS n FROM sesiones')).toBe(0);
  });

  it('intentos en paralelo no se saltan el límite (se atienden en serie)', async () => {
    guardarPinNuevo(db, HASH_PIN);
    const estados = (await Promise.all(Array.from({ length: 12 }, () => postSesion({ pin: '739182' })))).map((r) => r.status);
    expect(estados.filter((s) => s === 401)).toHaveLength(5);
    expect(estados.filter((s) => s === 429)).toHaveLength(7);
  });

  it('formato raro de PIN cuenta como fallo, sin romper nada', async () => {
    guardarPinNuevo(db, HASH_PIN);
    for (const pin of [123456, '12', null, { a: 1 }, 'x'.repeat(40)]) {
      expect((await postSesion({ pin })).status).toBe(401);
    }
  });

  it('sin Origin, con Origin ajeno o cross-site → 403 (CSRF); Host raro → 403', async () => {
    guardarPinNuevo(db, HASH_PIN);
    const base = { 'content-type': 'application/json' };
    const casos: Record<string, string>[] = [
      base,
      { ...base, origin: 'http://evil.com' },
      { ...base, origin: 'null' },
      { ...base, origin: ORIGEN, 'sec-fetch-site': 'cross-site' },
      { ...base, origin: ORIGEN, host: '127.0.0.1:3010.evil.com' },
      { ...base, origin: ORIGEN, 'x-forwarded-host': 'evil.com' },
    ];
    for (const headers of casos) {
      const res = await entrar(peticion('/api/sesion', { method: 'POST', body: JSON.stringify({ pin: PIN }), headers }), sinParams);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    const res = await entrar(peticion('/api/sesion', { method: 'POST', body: '{}', headers: { ...base, origin: ORIGEN, host: 'evil.com:3010' } }), sinParams);
    expect(await res.json()).toEqual({ error: { codigo: 'host_no_permitido' } });   // cuerpo mínimo
    expect(contar('SELECT count(*) AS n FROM limites')).toBe(0);                     // ni siquiera cuenta como intento
  });

  it('límites del cuerpo: text/plain → 415, > 1 KB → 413, JSON roto → 400', async () => {
    guardarPinNuevo(db, HASH_PIN);
    const h = { origin: ORIGEN };
    const r415 = await entrar(peticion('/api/sesion', { method: 'POST', body: `{"pin":"${PIN}"}`, headers: { ...h, 'content-type': 'text/plain' } }), sinParams);
    expect(r415.status).toBe(415);
    const r413 = await postSesion({ pin: PIN, relleno: 'x'.repeat(2000) });
    expect(r413.status).toBe(413);
    const r400 = await entrar(peticion('/api/sesion', { method: 'POST', body: '{pin:', headers: { ...h, 'content-type': 'application/json' } }), sinParams);
    expect(r400.status).toBe(400);
    expect((await cuerpo(r400)).error?.codigo).toBe('json_invalido');
  });
});

describe('sesión: vencimiento y cierre', () => {
  async function iniciar(): Promise<string> {
    guardarPinNuevo(db, HASH_PIN);
    return cookieDe(await postSesion({ pin: PIN }));
  }

  it('7 días sin uso → 401 y la fila se borra', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const c = await iniciar();
    vi.setSystemTime(new Date('2026-10-08T12:00:01Z'));
    const r = await rutaSesion(peticion('/api/x', { headers: { cookie: c } }), sinParams);
    expect(r.status).toBe(401);
    expect(contar('SELECT count(*) AS n FROM sesiones')).toBe(0);
  });

  it('30 días → 401 aunque se use a diario', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-01T12:00:00Z');
    vi.setSystemTime(t0);
    const c = await iniciar();
    for (let d = 1; d < 30; d++) {
      vi.setSystemTime(t0 + d * 86400e3);
      expect((await rutaSesion(peticion('/api/x', { headers: { cookie: c } }), sinParams)).status).toBe(200);
    }
    vi.setSystemTime(t0 + 30 * 86400e3);
    expect((await rutaSesion(peticion('/api/x', { headers: { cookie: c } }), sinParams)).status).toBe(401);
  });

  it('cookie con firma alterada o sesión inexistente → 401', async () => {
    const c = await iniciar();
    const alterada = c.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A'));
    expect((await rutaSesion(peticion('/api/x', { headers: { cookie: alterada } }), sinParams)).status).toBe(401);
    const huerfana = `plata_sesion=${firmarCookie(nuevoIdSesion(), SECRETO_PRUEBA)}`;
    expect((await rutaSesion(peticion('/api/x', { headers: { cookie: huerfana } }), sinParams)).status).toBe(401);
    expect((await rutaSesion(peticion('/api/x'), sinParams)).status).toBe(401);
  });

  it('DELETE /api/sesion borra la fila y la cookie; después, 401', async () => {
    const c = await iniciar();
    const res = await cerrarSesion(peticion('/api/sesion', { method: 'DELETE', headers: { cookie: c, origin: ORIGEN } }), sinParams);
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(contar('SELECT count(*) AS n FROM sesiones')).toBe(0);
    expect((await rutaSesion(peticion('/api/x', { headers: { cookie: c } }), sinParams)).status).toBe(401);
  });

  it('un nuevo inicio no reutiliza el id (sin fijación) y descarta la sesión previa', async () => {
    const c1 = await iniciar();
    const c2 = cookieDe(await postSesion({ pin: PIN }, { cookie: c1 }));
    expect(c2).not.toBe(c1);
    expect(contar('SELECT count(*) AS n FROM sesiones')).toBe(1);
    expect((await rutaSesion(peticion('/api/x', { headers: { cookie: c1 } }), sinParams)).status).toBe(401);
  });

  it('mutación con sesión exige Origin permitido', async () => {
    const c = await iniciar();
    const mutar = conAuth('sesion', async () => respuestaJSON({ ok: true }));
    const sinOrigen = await mutar(peticion('/api/x', { method: 'PATCH', headers: { cookie: c } }), sinParams);
    expect(sinOrigen.status).toBe(403);
    const ajeno = await mutar(peticion('/api/x', { method: 'PATCH', headers: { cookie: c, origin: 'http://evil.com' } }), sinParams);
    expect(ajeno.status).toBe(403);
    const ok = await mutar(peticion('/api/x', { method: 'PATCH', headers: { cookie: c, origin: ORIGEN, 'sec-fetch-site': 'same-origin' } }), sinParams);
    expect(ok.status).toBe(200);
  });
});

describe('conAuth con token (n8n)', () => {
  const bearer = { authorization: `Bearer ${TOKEN_PRUEBA}` };
  it('sin token → 401; token válido → actor n8n; token anterior válido', async () => {
    expect((await rutaToken(peticion('/api/x'), sinParams)).status).toBe(401);
    expect((await rutaToken(peticion('/api/x', { headers: { authorization: 'Bearer malo' } }), sinParams)).status).toBe(401);
    const ok = await rutaToken(peticion('/api/x', { headers: bearer }), sinParams);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ actor: 'n8n' });
    expect((await rutaToken(peticion('/api/x', { headers: { authorization: `Bearer ${TOKEN_VIEJO_PRUEBA}` } }), sinParams)).status).toBe(200);
  });
  it('token con Origin → 403; Host raro → 403', async () => {
    expect((await rutaToken(peticion('/api/x', { headers: { ...bearer, origin: ORIGEN } }), sinParams)).status).toBe(403);
    expect((await rutaToken(peticion('/api/x', { headers: { ...bearer, host: 'localhost:3011' } }), sinParams)).status).toBe(403);
  });
  it('token inválido no cae a la sesión (token_o_sesion)', async () => {
    guardarPinNuevo(db, HASH_PIN);
    const c = cookieDe(await postSesion({ pin: PIN }));
    expect((await rutaMixta(peticion('/api/x', { headers: { cookie: c } }), sinParams)).status).toBe(200);
    expect((await rutaMixta(peticion('/api/x', { headers: { cookie: c, authorization: 'Bearer malo' } }), sinParams)).status).toBe(401);
  });
  it('más de 120 peticiones por minuto → 429 con Retry-After', async () => {
    for (let i = 0; i < 120; i++) await rutaToken(peticion('/api/x', { headers: bearer }), sinParams);
    const r = await rutaToken(peticion('/api/x', { headers: bearer }), sinParams);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('cabecera de Server Action → 403', async () => {
    expect((await rutaToken(peticion('/api/x', { headers: { ...bearer, 'next-action': 'abc' } }), sinParams)).status).toBe(403);
  });
});

describe('leerJSON y errores', () => {
  const json = (body: string | ReadableStream, extra: Record<string, string> = {}) =>
    peticion('/api/x', { method: 'POST', body, headers: { 'content-type': 'application/json', ...extra } });

  it('cuerpo de 300 KB en /api/avisos (256 KB) → 413', async () => {
    const grande = JSON.stringify({ text: 'x'.repeat(300 * 1024) });
    await expect(leerJSON(json(grande), LIMITES_CUERPO.avisos)).rejects.toMatchObject({ estado: 413, codigo: 'cuerpo_grande' });
  });
  it('no confía en Content-Length: corta el stream al pasarse', async () => {
    let enviados = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(ctrl) { enviados += 1024; ctrl.enqueue(new Uint8Array(1024).fill(32)); if (enviados > 1024 * 1024) ctrl.close(); },
    });
    await expect(leerJSON(json(flujo), LIMITES_CUERPO.bot)).rejects.toMatchObject({ estado: 413 });
    expect(enviados).toBeLessThan(64 * 1024);   // dejó de leer pronto
  });
  it('charset distinto de utf-8, UTF-8 inválido y vacío', async () => {
    await expect(leerJSON(json('{}', { 'content-type': 'application/json; charset=latin1' }), 1024)).rejects.toMatchObject({ estado: 415 });
    const malo = new Request(`${BASE}/api/x`, { method: 'POST', body: new Uint8Array([0x7b, 0xff, 0x7d]), headers: { 'content-type': 'application/json' } });
    await expect(leerJSON(malo, 1024)).rejects.toMatchObject({ estado: 400 });
    await expect(leerJSON(json(''), 1024)).rejects.toMatchObject({ estado: 400 });
    expect(await leerJSON(json('{"a":1}', { 'content-type': 'application/json; charset=utf-8' }), 1024)).toEqual({ a: 1 });
  });
  it('respuestaError: 409 con version_actual, 422 de usuario, 500 sin filtrar el mensaje', async () => {
    const r409 = respuestaError(new ErrorConflicto(4));
    expect(r409.status).toBe(409);
    expect(await r409.json()).toMatchObject({ error: { codigo: 'conflicto_version', detalles: { version_actual: 4 } } });
    const r422 = respuestaError(new ErrorUsuario('validacion', 'monto inválido'));
    expect(r422.status).toBe(422);
    const r500 = respuestaError(new Error('fallo con la cuenta 98765432109 y token secreto'));
    expect(r500.status).toBe(500);
    const t = await r500.text();
    expect(t).not.toContain('98765432109');
    expect(t).not.toContain('secreto');
    const ev = db.prepare('SELECT tipo, detalle FROM eventos').get() as { tipo: string; detalle: string };
    expect(ev.tipo).toBe('error_interno');
    expect(ev.detalle).not.toContain('98765432109');
    expect(respuestaError(new ErrorHTTP(429, 'demasiados_intentos', 'x', { reintentar_en_s: 12 })).headers.get('retry-after')).toBe('12');
  });
});

describe('conIdempotencia', () => {
  it('misma clave y cuerpo → misma respuesta sin repetir efectos; otro cuerpo → 409', async () => {
    let llamadas = 0;
    const fn = async () => { llamadas++; return respuestaJSON({ id: llamadas }, 201); };
    const req = () => peticion('/api/movimientos', { method: 'POST', headers: { 'idempotency-key': 'clave-abc-123' } });
    const a = await conIdempotencia(req(), '/api/movimientos', { monto: 1000 }, fn);
    const b = await conIdempotencia(req(), '/api/movimientos', { monto: 1000 }, fn);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual({ id: 1 });
    expect(llamadas).toBe(1);
    await expect(conIdempotencia(req(), '/api/movimientos', { monto: 2000 }, fn)).rejects.toMatchObject({ estado: 409, codigo: 'idempotencia_conflicto' });
    const malaClave = peticion('/api/movimientos', { method: 'POST', headers: { 'idempotency-key': 'x' } });
    await expect(conIdempotencia(malaClave, '/api/movimientos', {}, fn)).rejects.toMatchObject({ estado: 422 });
  });
  it('dos reintentos simultáneos ejecutan una sola vez', async () => {
    let llamadas = 0;
    const fn = async () => { llamadas++; await new Promise((r) => setTimeout(r, 20)); return respuestaJSON({ ok: true }, 201); };
    const req = () => peticion('/api/x', { method: 'POST', headers: { 'idempotency-key': 'clave-par-0001' } });
    const [a, b] = await Promise.all([conIdempotencia(req(), '/api/x', {}, fn), conIdempotencia(req(), '/api/x', {}, fn)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(llamadas).toBe(1);
  });
});

describe('proxy.ts (sin base)', () => {
  type ModProxy = typeof import('@/proxy');
  let proxy: ModProxy['proxy'];
  let NextRequest: typeof import('next/server').NextRequest;
  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV_PRUEBA)) vi.stubEnv(k, v);
    ({ proxy } = await import('@/proxy'));
    ({ NextRequest } = await import('next/server'));
  });
  const req = (ruta: string, headers: Record<string, string> = {}, method = 'GET') =>
    new NextRequest(`${BASE}${ruta}`, { method, headers: { host: '127.0.0.1:3010', ...headers } });
  const pasa = (r: Response) => r.headers.get('x-middleware-next') === '1';

  it('API sin token ni cookie → 401; Host raro → 403', async () => {
    const r = proxy(req('/api/movimientos'));
    expect(r.status).toBe(401);
    expect(proxy(req('/api/movimientos', { host: '127.0.0.1:3010.evil.com', authorization: `Bearer ${TOKEN_PRUEBA}` })).status).toBe(403);
    expect(proxy(req('/', { host: 'evil.com' })).status).toBe(403);
    expect(proxy(req('/api/salud', { 'x-forwarded-host': 'evil.com' })).status).toBe(403);
  });
  it('con Bearer o cookie firmada pasa (la ruta valida); públicas pasan', () => {
    expect(pasa(proxy(req('/api/movimientos', { authorization: 'Bearer cualquiera' })))).toBe(true);
    const c = `plata_sesion=${firmarCookie(nuevoIdSesion(), SECRETO_PRUEBA)}`;
    expect(pasa(proxy(req('/api/movimientos', { cookie: c })))).toBe(true);
    expect(proxy(req('/api/movimientos', { cookie: `${c}x` })).status).toBe(401);
    expect(pasa(proxy(req('/api/salud')))).toBe(true);
    expect(pasa(proxy(req('/api/sesion', {}, 'POST')))).toBe(true);
    expect(pasa(proxy(req('/entrar')))).toBe(true);
  });
  it('páginas sin sesión → 303 a /entrar; OPTIONS → 405; Server Action → 403', () => {
    const r = proxy(req('/movimientos'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`${BASE}/entrar`);   // mismo origen que pidió el navegador
    expect(proxy(req('/movimientos', { host: 'localhost:3010' })).headers.get('location')).toBe('http://localhost:3010/entrar');
    expect(proxy(req('/api/movimientos', { origin: 'http://evil.com' }, 'OPTIONS')).status).toBe(405);
    expect(proxy(req('/', { 'next-action': 'abc' }, 'POST')).status).toBe(403);
  });
  it('añade las cabeceras de seguridad', () => {
    const r = proxy(req('/entrar'));
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(proxy(req('/api/salud')).headers.get('cache-control')).toBe('no-store');
  });
});
