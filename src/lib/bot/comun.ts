// Piezas compartidas por los módulos del bot: formato, contexto, montos, pendientes y categorías más usadas.
import {
  aBogota, escaparHTML, formatearCOP, normalizarTexto, parsearMonto, sumarDias, type ResultadoMonto,
} from '../formato';
import { calcularMetricas } from '../metricas';
import type { AccesoDatos, Boton, Categoria, ClienteIA, Instantanea, Metricas, Movimiento, RespuestaBot } from '../tipos';

export const $ = formatearCOP;
export const esc = escaparHTML;
export const MAX_LINEAS = 12;

export interface ContextoBot { datos: AccesoDatos; ia: ClienteIA; ahora: Date; urlPanel: string }

export const SEM: Record<string, string> = { verde: '🟢', amarillo: '🟡', rojo: '🔴', gris: '⚪', estimando: '🟠' };
export const MEDIOS: Record<string, string> = { debito: 'débito', credito: 'crédito', cuenta: 'cuenta', pse: 'PSE', efectivo: 'efectivo', otro: 'otro' };

// Con una base estimada el rojo se pinta naranja («estimando»): no se alarma con datos supuestos.
// Con cuentas anotadas manda la plata real (limita = 'saldo'): ese rojo es de verdad aunque el ingreso sea estimado.
export const rojoSegunBase = (m: Metricas): string => (m.base_hoy.limita === 'estimado' ? '🟠' : '🔴');
export const emojiDia = (m: Metricas): string => {
  if (m.limite_hoy === null) return '';
  if (m.limite_hoy === 0) return rojoSegunBase(m);
  const r = m.gastado_hoy / m.limite_hoy;
  return r <= 0.7 ? '🟢' : r <= 1 ? '🟡' : rojoSegunBase(m);
};
export const emojiMes = (m: Metricas): string => {
  if (m.proyeccion_ratio === null) return '⚪';
  return m.proyeccion_ratio <= 0.95 ? '🟢' : m.proyeccion_ratio <= 1.05 ? '🟡' : rojoSegunBase(m);
};

export const catDe = (cats: Categoria[], id: string) => cats.find((c) => c.id === id);
export const nombreCat = (cats: Categoria[], id: string) => catDe(cats, id)?.nombre ?? id;
export const emojiCat = (cats: Categoria[], id: string) => catDe(cats, id)?.emoji ?? '📦';
/** «🍔 Comida» */
export const etiquetaCat = (cats: Categoria[], id: string) => `${emojiCat(cats, id)} ${nombreCat(cats, id)}`;

export const reply = (texto: string, extra: Partial<RespuestaBot> = {}): RespuestaBot[] => [{ texto, ...extra }];
/** Respuesta sin mensaje: solo contesta el callback (quita el reloj de Telegram). */
export const vacio = (extra: Partial<RespuestaBot> = {}): RespuestaBot[] => [{ texto: '', answer_callback: {}, ...extra }];
export const toast = (texto: string, alerta = false): RespuestaBot[] => [{ texto: '', answer_callback: alerta ? { texto, alerta: true } : { texto } }];
export const YA_PASO = 'Eso ya pasó';

export const isoSinMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function vista(ctx: ContextoBot) {
  const inst = ctx.datos.instantanea(ctx.ahora);
  return { inst, m: calcularMetricas(inst), cats: ctx.datos.listarCategorias() };
}

/** Identificador corto de conversación: sale del update_id que la abre. */
export const nonceDe = (update_id: number): string => (Math.abs(update_id) % 46656).toString(36);

// ---------------------------------------------------------------------------
// Montos
// ---------------------------------------------------------------------------

export const SUFIJOS_MONTO = /^(k|mil|lucas|luca|m|mm|millon|millón|millones|palo|palos)$/i;

/** Toma el monto del inicio (acepta «80 mil» en dos palabras). */
export function tomarMonto(tokens: string[]): { res: ResultadoMonto; texto: string; resto: string[] } {
  let texto = tokens[0] ?? '';
  let usados = 1;
  if (tokens[1] && SUFIJOS_MONTO.test(tokens[1])) { texto = `${texto} ${tokens[1]}`; usados = 2; }
  return { res: parsearMonto(texto), texto, resto: tokens.slice(usados) };
}

