// GET /api/metas y POST /api/metas (sesión). SPEC §5.8.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { listarMetas, obtenerMeta } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => respuestaJSON({ items: listarMetas(c.db) }));

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'objetivo', 'fecha_objetivo', 'emoji']);
  const meta = c.datos.crearMeta({
    nombre: cuerpo.nombre as string, objetivo: cuerpo.objetivo as number,
    fecha_objetivo: (cuerpo.fecha_objetivo ?? null) as string | null, emoji: cuerpo.emoji as string | undefined,
  });
  return respuestaJSON(obtenerMeta(c.db, meta.id), 201);
});
