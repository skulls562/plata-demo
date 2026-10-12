// GET /api/deudas y POST /api/deudas (sesión). Migración 5.
// GET ?todas=1 incluye las archivadas; ?pago_mensual=N simula otro pago mensual a deudas (simulador del panel).
// Devuelve las deudas, su resumen, «solo el mínimo» por deuda y la comparación avalancha / bola de nieve.
import { api, consulta, enteroConsulta, objeto, validacion } from '@/lib/api';
import { compararPlanes, minimosMes, NOTA_ASESORIA, simularSoloMinimo, vencimientos } from '@/lib/deudas';
import { LIMITES_CUERPO, conIdempotencia, leerJSON, respuestaJSON } from '@/lib/http';
import { crearDeuda, listarDeudas } from '@/lib/panel';

export const GET = api('sesion', async (req, c) => {
  const q = consulta(req);
  const todas = q.get('todas') === '1';
  const pagoQ = enteroConsulta(q, 'pago_mensual');
  if (pagoQ !== undefined && (pagoQ < 1 || pagoQ > 10_000_000_000)) validacion('pago_mensual fuera de rango', 'pago_mensual');
  const cfg = c.datos.leerConfig();
  const items = listarDeudas(c.db, todas);
  const activas = items.filter((d) => d.activa);
  const pago = pagoQ ?? cfg.pago_deudas_mensual;
  const venc = vencimientos(activas, c.hoy);
  return respuestaJSON({
    items,
    resumen: {
      deuda_total: activas.reduce((s, d) => s + d.saldo, 0),
      minimos_mes: minimosMes(activas),
      proximo_vencimiento: venc[0] ?? null,
      vencimientos: venc,
    },
    solo_minimo: activas.filter((d) => d.saldo > 0).map(simularSoloMinimo),
    planes: compararPlanes(activas, pago),
    estrategia: cfg.estrategia_deudas,
    pago_mensual_config: cfg.pago_deudas_mensual,
    nota: NOTA_ASESORIA,
  });
});

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'tipo', 'saldo', 'tasa_ea', 'pago_minimo', 'dia_pago']);
  return conIdempotencia(req, '/api/deudas', cuerpo, async () =>
    respuestaJSON(crearDeuda(c.db, {
      nombre: cuerpo.nombre, tipo: cuerpo.tipo, saldo: cuerpo.saldo, tasa_ea: cuerpo.tasa_ea,
      pago_minimo: cuerpo.pago_minimo, dia_pago: cuerpo.dia_pago ?? null,
    }, c.ahora), 201));
});
