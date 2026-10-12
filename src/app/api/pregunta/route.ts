// POST /api/pregunta { pregunta } → { texto, intencion, hechos, fuente } (SPEC §5.8, §9.4). Solo lectura.
import { api } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { responderPregunta } from '@/lib/ia';

export const POST = api('token_o_sesion', async (req, c) => {
  const cuerpo = await leerJSON<{ pregunta?: unknown }>(req, LIMITES_CUERPO.pregunta);
  const p = cuerpo && typeof cuerpo === 'object' ? cuerpo.pregunta : undefined;
  if (typeof p !== 'string' || p.trim().length < 1 || p.length > 500) {
    throw new ErrorHTTP(422, 'validacion', 'pregunta debe ser un texto de 1 a 500 caracteres', { campo: 'pregunta' });
  }
  const { datos, ia, ahora } = c;
  return respuestaJSON(await responderPregunta(p.trim(), datos, ia, ahora));
});
