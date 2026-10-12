// POST /api/avisos/lote (token, 2 MB): hasta 50 correos en serie (script de historial y reconciliación). SPEC §5.4.
import { validarAvisoCrudo } from '@/lib/avisos/comun';
import { procesarAviso } from '@/lib/avisos/procesar';
import { api, objeto } from '@/lib/api';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import type { ResultadoAviso } from '@/lib/tipos';

export const POST = api('token', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.avisos_lote), ['avisos', 'origen']);
  const origen = cuerpo.origen ?? 'historial';
  if (origen !== 'aviso' && origen !== 'historial') throw new ErrorHTTP(422, 'validacion', 'origen debe ser aviso o historial', { campo: 'origen' });
  if (!Array.isArray(cuerpo.avisos) || cuerpo.avisos.length < 1 || cuerpo.avisos.length > 50) {
    throw new ErrorHTTP(422, 'validacion', 'avisos debe ser una lista de 1 a 50 correos', { campo: 'avisos' });
  }
  // Se valida todo antes de procesar nada.
  const avisos = cuerpo.avisos.map((a) => validarAvisoCrudo(a));

  const resultados: ResultadoAviso[] = [];
  const resumen = { creado: 0, fusionado: 0, duplicado: 0, ignorado: 0, por_revisar: 0 };
  for (const a of avisos) {
    const r = await procesarAviso(a, { origen }, { db: c.db, ia: c.ia, ahora: c.ahora });
    resultados.push(r);
    resumen[r.estado] += 1;
  }
  return respuestaJSON({ resultados, resumen });
});
