// POST /api/deshacer { accion_id? } (sesión): revierte una acción (o la última) de las últimas 24 h. SPEC §6.2.
import { api, objeto, validacion } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['accion_id']);
  let r;
  if (cuerpo.accion_id === undefined) r = c.datos.deshacerUltima(c.actor, c.ahora);
  else {
    if (typeof cuerpo.accion_id !== 'number' || !Number.isInteger(cuerpo.accion_id) || cuerpo.accion_id < 1) validacion('accion_id inválido', 'accion_id');
    r = c.datos.deshacer(cuerpo.accion_id as number, c.ahora);
  }
  if (!r) throw new ErrorHTTP(404, 'no_encontrado', 'No hay nada para deshacer en las últimas 24 horas');
  return respuestaJSON(r);
});
