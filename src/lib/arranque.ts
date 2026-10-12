// Conexión de la seguridad con la base (pendiente que dejó A2). Se llama al arrancar el servidor
// (src/instrumentation.ts) y, por si acaso, desde el envoltorio de las rutas (idempotente).
import { obtenerDB } from './db';
import { fijarAlmacenSeguridad } from './http';
import { crearAlmacenSQLite } from './seguridad';

const g = globalThis as typeof globalThis & { __plataSeguridadConectada?: boolean };

/** `fijarAlmacenSeguridad(() => crearAlmacenSQLite(obtenerDB()))`, una sola vez por proceso (perezoso: no abre la base aún). */
export function conectarSeguridad(): void {
  if (g.__plataSeguridadConectada) return;
  fijarAlmacenSeguridad(() => crearAlmacenSQLite(obtenerDB()));
  g.__plataSeguridadConectada = true;
}

/** Solo para pruebas que fijan su propio almacén. */
export function marcarSeguridadConectada(valor = true): void {
  g.__plataSeguridadConectada = valor;
}
