// PIN de PRUEBA para la base de demostración (data/panel-dev.db). Se crea con la función de seguridad de la app
// (hashPin + guardarPinNuevo) y se borra al terminar. Nunca se usa con data/plata.db.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { guardarPinNuevo, hashPin } from '../../src/lib/seguridad';

export const PIN_PRUEBA = '739204';
export const RUTA_BASE_DEMO = path.resolve(process.env.PLATA_E2E_DB ?? path.join('data', 'panel-dev.db'));

function abrir(): DatabaseSync {
  if (!RUTA_BASE_DEMO.endsWith('panel-dev.db')) throw new Error('Solo la base de demostración');
  const db = new DatabaseSync(RUTA_BASE_DEMO);
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export async function ponerPinPrueba(): Promise<void> {
  const db = abrir();
  try {
    guardarPinNuevo(db, await hashPin(PIN_PRUEBA));
    // El recorrido guiado se abre solo la primera vez; las pruebas del panel parten con él ya visto (inicio-deudas.spec.ts lo reabre).
    db.exec("INSERT OR REPLACE INTO config (clave, valor) VALUES ('tutorial_visto', 'true')");
  } finally {
    db.close();
  }
}

export function quitarPinPrueba(): void {
  const db = abrir();
  try {
    db.exec("DELETE FROM secretos WHERE clave = 'pin_hash'; DELETE FROM sesiones; DELETE FROM limites WHERE clave = 'pin';");
  } finally {
    db.close();
  }
}

