// GET /api/reportes/{cierre|semanal|mensual|suscripciones}?fecha=AAAA-MM-DD (SPEC §5.6).
// Son lecturas: no tocan cooldown ni emisiones. Con pausa vigente → respuestas [] y pausado: true.
import { aBogota, deBogota, mesAnterior, mesDe, parsearFechaUsuario } from '@/lib/formato';
import { api } from '@/lib/api';
import { ErrorHTTP, respuestaJSON } from '@/lib/http';
import { reporteCierre, reporteMensual, reporteSemanal, reporteSuscripciones } from '@/lib/bot';
import { registrarLatido } from '@/lib/datos';
import { calcularMetricas } from '@/lib/metricas';
import type { RespuestaBot } from '@/lib/tipos';

const TIPOS = new Set(['cierre', 'semanal', 'mensual', 'suscripciones']);

export const GET = api('token_o_sesion', async (req, c) => {
  const tipo = c.params.tipo;
  if (!TIPOS.has(tipo)) throw new ErrorHTTP(404, 'no_encontrado', 'Reporte desconocido');
  const q = new URL(req.url).searchParams.get('fecha');
  const real = c.ahora;
  let ahora = real;
  if (q !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q) || !parsearFechaUsuario(q, aBogota(real).fecha)) {
      throw new ErrorHTTP(422, 'validacion', 'fecha debe ser AAAA-MM-DD, pasada o de hoy', { campo: 'fecha' });
    }
    ahora = deBogota(q, '21:00');
  }
  const { db, datos } = c;
  const inst = datos.instantanea(ahora);
  const m = calcularMetricas(inst);
  const fecha = m.fecha;
  const generado_en = real.toISOString().replace(/\.\d{3}Z$/, 'Z');
  registrarLatido(db, 'reportes', real);

  if (inst.config.pausa_hasta && new Date(inst.config.pausa_hasta).getTime() > ahora.getTime()) {
    return respuestaJSON({ tipo, fecha, generado_en, respuestas: [], pausado: true, datos: {} });
  }
  let respuestas: RespuestaBot[];
  let cifras: Record<string, unknown>;
  switch (tipo) {
    case 'cierre':
      respuestas = reporteCierre(inst, m);
      cifras = { gastado_hoy: m.gastado_hoy, limite_hoy: m.limite_hoy, racha: m.racha.dias, semaforo: m.semaforo };
      break;
    case 'semanal':
      respuestas = reporteSemanal(inst, m);
      cifras = { gastado_mes: m.gastado_mes, hormiga_7d: m.hormiga.total_7d, nocturnas_7d: m.nocturnas.cantidad_7d };
      break;
    case 'mensual': {
      const mes = mesAnterior(mesDe(fecha));
      respuestas = reporteMensual(inst, mes);
      cifras = { mes };
      break;
    }
    default:
      respuestas = reporteSuscripciones(inst);
      cifras = { cobros_manana: respuestas.length };
  }
  return respuestaJSON({ tipo, fecha, generado_en, respuestas, datos: cifras });
});
