// Lista blanca de remitentes y verificación de autenticación del correo (SPEC §7.6). Todo PURO.
import { SERVIDORES_AUTH_CONFIABLES, evaluarAuthResults } from '../seguridad';
import type { Banco } from '../tipos';
import { paqueteActivo } from '../paises';

const RE_DOMINIO = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * 'Bancolombia <x@ayn.notificacionesbancolombia.com>' → 'ayn.notificacionesbancolombia.com'.
 * Prefiere la dirección entre <>, para que un nombre visible con «@» no engañe. null si no hay dominio válido.
 */
export function dominioRemitente(from: string): string | null {
  if (typeof from !== 'string' || from.length === 0 || from.length > 320) return null;
  const m = /<([^<>]{1,320})>\s*$/.exec(from);
  const direccion = m ? m[1] : from.trim();
  const arroba = direccion.lastIndexOf('@');
  if (arroba < 1) return null;
  const dominio = direccion.slice(arroba + 1).trim().toLowerCase().replace(/\.$/, '');
  return RE_DOMINIO.test(dominio) && !dominio.includes('..') ? dominio : null;
}

/** Banco según el dominio del remitente, con el paquete del país activo (PLATA_PAIS); null = no permitido. */
export function bancoPorDominio(dominio: string): Banco | null {
  const d = String(dominio ?? '').toLowerCase();
  if (!d) return null;
  return paqueteActivo().bancoPorDominio(d);
}

/**
 * Verificación del remitente según Authentication-Results. La lógica vive en seguridad.ts › evaluarAuthResults:
 * solo se lee el PRIMER bloque y solo si lo escribió mx.google.com (lo demás lo puede fabricar el remitente).
 */
export function verificarAutenticacion(auth_results: string | undefined, dominio: string): 'pasa' | 'falla' | 'desconocido' {
  // El firmante (header.d/header.i/header.from) debe ser de la lista blanca y del mismo banco que el remitente
  // (revisión I2: antes bastaba con ser un dominio «padre», incluido un sufijo público como «com» o «com.co»).
  const banco = bancoPorDominio(dominio);
  return evaluarAuthResults(auth_results, dominio, SERVIDORES_AUTH_CONFIABLES, (f) => banco !== null && bancoPorDominio(f) === banco);
}
