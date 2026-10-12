// Utilidades compartidas de avisos: validación, texto plano, referencias, huella, tipo y fusión (SPEC §1.3, §2.2). Todo PURO.
import { createHash } from 'node:crypto';
import { aBogota, deBogota, parsearFechaCorreo, recortar } from '../formato';
import { coincide } from '../categorizar';
import { ErrorUsuario } from '../tipos';
import type { AvisoCrudo, Banco, ConfigPlata, DatosAviso, HoraHM, ISODate, Movimiento, TipoMovimiento } from '../tipos';

// ---------------------------------------------------------------------------
// Validación de la entrada
// ---------------------------------------------------------------------------

function textoCampo(x: Record<string, unknown>, campo: string, max: number, obligatorio: boolean): string | undefined {
  const v = x[campo];
  if (v === undefined || v === null) {
    if (obligatorio) throw new ErrorUsuario('validacion', `${campo} es obligatorio`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ErrorUsuario('validacion', `${campo} debe ser texto`);
  if (v.length > max) throw new ErrorUsuario('validacion', `${campo} supera ${max} caracteres`);
  return v;
}

/** Valida un AvisoCrudo (límites del SPEC §2.1) y devuelve una copia limpia con solo las claves conocidas. */
export function validarAvisoCrudo(x: unknown): AvisoCrudo {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    throw new ErrorUsuario('validacion', 'aviso debe ser un objeto');
  }
  const o = x as Record<string, unknown>;
  const from = textoCampo(o, 'from', 320, true)!;
  if (from.trim() === '') throw new ErrorUsuario('validacion', 'from no puede estar vacío');
  const aviso: AvisoCrudo = {
    from,
    subject: textoCampo(o, 'subject', 500, true)!,
    date: textoCampo(o, 'date', 100, true)!,
    text: textoCampo(o, 'text', 200_000, true)!,
  };
  const mid = textoCampo(o, 'message_id', 998, false);
  if (mid !== undefined && mid.trim() !== '') aviso.message_id = mid;
  const auth = textoCampo(o, 'auth_results', 4000, false);
  if (auth !== undefined && auth.trim() !== '') aviso.auth_results = auth;
  return aviso;
}

// ---------------------------------------------------------------------------
// Texto plano (HTML → texto) sin regex con retroceso: un barrido lineal
// ---------------------------------------------------------------------------

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

/** Quita etiquetas (descarta script/style y comentarios) conservando saltos de línea de bloques. */
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
    if (!(esLetra || sig === 47 /* / */ || sig === 33 /* ! */ || sig === 63 /* ? */)) {
      salida += '<';     // un «<» suelto («a < b») es texto
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
      salida += html.slice(lt);   // sin cierre: lo que queda se conserva como texto
      break;
    }
    // nombre de etiqueta
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

/**
 * Texto plano del cuerpo de un correo: quita etiquetas y entidades, elimina caracteres invisibles,
 * colapsa espacios dentro de cada línea y descarta líneas vacías (los saltos entre líneas se conservan: PSE los necesita) y recorta a 20 000.
 */
export function textoPlano(text: string): string {
  let t = String(text ?? '');
  if (t.length > 400_000) t = t.slice(0, 400_000);
  if (t.includes('<')) t = quitarEtiquetas(t);
  t = decodificarEntidades(t);
  t = t
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '')
    .replace(/[ \t\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
  const lineas = t.split('\n').map((l) => l.trim());
  const compactas: string[] = [];
  for (const l of lineas) {
    if (l === '') continue;   // sin líneas en blanco: los parsers solo necesitan un salto entre líneas
    compactas.push(l);
  }
  return compactas.join('\n').trim().slice(0, 20_000);
}

// ---------------------------------------------------------------------------
// Referencias y huella
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const colapsar = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `mid:` + sha256(message_id sin <>) o `h:` + sha256(from/subject/date/texto). Nunca guarda el Message-ID crudo. */
export function refCorreo(a: AvisoCrudo): string {
  if (a.message_id && a.message_id.trim() !== '') {
    return 'mid:' + sha256(a.message_id.trim().toLowerCase().replace(/[<>]/g, ''));
  }
  return 'h:' + sha256(`${a.from}\n${a.subject}\n${a.date}\n${colapsar(a.text)}`);
}

/** Huella de contenido: `${fecha}|${hora ?? '--:--'}|${monto}|${comercio_norm}|${banco}`. */
export function huella(d: Pick<DatosAviso, 'fecha' | 'hora' | 'monto' | 'banco'>, comercio_norm: string): string {
  return `${d.fecha}|${d.hora ?? '--:--'}|${d.monto}|${comercio_norm}|${d.banco}`;
}

// ---------------------------------------------------------------------------
// Tipo ajustado (pago de tarjeta / entre cuentas) y fusión
// ---------------------------------------------------------------------------

/** Una salida cuyo comercio coincide con los patrones configurados deja de contar (evita el doble conteo). */
export function ajustarTipo(
  d: DatosAviso,
  comercio_norm: string,
  cfg: ConfigPlata,
): { tipo: TipoMovimiento; computa: boolean } {
  if (d.tipo === 'pago_tarjeta' || d.tipo === 'interno') return { tipo: d.tipo, computa: false };
  if (d.sentido === 'salida') {
    if (cfg.patrones_pago_tarjeta.some((p) => coincide(comercio_norm, p))) return { tipo: 'pago_tarjeta', computa: false };
    if (cfg.patrones_interno.some((p) => coincide(comercio_norm, p))) return { tipo: 'interno', computa: false };
  }
  // Decisión de Jero (2026-10-09): una transferencia no es gasto por defecto; cuenta solo si él la marca («Fue un gasto»).
  return { tipo: d.tipo, computa: d.tipo !== 'transferencia' };
}

const esPasarela = (b: Banco) => b === 'wompi' || b === 'pse';

/**
 * Busca el movimiento con el que el aviso nuevo es la misma compra (§1.3.3).
 * `candidatos` ya debe venir filtrado por el llamador (vivos y sin ref_secundaria). Aquí se exige: mismo monto,
 * mismo sentido, banco distinto, origen aviso/historial y |Δt| ≤ `minutos`.
 * - 'fusionar': exactamente uno de los dos es pasarela (wompi/pse).
 * - 'marcar': coinciden pero ninguno (o ambos) es pasarela, o falta la hora de alguno: se inserta y se marca posible duplicado.
 */
export function buscarFusion(
  nuevo: DatosAviso,
  candidatos: Movimiento[],
  minutos: number,
): { accion: 'fusionar' | 'marcar' | 'ninguna'; con: Movimiento | null } {
  let mejor: { mov: Movimiento; delta: number; sinHora: boolean } | null = null;
  for (const c of candidatos) {
    if (c.monto !== nuevo.monto || c.sentido !== nuevo.sentido || c.banco === nuevo.banco) continue;
    if (c.origen !== 'aviso' && c.origen !== 'historial') continue;
    let delta: number;
    let sinHora = false;
    if (c.hora && nuevo.hora) {
      delta = Math.abs(deBogota(c.fecha, c.hora).getTime() - deBogota(nuevo.fecha, nuevo.hora).getTime()) / 60_000;
    } else {
      if (c.fecha !== nuevo.fecha) continue;
      delta = 0;
      sinHora = true;
    }
    if (delta > minutos) continue;
    if (!mejor || delta < mejor.delta) mejor = { mov: c, delta, sinHora };
  }
  if (!mejor) return { accion: 'ninguna', con: null };
  const unaPasarela = esPasarela(nuevo.banco) !== esPasarela(mejor.mov.banco);
  if (unaPasarela && !mejor.sinHora) return { accion: 'fusionar', con: mejor.mov };
  return { accion: 'marcar', con: mejor.mov };
}

/** Fecha y hora de Bogotá de la cabecera Date; si es ilegible, las de `ahora`. */
export function fechaHoraDeCorreo(date: string, ahora: Date): { fecha: ISODate; hora: HoraHM } {
  const d = parsearFechaCorreo(date) ?? ahora;
  const { fecha, hora } = aBogota(d);
  return { fecha, hora };
}

/** Atajos usados por los parsers. */
export function comercioPorDefecto(tipo: TipoMovimiento): string {
  switch (tipo) {
    case 'retiro': return 'Retiro';
    case 'transferencia': return 'Transferencia';
    case 'ingreso': return 'Ingreso';
    case 'reverso': return 'Reembolso';
    case 'pago_tarjeta': return 'Pago de tarjeta';
    case 'pago': return 'Pago';
    default: return 'Compra';
  }
}

/** Recorta un comercio ya enmascarado al máximo de la base (120). */
export function limpiarComercio(s: string): string {
  return recortar(s.replace(/\s+/g, ' ').trim(), 120);
}

/** Hora 'HH:MM' desde partes sueltas; `ampm` es el texto «a. m.»/«p. m.» si lo hay. null si es imposible. */
export function horaDesdePartes(h: number, m: number, ampm?: string | null): HoraHM | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59) return null;
  let hh = h;
  if (ampm) {
    const pm = ampm.toLowerCase().startsWith('p');
    if (h < 1 || h > 12) return null;
    if (pm && h < 12) hh = h + 12;
    else if (!pm && h === 12) hh = 0;
  } else if (h < 0 || h > 23) {
    return null;
  }
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'AAAA-MM-DD' desde día/mes/año; null si la fecha no existe. */
export function fechaDesdePartes(d: number, m: number, a: number): ISODate | null {
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(a)) return null;
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(a, m, 0)).getUTCDate()) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
