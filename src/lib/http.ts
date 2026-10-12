// Capa HTTP común de las rutas /api/* (SPEC §2.2, §5.1–5.3, §7.7). Revisión: opus (tarea A2).
//
// - Sin dependencias de Next: solo Request/Response estándar (se prueba con Vitest sin servidor).
// - `conAuth` repite los controles del proxy (defensa en profundidad): Host → Origin → autenticación.
// - El almacén (base) se inyecta con `fijarAlmacenSeguridad` (lo conecta la integración; ver
//   docs/DECISIONES-MENORES.md). Si falta, las rutas que lo necesitan fallan cerradas (500).

import { createHash } from 'node:crypto';
import { ErrorConflicto, ErrorUsuario } from './tipos';
import type { Actor } from './tipos';
import {
  NOMBRE_COOKIE_SESION, aISO, evaluarSesion, hashIdSesion, hostPermitido, leerCookie, leerCookieFirmada,
  leerEntorno, origenPermitido, sanitizarDetalle, tokenValido,
} from './seguridad';
import type { AlmacenSeguridad, EntornoPlata } from './seguridad';

export type Politica = 'publica' | 'token' | 'sesion' | 'token_o_sesion';

export class ErrorHTTP extends Error {
  estado: number;
  codigo: string;
  detalles?: unknown;
  constructor(estado: number, codigo: string, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.name = 'ErrorHTTP';
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
  /** Mensaje apto para el cliente: enmascarado y corto. */
  mensajePublico(): string {
    return sanitizarDetalle(this.message, 200);
  }
}

/** Límites de cuerpo de §7.7 (bytes). */
export const LIMITES_CUERPO = {
  avisos: 256 * 1024,
  avisos_lote: 2 * 1024 * 1024,
  bot: 16 * 1024,
  sesion: 1024,
  pregunta: 4 * 1024,
  defecto: 64 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Dependencias de proceso (en globalThis: sobreviven a HMR y se comparten entre bundles)
// ---------------------------------------------------------------------------

interface EstadoGlobalHTTP {
  almacen: AlmacenSeguridad | (() => AlmacenSeguridad) | null;
  entorno: EntornoPlata | null;
  contadorToken: { inicio: number; cuenta: number };
  enCurso: Map<string, Promise<void>>;
}

const g = globalThis as typeof globalThis & { __plataHTTP?: EstadoGlobalHTTP };
function estado(): EstadoGlobalHTTP {
  g.__plataHTTP ??= { almacen: null, entorno: null, contadorToken: { inicio: 0, cuenta: 0 }, enCurso: new Map() };
  return g.__plataHTTP;
}

/** Conecta la base: `fijarAlmacenSeguridad(() => crearAlmacenSQLite(obtenerDB()))`. */
export function fijarAlmacenSeguridad(a: AlmacenSeguridad | (() => AlmacenSeguridad) | null): void {
  estado().almacen = a;
}

export function obtenerAlmacen(): AlmacenSeguridad {
  const a = estado().almacen;
  if (!a) throw new ErrorHTTP(500, 'interno', 'Error interno');
  if (typeof a === 'function') {
    const real = a();
    estado().almacen = real;
    return real;
  }
  return a;
}

/** Solo para pruebas: fija un entorno ya validado (o null para volver a leer process.env). */
export function fijarEntorno(e: EntornoPlata | null): void {
  estado().entorno = e;
}

export function obtenerEntorno(): EntornoPlata {
  const s = estado();
  s.entorno ??= leerEntorno(process.env);
  return s.entorno;
}

/** Solo para pruebas. */
export function reiniciarEstadoHTTP(): void {
  const s = estado();
  s.contadorToken = { inicio: 0, cuenta: 0 };
  s.enCurso.clear();
}

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

const CABECERAS_JSON = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function respuestaJSON(cuerpo: unknown, estadoHttp = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { ...CABECERAS_JSON, ...extra } });
}

