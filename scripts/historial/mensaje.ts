// Parser de correos (RFC 5322 / MIME) para el importador de historial. PURO y sin dependencias.
// Debe poder ejecutarse con Node 24 quitando tipos, así que NO importa módulos de src/ (rutas sin extensión);
// `textoPlano` y `dominioPermitido` copian el criterio de la app y las pruebas comprueban que coinciden.

export interface AvisoHistorial {
  from: string;
  subject: string;
  date: string;
  text: string;
  message_id?: string;
  auth_results?: string;
}

// --- Texto plano (copia del criterio de src/lib/avisos/comun.ts › textoPlano) ---------------------------------

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iexcl: '¡', iquest: '¿', ordm: 'º', ordf: 'ª', deg: '°', cent: '¢', pound: '£', euro: '€',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodificarEntidades(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,10});/g, (m, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const cp = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ' ';
      return String.fromCodePoint(cp);
    }
    return ENTIDADES[cuerpo] ?? m;
  });
}

const ETIQUETAS_SALTO = new Set([
  'br', 'p', 'div', 'tr', 'li', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'header', 'footer', 'blockquote', 'hr', 'pre',
]);
const ETIQUETAS_ESPACIO = new Set(['td', 'th']);

function quitarEtiquetas(html: string): string {
  const bajas = html.toLowerCase();
  let salida = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      salida += html.slice(i);
      break;
    }
    salida += html.slice(i, lt);
    const sig = html.charCodeAt(lt + 1);
    const esLetra = (sig >= 65 && sig <= 90) || (sig >= 97 && sig <= 122);
    if (!(esLetra || sig === 47 || sig === 33 || sig === 63)) {
      salida += '<';
      i = lt + 1;
      continue;
    }
    if (html.startsWith('<!--', lt)) {
      const fin = html.indexOf('-->', lt + 4);
      if (fin === -1) break;
      i = fin + 3;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      salida += html.slice(lt);
      break;
    }
    let j = lt + 1;
    if (html[j] === '/') j++;
    let k = j;
    while (k < gt && /[a-zA-Z0-9]/.test(html[k])) k++;
    const nombre = bajas.slice(j, k);
    const cierre = html[lt + 1] === '/';
    if (!cierre && (nombre === 'script' || nombre === 'style')) {
      const fin = bajas.indexOf('</' + nombre, gt + 1);
      if (fin === -1) break;
      const gt2 = html.indexOf('>', fin);
      i = gt2 === -1 ? n : gt2 + 1;
      continue;
    }
    if (ETIQUETAS_SALTO.has(nombre)) salida += '\n';
    else if (ETIQUETAS_ESPACIO.has(nombre)) salida += ' ';
    i = gt + 1;
  }
  return salida;
}

// Códigos (sin literales Unicode en regex): controles, invisibles y espacios raros, como en la app.
const invisible = (c: number) => (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0x2060 || c === 0xfeff);
const espacioRaro = (c: number) => (c === 9 || c === 0xa0 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000);

export function textoPlano(text: string): string {
  let t = String(text ?? '');
  if (t.length > 400_000) t = t.slice(0, 400_000);
  if (t.includes('<')) t = quitarEtiquetas(t);
  t = decodificarEntidades(t);
  t = t
    .replace(/\r\n?/g, '\n')
    .split('')
    .map((c) => (invisible(c.charCodeAt(0)) ? '' : espacioRaro(c.charCodeAt(0)) ? ' ' : c))
    .join('')
    .replace(/ {2,}/g, ' ');
  const compactas: string[] = [];
  for (const l of t.split('\n')) {
    const x = l.trim();
    if (x !== '') compactas.push(x);
  }
  return compactas.join('\n').trim().slice(0, 20_000);
}

// --- Enmascarado y remitentes -----------------------------------------------------------------------------

/** Secuencias de ≥ 8 dígitos seguidos → asteriscos salvo los últimos 4. */
export function enmascarar(texto: string): string {
  return texto.replace(/\d{8,}/g, (m) => '*'.repeat(m.length - 4) + m.slice(-4));
}

/** Dominio de un From (prefiere la dirección entre <>). null si no hay. */
export function dominioDe(from: string): string | null {
  const m = /<([^<>]{1,320})>\s*$/.exec(from);
  const dir = m ? m[1] : from.trim();
  const arroba = dir.lastIndexOf('@');
  if (arroba < 1) return null;
  const d = dir.slice(arroba + 1).trim().toLowerCase().replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(d) && !d.includes('..') ? d : null;
}

const esOSub = (d: string, base: string) => d === base || d.endsWith('.' + base);

/** Misma lista blanca que src/lib/avisos/remitentes.ts › bancoPorDominio (devuelve el banco o null). */
export function bancoPermitido(dominio: string): string | null {
  const d = dominio.toLowerCase();
  if (esOSub(d, 'notificacionesbancolombia.com')) return 'bancolombia';
  if (esOSub(d, 'achcolombia.com.co')) return 'pse';
  if (esOSub(d, 'wompi.co') || esOSub(d, 'wompi.com')) return 'wompi';
  if (/(^|\.)rappicard\.(com|co|com\.co)$/.test(d) || esOSub(d, 'rappi.com')) return 'rappicard';
  if (esOSub(d, 'didiglobal.com')) return 'didi';
  return null;
}

// --- Cabeceras y MIME -------------------------------------------------------------------------------------

