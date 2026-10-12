// Selector del paquete de país según PLATA_PAIS (por defecto CO). Para agregar un país: crear `xx.ts` y registrarlo aquí.
import { PAQUETE_CO } from './co';
import type { PaquetePais } from './tipos';

export type { PaquetePais } from './tipos';

export const PAQUETES: Record<string, PaquetePais> = { CO: PAQUETE_CO };

/** Paquete del país indicado (código ISO, sin importar mayúsculas); un código desconocido cae en Colombia. */
export function paqueteDe(pais: string | undefined): PaquetePais {
  return PAQUETES[String(pais ?? '').trim().toUpperCase()] ?? PAQUETE_CO;
}

/** Paquete activo, leído de PLATA_PAIS. */
export function paqueteActivo(entorno: Record<string, string | undefined> = process.env): PaquetePais {
  return paqueteDe(entorno.PLATA_PAIS);
}
