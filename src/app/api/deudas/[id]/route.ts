// GET / PATCH / DELETE /api/deudas/{id} (sesión). Migración 5.
// GET → { deuda, solo_minimo }. PATCH { nombre?, tipo?, saldo?, tasa_ea?, pago_minimo?, dia_pago?, activa? }.
// DELETE la archiva (activa = false; sale de los cálculos). Se reactiva con PATCH { activa: true }.
import { api, idDe, objeto } from '@/lib/api';
import { simularSoloMinimo } from '@/lib/deudas';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON, respuestaVacia } from '@/lib/http';
import { archivarDeuda, editarDeuda, obtenerDeuda } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => {
  const deuda = obtenerDeuda(c.db, idDe(c.params.id));
  if (!deuda) throw new ErrorHTTP(404, 'no_encontrado', 'Deuda no encontrada');
  return respuestaJSON({ deuda, solo_minimo: simularSoloMinimo(deuda) });
});

export const PATCH = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'tipo', 'saldo', 'tasa_ea', 'pago_minimo', 'dia_pago', 'activa']);
  return respuestaJSON(editarDeuda(c.db, id, cuerpo, c.ahora));
});

export const DELETE = api('sesion', async (_req, c) => {
  const id = idDe(c.params.id);
  if (!obtenerDeuda(c.db, id)) throw new ErrorHTTP(404, 'no_encontrado', 'Deuda no encontrada');
  archivarDeuda(c.db, id, c.ahora);
  return respuestaVacia(204);
});
