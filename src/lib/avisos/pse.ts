// Parser de avisos de PSE / ACH (SPEC §3.12). PURO. Espera texto con saltos de línea (textoPlano los conserva).
import { parsearDineroCO } from '../formato';
import { enmascararDigitos } from '../seguridad';
import type { HoraHM, ISODate, ResultadoParseo } from '../tipos';
import { limpiarComercio } from './comun';

const RE_ESTADO = /PSE\s*-\s*Transacci[oó]n\s+(Aprobada|Rechazada|Pendiente|Fallida)/i;
const RE_MONTO = /(?:valor|monto|total)[^\d$]{0,30}\$?\s*([\d.,]+)/i;
// La etiqueta va al inicio de línea y su valor puede estar en la línea siguiente (formato real de ACH):
// así no se confunde con el consejo «…el portal de tu entidad financiera.».
const RE_COMERCIO = /(?:^|\n)[ \t]*(?:empresa|comercio|convenio|entidad)[ \t]*:[ \t]*\n?[ \t]*([^\n]{2,80})/i;

export function parsearPSE(
  asunto: string,
  texto: string,
  fechaCorreo: { fecha: ISODate; hora: HoraHM },
): ResultadoParseo {
  const e = RE_ESTADO.exec(asunto.replace(/\s+/g, ' '));
  if (!e) return { estado: 'necesita_ia', banco: 'pse' };
  const estado = e[1].toLowerCase();
  if (estado === 'pendiente') return { estado: 'ignorado', motivo: 'transaccion_pendiente' };
  if (estado !== 'aprobada') return { estado: 'ignorado', motivo: 'transaccion_rechazada' };

  const cuerpo = texto.slice(0, 20_000);
  const m = RE_MONTO.exec(cuerpo);
  const c = RE_COMERCIO.exec(cuerpo);
  const monto = m ? parsearDineroCO(m[1]) : null;
  const comercio = c ? limpiarComercio(enmascararDigitos(c[1])) : '';
  if (monto === null || !comercio) return { estado: 'necesita_ia', banco: 'pse' };

  return {
    estado: 'leido',
    datos: {
      banco: 'pse', tipo: 'pago', sentido: 'salida', monto, comercio,
      fecha: fechaCorreo.fecha, hora: fechaCorreo.hora, medio: 'pse', confianza: 'regla',
    },
  };
}
