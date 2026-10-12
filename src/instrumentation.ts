// Se ejecuta una vez al arrancar el servidor de Next (antes de atender peticiones).
// Conecta la seguridad (sesiones, PIN, idempotencia) con la base SQLite y arranca la revisión periódica de Gmail (opcional).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { conectarSeguridad } = await import('./lib/arranque');
    conectarSeguridad();
    const { iniciarSyncAutomatico } = await import('./lib/correo-sync');
    iniciarSyncAutomatico();
  }
}
