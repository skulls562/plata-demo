// GET /api/reglas y POST /api/reglas { patron, categoria_id } (sesión): reglas de categorización a mano.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { crearRegla, listarReglas } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => respuestaJSON({ items: listarReglas(c.db) }));

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['patron', 'categoria_id']);
  return respuestaJSON(crearRegla(c.db, cuerpo.patron as string, cuerpo.categoria_id as string), 201);
});
