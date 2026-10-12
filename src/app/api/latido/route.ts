// POST /api/latido { flujo } → 204 (token). SPEC §5.7.
import { api, objeto, validacion } from '@/lib/api';
import { registrarLatido } from '@/lib/datos';
import { LIMITES_CUERPO, leerJSON, respuestaVacia } from '@/lib/http';

const FLUJOS = ['ingesta', 'bot', 'reportes', 'historial'] as const;

export const POST = api('token', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['flujo']);
  const flujo = FLUJOS.find((f) => f === cuerpo.flujo);
  if (!flujo) validacion('flujo debe ser ingesta, bot, reportes o historial', 'flujo');
  registrarLatido(c.db, flujo!, c.ahora);
  return respuestaVacia(204);
});
