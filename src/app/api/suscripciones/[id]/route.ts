// PATCH /api/suscripciones/{id} { estado: confirmada | descartada } (sesión). Descartar silencia el aviso R15.
import { api, idDe, objeto, validacion } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const PATCH = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['estado']);
  if (cuerpo.estado !== 'confirmada' && cuerpo.estado !== 'descartada') validacion('estado debe ser confirmada o descartada', 'estado');
  const r = c.datos.cambiarEstadoRecurrente(id, cuerpo.estado as 'confirmada' | 'descartada');
  if (!r) throw new ErrorHTTP(404, 'no_encontrado', 'Suscripción no encontrada');
  if (cuerpo.estado === 'descartada') c.datos.silenciar(`suscripcion_detectada:${id}`, '9999-12-31T00:00:00Z');
  return respuestaJSON(r);
});
