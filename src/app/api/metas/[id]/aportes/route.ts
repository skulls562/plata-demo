// POST /api/metas/{id}/aportes { monto, fecha? } (sesión): monto negativo = retiro. SPEC §5.8.
import { api, idDe, objeto } from '@/lib/api';
import { LIMITES_CUERPO, conIdempotencia, leerJSON, respuestaJSON } from '@/lib/http';

export const POST = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['monto', 'fecha', 'nota']);
  return conIdempotencia(req, `/api/metas/${id}/aportes`, cuerpo, async () => {
    const aporte = c.datos.aportarMeta(id, cuerpo.monto as number, (cuerpo.fecha ?? c.hoy) as string, c.actor);
    return respuestaJSON(aporte, 201);
  });
});
