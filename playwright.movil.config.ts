import { defineConfig, devices } from '@playwright/test';

// e2e móvil contra `next start` (build en .next-movil) en 3011 con la base de demostración y un nombre de Tailscale
// de mentira en PLATA_HOSTS. Requiere haber compilado antes: PLATA_DIST_DIR=.next-movil npx next build
// Nunca toca el 3010 de producción ni data/plata.db.
const URL = 'http://127.0.0.1:3011';
const HOST_TS = 'mi-pc.tail1a2b3.ts.net';
process.env.PLATA_E2E_TS_HOST = HOST_TS;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /movil\.spec\.ts/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: URL, trace: 'retain-on-failure', locale: 'es-CO', timezoneId: 'America/Bogota' },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npx next start -H 127.0.0.1 -p 3011',
    url: `${URL}/api/salud`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PLATA_DIST_DIR: '.next-movil',
      PLATA_HOSTS: `127.0.0.1:3011,localhost:3011,${HOST_TS}`,
      PLATA_DB_PATH: 'data/panel-dev.db',
    },
  },
});
