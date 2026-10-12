// DELETE /api/fijos/{id} (sesión): lo desactiva (se puede deshacer).
import { api, idDe } from '@/lib/api';
import { ErrorHTTP, respuestaVacia } from '@/lib/http';

export const DELETE = api('sesion', async (_req, c) => {
  const id = idDe(c.params.id);
  const f = c.datos.listarFijos().find((x) => x.id === id);
  if (!f || !c.datos.quitarFijo(f.nombre, c.actor)) throw new ErrorHTTP(404, 'no_encontrado', 'Gasto fijo no encontrado');
  return respuestaVacia(204);
});
