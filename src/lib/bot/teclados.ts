// Teclados del bot: menú fijo, teclado numérico y botones de categorías.
import { formatearCOP } from '../formato';
import type { Boton, Categoria } from '../tipos';
import { cb, irA } from './callbacks';
import { categoriasGasto, enFilas } from './comun';

/** Menú fijo (teclado de respuesta persistente de Telegram), 3 filas. `pendientes` sale de la cola de Pendientes. */
export function tecladoMenu(pendientes: number): string[][] {
  return [
    ['💰 Hoy', '📅 Mes', '➕ Gasto'],
    ['🛒 ¿Puedo comprar?', '💵 Ingreso', pendientes > 0 ? `🧾 Pendientes (${Math.min(pendientes, 99)})` : '🧾 Pendientes'],
    ['🏦 Mis cuentas', '⚙️ Más'],
  ];
}

export const MONTOS_RAPIDOS: ReadonlyArray<{ tecla: string; valor: number }> = [
  { tecla: 'q5', valor: 5_000 }, { tecla: 'q10', valor: 10_000 }, { tecla: 'q20', valor: 20_000 }, { tecla: 'q50', valor: 50_000 },
];
const MAX_DIGITOS = 10;

/** Aplica una tecla al monto (cadena de dígitos). null = la tecla no cambia nada. */
export function aplicarTecla(d: string, tecla: string): string | null {
  const nuevo = (() => {
    if (/^\d$/.test(tecla)) return d === '' || d === '0' ? (tecla === '0' ? '' : tecla) : d + tecla;
    if (tecla === 't') return d === '' ? '' : d + '000';
    if (tecla === 'b') return d.slice(0, -1);
    const q = MONTOS_RAPIDOS.find((x) => x.tecla === tecla);
    return q ? String(q.valor) : d;
  })();
  if (nuevo.length > MAX_DIGITOS) return null;
  return nuevo === d ? null : nuevo;
}

/** Teclado numérico en línea: 1-9, 000 · 0 · ⌫, montos rápidos y Listo. */
export function tecladoNumerico(n: string): Boton[][] {
  const k = (texto: string, tecla: string): Boton => cb(texto, { accion: 'k', n, tecla });
  return [
    [k('1', '1'), k('2', '2'), k('3', '3')],
    [k('4', '4'), k('5', '5'), k('6', '6')],
    [k('7', '7'), k('8', '8'), k('9', '9')],
    [k('000', 't'), k('0', '0'), k('⌫', 'b')],
    MONTOS_RAPIDOS.map((q) => k(formatearCOP(q.valor), q.tecla)),
    [cb('✖ Cancelar', { accion: 'f', n, op: 'no' }), k('✔ Listo', 'l')],
  ];
}

/** Categorías de un flujo: 3 por fila. `extra` agrega una fila al final (p. ej. «No sé»). */
export function tecladoCategoriasFlujo(n: string, cats: Categoria[], extra: Boton[] = []): Boton[][] {
  const botones = categoriasGasto(cats).map((c) => cb(`${c.emoji} ${c.nombre}`, { accion: 'c', n, cat: c.id }));
  const filas = enFilas(botones, 3);
  if (extra.length) filas.push(extra);
  return filas;
}

/** Categorías para un movimiento (`cs:<mov>:<cat>`), 3 por fila, con «Era ingreso» y «Volver». */
export function tecladoCategorias(mov: number, cats: Categoria[]): Boton[][] {
  const botones = categoriasGasto(cats).map((c) => cb(`${c.emoji} ${c.nombre}`, { accion: 'cs', mov, cat: c.id }));
  const filas = enFilas(botones, 3);
  filas.push([cb('💰 Era ingreso', { accion: 'ing', mov }), cb('↩ Volver', { accion: 'vol', mov })]);
  return filas;
}

/** Pregunta «¿En qué se fue?» con las `usadas` más frecuentes (3 por fila) y «Más». */
export function tecladoPregunta(mov: number, cats: Categoria[], usadas: string[]): Boton[][] {
  const botones = usadas.map((id) => cats.find((c) => c.id === id && c.activa)).filter((c): c is Categoria => !!c)
    .map((c) => cb(`${c.emoji} ${c.nombre}`, { accion: 'cs', mov, cat: c.id }));
  const filas = enFilas(botones, 3);
  filas.push([cb('➕ Más', { accion: 'cat', mov }), cb('🙈 Ignorar', { accion: 'ign', mov })]);
  return filas;
}

export const volverMas = (): Boton[] => [irA('↩ Más', 'mas')];
