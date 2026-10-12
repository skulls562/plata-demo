// GET /api/movimientos (lista con cursor) y POST /api/movimientos (alta manual). Token o sesión. SPEC §5.3, §5.8.
import { api, consulta, enteroConsulta, objeto, validacion } from '@/lib/api';
import { LIMITES_CUERPO, conIdempotencia, leerJSON, respuestaJSON } from '@/lib/http';
import type { FiltroMovimientos, NuevoMovimiento } from '@/lib/tipos';

const CAMPOS_NUEVO = ['fecha', 'hora', 'banco', 'tipo', 'sentido', 'monto', 'comercio', 'categoria_id', 'medio', 'nota', 'computa', 'origen'];

export const GET = api('token_o_sesion', async (req, c) => {
  const q = consulta(req);
  const f: FiltroMovimientos = {};
  const txt = (k: string) => q.get(k) || undefined;
  f.desde = txt('desde');
  f.hasta = txt('hasta');
  f.categoria_id = txt('categoria');
  f.banco = txt('banco') as FiltroMovimientos['banco'];
  f.tipo = txt('tipo') as FiltroMovimientos['tipo'];
  f.sentido = txt('sentido') as FiltroMovimientos['sentido'];
  f.origen = txt('origen') as FiltroMovimientos['origen'];
  f.q = txt('q');
  f.min = enteroConsulta(q, 'min');
  f.max = enteroConsulta(q, 'max');
  f.limite = enteroConsulta(q, 'limite');
  f.cursor = txt('cursor') ?? null;
  return respuestaJSON(c.datos.buscarMovimientos(f));
});

export const POST = api('token_o_sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), CAMPOS_NUEVO);
  if (cuerpo.origen !== 'manual') validacion('origen debe ser "manual"', 'origen');
  return conIdempotencia(req, '/api/movimientos', cuerpo, async () => {
    const m = c.datos.crearMovimiento(cuerpo as unknown as NuevoMovimiento, c.actor);
    return respuestaJSON(m, 201);
  });
});
