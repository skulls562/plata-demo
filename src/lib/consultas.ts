// Consultas de solo lectura sobre AccesoDatos que comparten ia.ts y bot.ts (periodos fuera de la instantánea).
import { aBogota, sumarDias } from './formato';
import { resumenPeriodo, type ResumenPeriodo } from './metricas';
import type { AccesoDatos, Instantanea, ISODate, Movimiento } from './tipos';

/** Todos los movimientos vivos de un rango, paginando (máximo 50 páginas de 200). */
export function movimientosRango(datos: AccesoDatos, desde: ISODate, hasta: ISODate, extra: { q?: string; sentido?: 'salida' | 'entrada' } = {}): Movimiento[] {
  const res: Movimiento[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const p = datos.buscarMovimientos({ desde, hasta, limite: 200, cursor, ...extra });
    res.push(...p.items);
    if (!p.siguiente_cursor) break;
    cursor = p.siguiente_cursor;
  }
  return res;
}

/** Resumen de un periodo: usa la instantánea si lo cubre (últimos ~400 días); si no, pagina la base. */
export function resumenDe(datos: AccesoDatos, inst: Instantanea, desde: ISODate, hasta: ISODate): ResumenPeriodo {
  const hoy = aBogota(inst.ahora).fecha;
  if (desde >= sumarDias(hoy, -395)) return resumenPeriodo(inst, desde, hasta);
  return resumenPeriodo({ ...inst, movimientos: movimientosRango(datos, desde, hasta) }, desde, hasta);
}
