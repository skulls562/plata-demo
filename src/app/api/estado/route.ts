// GET /api/estado (token o sesión): salud del sistema, solo conteos y fechas. SPEC §5.7.
import { api, armarEstado } from '@/lib/api';
import { respuestaJSON } from '@/lib/http';

export const GET = api('token_o_sesion', async (_req, c) => respuestaJSON(await armarEstado(c)));
