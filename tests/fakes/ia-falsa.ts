// ClienteIA falso: respuestas fijas o calculadas, y modo «caída». Jamás toca la red (SPEC §8.2).
import type { ClienteIA } from '@/lib/tipos';

export interface OpcionesIAFalsa {
  /** false = Ollama caído: disponible() → false y todo lo demás → null. */
  disponible?: boolean;
  /** Respuesta de chatJSON: valor fijo, o función de (sistema, usuario). null = el modelo no respondió. */
  json?: unknown | ((sistema: string, usuario: string) => unknown);
  /** Respuesta de chatTexto: texto fijo o función. */
  texto?: string | null | ((sistema: string, usuario: string) => string | null);
}

export interface IAFalsa extends ClienteIA {
  llamadas: { tipo: 'json' | 'texto'; sistema: string; usuario: string }[];
  /** Cambia las respuestas en caliente. */
  configurar(o: OpcionesIAFalsa): void;
}

export function crearIAFalsa(opciones: OpcionesIAFalsa = {}): IAFalsa {
  let o: OpcionesIAFalsa = { disponible: true, json: null, texto: null, ...opciones };
  const llamadas: IAFalsa['llamadas'] = [];
  return {
    llamadas,
    configurar(n) { o = { ...o, ...n }; },
    async disponible() { return o.disponible !== false; },
    async chatJSON<T>(sistema: string, usuario: string): Promise<T | null> {
      llamadas.push({ tipo: 'json', sistema, usuario });
      if (o.disponible === false) return null;
      const r = typeof o.json === 'function' ? (o.json as (s: string, u: string) => unknown)(sistema, usuario) : o.json;
      return (r ?? null) as T | null;
    },
    async chatTexto(sistema: string, usuario: string, opts?: { maxCaracteres?: number }) {
      llamadas.push({ tipo: 'texto', sistema, usuario });
      if (o.disponible === false) return null;
      const r = typeof o.texto === 'function' ? o.texto(sistema, usuario) : (o.texto ?? null);
      if (r === null) return null;
      return opts?.maxCaracteres ? r.slice(0, opts.maxCaracteres) : r;
    },
  };
}

/** IA caída. */
export const iaCaida = (): IAFalsa => crearIAFalsa({ disponible: false });
