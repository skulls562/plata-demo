import type { Banco } from '../tipos';

/** Lo que cambia de un país a otro. Cada país exporta un `PaquetePais` y se registra en `./index.ts`. */
export interface PaquetePais {
  pais: string;                    // ISO 3166-1 alfa-2, p. ej. 'CO'
  nombre: string;
  moneda: string;                  // ISO 4217
  zona: string;                    // zona horaria IANA
  /** Banco según el dominio del remitente (minúsculas); null = remitente no permitido. */
  bancoPorDominio(dominio: string): Banco | null;
  patrones_pago_tarjeta: string[];
  patrones_interno: string[];
}