export function respuestaVacia(estadoHttp = 204, extra?: Record<string, string>): Response {
  return new Response(null, { status: estadoHttp, headers: { 'Cache-Control': 'no-store', ...extra } });
}

function cuerpoError(codigo: string, mensaje: string, detalles?: unknown) {
  return { error: detalles === undefined ? { codigo, mensaje } : { codigo, mensaje, detalles } };
}

/** Mapea ErrorHTTP / ErrorUsuario / ErrorConflicto. Nunca filtra trazas ni datos del cuerpo. */
export function respuestaError(e: unknown): Response {
  if (e instanceof ErrorHTTP) {
    const extra: Record<string, string> = {};
    const d = e.detalles as { reintentar_en_s?: unknown } | undefined;
    if (e.estado === 429 && d && typeof d.reintentar_en_s === 'number') extra['Retry-After'] = String(Math.ceil(d.reintentar_en_s));
    if (e.estado === 403) return respuestaJSON({ error: { codigo: e.codigo } }, 403); // cuerpo mínimo
    return respuestaJSON(cuerpoError(e.codigo, e.mensajePublico(), e.detalles), e.estado, extra);
  }
  if (e instanceof ErrorConflicto) {
    return respuestaJSON(cuerpoError('conflicto_version', 'El registro cambió; recarga y vuelve a intentar', { version_actual: e.version_actual }), 409);
  }
  if (e instanceof ErrorUsuario) {
    return respuestaJSON(cuerpoError(e.codigo, sanitizarDetalle(e.message, 200)), 422);
  }
  registrarErrorInterno(e);
  return respuestaJSON(cuerpoError('interno', 'Error interno'), 500);
}

function registrarErrorInterno(e: unknown): void {
  const nombre = e instanceof Error ? e.name : typeof e;
  const mensaje = e instanceof Error ? e.message : '';
  // Solo tipo y un mensaje enmascarado y corto: nunca cuerpos, cabeceras ni trazas.
  const detalle = sanitizarDetalle(`${nombre}: ${mensaje}`, 300);
  try {
    obtenerAlmacen().registrarEvento({ nivel: 'error', tipo: 'error_interno', detalle });
  } catch {
    console.error(`[plata] error_interno ${detalle}`);
  }
}

// ---------------------------------------------------------------------------
// Lectura de JSON con límite real (§7.7)
// ---------------------------------------------------------------------------

/** Exige application/json, respeta el límite aunque mientan en Content-Length y corta el stream al pasarse. */
export async function leerJSON<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const tipo = (req.headers.get('content-type') ?? '').toLowerCase();
  const [media, ...params] = tipo.split(';').map((s) => s.trim());
  if (media !== 'application/json' || params.some((p) => p.startsWith('charset=') && p !== 'charset=utf-8')) {
    throw new ErrorHTTP(415, 'tipo_no_soportado', 'El cuerpo debe ser application/json');
  }
  const cl = req.headers.get('content-length');
  if (cl !== null) {
    if (!/^\d{1,15}$/.test(cl.trim())) throw new ErrorHTTP(400, 'json_invalido', 'Content-Length inválido');
    if (Number(cl) > maxBytes) throw new ErrorHTTP(413, 'cuerpo_grande', `El cuerpo supera ${maxBytes} bytes`);
  }
  if (!req.body) throw new ErrorHTTP(400, 'json_invalido', 'Falta el cuerpo');

  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel().catch(() => undefined);
      throw new ErrorHTTP(413, 'cuerpo_grande', `El cuerpo supera ${maxBytes} bytes`);
    }
    trozos.push(value);
  }
  if (total === 0) throw new ErrorHTTP(400, 'json_invalido', 'Falta el cuerpo');
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { bytes.set(t, pos); pos += t.byteLength; }

  let textoCuerpo: string;
  try {
    textoCuerpo = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ErrorHTTP(400, 'json_invalido', 'El cuerpo no es UTF-8 válido');
  }
  try {
    return JSON.parse(textoCuerpo) as T;
  } catch {
    throw new ErrorHTTP(400, 'json_invalido', 'El cuerpo no es JSON válido');
  }
}

