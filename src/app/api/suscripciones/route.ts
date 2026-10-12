// GET /api/suscripciones (sesión): recurrentes guardados (se refrescan antes de listar). SPEC §5.8.
import { api } from '@/lib/api';
import { leerRecurrentes, refrescarRecurrentes } from '@/lib/datos';
import { respuestaJSON } from '@/lib/http';

export const GET = api('sesion', async (_req, c) => {
  refrescarRecurrentes(c.db, c.hoy);
  const items = leerRecurrentes(c.db).sort((a, b) => b.costo_anual - a.costo_anual || a.id - b.id);
  return respuestaJSON({ items });
});