/** Cabeceras desplegadas (unfold) en orden de aparición; nombre en minúsculas. */
export function parsearCabeceras(bloque: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const linea of bloque.split(/\r?\n/)) {
    if (/^[ \t]/.test(linea) && out.length > 0) {
      out[out.length - 1][1] += ' ' + linea.trim();
      continue;
    }
    const i = linea.indexOf(':');
    if (i > 0) out.push([linea.slice(0, i).trim().toLowerCase(), linea.slice(i + 1).trim()]);
  }
  return out;
}

function cab(h: Array<[string, string]>, nombre: string): string | undefined {
  return h.find(([n]) => n === nombre)?.[1];
}

function decodificarBytes(bytes: Buffer, charset: string | undefined): string {
  const cs = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  try {
    if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return new TextDecoder('utf-8').decode(bytes);
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

export function decodificarQP(s: string): Buffer {
  const limpio = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(limpio.slice(i + 1, i + 3))) {
      bytes.push(parseInt(limpio.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(limpio.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

/** RFC 2047: =?charset?B|Q?texto?= en asunto, remitente, etc. */
export function decodificarPalabras(valor: string): string {
  const sinEspacios = valor.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return sinEspacios.replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, texto: string) => {
    const bytes = enc.toUpperCase() === 'B'
      ? Buffer.from(texto, 'base64')
      : decodificarQP(texto.replace(/_/g, ' '));
    return decodificarBytes(bytes, cs.split('*')[0]);
  });
}

function parametro(valor: string, nombre: string): string | undefined {
  const m = new RegExp(`${nombre}\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(valor);
  return m ? (m[1] ?? m[2]) : undefined;
}

interface Parte { tipo: string; texto: string }

function cuerpoDecodificado(cuerpoBin: string, h: Array<[string, string]>): string {
  const cte = (cab(h, 'content-transfer-encoding') ?? '7bit').toLowerCase();
  const charset = parametro(cab(h, 'content-type') ?? '', 'charset');
  let bytes: Buffer;
  if (cte === 'base64') bytes = Buffer.from(cuerpoBin.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  else if (cte === 'quoted-printable') bytes = decodificarQP(cuerpoBin);
  else bytes = Buffer.from(cuerpoBin, 'latin1');
  return decodificarBytes(bytes, charset);
}

function partirCabecera(bin: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(bin);
  if (!m) return [bin, ''];
  return [bin.slice(0, m.index), bin.slice(m.index + m[0].length)];
}

function recogerPartes(bin: string, profundidad: number, salida: Parte[]): void {
  if (profundidad > 6) return;
  const [cabBloque, cuerpo] = partirCabecera(bin);
  const h = parsearCabeceras(cabBloque);
  const ct = (cab(h, 'content-type') ?? 'text/plain').toLowerCase();
  const tipo = ct.split(';')[0].trim();
  const disp = (cab(h, 'content-disposition') ?? '').toLowerCase();
  if (tipo.startsWith('multipart/')) {
    const limite = parametro(cab(h, 'content-type') ?? '', 'boundary');
    if (!limite) return;
    const marca = '--' + limite;
    const trozos = cuerpo.split(marca).slice(1);
    for (const t of trozos) {
      if (t.startsWith('--')) break;   // marca de cierre
      recogerPartes(t.replace(/^\r?\n/, ''), profundidad + 1, salida);
    }
    return;
  }
  if (disp.startsWith('attachment')) return;
  if (tipo === 'text/plain' || tipo === 'text/html') {
    salida.push({ tipo, texto: cuerpoDecodificado(cuerpo, h) });
  } else if (tipo === 'message/rfc822') {
    // correo reenviado: no se mira (podría traer otro remitente)
  }
}

/**
 * Convierte un correo crudo en el aviso para la API. null si no tiene cuerpo de texto.
 * `text/plain` tiene prioridad; si solo hay HTML, se quitan las etiquetas. Los dígitos largos se enmascaran.
 */
export function parsearCorreo(raw: Buffer | string): AvisoHistorial | null {
  const bin = typeof raw === 'string' ? raw : raw.toString('latin1');
  const [cabBloque] = partirCabecera(bin);
  const h = parsearCabeceras(cabBloque);
  const partes: Parte[] = [];
  recogerPartes(bin, 0, partes);
  const plano = partes.find((p) => p.tipo === 'text/plain' && p.texto.trim() !== '');
  const html = partes.find((p) => p.tipo === 'text/html' && p.texto.trim() !== '');
  const elegido = plano ?? html;
  if (!elegido) return null;
  const texto = enmascarar(textoPlano(elegido.texto));
  if (texto === '') return null;

  const decod = (v: string | undefined) => decodificarPalabras(v ?? '').replace(/\s+/g, ' ').trim();
  const from = decod(cab(h, 'from')).slice(0, 320);
  if (from === '') return null;
  const aviso: AvisoHistorial = {
    from,
    subject: enmascarar(decod(cab(h, 'subject'))).slice(0, 500),
    date: (cab(h, 'date') ?? '').slice(0, 100),
    text: texto,
  };
  const mid = cab(h, 'message-id');
  if (mid) aviso.message_id = mid.slice(0, 998);
  // Solo el PRIMER bloque Authentication-Results (el que añadió mx.google.com; los demás los puede fabricar el remitente).
  const auth = cab(h, 'authentication-results');
  if (auth) aviso.auth_results = auth.replace(/\s+/g, ' ').slice(0, 4000);
  return aviso;
}

/** Mes del correo (AAAA-MM) según su Date; 'sin-fecha' si no se entiende. */
export function mesDeCorreo(date: string): string {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return 'sin-fecha';
  const d = new Date(t - 5 * 3600_000);   // Bogotá = UTC-5
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
