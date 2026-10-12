// GET / PATCH / DELETE /api/metas/{id} (sesión). DELETE cancela la meta (no borra sus aportes). SPEC §5.8.
import { api, idDe, objeto, validacion } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON, respuestaVacia } from '@/lib/http';
import { editarMeta, obtenerMeta } from '@/lib/panel';
import type { Meta } from '@/lib/tipos';

const ESTADOS = ['activa', 'pausada', 'cumplida', 'cancelada'];

export const GET = api('sesion', async (_req, c) => {
  const m = obtenerMeta(c.db, idDe(c.params.id));
  if (!m) throw new ErrorHTTP(404, 'no_encontrado', 'Meta no encontrada');
  return respuestaJSON(m);
});

export const PATCH = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'objetivo', 'fecha_objetivo', 'emoji', 'prioridad', 'estado']);
  const { estado, ...resto } = cuerpo;
  if (estado !== undefined && (typeof estado !== 'string' || !ESTADOS.includes(estado))) validacion('estado inválido', 'estado');
  editarMeta(c.db, id, resto as Parameters<typeof editarMeta>[2]);
  if (estado !== undefined) c.datos.cambiarEstadoMeta(id, estado as Meta['estado']);
  return respuestaJSON(obtenerMeta(c.db, id));
});

export const DELETE = api('sesion', async (_req, c) => {
  c.datos.cambiarEstadoMeta(idDe(c.params.id), 'cancelada');
  return respuestaVacia(204);
});