const MSG_MONTO: Record<string, (x: string) => string> = {
  vacio: () => '¿Cuánto? Ej: 80k, 80.000 o 1.5M.',
  formato: (x) => `No entendí el monto «${esc(x)}». Prueba 80k, 80.000 o 1.5M.`,
  ambiguo: (x) => `¿${esc(x.replace('.', ','))} pesos? Escríbelo como 80k o 80.000.`,
  cero: () => 'El monto tiene que ser mayor que cero.',
  muy_grande: () => 'Ese monto es demasiado grande.',
};
export const errMonto = (r: Extract<ResultadoMonto, { ok: false }>, txt: string): string => MSG_MONTO[r.error](txt);

// ---------------------------------------------------------------------------
// Comercios genéricos, pendientes y categorías más usadas
// ---------------------------------------------------------------------------

const GENERICOS = new Set(['', 'pago por qr', 'pago qr', 'transferencia a cuenta', 'transferencia', 'compra', 'pago', 'retiro', 'ingreso']);

/** Un comercio genérico no dice nada del lugar: no se aprende una regla de él («Pago por QR», «Gasto comida»…). */
export function esComercioGenerico(comercio_norm: string): boolean {
  return GENERICOS.has(comercio_norm) || /^gasto( |$)/.test(comercio_norm) || /^pago por qr( |$)/.test(comercio_norm);
}

/** Movimientos que piden una categoría: salida que cuenta, sin categoría clara (otros por defecto o QR sin comercio), de los últimos 60 días. */
export function pendientesDe(inst: Instantanea): Movimiento[] {
  const hoy = aBogota(inst.ahora).fecha;
  const desde = sumarDias(hoy, -60);
  return inst.movimientos
    .filter((x) => x.sentido === 'salida' && x.computa && x.fecha >= desde && x.tipo !== 'interno' && x.tipo !== 'pago_tarjeta' && x.tipo !== 'retiro'
      && x.categoria_fuente !== 'manual' && x.categoria_fuente !== 'aprendida'
      && (x.categoria_id === 'otros' && x.categoria_fuente === 'defecto' || /^pago (por )?qr/.test(x.comercio_norm) && x.categoria_id === 'otros'))
    .sort((a, b) => (b.fecha + (b.hora ?? '00:00')).localeCompare(a.fecha + (a.hora ?? '00:00')) || b.id - a.id);
}

/** ¿Este movimiento tiene una categoría poco segura? (se le pregunta al usuario) */
export function categoriaIncierta(m: Movimiento): boolean {
  return m.tipo !== 'ingreso' && m.sentido === 'salida' && m.computa && (m.categoria_id === 'otros' || m.categoria_id === 'transferencias') && m.categoria_fuente === 'defecto';
}

/** Categorías de gasto activas, en el orden del catálogo. */
export function categoriasGasto(cats: Categoria[]): Categoria[] {
  return cats.filter((c) => c.es_gasto && c.activa && !c.sistema).sort((a, b) => a.orden - b.orden);
}

/** Ids de las `n` categorías de gasto más usadas en los últimos 90 días (rellena con el orden del catálogo). */
export function masUsadas(inst: Instantanea, n: number): string[] {
  const desde = sumarDias(aBogota(inst.ahora).fecha, -90);
  const cuenta = new Map<string, number>();
  for (const x of inst.movimientos) {
    if (x.sentido === 'salida' && x.fecha >= desde && x.categoria_id !== 'otros' && x.categoria_fuente !== 'defecto') cuenta.set(x.categoria_id, (cuenta.get(x.categoria_id) ?? 0) + 1);
  }
  const ids = categoriasGasto(inst.categorias).filter((c) => c.id !== 'otros').map((c) => c.id);
  const ordenadas = [...ids].sort((a, b) => (cuenta.get(b) ?? 0) - (cuenta.get(a) ?? 0));
  return ordenadas.slice(0, n);
}

export const normaliza = normalizarTexto;

/** Reparte botones en filas de `por` columnas. */
export function enFilas(botones: Boton[], por: number): Boton[][] {
  const filas: Boton[][] = [];
  for (let i = 0; i < botones.length; i += por) filas.push(botones.slice(i, i + por));
  return filas;
}
