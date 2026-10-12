// POST /api/correo/sincronizar (sesión): trae ahora los avisos recientes del banco desde Gmail («Actualizar Gmail»).
// Responde 200 también cuando no se pudo (ok:false + mensaje legible), para que el panel lo muestre tal cual.
import { api } from '@/lib/api';
import { sincronizarCorreo } from '@/lib/correo-sync';
import { respuestaJSON } from '@/lib/http';

export const POST = api('sesion', async () => respuestaJSON(await sincronizarCorreo()));
