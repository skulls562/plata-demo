// GET /api/presupuestos?mes=AAAA-MM y PUT /api/presupuestos { mes, categoria_id, monto|null } (token o sesión). SPEC §5.8.
import { api, consulta, mesConsulta, objeto } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { mesDe } from '@/lib/formato';
import { presupuestosDe } from '@/lib/panel';

export const GET = api('token_o_sesion', async (req, c) => {
  return respuestaJSON(presupuestosDe(c.db, mesConsulta(consulta(req), 'mes', mesDe(c.hoy))));
});

export const PUT = api('token_o_sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['mes', 'categoria_id', 'monto']);
  // La validación fina (mes, categoría de gasto, monto) la hace el puerto y responde 422.
  c.datos.fijarPresupuesto(cuerpo.mes as string, cuerpo.categoria_id as string, (cuerpo.monto ?? null) as number | null, c.actor);
  const mes = typeof cuerpo.mes === 'string' && cuerpo.mes !== '*' ? cuerpo.mes : mesDe(c.hoy);
  return respuestaJSON(presupuestosDe(c.db, mes));
});
