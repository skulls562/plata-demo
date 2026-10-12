// GET /api/metricas?fecha=AAAA-MM-DD (token o sesión) → Metricas. `fecha` es opcional (pruebas y rellenos). SPEC §5.8.
import { api, consulta, validacion } from '@/lib/api';
import { deBogota } from '@/lib/formato';
import { respuestaJSON } from '@/lib/http';
import { calcularMetricas } from '@/lib/metricas';

export const GET = api('token_o_sesion', async (req, c) => {
  const f = consulta(req).get('fecha');
  let ahora = c.ahora;
  if (f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(deBogota(f, '12:00').getTime())) validacion('fecha debe ser AAAA-MM-DD', 'fecha');
    if (f > c.hoy) validacion('fecha no puede ser futura', 'fecha');
    if (f < c.hoy) ahora = deBogota(f, '12:00');
  }
  return respuestaJSON(calcularMetricas(c.datos.instantanea(ahora)));
});
