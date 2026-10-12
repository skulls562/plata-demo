// Seguridad de Plata (SPEC §2.2, §7). Revisión: opus (tarea A2).
//
// Reglas de este archivo:
// - Solo importa módulos `node:` en tiempo de ejecución (los tipos se borran): así lo puede cargar
//   `scripts/crear-pin.ts` directamente con Node (type stripping) y el proxy sin arrastrar la base.
// - Nada de enums ni parameter properties (Node no los soporta al quitar tipos).
// - Nunca se registran secretos, PIN, tokens ni cookies. Los errores nombran variables, no valores.

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { InstanteISO, NuevoEvento } from './tipos';

// ---------------------------------------------------------------------------
// Entorno (§7.11)
// ---------------------------------------------------------------------------

export interface EntornoPlata {
  token: string; token_anterior: string | null; secreto_sesion: string; chat_id: string;
  db_path: string; dir_finanzas: string | null; ollama_url: string; ollama_modelo: string;
  hosts: string[];                // ['127.0.0.1:3010','localhost:3010'] (+ 'pc.tailnet.ts.net' si se añade)
  origenes: string[];             // ['http://127.0.0.1:3010','http://localhost:3010'] (+ 'https://pc.tailnet.ts.net')
  url_panel: string;              // 'http://127.0.0.1:3010' o PLATA_URL_PANEL (botón «Abrir panel» del bot)
}

const RE_SECRETO_B64URL = /^[A-Za-z0-9_-]{43,512}$/;
const RE_HOST_PERMITIDO = /^(127\.0\.0\.1|localhost):(\d{1,5})$/;
// Nombre exacto de Tailscale (MagicDNS): <equipo>.<tailnet>.ts.net, sin comodines. Sin puerto = HTTPS 443 de `tailscale serve`.
const RE_HOST_TAILSCALE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net(?::(\d{1,5}))?$/;
const HOSTS_LOOPBACK_OLLAMA = new Set(['127.0.0.1', 'localhost']);

function esRutaAbsoluta(p: string): boolean {
  // Windows (C:\… o \\servidor\…) o POSIX (/…). Sin `node:path` para seguir siendo pura y portable.
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p) || p.startsWith('/');
}

