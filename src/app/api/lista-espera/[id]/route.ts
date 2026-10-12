// PATCH /api/lista-espera/{id} { accion: comprado | descartado | extender } (sesión).
import { api, idDe, objeto, validacion } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const PATCH = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['accion']);
  if (cuerpo.accion !== 'comprado' && cuerpo.accion !== 'descartado' && cuerpo.accion !== 'extender') {
    validacion('accion debe ser comprado, descartado o extender', 'accion');
  }
  const it = c.datos.actualizarEspera(id, cuerpo.accion as 'comprado', c.ahora);
  if (!it) throw new ErrorHTTP(404, 'no_encontrado', 'Ítem no encontrado');
  return respuestaJSON(it);
});
