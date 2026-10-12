// Ejecuta un script .ts del proyecto con el transformador de Vite (resuelve imports sin extensión).
// Uso: node scripts/ejecutar-ts.mjs scripts/archivo.ts
import { createServer } from 'vite';
import { resolve } from 'node:path';

const archivo = process.argv[2];
if (!archivo) {
  console.error('Falta el script a ejecutar.');
  process.exit(1);
}
const servidor = await createServer({
  configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  await servidor.ssrLoadModule(resolve(archivo));
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Error al ejecutar el script.');
  process.exitCode = 1;
} finally {
  await servidor.close();
}
