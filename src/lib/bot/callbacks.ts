// Gramática de callback_data del bot (docs/BOT-UX.md §Callbacks). ASCII, ≤ 64 bytes, a lo sumo 3 segmentos.
import { DESTINOS_MENU, type CallbackBot, type DestinoMenu } from '../tipos';

export const RE_CALLBACK = /^[a-z0-9]{1,4}(:[a-z0-9_]{1,24}){0,2}$/;
const RE_NONCE = /^[a-z0-9]{1,4}$/;
const RE_SEG = /^[a-z0-9_]{1,24}$/;

const entero = (s: string | undefined): number | null => (s !== undefined && /^\d{1,12}$/.test(s) && Number(s) > 0 ? Number(s) : null);

export function parsearCallback(data: string): CallbackBot | null {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 64 || !RE_CALLBACK.test(data)) return null;
  const [a, x, y] = data.split(':');
  const n = entero(x);
  switch (a) {
    case 'cat': case 'ing': case 'gas': case 'int': case 'rev': case 'ign': case 'dup': case 'vol': case 'ni': case 'mv': case 'cn': case 'ps': case 'pi':
      return n !== null && y === undefined ? ({ accion: a, mov: n } as CallbackBot) : null;
    case 'cs': case 'rm': case 'pc': return n !== null && y !== undefined ? ({ accion: a, mov: n, cat: y } as CallbackBot) : null;
    case 'und': return n !== null && y === undefined ? { accion: 'und', accion_id: n } : null;
    case 'ndp': { const b = entero(y); return n !== null && b !== null ? { accion: 'ndp', a: n, b } : null; }
    case 'pu': { const b = entero(y); return n !== null && b !== null ? { accion: 'pu', accion_id: n, mov: b } : null; }
    case 'sc': case 'sd': return n !== null && y === undefined ? { accion: a, rec: n } : null;
    case 'ec': case 'ed': case 'e48': return n !== null && y === undefined ? { accion: a, item: n } : null;
    case 'me': case 'ma': case 'ms': case 'mp': return n !== null && y === undefined ? ({ accion: a, meta: n } as CallbackBot) : null;
    case 'pz': return n !== null && n <= 168 && y === undefined ? { accion: 'pz', horas: n } : null;
    case 'ah': return n !== null && n <= 80 && y === undefined ? { accion: 'ah', pct: n } : null;
    case 'bd': case 'bm': case 'bp': case 'be': case 'bq':
      return x !== undefined && y === undefined && RE_SEG.test(x) ? ({ accion: a, cat: x } as CallbackBot) : null;
    case 'm': return x !== undefined && y === undefined && (DESTINOS_MENU as readonly string[]).includes(x) ? { accion: 'm', dest: x as DestinoMenu } : null;
    case 'k': return x !== undefined && y !== undefined && RE_NONCE.test(x) ? { accion: 'k', n: x, tecla: y } : null;
    case 'c': return x !== undefined && y !== undefined && RE_NONCE.test(x) ? { accion: 'c', n: x, cat: y } : null;
    case 'f': return x !== undefined && y !== undefined && RE_NONCE.test(x) ? { accion: 'f', n: x, op: y } : null;
    case 'iu': return x === undefined ? { accion: 'iu' } : null;
    case 'ok': return x === undefined ? { accion: 'ok' } : null;
    default: return null;
  }
}

export function serializarCallback(c: CallbackBot): string {
  let s: string;
  switch (c.accion) {
    case 'cs': case 'rm': case 'pc': s = `${c.accion}:${c.mov}:${c.cat}`; break;
    case 'und': s = `und:${c.accion_id}`; break;
    case 'ndp': s = `ndp:${c.a}:${c.b}`; break;
    case 'pu': s = `pu:${c.accion_id}:${c.mov}`; break;
    case 'sc': case 'sd': s = `${c.accion}:${c.rec}`; break;
    case 'ec': case 'ed': case 'e48': s = `${c.accion}:${c.item}`; break;
    case 'me': case 'ma': case 'ms': case 'mp': s = `${c.accion}:${c.meta}`; break;
    case 'pz': s = `pz:${c.horas}`; break;
    case 'ah': s = `ah:${c.pct}`; break;
    case 'bd': case 'bm': case 'bp': case 'be': case 'bq': s = `${c.accion}:${c.cat}`; break;
    case 'm': s = `m:${c.dest}`; break;
    case 'k': s = `k:${c.n}:${c.tecla}`; break;
    case 'c': s = `c:${c.n}:${c.cat}`; break;
    case 'f': s = `f:${c.n}:${c.op}`; break;
    case 'iu': s = 'iu'; break;
    case 'ok': s = 'ok'; break;
    default: s = `${c.accion}:${c.mov}`;
  }
  if (Buffer.byteLength(s, 'utf8') > 64 || !RE_CALLBACK.test(s)) throw new Error(`callback_data inválido: ${s}`);
  return s;
}

/** Atajos para armar botones. */
export const cb = (texto: string, c: CallbackBot): { texto: string; callback_data: string } => ({ texto, callback_data: serializarCallback(c) });
export const irA = (texto: string, dest: DestinoMenu) => cb(texto, { accion: 'm', dest });
