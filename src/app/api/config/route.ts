// GET /api/config y PATCH /api/config { clave, valor } (sesión). Nunca toca `secretos`. SPEC §5.8.
import { api, objeto, validacion } from '@/lib/api';
import { CONFIG_POR_DEFECTO } from '@/lib/config';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import type { ConfigPlata } from '@/lib/tipos';

export const GET = api('sesion', async (_req, c) => respuestaJSON(c.datos.leerConfig()));

export const PATCH = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['clave', 'valor']);
  const clave = cuerpo.clave;
  if (typeof clave !== 'string' || !Object.prototype.hasOwnProperty.call(CONFIG_POR_DEFECTO, clave)) validacion('clave de configuración desconocida', 'clave');
  if (!('valor' in cuerpo)) validacion('falta valor', 'valor');
  c.datos.fijarConfig(clave as keyof ConfigPlata, cuerpo.valor as never, c.actor);
  return respuestaJSON(c.datos.leerConfig());
});
