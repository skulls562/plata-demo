// Formato, dinero y fechas (America/Bogota = UTC-5 fijo). Todo es PURO (SPEC §2.2, §3.10, §3.11, §6.3).
import type { HoraHM, ISODate, Mes, Pesos } from './tipos';

const MAX_PESOS = 10_000_000_000;
const DIA_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Dinero
// ---------------------------------------------------------------------------

export type ResultadoMonto =
  | { ok: true; valor: Pesos }
  | { ok: false; error: 'vacio' | 'formato' | 'ambiguo' | 'cero' | 'muy_grande' };

interface NumeroAnalizado {
  valor: number;            // puede traer decimales
  /** true si hay UN solo separador seguido de 1-2 dígitos (decimal sin forma de miles). */
  decimalSimple: boolean;
}

const soloDigitos = (s: string) => /^\d+$/.test(s);

/** Interpreta un número con separadores de miles/decimales al estilo colombiano o anglo. null = no se entiende. */
function analizarNumero(crudo: string): NumeroAnalizado | null {
  const s = crudo.replace(/[.,]+$/, '');          // un punto/coma final es de la frase, no del número
  if (!s || !/^[\d.,]+$/.test(s) || !/^\d/.test(s)) return null;
  const tienePunto = s.includes('.');
  const tieneComa = s.includes(',');

  if (!tienePunto && !tieneComa) return { valor: Number(s), decimalSimple: false };

  if (tienePunto && tieneComa) {
    // El separador que aparece último es el decimal (1-2 dígitos); el otro, de miles.
    const iUlt = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const sepDec = s[iUlt];
    const sepMiles = sepDec === '.' ? ',' : '.';
    const parteDec = s.slice(iUlt + 1);
    const parteEnt = s.slice(0, iUlt);
    if (!/^\d{1,2}$/.test(parteDec)) return null;
    if (parteEnt.includes(sepDec)) return null;
    const grupos = parteEnt.split(sepMiles);
    if (!gruposDeMilesValidos(grupos)) return null;
    return { valor: Number(grupos.join('') + '.' + parteDec), decimalSimple: false };
  }

  // Un solo tipo de separador.
  const sep = tienePunto ? '.' : ',';
  const grupos = s.split(sep);
  if (grupos.length > 2) {
    return gruposDeMilesValidos(grupos) ? { valor: Number(grupos.join('')), decimalSimple: false } : null;
  }
  const [ent, dec] = grupos;
  if (!soloDigitos(ent) || !soloDigitos(dec)) return null;
  if (dec.length === 3) {
    return ent.length <= 3 ? { valor: Number(ent + dec), decimalSimple: false } : null;
  }
  if (dec.length <= 2) return { valor: Number(ent + '.' + dec), decimalSimple: true };
  return null;
}

/** Primer grupo de 1-3 dígitos; los demás exactamente 3. */
function gruposDeMilesValidos(grupos: string[]): boolean {
  if (grupos.length === 0) return false;
  if (!/^\d{1,3}$/.test(grupos[0])) return false;
  return grupos.slice(1).every((g) => /^\d{3}$/.test(g));
}

/** Dinero dentro de un correo (§3.11): '14.730,00' → 14730. null si no se entiende o ≤ 0 o > 10^10. */
export function parsearDineroCO(s: string): Pesos | null {
  if (typeof s !== 'string') return null;
  const n = analizarNumero(s.replace(/\s+/g, ''));
  if (!n) return null;
  const v = Math.round(n.valor);
  if (!Number.isFinite(v) || v <= 0 || v > MAX_PESOS) return null;
  return v;
}

const SUFIJOS: Record<string, number> = {
  k: 1_000, mil: 1_000, lucas: 1_000, luca: 1_000,
  m: 1_000_000, millon: 1_000_000, 'millón': 1_000_000, millones: 1_000_000, palo: 1_000_000, palos: 1_000_000, mm: 1_000_000,
};

