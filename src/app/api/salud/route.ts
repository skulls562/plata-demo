// GET /api/salud → { ok: true } (pública; conAuth aplica el control de Host). SPEC §5.1.
import { conAuth, respuestaJSON } from '@/lib/http';

export const GET = conAuth('publica', async () => respuestaJSON({ ok: true }));
