// Parser de avisos de Wompi (SPEC §3.12). PURO.
import { parsearDineroCO } from '../formato';
import { enmascararDigitos } from '../seguridad';
import type { HoraHM, ISODate, ResultadoParseo } from '../tipos';
import { limpiarComercio } from './comun';

const RE_ASUNTO = /Transacci[oó]n\s+(APROBADA|RECHAZADA|DECLINADA|ANULADA|PENDIENTE|FALLIDA)\s+en\s+(.+?)(?:\s+-\s+ref\.?.*)?$/i;
const RE_MONTO_COP = /COP\s*\$?\s*([\d.,]+)/i;
const RE_MONTO_PESOS = /\$\s?([\d.,]+)/;

export function parsearWompi(
  asunto: string,
  texto: string,
  fechaCorreo: { fecha: ISODate; hora: HoraHM },
): ResultadoParseo {
  const a = RE_ASUNTO.exec(asunto.replace(/\s+/g, ' ').trim());
  if (!a) return { estado: 'necesita_ia', banco: 'wompi' };

  const estado = a[1].toUpperCase();
  if (estado === 'PENDIENTE') return { estado: 'ignorado', motivo: 'transaccion_pendiente' };
  if (estado !== 'APROBADA') return { estado: 'ignorado', motivo: 'transaccion_rechazada' };

  const cuerpo = texto.replace(/\s+/g, ' ').slice(0, 20_000);
  const m = RE_MONTO_COP.exec(cuerpo) ?? RE_MONTO_PESOS.exec(cuerpo);
  const monto = m ? parsearDineroCO(m[1]) : null;
  const comercio = limpiarComercio(enmascararDigitos(a[2]));
  if (monto === null || !comercio) return { estado: 'necesita_ia', banco: 'wompi' };

  return {
    estado: 'leido',
    datos: {
      banco: 'wompi', tipo: 'pago', sentido: 'salida', monto, comercio,
      fecha: fechaCorreo.fecha, hora: fechaCorreo.hora, medio: null, confianza: 'regla',
    },
  };
}
