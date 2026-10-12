// GET /api/tendencias?meses=12 (sesión): totales por mes para las gráficas. SPEC §5.1.
import { api, consulta, enteroConsulta, validacion } from '@/lib/api';
import { resumenDe } from '@/lib/consultas';
import { mesAnterior, mesDe, rangoMes } from '@/lib/formato';
import { respuestaJSON } from '@/lib/http';

export const GET = api('sesion', async (req, c) => {
  const meses = enteroConsulta(consulta(req), 'meses') ?? 12;
  if (meses < 1 || meses > 24) validacion('meses debe estar entre 1 y 24', 'meses');
  const inst = c.datos.instantanea(c.ahora);
  const lista: string[] = [];
  for (let m = mesDe(c.hoy), i = 0; i < meses; i++, m = mesAnterior(m)) lista.push(m);
  const items = lista.reverse().map((mes) => {
    const { desde, hasta } = rangoMes(mes);
    const r = resumenDe(c.datos, inst, desde, hasta);
    return {
      mes, ingresos: r.ingresos, gastado_variable: r.gastado_variable, gastado_fijos: r.gastado_fijos,
      ahorro: r.ingresos - r.gastado_variable - r.gastado_fijos,
    };
  });
  return respuestaJSON({ items });
});