/** [P] Lee y valida el entorno. Lanza (nombrando solo la variable) si falta algo o es débil. */
export function leerEntorno(env: Record<string, string | undefined>): EntornoPlata {
  const errores: string[] = [];
  const val = (k: string): string | undefined => {
    const v = env[k];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };

  const token = val('PLATA_TOKEN');
  if (!token) errores.push('PLATA_TOKEN falta');
  else if (!RE_SECRETO_B64URL.test(token)) errores.push('PLATA_TOKEN debe tener ≥ 43 caracteres base64url');

  const tokenAnterior = val('PLATA_TOKEN_ANTERIOR') ?? null;
  if (tokenAnterior !== null && !RE_SECRETO_B64URL.test(tokenAnterior)) {
    errores.push('PLATA_TOKEN_ANTERIOR debe tener ≥ 43 caracteres base64url');
  }

  const secreto = val('PLATA_SESION_SECRETO');
  if (!secreto) errores.push('PLATA_SESION_SECRETO falta');
  else if (secreto.length < 43 || /\s/.test(secreto)) errores.push('PLATA_SESION_SECRETO debe tener ≥ 43 caracteres sin espacios');
  else if (secreto === token || secreto === tokenAnterior) errores.push('PLATA_SESION_SECRETO debe ser distinto del token');
  if (token && tokenAnterior && token === tokenAnterior) errores.push('PLATA_TOKEN_ANTERIOR es igual a PLATA_TOKEN');

  const chat = val('PLATA_TELEGRAM_CHAT_ID');
  if (!chat) errores.push('PLATA_TELEGRAM_CHAT_ID falta');
  else if (!/^\d{1,20}$/.test(chat)) errores.push('PLATA_TELEGRAM_CHAT_ID debe ser solo dígitos');

  const dirFinanzas = val('PLATA_VAULT_FINANZAS') ?? null;
  if (dirFinanzas !== null && !esRutaAbsoluta(dirFinanzas)) errores.push('PLATA_VAULT_FINANZAS debe ser una ruta absoluta');

  const ollamaUrl = val('OLLAMA_URL') ?? 'http://127.0.0.1:11434';
  try {
    const u = new URL(ollamaUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') errores.push('OLLAMA_URL debe ser http(s)');
    else if (!HOSTS_LOOPBACK_OLLAMA.has(u.hostname)) errores.push('OLLAMA_URL solo puede apuntar a 127.0.0.1 o localhost');
    else if (u.username || u.password) errores.push('OLLAMA_URL no puede llevar credenciales');
  } catch {
    errores.push('OLLAMA_URL no es una URL válida');
  }

  const hostsTexto = val('PLATA_HOSTS') ?? '127.0.0.1:3010,localhost:3010';
  const hosts = hostsTexto.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0) errores.push('PLATA_HOSTS está vacío');
  for (const h of hosts) {
    const m = RE_HOST_PERMITIDO.exec(h);
    const t = RE_HOST_TAILSCALE.exec(h);
    const puerto = m ? Number(m[2]) : t && t[1] !== undefined ? Number(t[1]) : 443;
    if ((!m && !t) || puerto < 1 || puerto > 65535) {
      errores.push('PLATA_HOSTS solo admite 127.0.0.1:<puerto>, localhost:<puerto> o <equipo>.<tailnet>.ts.net');
      break;
    }
  }
  // Loopback va por http; un nombre de Tailscale siempre por https (`tailscale serve` termina el TLS).
  const origenes = hosts.map((h) => `${RE_HOST_TAILSCALE.test(h) ? 'https' : 'http'}://${h}`);

  // URL del botón «Abrir panel» del bot: solo origen puro (sin ruta ni credenciales) y de un host permitido.
  let urlPanel = origenes[0] ?? '';
  const urlPanelTexto = val('PLATA_URL_PANEL');
  if (urlPanelTexto !== undefined) {
    try {
      const u = new URL(urlPanelTexto);
      const origen = u.origin.toLowerCase();
      if (u.username || u.password || u.search || u.hash || u.pathname !== '/') errores.push('PLATA_URL_PANEL debe ser solo el origen (sin ruta, credenciales ni parámetros)');
      else if (!origenes.includes(origen)) errores.push('PLATA_URL_PANEL debe coincidir con uno de los hosts de PLATA_HOSTS');
      else urlPanel = origen;
    } catch {
      errores.push('PLATA_URL_PANEL no es una URL válida');
    }
  }

  if (errores.length > 0) {
    throw new Error(`Entorno de Plata inválido: ${errores.join('; ')}. Revisa .env.local (plantilla: .env.example).`);
  }

  return {
    token: token as string,
    token_anterior: tokenAnterior,
    secreto_sesion: secreto as string,
    chat_id: chat as string,
    db_path: val('PLATA_DB_PATH') ?? 'data/plata.db',
    dir_finanzas: dirFinanzas,
    ollama_url: ollamaUrl,
    ollama_modelo: val('OLLAMA_MODELO') ?? 'qwen2.5:7b',
    hosts,
    origenes,
    url_panel: urlPanel,
  };
}

// ---------------------------------------------------------------------------
// Comparaciones y token (§7.4)
// ---------------------------------------------------------------------------

function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** [P] Comparación en tiempo constante que no filtra la longitud (sha256 de ambos + timingSafeEqual). */
export function compararSeguro(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** [P] 'Bearer <t>' contra el token actual y el anterior (rotación). */
export function tokenValido(cabeceraAuth: string | null, e: EntornoPlata): boolean {
  if (!cabeceraAuth || cabeceraAuth.length > 600) return false;
  const m = /^Bearer[ ]+([A-Za-z0-9_-]{1,512})[ ]*$/i.exec(cabeceraAuth);
  if (!m) return false;
  const recibido = m[1];
  // Se evalúan las dos comparaciones siempre (sin cortocircuito) para no revelar cuál coincidió.
  const actual = compararSeguro(recibido, e.token);
  const anterior = e.token_anterior !== null ? compararSeguro(recibido, e.token_anterior) : false;
  return actual || anterior;
}

// ---------------------------------------------------------------------------
// PIN (§7.3)
// ---------------------------------------------------------------------------

function esSecuencia(d: string): boolean {
  let sube = true;
  let baja = true;
  for (let i = 1; i < d.length; i++) {
    const a = d.charCodeAt(i - 1) - 48;
    const b = d.charCodeAt(i) - 48;
    if (b !== (a + 1) % 10) sube = false;
    if (b !== (a + 9) % 10) baja = false;
  }
  return sube || baja;
}

function esPeriodico(d: string): boolean {
  // 121212, 123123, 12341234…: un bloque de 1 a 4 dígitos repetido.
  for (let p = 1; p <= 4 && p < d.length; p++) {
    if (d.length % p !== 0) continue;
    if (d.slice(0, p).repeat(d.length / p) === d) return true;
  }
  return false;
}

function fechaValida(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return dia <= dias;
}

function pareceFecha(d: string): boolean {
  const n = (i: number, len: number) => Number(d.slice(i, i + len));
  if (d.length === 8) {
    const aaaaMMdd = n(0, 4) >= 1900 && n(0, 4) <= 2099 && fechaValida(n(0, 4), n(4, 2), n(6, 2));
    const ddMMaaaa = n(4, 4) >= 1900 && n(4, 4) <= 2099 && fechaValida(n(4, 4), n(2, 2), n(0, 2));
    const MMddaaaa = n(4, 4) >= 1900 && n(4, 4) <= 2099 && fechaValida(n(4, 4), n(0, 2), n(2, 2));
    return aaaaMMdd || ddMMaaaa || MMddaaaa;
  }
  if (d.length === 6) {
    // aaMMdd, ddMMaa y MMddaa (año de 2 dígitos: cualquiera; se usa 2000 para validar el día).
    return fechaValida(2000 + n(0, 2), n(2, 2), n(4, 2))
      || fechaValida(2000 + n(4, 2), n(2, 2), n(0, 2))
      || fechaValida(2000 + n(4, 2), n(0, 2), n(2, 2));
  }
  return false;
}

/** [P] 6–12 dígitos y no trivial: todos iguales, secuencias, bloques repetidos o forma de fecha. */
export function validarFormatoPin(pin: string): boolean {
  if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) return false;
  if (esSecuencia(pin) || esPeriodico(pin) || pareceFecha(pin)) return false;
  return true;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LARGO = 32;
const SCRYPT_SAL = 16;

function scryptAsync(pin: string, sal: Buffer, n: number, r: number, p: number, largo: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(pin, sal, largo, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, clave) => {
      if (err) reject(err);
      else resolve(clave);
    });
  });
}