// ---------------------------------------------------------------------------
// Autenticación (§5.1)
// ---------------------------------------------------------------------------

const MUTACIONES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LIMITE_TOKEN_POR_MIN = 120;

function contarPeticionToken(ahoraMs: number): { permitido: boolean; reintentar_en_s: number } {
  const c = estado().contadorToken;
  if (ahoraMs - c.inicio >= 60_000) { c.inicio = ahoraMs; c.cuenta = 0; }
  c.cuenta++;
  if (c.cuenta > LIMITE_TOKEN_POR_MIN) {
    return { permitido: false, reintentar_en_s: Math.max(1, Math.ceil((c.inicio + 60_000 - ahoraMs) / 1000)) };
  }
  return { permitido: true, reintentar_en_s: 0 };
}

/** Controles de red comunes a proxy y rutas: Host y X-Forwarded-Host. Lanza ErrorHTTP 403. */
export function comprobarHost(headers: Headers, e: EntornoPlata): void {
  if (!hostPermitido(headers.get('host'), e)) throw new ErrorHTTP(403, 'host_no_permitido', 'Host no permitido');
  // Con DNS rebinding la página atacante es «mismo origen» y puede poner X-Forwarded-Host a su gusto.
  const xfh = headers.get('x-forwarded-host');
  if (xfh !== null && !hostPermitido(xfh, e)) throw new ErrorHTTP(403, 'host_no_permitido', 'Host no permitido');
}

/** [IO] ¿La cookie de sesión es válida (firma + fila viva en la base)? Actualiza la actividad cada 10 min. */
export function sesionValida(valorCookie: string | undefined, e: EntornoPlata, almacen: AlmacenSeguridad, ahora: Date): boolean {
  const id = leerCookieFirmada(valorCookie, e.secreto_sesion);
  if (!id) return false;
  const idHash = hashIdSesion(id);
  const fila = almacen.leerSesion(idHash);
  const r = evaluarSesion(fila, ahora);
  if (!r.valida) {
    if (fila) almacen.borrarSesion(idHash);
    return false;
  }
  if (r.tocar) almacen.tocarSesion(idHash, aISO(ahora));
  return true;
}

type ContextoRuta = { actor: Actor; entorno: EntornoPlata; params: Record<string, string> };
type ManejadorRuta = (req: Request, ctx: ContextoRuta) => Promise<Response>;

/**
 * Envuelve un route handler. Orden: Host → Origin (mutación no autenticada por token) → autenticación
 * según la política → captura de errores. Toda respuesta sale con Cache-Control: no-store.
 */
export function conAuth(
  politica: Politica,
  handler: ManejadorRuta,
): (req: Request, rctx: { params: Promise<Record<string, string>> }) => Promise<Response> {
  return async (req, rctx) => {
    let res: Response;
    try {
      const entorno = obtenerEntorno();
      comprobarHost(req.headers, entorno);

      // Server Actions desactivadas en v1 (§0.10): nunca se aceptan en rutas de la API.
      if (req.headers.has('next-action')) throw new ErrorHTTP(403, 'origen_no_permitido', 'No permitido');

      const auth = req.headers.get('authorization');
      const usaToken = (politica === 'token' || politica === 'token_o_sesion') && auth !== null;
      const origin = req.headers.get('origin');

      if (usaToken) {
        // n8n no manda Origin; un navegador sí. Token + Origin → rechazo.
        if (origin !== null) throw new ErrorHTTP(403, 'origen_no_permitido', 'Origen no permitido');
      } else if (MUTACIONES.has(req.method.toUpperCase())) {
        if (!origenPermitido(origin, req.headers.get('sec-fetch-site'), entorno)) {
          throw new ErrorHTTP(403, 'origen_no_permitido', 'Origen no permitido');
        }
      }

      let actor: Actor = 'panel';
      if (politica === 'token' || usaToken) {
        if (!tokenValido(auth, entorno)) throw new ErrorHTTP(401, 'no_autenticado', 'No autenticado');
        const lim = contarPeticionToken(Date.now());
        if (!lim.permitido) {
          throw new ErrorHTTP(429, 'demasiados_intentos', 'Demasiadas peticiones', { reintentar_en_s: lim.reintentar_en_s });
        }
        actor = 'n8n';
      } else if (politica === 'sesion' || politica === 'token_o_sesion') {
        const valor = leerCookie(req.headers.get('cookie'), NOMBRE_COOKIE_SESION);
        if (!sesionValida(valor, entorno, obtenerAlmacen(), new Date())) {
          throw new ErrorHTTP(401, 'no_autenticado', 'No autenticado');
        }
        actor = 'panel';
      }

      const params = rctx && rctx.params ? await rctx.params : {};
      res = await handler(req, { actor, entorno, params: params ?? {} });
    } catch (e) {
      res = respuestaError(e);
    }
    return conNoStore(res);
  };
}