/** Entrada de Jero (§6.3): '80k', '1,5M', '2 palos', '80.000'. */
export function parsearMonto(s: string): ResultadoMonto {
  let t = (typeof s === 'string' ? s : '').toLowerCase().replace(/\$/g, ' ').replace(/\bcop\b/g, ' ').trim();
  t = t.replace(/\s+/g, ' ');
  if (!t) return { ok: false, error: 'vacio' };

  let mult = 1;
  const m = /^([\d.,\s]*?)\s*(k|mil|lucas|luca|millones|millon|millón|mm|m|palos|palo)$/.exec(t);
  let cuerpo = t;
  if (m) {
    cuerpo = m[1].trim();
    mult = SUFIJOS[m[2]];
    if (!cuerpo) return { ok: false, error: 'formato' };
  }
  cuerpo = cuerpo.replace(/\s+/g, '');
  if (!/^[\d.,]+$/.test(cuerpo)) return { ok: false, error: 'formato' };

  const n = analizarNumero(cuerpo);
  if (!n) return { ok: false, error: 'formato' };
  if (n.valor === 0) return { ok: false, error: 'cero' };
  // Sin sufijo, un único separador con 1-2 decimales (80.5) es ambiguo; con sufijo (1.5M) es decimal.
  if (mult === 1 && n.decimalSimple) return { ok: false, error: 'ambiguo' };

  const v = Math.round(n.valor * mult);
  if (v <= 0) return { ok: false, error: 'cero' };
  if (v > MAX_PESOS) return { ok: false, error: 'muy_grande' };
  return { ok: true, valor: v };
}

function conMiles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1234567 → '$1.234.567'; -5000 → '−$5.000' (signo menos U+2212). */
export function formatearCOP(n: Pesos): string {
  const r = Math.round(n);
  if (r < 0) return '−$' + conMiles(-r);
  return '$' + conMiles(r);
}

