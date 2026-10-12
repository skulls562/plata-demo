// GET /api/recomendaciones (token o sesión): todas las vigentes, sin cooldown. SPEC §5.8.
// (El texto redactado por la IA, ?redactar=1, queda para la integración I1.)
import { api } from '@/lib/api';
import { respuestaJSON } from '@/lib/http';
import { calcularMetricas } from '@/lib/metricas';
import { evaluarReglas, ordenarRecomendaciones } from '@/lib/recomendar';

export const GET = api('token_o_sesion', async (_req, c) => {
  const inst = c.datos.instantanea(c.ahora);
  return respuestaJSON({ items: ordenarRecomendaciones(evaluarReglas(inst, calcularMetricas(inst))) });
});
