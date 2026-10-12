// GET /api/categorias y POST /api/categorias (sesión). SPEC §5.8.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { crearCategoria } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => respuestaJSON({ items: c.datos.listarCategorias() }));

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['id', 'nombre', 'emoji', 'esencial', 'cuenta_hormiga']);
  return respuestaJSON(crearCategoria(c.db, cuerpo as Parameters<typeof crearCategoria>[1]), 201);
});
