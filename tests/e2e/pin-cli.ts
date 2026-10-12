// Uso manual: node scripts/ejecutar-ts.mjs tests/e2e/pin-cli.ts poner|quitar  (solo data/panel-dev.db)
import { ponerPinPrueba, quitarPinPrueba } from './pin';

const orden = process.argv[3];
if (orden === 'poner') await ponerPinPrueba();
if (orden === 'quitar') quitarPinPrueba();
