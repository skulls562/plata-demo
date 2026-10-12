// Arnés de pruebas del bot sin comandos: una «sesión» con datos e IA falsos, reloj controlable y las invariantes del contrato
// (docs/BOT-UX.md) comprobadas en CADA respuesta.
import { expect } from 'vitest';
import { manejarUpdate } from '@/lib/bot';
import { parsearCallback } from '@/lib/bot/callbacks';
import type { RespuestaBot, UpdateBot } from '@/lib/tipos';
import { crearDatosFalsos } from './datos-falsos';
import { iaCaida } from './ia-falsa';
import { escenarioCanonico } from '../fixtures/constructores';

export const AHORA = new Date('2026-10-15T17:00:00Z');
export const URL_PANEL = 'http://127.0.0.1:3010';
export const CHAT = 123456789;

/** Invariantes del contrato: ≤ 4096 caracteres, ≤ 12 líneas, nunca pide un slash, callbacks válidos, un solo teclado por mensaje. */
export function chequear(rs: RespuestaBot[]): void {
  for (const r of rs) {
    expect(r.texto.length).toBeLessThanOrEqual(4096);
    expect(r.texto.split('\n').length, r.texto).toBeLessThanOrEqual(12);
    expect(r.texto, 'pide un slash').not.toMatch(/(^|[\s>(«])\/[a-z]{2,}/);
    for (const b of (r.botones ?? []).flat()) {
      // Un botón lleva callback_data o url (nunca los dos); la url, https/http.
      expect(b.callback_data !== undefined || b.url !== undefined, b.texto).toBe(true);
      if (b.url !== undefined) { expect(b.callback_data).toBeUndefined(); expect(b.url).toMatch(/^https?:[/][/]/); continue; }
      expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
      expect(parsearCallback(b.callback_data!), b.callback_data).not.toBeNull();
    }
    if (r.botones?.length) expect(r.teclado).toBeUndefined();
    if (r.teclado) { expect(r.quitar_teclado).toBeUndefined(); expect(r.editar_message_id).toBeUndefined(); }
  }
}

export function sesion(extra: Parameters<typeof crearDatosFalsos>[0] = {}, urlPanel: string = URL_PANEL) {
  const i = escenarioCanonico();
  const datos = crearDatosFalsos({ movimientos: i.movimientos, fijos: i.fijos, recurrentes: i.recurrentes, config: i.config, ...extra });
  const ia = iaCaida();
  let id = 1000;
  let ahora = AHORA;
  const correr = async (u: UpdateBot) => { const rs = await manejarUpdate(u, { datos, ia, ahora, urlPanel }); chequear(rs); return rs; };
  return {
    datos,
    texto: (t: string) => correr({ update_id: id++, chat_id: CHAT, tipo: 'texto', texto: t, message_id: 10 }),
    cb: (data: string, msg = 77) => correr({ update_id: id++, chat_id: CHAT, tipo: 'callback', callback_data: data, callback_query_id: 'q', message_id: msg }),
    avanzar: (min: number) => { ahora = new Date(ahora.getTime() + min * 60_000); },
    ultimo: () => datos.estado.movimientos.at(-1)!,
  };
}
export type Sesion = ReturnType<typeof sesion>;

export const datosDe = (r: RespuestaBot) => (r.botones ?? []).flat().map((b) => b.callback_data!);
export const nonceDe = (r: RespuestaBot) => /^(?:k|c|f):([a-z0-9]+):/.exec(datosDe(r).find((d) => /^(?:k|c|f):/.test(d)) ?? '')![1];
export const pulsar = async (s: Sesion, n: string, teclas: string[]) => { let r: RespuestaBot[] = []; for (const t of teclas) r = await s.cb(`k:${n}:${t}`); return r; };
