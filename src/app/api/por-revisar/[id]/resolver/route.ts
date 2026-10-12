// POST /api/por-revisar/{id}/resolver (sesión): crear el movimiento a mano, descartar o reintentar con la IA. SPEC §5.8.
import { enTransaccion } from '@/lib/db';
import { reintentarPorRevisar } from '@/lib/avisos/procesar';
import { api, idDe, objeto, validacion } from '@/lib/api';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { cerrarPorRevisar, obtenerPorRevisar } from '@/lib/panel';
import type { NuevoMovimiento } from '@/lib/tipos';

const CAMPOS_MOV = ['fecha', 'hora', 'banco', 'tipo', 'sentido', 'monto', 'comercio', 'categoria_id', 'medio', 'nota', 'computa', 'origen'];

export const POST = api('sesion', async (req, c) => {
  const id = idDe(c.params.id);
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['accion', 'movimiento']);
  const fila = obtenerPorRevisar(c.db, id);
  if (!fila || fila.estado !== 'pendiente') {
    return respuestaJSON({ error: { codigo: 'no_encontrado', mensaje: 'Aviso por revisar no encontrado' } }, 404);
  }

  if (cuerpo.accion === 'descartar') {
    cerrarPorRevisar(c.db, id, 'descartado', c.ahora);
    return respuestaJSON({ estado: 'descartado' });
  }
  if (cuerpo.accion === 'crear') {
    const mov = objeto(cuerpo.movimiento, CAMPOS_MOV);
    const creado = enTransaccion(c.db, () => {
      const m = c.datos.crearMovimiento({ origen: 'manual', ...mov } as unknown as NuevoMovimiento, c.actor);
      cerrarPorRevisar(c.db, id, { movimiento_id: m.id }, c.ahora);
      return m;
    });
    return respuestaJSON({ estado: 'resuelto', movimiento: creado }, 201);
  }
  if (cuerpo.accion === 'reintentar_ia') {
    c.db.prepare(
      "UPDATE por_revisar SET motivo = 'ia_no_disponible', intentos = 0 WHERE id = ? AND estado = 'pendiente' AND motivo IN ('ia_no_disponible','ia_invalida','monto_no_verificado')",
    ).run(id);
    const r = await reintentarPorRevisar({ db: c.db, ia: c.ia, ahora: c.ahora }, 50);
    return respuestaJSON({ ...r, fila: obtenerPorRevisar(c.db, id) });
  }
  return validacion('accion debe ser crear, descartar o reintentar_ia', 'accion');
});
