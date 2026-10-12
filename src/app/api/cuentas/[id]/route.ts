// GET / PATCH / DELETE /api/cuentas/{id} (sesión). PATCH { nombre?, tipo?, saldo? }; DELETE la borra (no tiene historial).
import { api, idDe, objeto } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON, respuestaVacia } from '@/lib/http';
import { borrarCuenta, editarCuenta, obtenerCuenta } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => {
  const cuenta = obtenerCuenta(c.db, idDe(c.params.id));
  if (!cuenta) throw new ErrorHTTP(404, 'no_encontrado', 'Cuenta no encontrada');
  return respuestaJSON(cuenta);
});

export const PATCH = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'tipo', 'saldo']);
  return respuestaJSON(editarCuenta(c.db, id, cuerpo, c.ahora));
});

export const DELETE = api('sesion', async (_req, c) => {
  if (!borrarCuenta(c.db, idDe(c.params.id))) throw new ErrorHTTP(404, 'no_encontrado', 'Cuenta no encontrada');
  return respuestaVacia(204);
});
