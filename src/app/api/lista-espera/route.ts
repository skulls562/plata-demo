// GET /api/lista-espera y POST /api/lista-espera (sesión): regla de las 48 horas. SPEC §4.4, §5.8.
import { api, objeto } from '@/lib/api';
import { categorizar } from '@/lib/categorizar';
import { mesDe, normalizarComercio } from '@/lib/formato';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { listarEspera } from '@/lib/panel';
import { leerReglasDB } from '@/lib/repo';

export const GET = api('sesion', async (_req, c) => respuestaJSON(listarEspera(c.db, mesDe(c.hoy))));

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['descripcion', 'monto', 'categoria_id']);
  const desc = typeof cuerpo.descripcion === 'string' ? cuerpo.descripcion : '';
  const cat = (cuerpo.categoria_id as string | undefined) ??
    categorizar(normalizarComercio(desc), 'compra', true, leerReglasDB(c.db)).categoria_id;
  return respuestaJSON(c.datos.agregarEspera(cuerpo.descripcion as string, cuerpo.monto as number, cat, c.ahora), 201);
});
