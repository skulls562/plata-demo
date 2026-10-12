// POST /api/por-revisar/reintentar { max } → { resueltos, siguen } (token). Solo motivo ia_no_disponible, máx. 5 intentos.
import { reintentarPorRevisar } from '@/lib/avisos/procesar';
import { api, objeto, validacion } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const POST = api('token', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['max']);
  const max = cuerpo.max ?? 10;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 50) validacion('max debe ser un entero de 1 a 50', 'max');
  return respuestaJSON(await reintentarPorRevisar({ db: c.db, ia: c.ia, ahora: c.ahora }, max as number));
});
