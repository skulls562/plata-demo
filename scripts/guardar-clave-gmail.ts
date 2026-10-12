// Deja listo Gmail para el botón «Actualizar Gmail» de Plata (se hace UNA sola vez).
// Uso: `npm run gmail-clave` en una terminal real.
//
// - Pide tu correo y la contraseña de aplicación de Google (16 letras; se crea en myaccount.google.com → Seguridad →
//   Verificación en dos pasos → Contraseñas de aplicaciones). La contraseña se teclea SIN eco y no se imprime nunca.
// - La guarda en `~/.plata/gmail.txt`, FUERA del proyecto, y apunta tu correo en `.env.local` (PLATA_IMAP_USER).
// - Es de solo lectura: Plata nunca borra ni envía correos.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const RE_CORREO = /^[^\s@<>"']{1,64}@[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function leerOculto(pregunta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const entrada = process.stdin;
    process.stdout.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let valor = '';
    const alTeclear = (trozo: string) => {
      for (const c of trozo) {
        if (c === '\r' || c === '\n') { terminar(); process.stdout.write('\n'); resolver(valor); return; }
        if (c === '\u0003') { terminar(); process.stdout.write('\n'); rechazar(new Error('cancelado')); return; }
        if (c === '\u007f' || c === '\b') valor = valor.slice(0, -1);
        else if (valor.length < 80) valor += c;
      }
    };
    const terminar = () => { entrada.off('data', alTeclear); entrada.setRawMode(false); entrada.pause(); };
    entrada.on('data', alTeclear);
  });
}

/** Pone o cambia una variable en el texto de un .env. */
export function conVariable(texto: string, clave: string, valor: string): string {
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^${clave}=.*$`, 'm');
  if (re.test(texto)) return texto.replace(re, linea);
  return texto.endsWith('\n') || texto === '' ? `${texto}${linea}\n` : `${texto}\n${linea}\n`;
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Este script necesita una terminal interactiva (la contraseña no se acepta por tuberías ni argumentos).');
    return 1;
  }
  console.log('Gmail para Plata: solo lectura. La contraseña queda en un archivo tuyo, fuera del proyecto.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const correo = (await rl.question('Tu correo de Gmail: ')).trim();
  rl.close();
  if (!RE_CORREO.test(correo)) { console.error('Ese correo no parece válido. No cambié nada.'); return 1; }

  const pass = (await leerOculto('Contraseña de aplicación (16 letras, no se ve al escribir): ')).replace(/\s+/g, '');
  if (!/^[A-Za-z]{16}$/.test(pass)) {
    console.error('Una contraseña de aplicación de Google tiene 16 letras (sin espacios). No cambié nada.');
    return 1;
  }

  const ruta = join(homedir(), '.plata', 'gmail.txt');
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, pass + '\n', { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(ruta, 0o600); } catch { /* en Windows no aplica */ }

  const env = '.env.local';
  const actual = existsSync(env) ? readFileSync(env, 'utf8') : '';
  writeFileSync(env, conVariable(conVariable(actual, 'PLATA_IMAP_USER', correo), 'PLATA_SYNC_AUTO_MIN', '10'), 'utf8');

  console.log('Listo. Guardé la clave en tu carpeta de usuario (.plata) y tu correo en .env.local. Plata revisará Gmail sola cada 10 minutos.');
  console.log('Reinicia Plata y toca «Actualizar Gmail» en la página Sistema.');
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().then((c) => process.exit(c), (e: Error) => { console.error(e.message === 'cancelado' ? 'Cancelado. No cambié nada.' : 'No pude guardar la clave.'); process.exit(1); });
}
