// POST /api/puedo { monto, descripcion } → Veredicto (SPEC §5.8, §4.3). No agrega nada a la lista de espera:
// devuelve regla_48h y el panel ofrece el botón.
import { api } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { calcularMetricas } from '@/lib/metricas';
import { veredictoPuedo } from '@/lib/recomendar';

export const POST = api('token_o_sesion', async (req, c) => {
  const cuerpo = await leerJSON<{ monto?: unknown; descripcion?: unknown }>(req, LIMITES_CUERPO.defecto);
  const o = cuerpo && typeof cuerpo === 'object' ? cuerpo : {};
  const monto = o.monto;
  if (typeof monto !== 'number' || !Number.isSafeInteger(monto) || monto <= 0 || monto > 10_000_000_000) {
    throw new ErrorHTTP(422, 'validacion', 'monto debe ser un entero positivo', { campo: 'monto' });
  }
  const desc = o.descripcion ?? '';
  if (typeof desc !== 'string' || desc.length > 80) {
    throw new ErrorHTTP(422, 'validacion', 'descripcion debe ser un texto de hasta 80 caracteres', { campo: 'descripcion' });
  }
  const { datos, ahora } = c;
  const inst = datos.instantanea(ahora);
  return respuestaJSON(veredictoPuedo(inst, calcularMetricas(inst), { monto, descripcion: desc, ahora }));
});