/** [IO-cpu] 'scrypt$16384$8$1$<sal_b64>$<hash_b64>'. */
export async function hashPin(pin: string): Promise<string> {
  if (!validarFormatoPin(pin)) throw new Error('PIN inválido o trivial');
  const sal = randomBytes(SCRYPT_SAL);
  const clave = await scryptAsync(pin, sal, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LARGO);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${sal.toString('base64')}$${clave.toString('base64')}`;
}

/** [IO-cpu] Verifica en tiempo constante. Un hash guardado mal formado o con parámetros raros → false. */
export async function verificarPin(pin: string, guardado: string): Promise<boolean> {
  if (typeof pin !== 'string' || pin.length === 0 || pin.length > 64) return false;
  const partes = typeof guardado === 'string' ? guardado.split('$') : [];
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  // Solo parámetros sensatos (evita que un valor manipulado en la base dispare un consumo enorme).
  if (!Number.isInteger(n) || n < 16384 || n > 1048576 || (n & (n - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 8 || r > 32 || !Number.isInteger(p) || p < 1 || p > 4) return false;
  const sal = Buffer.from(partes[4], 'base64');
  const esperado = Buffer.from(partes[5], 'base64');
  if (sal.length < 16 || esperado.length < 32 || esperado.length > 64) return false;
  let calculado: Buffer;
  try {
    calculado = await scryptAsync(pin, sal, n, r, p, esperado.length);
  } catch {
    return false;
  }
  return timingSafeEqual(calculado, esperado);
}

// ---------------------------------------------------------------------------
// Sesión y cookie (§7.3)
// ---------------------------------------------------------------------------

export const NOMBRE_COOKIE_SESION = 'plata_sesion';
export const SESION_MAX_S = 30 * 24 * 3600;            // 30 días
export const SESION_INACTIVIDAD_S = 7 * 24 * 3600;     // 7 días sin uso
export const SESION_TOQUE_S = 10 * 60;                 // ultima_actividad_en se actualiza como mucho cada 10 min

const RE_ID_SESION = /^[A-Za-z0-9_-]{43}$/;

/** [IO-rand] 32 bytes aleatorios en base64url (43 caracteres). */
export function nuevoIdSesion(): string {
  return randomBytes(32).toString('base64url');
}

/** [P] sha256 hex: lo único que se guarda en la base. */
export function hashIdSesion(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

function hmacB64url(id: string, secreto: string): string {
  return createHmac('sha256', secreto).update(id, 'utf8').digest('base64url');
}

/** [P] `${id}.${hmacB64url}` */
export function firmarCookie(id: string, secreto: string): string {
  return `${id}.${hmacB64url(id, secreto)}`;
}

/** [P] Devuelve el id si la firma es válida; si no, null. */
export function leerCookieFirmada(valor: string | undefined, secreto: string): string | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 200) return null;
  const punto = valor.indexOf('.');
  if (punto <= 0 || punto !== valor.lastIndexOf('.')) return null;
  const id = valor.slice(0, punto);
  const firma = valor.slice(punto + 1);
  if (!RE_ID_SESION.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(firma)) return null;
  const esperada = Buffer.from(hmacB64url(id, secreto), 'utf8');
  const recibida = Buffer.from(firma, 'utf8');
  if (esperada.length !== recibida.length) return null;
  return timingSafeEqual(esperada, recibida) ? id : null;
}

/**
 * [P] ¿La petición original llegó por HTTPS? Se mira `X-Forwarded-Proto` (lo pone `tailscale serve`) o el
 * protocolo de la URL. Falsearlo desde loopback solo añade `Secure` a la cookie: no abre nada.
 */
export function llegoPorHttps(headers: Headers, urlProtocolo?: string): boolean {
  const xfp = headers.get('x-forwarded-proto');
  if (xfp !== null) return xfp.split(',')[0].trim().toLowerCase() === 'https';
  return urlProtocolo === 'https:';
}

/** Cabecera Set-Cookie de la sesión. `Secure` solo si la petición llegó por HTTPS (Tailscale); en http://127.0.0.1 no. */
export function cookieSesion(valorFirmado: string, seguro = false): string {
  return `${NOMBRE_COOKIE_SESION}=${valorFirmado}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESION_MAX_S}${seguro ? '; Secure' : ''}`;
}

/** Cabecera Set-Cookie que borra la sesión en el navegador. */
export function cookieSesionBorrada(seguro = false): string {
  return `${NOMBRE_COOKIE_SESION}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${seguro ? '; Secure' : ''}`;
}

/** [P] Lee una cookie de la cabecera `Cookie`. Si el nombre aparece repetido, no se elige ninguna. */
export function leerCookie(cabecera: string | null, nombre: string): string | undefined {
  if (!cabecera) return undefined;
  let encontrada: string | undefined;
  let veces = 0;
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      veces++;
      encontrada = parte.slice(i + 1).trim();
    }
  }
  return veces === 1 ? encontrada : undefined;
}

export interface FilaSesion {
  id_hash: string; creada_en: InstanteISO; expira_en: InstanteISO; ultima_actividad_en: InstanteISO;
}

/** [P] ¿La sesión sigue viva? ¿Toca actualizar `ultima_actividad_en`? */
export function evaluarSesion(f: FilaSesion | null, ahora: Date): { valida: boolean; tocar: boolean } {
  if (!f) return { valida: false, tocar: false };
  const t = ahora.getTime();
  const expira = Date.parse(f.expira_en);
  const ultima = Date.parse(f.ultima_actividad_en);
  if (!Number.isFinite(expira) || !Number.isFinite(ultima)) return { valida: false, tocar: false };
  const valida = t < expira && t - ultima < SESION_INACTIVIDAD_S * 1000;
  return { valida, tocar: valida && t - ultima >= SESION_TOQUE_S * 1000 };
}

/** [P] Fila nueva para una sesión que empieza `ahora`. */
export function nuevaFilaSesion(id: string, ahora: Date): FilaSesion {
  const iso = aISO(ahora);
  return {
    id_hash: hashIdSesion(id),
    creada_en: iso,
    expira_en: aISO(new Date(ahora.getTime() + SESION_MAX_S * 1000)),
    ultima_actividad_en: iso,
  };
}

// ---------------------------------------------------------------------------
// Host, Origin y Telegram (§7.2, §5.1, §7.5)
// ---------------------------------------------------------------------------

/** [P] Host exacto de la lista (corta el DNS rebinding). */
export function hostPermitido(host: string | null, e: EntornoPlata): boolean {
  if (!host || host.length > 100) return false;
  return e.hosts.includes(host.trim().toLowerCase());
}

/** [P] Mutaciones con cookie: Origin obligatorio y de la lista; si viene Sec-Fetch-Site, same-origin. */
export function origenPermitido(origin: string | null, secFetchSite: string | null, e: EntornoPlata): boolean {
  if (!origin || origin === 'null') return false;
  if (!e.origenes.includes(origin.trim().toLowerCase())) return false;
  if (secFetchSite !== null && secFetchSite !== 'same-origin') return false;
  return true;
}

/** [P] String(chat_id) === e.chat_id (solo enteros; nada de '123456789 ' ni 123456789.5). */
export function chatAutorizado(chat_id: number | string, e: EntornoPlata): boolean {
  if (typeof chat_id === 'number') {
    if (!Number.isSafeInteger(chat_id)) return false;
  } else if (typeof chat_id !== 'string' || !/^-?\d{1,20}$/.test(chat_id)) {
    return false;
  }
  return String(chat_id) === e.chat_id;
}

// ---------------------------------------------------------------------------
// Enmascarado (§7.8)
// ---------------------------------------------------------------------------

const MARCA = '\uE000';
// Lo que se protege (se deja intacto). Sin cuantificadores anidados ambiguos: tiempo lineal.
const RE_PROTEGIDO = new RegExp(
  [
    String.raw`(?<!\d)\d{1,2}/\d{1,2}/\d{4}(?!\d)`,                      // 06/10/2026
    String.raw`(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)`,                          // 2026-10-06
    String.raw`(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)`,                   // 13:59, 13:59:40
    // Montos precedidos de $ o COP (hasta 10^11, con miles y decimales).
    String.raw`(?:\$|\bCOP\b)[ \t]{0,2}\$?[ \t]{0,2}(?:\d{1,3}(?:[.,]\d{3}){1,4}|\d{1,11})(?:[.,]\d{1,2})?(?![\d])`,
  ].join('|'),
  'gi',
);
// ≥ 4 dígitos, admitiendo `*`, espacio o guion entre ellos (4111 1111 1111 1111, 1234-5678).
const RE_NUMERO_LARGO = /\d(?:[ *-]{0,2}\d){3,}/g;

/** [P] Protege fechas, horas y montos; reemplaza por [num] toda secuencia de ≥ 4 dígitos; restaura. */
export function enmascararDigitos(texto: string): string {
  if (typeof texto !== 'string' || texto.length === 0) return '';
  const protegidos: string[] = [];
  const limpio = texto.split(MARCA).join('');
  const conMarcas = limpio.replace(RE_PROTEGIDO, (m) => {
    protegidos.push(m);
    return MARCA;
  });
  const enmascarado = conMarcas.replace(RE_NUMERO_LARGO, '[num]');
  let i = 0;
  return enmascarado.replace(/\uE000/g, () => protegidos[i++] ?? '');
}

/** [P] Enmascara, quita caracteres de control y recorta (por defecto 500, el CHECK de `eventos.detalle`). */
export function sanitizarDetalle(s: string, max = 500): string {
  const base = enmascararDigitos(String(s ?? ''))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  if (base.length <= max) return base;
  return max <= 1 ? base.slice(0, max) : `${base.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Authentication-Results (§7.6). `avisos/remitentes.ts › verificarAutenticacion` debe delegar aquí.
// ---------------------------------------------------------------------------

/** Servidores cuyo Authentication-Results se cree (el de Gmail). Los demás los puede escribir el remitente. */
export const SERVIDORES_AUTH_CONFIABLES: readonly string[] = ['mx.google.com'];

function quitarComentarios(s: string): string {
  // Comentarios RFC 5322 «( … )», hasta 3 niveles de anidación; lineal (sin retroceso ambiguo).
  let r = s;
  for (let i = 0; i < 3; i++) r = r.replace(/\([^()]*\)/g, ' ');
  return r.replace(/[()]/g, ' ');
}

function dominiosAlineados(firmante: string, dominio: string, firmanteValido: (d: string) => boolean): boolean {
  // Igual, o uno subdominio del otro. Firmar como un padre o un hijo del dominio del banco exige
  // controlar su DNS, así que no lo puede hacer un tercero; `banco.com.atacante.co` no pasa.
  // I2: el firmante además debe pasar `firmanteValido` (lista blanca, mismo banco): sin eso, un sufijo
  // público padre del remitente («com», «co», «com.co») contaba como alineado.
  if (!firmante || !dominio || !firmante.includes('.')) return false;
  const alineado = firmante === dominio || dominio.endsWith(`.${firmante}`) || firmante.endsWith(`.${dominio}`);
  return alineado && firmanteValido(firmante);
}

/**
 * [P] Evalúa la cabecera Authentication-Results para el dominio del remitente (ya en la lista blanca).
 * - Solo se lee el PRIMER bloque (el que añade Gmail arriba) y solo si su authserv-id es confiable;
 *   lo que venga después (otras cabeceras concatenadas por n8n, con salto de línea o coma) se ignora.
 * - `dmarc=fail` → 'falla'. `dkim=fail` sin un `dkim=pass` alineado → 'falla'.
 * - `dmarc=pass` (con header.from alineado si viene) o `dkim=pass` con header.d/header.i alineado → 'pasa'.
 * - Sin cabecera, servidor no confiable o sin resultados útiles → 'desconocido'.
 */
export function evaluarAuthResults(
  auth_results: string | undefined | null,
  dominioRemitente: string,
  servidores: readonly string[] = SERVIDORES_AUTH_CONFIABLES,
  firmanteValido: (d: string) => boolean = () => true,
): 'pasa' | 'falla' | 'desconocido' {
  if (typeof auth_results !== 'string' || auth_results.trim() === '' || auth_results.length > 4000) return 'desconocido';
  const dominio = dominioRemitente.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]{3,253}$/.test(dominio)) return 'desconocido';

  // Primer bloque: primera línea + continuaciones (líneas que empiezan con espacio o tab).
  const lineas = auth_results.replace(/\r\n?/g, '\n').split('\n');
  let bloque = lineas[0];
  for (let i = 1; i < lineas.length && /^[ \t]/.test(lineas[i]); i++) bloque += ` ${lineas[i]}`;
  let limpio = quitarComentarios(bloque.toLowerCase()).replace(/^\s*authentication-results\s*:/, '');
  const coma = limpio.indexOf(',');
  if (coma >= 0) limpio = limpio.slice(0, coma);           // fuera de comentarios no hay comas legítimas
  limpio = limpio.replace(/\s+/g, ' ').trim();

  const partes = limpio.split(';').map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return 'desconocido';
  const authserv = partes[0].split(' ')[0];
  if (!servidores.map((s) => s.toLowerCase()).includes(authserv)) return 'desconocido';

  let dkimPassAlineado = false;
  let dkimFail = false;
  let dmarcPass = false;
  let dmarcFail = false;
  for (const p of partes.slice(1)) {
    const m = /^([a-z0-9-]+)\s*=\s*([a-z]+)\b(.*)$/.exec(p);
    if (!m) continue;
    const [, metodo, resultado, resto] = m;
    const props = new Map<string, string>();
    for (const pm of resto.matchAll(/([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|[^\s;]+)/g)) {
      props.set(pm[1], pm[2].replace(/^"|"$/g, ''));
    }
    if (metodo === 'dkim') {
      if (resultado === 'pass') {
        const d = (props.get('header.d') ?? '').replace(/\.$/, '');
        const iDom = (props.get('header.i') ?? '').split('@').pop()?.replace(/\.$/, '') ?? '';
        if (dominiosAlineados(d, dominio, firmanteValido) || dominiosAlineados(iDom, dominio, firmanteValido)) dkimPassAlineado = true;
      } else if (resultado === 'fail') {
        dkimFail = true;
      }
    } else if (metodo === 'dmarc') {
      if (resultado === 'fail') dmarcFail = true;
      else if (resultado === 'pass') {
        const from = props.get('header.from');
        if (from === undefined || dominiosAlineados(from.replace(/\.$/, ''), dominio, firmanteValido)) dmarcPass = true;
      }
    }
  }
  if (dmarcFail) return 'falla';
  if (dkimFail && !dkimPassAlineado) return 'falla';
  if (dmarcPass || dkimPassAlineado) return 'pasa';
  return 'desconocido';
}

