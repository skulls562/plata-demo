// DELETE /api/reglas/{id} (sesión).
import { api, idDe } from '@/lib/api';
import { ErrorHTTP, respuestaVacia } from '@/lib/http';
import { borrarRegla } from '@/lib/panel';

export const DELETE = api('sesion', async (_req, c) => {
  if (!borrarRegla(c.db, idDe(c.params.id))) throw new ErrorHTTP(404, 'no_encontrado', 'Regla no encontrada');
  return respuestaVacia(204);
});
