// Despacho de avisos por remitente (SPEC §2.2). PURO.
import type { AvisoCrudo, ResultadoParseo } from '../tipos';
import { parsearBancolombia } from './bancolombia';
import { fechaHoraDeCorreo, textoPlano } from './comun';
import { bancoPorDominio, dominioRemitente } from './remitentes';
import { parsearPSE } from './pse';
import { parsearWompi } from './wompi';

/**
 * Lee un aviso con las reglas del banco que corresponde al remitente.
 * - Remitente fuera de la lista blanca → ignorado/remitente_no_permitido (la ruta lo traduce a 422).
 * - RappiCard y DiDi → siempre necesita_ia.
 */
export function interpretarAviso(a: AvisoCrudo, ahora: Date): ResultadoParseo {
  const dominio = dominioRemitente(a.from);
  const banco = dominio ? bancoPorDominio(dominio) : null;
  if (!banco) return { estado: 'ignorado', motivo: 'remitente_no_permitido' };

  const texto = textoPlano(a.text);
  const fechaCorreo = fechaHoraDeCorreo(a.date, ahora);
  switch (banco) {
    case 'bancolombia': return parsearBancolombia(a.subject, texto, fechaCorreo);
    case 'wompi': return parsearWompi(a.subject, texto, fechaCorreo);
    case 'pse': return parsearPSE(a.subject, texto, fechaCorreo);
    default: return { estado: 'necesita_ia', banco };
  }
}
