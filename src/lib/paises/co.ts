// Paquete de país: Colombia. Agrupa lo que depende del país y no del código: qué dominios de correo son de qué banco
// y qué textos indican un pago de tarjeta o un movimiento propio. Todo PURO.
// Las reglas semilla de categorías (comercios colombianos) viven en las migraciones de src/lib/db.ts: esas migraciones
// ya se aplicaron y no se editan; un país nuevo debería agregarlas con su propia migración posterior.
import type { Banco } from '../tipos';
import type { PaquetePais } from './tipos';

const esOSub = (dominio: string, base: string): boolean => dominio === base || dominio.endsWith('.' + base);

/** Banco según el dominio del remitente (ya en minúsculas); null = no permitido. */
function bancoPorDominioCO(d: string): Banco | null {
  if (esOSub(d, 'notificacionesbancolombia.com')) return 'bancolombia';
  if (esOSub(d, 'achcolombia.com.co')) return 'pse';
  if (esOSub(d, 'wompi.co') || esOSub(d, 'wompi.com')) return 'wompi';
  // El SPEC dice «contengan rappicard»; se exige que rappicard sea el dominio registrable (no cualquier etiqueta).
  if (/(^|\.)rappicard\.(com|co|com\.co)$/.test(d) || esOSub(d, 'rappi.com')) return 'rappicard';
  if (esOSub(d, 'didiglobal.com')) return 'didi';
  return null;
}

export const PAQUETE_CO: PaquetePais = {
  pais: 'CO',
  nombre: 'Colombia',
  moneda: 'COP',
  zona: 'America/Bogota',
  bancoPorDominio: bancoPorDominioCO,
  patrones_pago_tarjeta: ['rappicard', 'rappi card', 'didi card', 'tarjeta de credito', 'pago tc', 'pago tarjeta', 'abono tarjeta'],
  patrones_interno: ['bolsillo', 'cuenta de ahorros propia', 'traslado entre cuentas', 'nequi propio'],
};
