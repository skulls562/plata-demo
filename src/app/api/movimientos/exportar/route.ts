// GET /api/movimientos/exportar?mes=AAAA-MM (solo sesión): CSV con BOM. Las celdas que empiezan con = + - @ TAB CR
// se prefijan con ' para que Excel no las ejecute como fórmula (SPEC §5.8, S10).
import { api, celdaCSV, mesConsulta } from '@/lib/api';
import { movimientosRango } from '@/lib/consultas';
import { mesDe, rangoMes } from '@/lib/formato';

export const GET = api('sesion', async (req, c) => {
  const mes = mesConsulta(new URL(req.url).searchParams, 'mes', mesDe(c.hoy));
  const { desde, hasta } = rangoMes(mes);
  const nombres = new Map(c.datos.listarCategorias().map((x) => [x.id, x.nombre]));
  const filas = movimientosRango(c.datos, desde, hasta).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? '').localeCompare(b.hora ?? '') || a.id - b.id);
  const lineas = ['fecha,hora,banco,tipo,monto,comercio,categoria,nota'];
  for (const m of filas) {
    lineas.push(
      [m.fecha, m.hora, m.banco, m.tipo, m.monto, m.comercio, nombres.get(m.categoria_id) ?? m.categoria_id, m.nota].map(celdaCSV).join(','),
    );
  }
  return new Response('﻿' + lineas.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="plata-${mes}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
