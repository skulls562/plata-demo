import { defineConfig, devices } from '@playwright/test';

// Los e2e corren contra el servidor de desarrollo del panel (puerto 3011, base data/panel-dev.db, datos sintéticos).
// Nunca contra el servidor de producción (3010) ni contra data/plata.db.
const URL = 'http://127.0.0.1:3011';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: URL, trace: 'retain-on-failure', locale: 'es-CO', timezoneId: 'America/Bogota' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'movil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npx next dev -H 127.0.0.1 -p 3011',
    url: `${URL}/api/salud`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PLATA_DIST_DIR: '.next-dev', PLATA_HOSTS: '127.0.0.1:3011,localhost:3011', PLATA_DB_PATH: 'data/panel-dev.db' },
  },
});
