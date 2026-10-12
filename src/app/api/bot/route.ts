// POST /api/bot (SPEC §5.5): n8n manda cada update de Telegram; responde los mensajes a enviar.
// Idempotente por update_id. Nunca responde 4xx por el CONTENIDO del mensaje (n8n reintentaría).
// Una respuesta con `texto: ''` es solo un answer_callback: n8n no manda mensaje, solo responde el callback.
// Contrato completo de RespuestaBot (botones, teclado fijo, editar/borrar mensaje): docs/BOT-UX.md §8.
import type { DatabaseSync } from 'node:sqlite';
import { api } from '@/lib/api';
import { aInstanteISO } from '@/lib/db';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { manejarUpdate } from '@/lib/bot';
import { registrarLatido } from '@/lib/datos';
import { chatAutorizado, enmascararDigitos } from '@/lib/seguridad';
import type { UpdateBot } from '@/lib/tipos';

function validar(x: unknown): UpdateBot {
  const bad = (campo: string): never => { throw new ErrorHTTP(422, 'validacion', `${campo} inválido`, { campo }); };
  if (!x || typeof x !== 'object') return bad('cuerpo');
  const o = x as Record<string, unknown>;
  if (!Number.isSafeInteger(o.update_id) || (o.update_id as number) < 0) bad('update_id');
  if (!(typeof o.chat_id === 'number' && Number.isSafeInteger(o.chat_id)) && !(typeof o.chat_id === 'string' && /^-?\d{1,20}$/.test(o.chat_id))) bad('chat_id');
  if (o.tipo !== 'texto' && o.tipo !== 'callback') bad('tipo');
  const u: UpdateBot = { update_id: o.update_id as number, chat_id: o.chat_id as number | string, tipo: o.tipo as 'texto' | 'callback' };
  if (o.texto !== undefined && o.texto !== null) { if (typeof o.texto !== 'string' || o.texto.length > 4096) bad('texto'); u.texto = o.texto as string; }
  if (o.callback_data !== undefined && o.callback_data !== null) {
    if (typeof o.callback_data !== 'string' || Buffer.byteLength(o.callback_data) > 64) bad('callback_data');
    u.callback_data = o.callback_data as string;
  }
  if (o.callback_query_id !== undefined && o.callback_query_id !== null) {
    if (typeof o.callback_query_id !== 'string' || o.callback_query_id.length > 64) bad('callback_query_id');
    u.callback_query_id = o.callback_query_id as string;
  }
  if (o.message_id !== undefined && o.message_id !== null) { if (!Number.isSafeInteger(o.message_id)) bad('message_id'); u.message_id = o.message_id as number; }
  return u;
}

function leerRespuestaBot(db: DatabaseSync, update_id: number): string | null {
  const f = db.prepare('SELECT respuesta FROM bot_updates WHERE update_id = ?').get(update_id) as { respuesta?: unknown } | undefined;
  return f && typeof f.respuesta === 'string' ? f.respuesta : null;
}

function guardarRespuestaBot(db: DatabaseSync, update_id: number, respuesta: string, ahora: Date): void {
  db.prepare('INSERT OR IGNORE INTO bot_updates (update_id, recibido_en, respuesta) VALUES (?, ?, ?)').run(update_id, aInstanteISO(ahora), respuesta);
}

export const POST = api('token', async (req, c) => {
  const { entorno, db, datos, ia, ahora } = c;
  const u = validar(await leerJSON(req, LIMITES_CUERPO.bot));

  if (!chatAutorizado(u.chat_id, entorno)) {
    datos.registrarEvento({ nivel: 'aviso', tipo: 'chat_no_autorizado', detalle: `chat ${enmascararDigitos(String(u.chat_id))}` });
    return respuestaJSON({ respuestas: [], ignorado: 'chat_no_autorizado' });
  }

  const previa = leerRespuestaBot(db, u.update_id);
  if (previa !== null) return new Response(previa, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  const respuestas = await manejarUpdate(u, { datos, ia, ahora, urlPanel: entorno.url_panel });
  const cuerpo = JSON.stringify({ respuestas });
  guardarRespuestaBot(db, u.update_id, cuerpo, ahora);
  registrarLatido(db, 'bot', ahora);
  return new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
});