function unDecimal(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

/** 80000 → '$80k'; 1500000 → '$1,5M'. */
export function formatearCOPCorto(n: Pesos): string {
  const r = Math.round(n);
  const signo = r < 0 ? '−' : '';
  const a = Math.abs(r);
  if (a < 1000) return `${signo}$${a}`;
  if (a < 1_000_000) {
    const k = Math.round((a / 1000) * 10) / 10;
    if (k < 1000) return `${signo}$${unDecimal(k)}k`;
  }
  return `${signo}$${unDecimal(a / 1_000_000)}M`;
}

/** 0.1326 → '13%'. */
export function formatearPct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** NFD, sin tildes, minúsculas, [^a-z0-9] → ' ', espacios colapsados. */
export function normalizarTexto(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** normalizarTexto + quitar tokens numéricos de ≥ 4 dígitos + recortar a 120 (§3.10). */
export function normalizarComercio(s: string): string {
  const t = normalizarTexto(s)
    .split(' ')
    .filter((tok) => tok && !/^\d{4,}$/.test(tok))
    .join(' ');
  return t.slice(0, 120).trim();
}

export function escaparHTML(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Recorta a `max` caracteres en total, con '…' al final si se cortó. */
export function recortar(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  if (max === 1) return '…';
  return s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Fechas (Bogotá = UTC−5 fijo)
// ---------------------------------------------------------------------------

const OFFSET_H = 5;
const dos = (n: number) => String(n).padStart(2, '0');

export function aBogota(d: Date): { fecha: ISODate; hora: HoraHM; diaSemana: number } {
  const x = new Date(d.getTime() - OFFSET_H * 3_600_000);
  return {
    fecha: `${x.getUTCFullYear()}-${dos(x.getUTCMonth() + 1)}-${dos(x.getUTCDate())}`,
    hora: `${dos(x.getUTCHours())}:${dos(x.getUTCMinutes())}`,
    diaSemana: x.getUTCDay(),
  };
}

/** Instante UTC de una fecha/hora locales de Bogotá. */
export function deBogota(fecha: ISODate, hora?: HoraHM | null): Date {
  const [y, mo, d] = fecha.split('-').map(Number);
  const [h, mi] = (hora ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + OFFSET_H, mi));
}

function partesFecha(fecha: ISODate): [number, number, number] {
  const [y, m, d] = fecha.split('-').map(Number);
  return [y, m, d];
}

function aISO(ms: number): ISODate {
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${dos(x.getUTCMonth() + 1)}-${dos(x.getUTCDate())}`;
}

export function diasDelMes(mes: Mes): number {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function mesDe(fecha: ISODate): Mes {
  return fecha.slice(0, 7);
}

export function sumarDias(fecha: ISODate, n: number): ISODate {
  const [y, m, d] = partesFecha(fecha);
  return aISO(Date.UTC(y, m - 1, d) + n * DIA_MS);
}

/** Suma meses; el día se recorta al último del mes destino (31-ene +1 → 28-feb). */
export function sumarMeses(fecha: ISODate, n: number, diaPreferido?: number): ISODate {
  const [y, m, d] = partesFecha(fecha);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const dia = Math.min(diaPreferido ?? d, dim);
  return `${ny}-${dos(nm)}-${dos(dia)}`;
}

/** b − a en días. */
export function diasEntre(a: ISODate, b: ISODate): number {
  const [ya, ma, da] = partesFecha(a);
  const [yb, mb, db] = partesFecha(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DIA_MS);
}

export function rangoMes(mes: Mes): { desde: ISODate; hasta: ISODate } {
  return { desde: `${mes}-01`, hasta: `${mes}-${dos(diasDelMes(mes))}` };
}

export function mesAnterior(mes: Mes): Mes {
  const [y, m] = mes.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${dos(m - 1)}`;
}

function fechaValida(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Cabecera Date de un correo (RFC 2822) o ISO. Un ISO sin zona se toma como hora de Bogotá. */
export function parsearFechaCorreo(date: string): Date | null {
  if (typeof date !== 'string') return null;
  let s = date.trim();
  if (!s || s.length > 100) return null;
  s = s.replace(/\s*\([^)]*\)\s*$/, '');      // '(CST)' al final
  const sinZona = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/.exec(s);
  if (sinZona) s = `${sinZona[1]}T${sinZona[2]}:${sinZona[3] ?? '00'}-05:00`;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** 'hoy','ayer','anteayer','6/10','06/10/2026','2026-10-06'. Nunca futura ni > 400 días atrás. */
export function parsearFechaUsuario(s: string, hoy: ISODate): ISODate | null {
  const t = sinTildes(String(s ?? ''));
  let res: ISODate | null = null;
  if (t === 'hoy') res = hoy;
  else if (t === 'ayer') res = sumarDias(hoy, -1);
  else if (t === 'anteayer') res = sumarDias(hoy, -2);
  else {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (fechaValida(y, mo, d)) res = `${y}-${dos(mo)}-${dos(d)}`;
    } else {
      m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(t);
      if (m) {
        const d = Number(m[1]);
        const mo = Number(m[2]);
        let y = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
        if (fechaValida(y, mo, d)) {
          let cand = `${y}-${dos(mo)}-${dos(d)}`;
          // Sin año y cae en el futuro → es de el año pasado.
          if (!m[3] && cand > hoy) {
            y -= 1;
            cand = fechaValida(y, mo, d) ? `${y}-${dos(mo)}-${dos(d)}` : '';
          }
          res = cand || null;
        }
      }
    }
  }
  if (!res) return null;
  if (res > hoy) return null;
  if (diasEntre(res, hoy) > 400) return null;
  return res;
}

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

/** '2026-09', 'septiembre', 'sep', 'sep 2025', 'pasado', 'actual'. */
export function parsearMes(s: string, hoy: ISODate): Mes | null {
  const t = sinTildes(String(s ?? ''));
  const actual = mesDe(hoy);
  if (t === 'pasado' || t === 'mes pasado' || t === 'anterior') return mesAnterior(actual);
  if (t === 'actual' || t === 'este' || t === 'este mes') return actual;
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 ? `${y}-${dos(mo)}` : null;
  }
  m = /^([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/.exec(t);
  if (!m || !(m[1] in MESES)) return null;
  const mo = MESES[m[1]];
  const yHoy = Number(hoy.slice(0, 4));
  if (m[2]) return `${m[2]}-${dos(mo)}`;
  // Sin año: el más reciente que no sea futuro.
  const y = mo > Number(hoy.slice(5, 7)) ? yHoy - 1 : yHoy;
  return `${y}-${dos(mo)}`;
}

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-06' → '6 oct'. */
export function formatearFechaCorta(fecha: ISODate): string {
  const [, m, d] = partesFecha(fecha);
  return `${d} ${MES_CORTO[m - 1]}`;
}

/** Mediana; con cantidad par, el promedio de los dos centrales (puede traer decimales). Vacío → 0. */
export function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(o.length / 2);
  return o.length % 2 ? o[mid] : (o[mid - 1] + o[mid]) / 2;
}
