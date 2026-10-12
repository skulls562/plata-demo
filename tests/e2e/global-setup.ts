import { ponerPinPrueba, quitarPinPrueba } from './pin';

// Crea el PIN de prueba en la base de demostración antes de los e2e y lo borra al terminar.
export default async function globalSetup() {
  await ponerPinPrueba();
  return async () => {
    quitarPinPrueba();
  };
}
