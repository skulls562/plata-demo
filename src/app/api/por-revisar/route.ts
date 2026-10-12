// GET /api/por-revisar?estado=pendiente|resuelto|descartado (sesión).
import { api, consulta, validacion } from '@/lib/api';
import { respuestaJSON } from '@/lib/http';
import { listarPorRevisar } from '@/lib/panel';

export const GET = api('sesion', async (req, c) => {
  const estado = consulta(req).get('estado') ?? 'pendiente';
  if (estado !== 'pendiente' && estado !== 'resuelto' && estado !== 'descartado') validacion('estado inválido', 'estado');
  return respuestaJSON({ items: listarPorRevisar(c.db, estado as 'pendiente') });
});
