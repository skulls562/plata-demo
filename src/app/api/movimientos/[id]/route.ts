// GET / PATCH / DELETE /api/movimientos/{id} (token o sesión). PATCH exige `version`; si cambia la categoría,
// se aprende como recategorizar y la respuesta es { movimiento, aplicados_a }. SPEC §5.3, §5.8.
import { api, idDe, objeto, validacion } from '@/lib/api';
import { enTransaccion } from '@/lib/db';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { ErrorConflicto } from '@/lib/tipos';
import type { CambiosMovimiento } from '@/lib/tipos';

const CAMPOS = ['version', 'categoria_id', 'tipo', 'sentido', 'computa', 'comercio', 'monto', 'fecha', 'hora', 'nota', 'fijo_id'];

export const GET = api('token_o_sesion', async (_req, c) => {
  const m = c.datos.obtenerMovimiento(idDe(c.params.id));
  if (!m) throw new ErrorHTTP(404, 'no_encontrado', 'Movimiento no encontrado');
  return respuestaJSON(m);
});

export const PATCH = api('token_o_sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), CAMPOS);
  if (typeof cuerpo.version !== 'number' || !Number.isInteger(cuerpo.version) || cuerpo.version < 1) validacion('version es obligatoria', 'version');

  return enTransaccion(c.db, () => {
    const actual = c.datos.obtenerMovimiento(id);
    if (!actual) throw new ErrorHTTP(404, 'no_encontrado', 'Movimiento no encontrado');
    if (actual.version !== cuerpo.version) throw new ErrorConflicto(actual.version);

    const { categoria_id, ...resto } = cuerpo as Record<string, unknown>;
    const cambiaCategoria = typeof categoria_id === 'string' && categoria_id !== actual.categoria_id;
    const hayOtros = Object.keys(resto).some((k) => k !== 'version');
    if (categoria_id !== undefined && typeof categoria_id !== 'string') validacion('categoria_id inválida', 'categoria_id');

    let mov = actual;
    if (hayOtros) mov = c.datos.editarMovimiento(id, resto as unknown as CambiosMovimiento, c.actor);
    if (cambiaCategoria) {
      const r = c.datos.recategorizar(id, categoria_id as string, c.actor);
      return respuestaJSON({ movimiento: r.movimiento, aplicados_a: r.aplicados_a });
    }
    return respuestaJSON(mov);
  });
});

export const DELETE = api('token_o_sesion', async (_req, c) => {
  return respuestaJSON(c.datos.borrarMovimiento(idDe(c.params.id), c.actor));
});
