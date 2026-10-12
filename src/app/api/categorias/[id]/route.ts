// PATCH /api/categorias/{id} (sesión): nombre, emoji, esencial, cuenta_hormiga, activa, orden.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { editarCategoria } from '@/lib/panel';

export const PATCH = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'emoji', 'esencial', 'cuenta_hormiga', 'activa', 'orden']);
  return respuestaJSON(editarCategoria(c.db, c.params.id, cuerpo as Parameters<typeof editarCategoria>[2]));
});
