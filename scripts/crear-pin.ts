// Crea o cambia el PIN del panel (SPEC §7.3). Único camino: el panel nunca crea PIN por HTTP.
// Uso: `npm run pin` (Node 24 ejecuta TypeScript quitando tipos; lee .env.local si existe).
//
// - Pide el PIN dos veces por la terminal SIN eco. Exige una terminal real (no tuberías).
// - 6–12 dígitos, no trivial. Guarda solo el hash scrypt en `secretos.pin_hash`.
// - Cierra todas las sesiones y reinicia el límite de intentos.
// - La base debe existir con su esquema: arranca la app una vez (`npm run start`) antes.

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

type Seguridad = typeof import('../src/lib/seguridad');

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
        if (c === '\r' || c === '\n') {
          terminar();
          process.stdout.write('\n');
          resolver(valor);
          return;
        }
        if (c === '\u0003') { // Ctrl+C
          terminar();
          process.stdout.write('\n');
          rechazar(new Error('cancelado'));
          return;
        }
        if (c === '\u007f' || c === '\b') valor = valor.slice(0, -1);
        else if (valor.length < 64) valor += c;
      }
    };
    const terminar = () => {
      entrada.off('data', alTeclear);
      entrada.setRawMode(false);
      entrada.pause();
    };
    entrada.on('data', alTeclear);
  });
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Este script necesita una terminal interactiva (el PIN no se acepta por tuberías ni argumentos).');
    return 1;
  }
  const seg = (await import(new URL('../src/lib/seguridad.ts', import.meta.url).href)) as Seguridad;

  const rutaDB = resolve(process.env.PLATA_DB_PATH?.trim() || 'data/plata.db');
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(rutaDB, { open: true, enableForeignKeyConstraints: true });
  } catch {
    console.error('No pude abrir la base. Arranca la app una vez (npm run start) para crearla y vuelve a intentar.');
    return 1;
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    const tabla = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'secretos'").get();
    if (!tabla) {
      console.error('La base aún no tiene el esquema. Arranca la app una vez (npm run start) y vuelve a intentar.');
      return 1;
    }

    console.log('PIN del panel de Plata: 6 a 12 dígitos, sin secuencias (123456), repeticiones ni fechas.');
    const pin = await leerOculto('PIN nuevo: ');
    if (!seg.validarFormatoPin(pin)) {
      console.error('PIN rechazado: debe tener 6–12 dígitos y no ser trivial.');
      return 1;
    }
    const confirmacion = await leerOculto('Repítelo: ');
    if (!seg.compararSeguro(pin, confirmacion)) {
      console.error('Los PIN no coinciden. No cambié nada.');
      return 1;
    }
    const hash = await seg.hashPin(pin);
    seg.guardarPinNuevo(db, hash);
    console.log('Listo: PIN guardado (solo su hash). Cerré todas las sesiones abiertas del panel.');
    return 0;
  } finally {
    db.close();
  }
}

main().then(
  (codigo) => { process.exitCode = codigo; },
  (err: unknown) => {
    const msg = err instanceof Error && err.message === 'cancelado' ? 'Cancelado.' : 'No pude guardar el PIN.';
    console.error(msg);
    process.exitCode = 1;
  },
);