function conNoStore(res: Response): Response {
  try {
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch {
    // Cabeceras inmutables (p. ej. Response.redirect): se copia.
    const copia = new Response(res.body, res);
    copia.headers.set('Cache-Control', 'no-store');
    return copia;
  }
}

// ---------------------------------------------------------------------------
// Idempotencia (§5.3)
// ---------------------------------------------------------------------------

const RE_CLAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,64}$/;
const IDEMPOTENCIA_TTL_MS = 24 * 3600 * 1000;

/** Misma clave y mismo cuerpo → la misma respuesta; otro cuerpo → 409. Sin cabecera → ejecuta normal. */
export async function conIdempotencia(req: Request, ruta: string, cuerpo: unknown, fn: () => Promise<Response>): Promise<Response> {
  const clave = req.headers.get('idempotency-key');
  if (clave === null) return fn();
  if (!RE_CLAVE_IDEMPOTENCIA.test(clave)) {
    throw new ErrorHTTP(422, 'validacion', 'Idempotency-Key debe tener 8–64 caracteres [A-Za-z0-9_-]', { campo: 'Idempotency-Key' });
  }
  const huella = createHash('sha256').update(JSON.stringify(cuerpo ?? null), 'utf8').digest('hex');
  const llave = `${ruta}\u0000${clave}`;
  const enCurso = estado().enCurso;

  // Serializa peticiones con la misma clave dentro del proceso (dos reintentos simultáneos de n8n).
  while (enCurso.has(llave)) await enCurso.get(llave);
  let liberar!: () => void;
  enCurso.set(llave, new Promise<void>((r) => { liberar = r; }));
  try {
    const almacen = obtenerAlmacen();
    const previa = almacen.leerIdempotencia(ruta, clave);
    const ahora = new Date();
    if (previa && ahora.getTime() - Date.parse(previa.creado_en) < IDEMPOTENCIA_TTL_MS) {
      if (previa.huella_cuerpo !== huella) {
        throw new ErrorHTTP(409, 'idempotencia_conflicto', 'Esa Idempotency-Key ya se usó con otro cuerpo');
      }
      return previa.estado_http === 204
        ? respuestaVacia(204, { 'Idempotent-Replayed': 'true' })
        : new Response(previa.respuesta, { status: previa.estado_http, headers: { ...CABECERAS_JSON, 'Idempotent-Replayed': 'true' } });
    }
    const res = await fn();
    if (res.status < 500) {
      const textoRes = res.status === 204 ? '' : await res.clone().text();
      almacen.guardarIdempotencia(ruta, clave, { huella_cuerpo: huella, estado_http: res.status, respuesta: textoRes, creado_en: aISO(ahora) });
    }
    return res;
  } finally {
    enCurso.delete(llave);
    liberar();
  }
}
