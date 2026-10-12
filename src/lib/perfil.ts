// Perfil central de quien usa Plata, leído del entorno (.env.local). Nada personal vive en el código:
// con el entorno vacío salen valores neutros. Todo PURO salvo `perfilActivo`, que lee process.env.
import { paqueteDe } from './paises';

export interface Perfil {
  nombre: string;                       // cómo te llama la app; por defecto «amigo»
  nombre_configurado: boolean;
  pais: string;                         // ISO 3166-1 alfa-2; define el paquete de país (src/lib/paises)
  moneda: string;                       // ISO 4217
  zona: string;                         // zona horaria IANA
  telegram_chat_id: string | null;      // solo dígitos
  imap_user: string | null;             // correo desde el que se importa el historial
  imap_host: string;                    // por defecto imap.gmail.com
}

export const NOMBRE_POR_DEFECTO = 'amigo';
const HOST_IMAP_POR_DEFECTO = 'imap.gmail.com';
const RE_NOMBRE = /^[\p{L}\p{N} ._'-]{1,40}$/u;       // sin saltos de línea ni símbolos: el nombre entra en prompts de la IA
const RE_PAIS = /^[A-Za-z]{2}$/;
const RE_MONEDA = /^[A-Za-z]{3}$/;
const RE_CHAT = /^\d{1,20}$/;
const RE_CORREO = /^[^\s@<>"']{1,64}@[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const RE_HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function zonaValida(z: string): boolean {
  try { new Intl.DateTimeFormat('es', { timeZone: z }); return true; } catch { return false; }
}

/** Lee y valida el perfil. Los campos inválidos caen en su valor por defecto y se listan en `errores`. */
export function validarPerfil(entorno: Record<string, string | undefined>): { perfil: Perfil; errores: string[] } {
  const errores: string[] = [];
  const val = (k: string): string | undefined => {
    const v = entorno[k];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };

  let nombre = val('PLATA_NOMBRE');
  if (nombre !== undefined && !RE_NOMBRE.test(nombre)) { errores.push('PLATA_NOMBRE debe tener 1 a 40 letras, números o espacios'); nombre = undefined; }

  let pais = val('PLATA_PAIS')?.toUpperCase();
  if (pais !== undefined && !RE_PAIS.test(pais)) { errores.push('PLATA_PAIS debe ser un código de 2 letras (p. ej. CO)'); pais = undefined; }
  const paquete = paqueteDe(pais);
  if (pais !== undefined && pais !== paquete.pais) errores.push(`PLATA_PAIS=${pais} no tiene paquete de país todavía; se usa ${paquete.pais}`);

  let moneda = val('PLATA_MONEDA')?.toUpperCase();
  if (moneda !== undefined && !RE_MONEDA.test(moneda)) { errores.push('PLATA_MONEDA debe ser un código de 3 letras (p. ej. COP)'); moneda = undefined; }

  let zona = val('PLATA_ZONA');
  if (zona !== undefined && !zonaValida(zona)) { errores.push('PLATA_ZONA no es una zona horaria válida (p. ej. America/Bogota)'); zona = undefined; }

  let chat = val('PLATA_TELEGRAM_CHAT_ID');
  if (chat !== undefined && !RE_CHAT.test(chat)) { errores.push('PLATA_TELEGRAM_CHAT_ID debe ser solo dígitos'); chat = undefined; }

  let correo = val('PLATA_IMAP_USER');
  if (correo !== undefined && !RE_CORREO.test(correo)) { errores.push('PLATA_IMAP_USER no parece un correo'); correo = undefined; }

  let host = val('PLATA_IMAP_HOST');
  if (host !== undefined && !RE_HOST.test(host)) { errores.push('PLATA_IMAP_HOST no parece un nombre de servidor'); host = undefined; }

  return {
    perfil: {
      nombre: nombre ?? NOMBRE_POR_DEFECTO,
      nombre_configurado: nombre !== undefined,
      pais: paquete.pais,
      moneda: moneda ?? paquete.moneda,
      zona: zona ?? paquete.zona,
      telegram_chat_id: chat ?? null,
      imap_user: correo ?? null,
      imap_host: host ?? HOST_IMAP_POR_DEFECTO,
    },
    errores,
  };
}

/** Como `validarPerfil`, pero lanza si algo es inválido (para scripts y el arranque). */
export function leerPerfil(entorno: Record<string, string | undefined> = process.env): Perfil {
  const { perfil, errores } = validarPerfil(entorno);
  if (errores.length) throw new Error(`Perfil inválido: ${errores.join('; ')}`);
  return perfil;
}

/** Perfil para usar en caliente (prompts, textos): nunca lanza; lo inválido se reemplaza por el valor por defecto. */
export function perfilActivo(entorno: Record<string, string | undefined> = process.env): Perfil {
  return validarPerfil(entorno).perfil;
}

/** Cómo nombrar a la persona dentro de un prompt de la IA: su nombre, o un genérico («para la persona»). */
export function nombreParaPrompt(p: Perfil): string {
  return p.nombre_configurado ? p.nombre : 'la persona';
}