// ---------------------------------------------------------------------------
// Límite de intentos de PIN (§7.3). Clave global 'pin' en la tabla `limites`.
// ---------------------------------------------------------------------------

export interface EstadoLimite {
  fallos: number; ventana_desde: InstanteISO; fallos_24h: number; ventana_24h_desde: InstanteISO; bloqueado_hasta: InstanteISO | null;
}

const MIN = 60 * 1000;
const VENTANA_MS = 15 * MIN;
const VENTANA_24H_MS = 24 * 60 * MIN;
const BLOQUEO_BASE_MS = 5 * MIN;
const BLOQUEO_MAX_MS = 60 * MIN;
const FALLOS_POR_ESCALON = 5;
const FALLOS_24H_MAX = 20;

/** ISO UTC sin milisegundos: '2026-10-06T18:59:00Z'. */
export function aISO(d: Date): InstanteISO {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ms(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** [P] ¿Se puede intentar ahora? Bloqueado → no se verifica el PIN. */
export function evaluarIntentoPin(e: EstadoLimite | null, ahora: Date): { permitido: boolean; reintentar_en_s: number } {
  if (!e || !e.bloqueado_hasta) return { permitido: true, reintentar_en_s: 0 };
  const hasta = ms(e.bloqueado_hasta);
  const t = ahora.getTime();
  if (!(hasta > t)) return { permitido: true, reintentar_en_s: 0 };
  return { permitido: false, reintentar_en_s: Math.max(1, Math.ceil((hasta - t) / 1000)) };
}

/**
 * [P] Registra el resultado de un intento.
 * - `ventana_desde` = instante del último fallo. `fallos` se reinicia si pasan 15 min sin fallos
 *   contados desde el último fallo o desde el fin del último bloqueo (lo más tardío): así un ataque
 *   continuo acumula y el bloqueo se duplica (5 → 10 → 20 → 40 → 60 min).
 * - `fallos_24h` cuenta en una ventana fija de 24 h desde su primer fallo; al llegar a 20 → bloqueo de 24 h.
 * - Un acierto reinicia `fallos` (no `fallos_24h`).
 */
export function registrarResultadoPin(e: EstadoLimite | null, exito: boolean, ahora: Date): { estado: EstadoLimite; bloqueo_24h: boolean } {
  const t = ahora.getTime();
  const iso = aISO(ahora);
  const s: EstadoLimite = e
    ? { ...e }
    : { fallos: 0, ventana_desde: iso, fallos_24h: 0, ventana_24h_desde: iso, bloqueado_hasta: null };

  const referencia = Math.max(ms(s.ventana_desde), ms(s.bloqueado_hasta));
  if (s.fallos > 0 && t - referencia > VENTANA_MS) s.fallos = 0;
  if (s.fallos_24h > 0 && t - ms(s.ventana_24h_desde) > VENTANA_24H_MS) s.fallos_24h = 0;
  if (s.bloqueado_hasta && ms(s.bloqueado_hasta) <= t) s.bloqueado_hasta = null;

  if (exito) {
    s.fallos = 0;
    return { estado: s, bloqueo_24h: false };
  }

  s.fallos += 1;
  s.ventana_desde = iso;
  if (s.fallos_24h === 0) s.ventana_24h_desde = iso;
  s.fallos_24h += 1;

  if (s.fallos_24h >= FALLOS_24H_MAX) {
    s.bloqueado_hasta = aISO(new Date(t + VENTANA_24H_MS));
    return { estado: s, bloqueo_24h: true };
  }
  if (s.fallos % FALLOS_POR_ESCALON === 0) {
    const escalon = s.fallos / FALLOS_POR_ESCALON;            // 1, 2, 3…
    const dur = Math.min(BLOQUEO_BASE_MS * 2 ** (escalon - 1), BLOQUEO_MAX_MS);
    s.bloqueado_hasta = aISO(new Date(t + dur));
  }
  return { estado: s, bloqueo_24h: false };
}

// ---------------------------------------------------------------------------
// Almacén mínimo (puerto). Permite trabajar sin esperar a `db.ts`:
// la ruta recibe la dependencia; la implementación SQLite usa solo sentencias preparadas.
// ---------------------------------------------------------------------------

export interface FilaIdempotencia { huella_cuerpo: string; estado_http: number; respuesta: string; creado_en: InstanteISO; }

export interface AlmacenSeguridad {
  leerPinHash(): string | null;
  leerLimite(clave: string): EstadoLimite | null;
  guardarLimite(clave: string, e: EstadoLimite): void;
  crearSesion(f: FilaSesion): void;
  leerSesion(id_hash: string): FilaSesion | null;
  tocarSesion(id_hash: string, ultima_actividad_en: InstanteISO): void;
  borrarSesion(id_hash: string): void;
  borrarSesionesVencidas(ahora: Date): void;
  leerIdempotencia(ruta: string, clave: string): FilaIdempotencia | null;
  guardarIdempotencia(ruta: string, clave: string, f: FilaIdempotencia): void;
  registrarEvento(e: NuevoEvento): void;
}

/** Lo mínimo de `DatabaseSync` (node:sqlite) que se usa aquí. */
export type ParametroSQL = string | number | bigint | null;
export interface SentenciaSQL {
  get(...params: ParametroSQL[]): unknown;
  run(...params: ParametroSQL[]): unknown;
}
export interface BaseSQLMinima {
  prepare(sql: string): SentenciaSQL;
  exec(sql: string): void;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Implementación del puerto sobre las tablas de §1.2 (`secretos`, `limites`, `sesiones`, `idempotencia`, `eventos`). */
export function crearAlmacenSQLite(db: BaseSQLMinima): AlmacenSeguridad {
  return {
    leerPinHash() {
      const fila = db.prepare("SELECT valor FROM secretos WHERE clave = 'pin_hash'").get() as { valor?: unknown } | undefined;
      return fila ? texto(fila.valor) : null;
    },
    leerLimite(clave) {
      const f = db.prepare(
        'SELECT fallos, ventana_desde, fallos_24h, ventana_24h_desde, bloqueado_hasta FROM limites WHERE clave = ?',
      ).get(clave) as Record<string, unknown> | undefined;
      if (!f) return null;
      return {
        fallos: Number(f.fallos),
        ventana_desde: String(f.ventana_desde),
        fallos_24h: Number(f.fallos_24h),
        ventana_24h_desde: String(f.ventana_24h_desde),
        bloqueado_hasta: texto(f.bloqueado_hasta),
      };
    },
    guardarLimite(clave, e) {
      db.prepare(
        `INSERT INTO limites (clave, fallos, ventana_desde, fallos_24h, ventana_24h_desde, bloqueado_hasta)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(clave) DO UPDATE SET fallos = excluded.fallos, ventana_desde = excluded.ventana_desde,
           fallos_24h = excluded.fallos_24h, ventana_24h_desde = excluded.ventana_24h_desde,
           bloqueado_hasta = excluded.bloqueado_hasta`,
      ).run(clave, e.fallos, e.ventana_desde, e.fallos_24h, e.ventana_24h_desde, e.bloqueado_hasta);
    },
    crearSesion(f) {
      db.prepare('INSERT INTO sesiones (id_hash, creada_en, expira_en, ultima_actividad_en) VALUES (?, ?, ?, ?)')
        .run(f.id_hash, f.creada_en, f.expira_en, f.ultima_actividad_en);
    },
    leerSesion(id_hash) {
      const f = db.prepare('SELECT id_hash, creada_en, expira_en, ultima_actividad_en FROM sesiones WHERE id_hash = ?')
        .get(id_hash) as Record<string, unknown> | undefined;
      if (!f) return null;
      return {
        id_hash: String(f.id_hash), creada_en: String(f.creada_en),
        expira_en: String(f.expira_en), ultima_actividad_en: String(f.ultima_actividad_en),
      };
    },
    tocarSesion(id_hash, ultima) {
      db.prepare('UPDATE sesiones SET ultima_actividad_en = ? WHERE id_hash = ?').run(ultima, id_hash);
    },
    borrarSesion(id_hash) {
      db.prepare('DELETE FROM sesiones WHERE id_hash = ?').run(id_hash);
    },
    borrarSesionesVencidas(ahora) {
      const iso = aISO(ahora);
      const limiteInactividad = aISO(new Date(ahora.getTime() - SESION_INACTIVIDAD_S * 1000));
      db.prepare('DELETE FROM sesiones WHERE expira_en <= ? OR ultima_actividad_en <= ?').run(iso, limiteInactividad);
    },
    leerIdempotencia(ruta, clave) {
      const f = db.prepare('SELECT huella_cuerpo, estado_http, respuesta, creado_en FROM idempotencia WHERE ruta = ? AND clave = ?')
        .get(ruta, clave) as Record<string, unknown> | undefined;
      if (!f) return null;
      return {
        huella_cuerpo: String(f.huella_cuerpo), estado_http: Number(f.estado_http),
        respuesta: String(f.respuesta), creado_en: String(f.creado_en),
      };
    },
    guardarIdempotencia(ruta, clave, f) {
      db.prepare(
        `INSERT INTO idempotencia (ruta, clave, huella_cuerpo, estado_http, respuesta, creado_en) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ruta, clave) DO UPDATE SET huella_cuerpo = excluded.huella_cuerpo, estado_http = excluded.estado_http,
           respuesta = excluded.respuesta, creado_en = excluded.creado_en`,
      ).run(ruta, clave, f.huella_cuerpo, f.estado_http, f.respuesta, f.creado_en);
    },
    registrarEvento(e) {
      db.prepare('INSERT INTO eventos (nivel, tipo, detalle, ref) VALUES (?, ?, ?, ?)').run(
        e.nivel,
        sanitizarDetalle(e.tipo, 40),
        e.detalle === undefined ? null : sanitizarDetalle(e.detalle, 500),
        e.ref === undefined ? null : sanitizarDetalle(e.ref, 80),
      );
    },
  };
}

/** Guarda un PIN nuevo (ya hasheado), borra todas las sesiones y reinicia el límite (§7.3). Transacción. */
export function guardarPinNuevo(db: BaseSQLMinima, pinHash: string): void {
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(pinHash)) throw new Error('hash de PIN con formato inválido');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO secretos (clave, valor, actualizado_en) VALUES ('pin_hash', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    ).run(pinHash);
    db.prepare('DELETE FROM sesiones').run();
    db.prepare("DELETE FROM limites WHERE clave = 'pin'").run();
    db.prepare("INSERT INTO eventos (nivel, tipo, detalle) VALUES ('info', 'pin_cambiado', 'PIN creado o cambiado con npm run pin; sesiones cerradas')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
