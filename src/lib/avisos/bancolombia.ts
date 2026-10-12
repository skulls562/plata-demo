// Parser de avisos de Bancolombia (SPEC §3.12). PURO. Sin cuantificadores anidados: acotados y lineales.
import { parsearDineroCO } from '../formato';
import { enmascararDigitos } from '../seguridad';
import type { HoraHM, ISODate, Medio, ResultadoParseo, TipoMovimiento } from '../tipos';
import { comercioPorDefecto, fechaDesdePartes, horaDesdePartes, limpiarComercio } from './comun';

const RE_ORACION = /(Compraste|Pagaste|Retiraste|Transferiste|Recibiste)\b([^$]{0,80})\$\s?([\d.,]{1,20})(.{0,200}?)(?:\.\s|$)/i;
const RE_COMERCIO = /^\s*(?:en|a)\s+(.+?)(?=\s+(?:con tu|de tu|desde tu|desde la|en tu|a tu|el \d{1,2}\/)|,|$)/i;
// «a la llave @x desde tu cuenta *1 a NOMBRE el …» (Bre-B): el comercio es el destinatario.
const RE_LLAVE = /^\s*a la llave\s+\S{1,40}\s+desde tu cuenta\s+\S{1,20}\s+a\s+(.+?)(?=\s+el \d|,|$)/i;
const RE_A_CUENTA = /^\s*desde tu cuenta\s+\S{1,20}\s+a la cuenta\b/i;
const RE_QR = /^\s*por c[oó]digo QR\b/i;
const RE_COMERCIO_INGRESO = /\bde\s+(.+?)(?=\s+(?:en tu|a tu|el \d)|,|$)/i;
const RE_FECHA = /el (\d{2})\/(\d{2})\/(\d{4})/i;
const RE_HORA = /a las (\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i;

const TIPO_POR_VERBO: Record<string, TipoMovimiento> = {
  compraste: 'compra', pagaste: 'pago', retiraste: 'retiro', transferiste: 'transferencia', recibiste: 'ingreso',
};

function medioDe(s: string): Medio | null {
  if (/\bT\.?\s?Deb/i.test(s)) return 'debito';
  if (/\bT\.?\s?Cred/i.test(s)) return 'credito';
  if (/\bcta\b|cuenta/i.test(s)) return 'cuenta';
  return null;
}

export function parsearBancolombia(
  _asunto: string,
  texto: string,
  fechaCorreo: { fecha: ISODate; hora: HoraHM },
): ResultadoParseo {
  const plano = texto.replace(/\s+/g, ' ').trim().slice(0, 20_000);
  const m = RE_ORACION.exec(plano);
  if (!m) {
    return plano.includes('$') ? { estado: 'necesita_ia', banco: 'bancolombia' } : { estado: 'ignorado', motivo: 'publicidad' };
  }

  const verbo = m[1].toLowerCase();
  let tipo = TIPO_POR_VERBO[verbo];
  if (/revers|devoluci|reembols/i.test(m[0])) tipo = 'reverso';

  const monto = parsearDineroCO(m[3]);
  if (monto === null) return { estado: 'necesita_ia', banco: 'bancolombia' };

  const resto = m[4];
  let crudo = '';
  if (verbo === 'recibiste') {
    const cm = RE_COMERCIO_INGRESO.exec(resto);
    crudo = cm ? limpiarComercio(enmascararDigitos(cm[1])) : '';
  } else if (RE_QR.test(resto)) {
    crudo = 'Pago por QR';
  } else if (RE_A_CUENTA.test(resto)) {
    crudo = 'Transferencia a cuenta';
  } else {
    const ll = RE_LLAVE.exec(resto);
    const cm = ll ?? RE_COMERCIO.exec(resto);
    crudo = cm ? limpiarComercio(enmascararDigitos(cm[1])) : '';
    if (!ll && /^la llave/i.test(crudo)) crudo = 'Llave Bre-B';
  }
  const comercio = crudo || comercioPorDefecto(tipo);

  // Medio, fecha y hora se buscan en lo que sigue al verbo (la oración puede cortarse en «p. m.»).
  const cola = plano.slice(m.index, m.index + 400);
  const medio = medioDe(cola);

  let fecha = fechaCorreo.fecha;
  const f = RE_FECHA.exec(cola);
  if (f) fecha = fechaDesdePartes(Number(f[1]), Number(f[2]), Number(f[3])) ?? fecha;

  let hora = fechaCorreo.hora;
  const h = RE_HORA.exec(cola);
  if (h) hora = horaDesdePartes(Number(h[1]), Number(h[2]), h[3]) ?? hora;

  return {
    estado: 'leido',
    datos: {
      banco: 'bancolombia', tipo, sentido: tipo === 'ingreso' || tipo === 'reverso' ? 'entrada' : 'salida',
      monto, comercio, fecha, hora, medio, confianza: 'regla',
    },
  };
}
