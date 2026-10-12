// GET /api/fijos y POST /api/fijos (sesión): gastos fijos. Guardar con un nombre existente lo actualiza. SPEC §5.8.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const GET = api('sesion', async (_req, c) => respuestaJSON({ items: c.datos.listarFijos() }));

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'monto', 'dia_mes', 'patron', 'categoria_id']);
  const f = c.datos.guardarFijo({
    nombre: cuerpo.nombre as string, monto: cuerpo.monto as number, dia_mes: (cuerpo.dia_mes ?? null) as number | null,
    patron: (cuerpo.patron ?? null) as string | null, categoria_id: cuerpo.categoria_id as string | undefined,
  }, c.actor);
  return respuestaJSON(f, 201);
});
