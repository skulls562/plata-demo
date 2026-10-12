// POST /api/avisos (token, 256 KB): un correo del banco → movimiento. SPEC §5.4.
import { procesarAviso } from '@/lib/avisos/procesar';
import { validarAvisoCrudo } from '@/lib/avisos/comun';
import { api, armarNotificacion, objeto } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';

export const POST = api('token', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.avisos), ['aviso', 'origen']);
  const origen = cuerpo.origen ?? 'aviso';
  if (origen !== 'aviso' && origen !== 'historial') throw new ErrorHTTP(422, 'validacion', 'origen debe ser aviso o historial', { campo: 'origen' });
  const aviso = validarAvisoCrudo(cuerpo.aviso);

  const r = await procesarAviso(aviso, { origen }, { db: c.db, ia: c.ia, ahora: c.ahora });
  if (r.estado === 'ignorado' && r.motivo === 'remitente_no_permitido') {
    throw new ErrorHTTP(422, 'remitente_no_permitido', 'El remitente no está en la lista permitida');
  }
  const { notificar, anomalias } = armarNotificacion(c, r, origen);
  const resultado = r.estado === 'creado' ? { ...r, anomalias } : r;
  return respuestaJSON({ resultado, notificar }, r.estado === 'creado' ? 201 : 200);
});
