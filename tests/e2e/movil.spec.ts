// e2e del panel en el celular: aviso «Instala Plata», atajos del manifest y control de Host (Tailscale).
// El control del host de Tailscale solo corre si el servidor se levantó con PLATA_HOSTS ampliado
// (`npx playwright test -c playwright.movil.config.ts`, que fija PLATA_E2E_TS_HOST). Sin Tailscale real: se emula
// lo que hace `tailscale serve` (Host del nombre ts.net + X-Forwarded-Proto/Host) contra 127.0.0.1.
import { expect, test, type Page } from '@playwright/test';
import { PIN_PRUEBA } from './pin';

const ORIGEN = process.env.PLATA_E2E_ORIGEN ?? 'http://127.0.0.1:3011';
const HOST_TS = process.env.PLATA_E2E_TS_HOST;
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function entrarPorApi(page: Page) {
  const r = await page.request.post('/api/sesion', { headers: { Origin: ORIGEN, 'Content-Type': 'application/json' }, data: { pin: PIN_PRUEBA } });
  expect(r.status()).toBe(204);
}

async function sinScrollHorizontal(page: Page) {
  const [ancho, vista] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(ancho).toBeLessThanOrEqual(vista);
}

async function altoMinimo(page: Page, sel: string) {
  const cajas = await page.locator(sel).evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { texto: (el.textContent ?? '').trim(), w: r.width, h: r.height };
  }));
  for (const c of cajas) expect(c.h, `alto de «${c.texto}»`).toBeGreaterThanOrEqual(43.5);
}

test.describe('Aviso de instalar (Android/Chrome)', () => {
  test('aparece con beforeinstallprompt, mide ≥44 px, se descarta y no vuelve', async ({ page }) => {
    await entrarPorApi(page);
    await page.goto('/');
    const aviso = page.getByTestId('aviso-instalar');
    // El oyente se registra al hidratar: se reintenta el evento hasta que el aviso aparezca.
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
      return aviso.isVisible();
    }, { timeout: 15_000 }).toBe(true);
    await expect(aviso).toContainText('Instala Plata en tu celular');
    await expect(aviso.getByRole('button', { name: 'Instalar', exact: true })).toBeVisible();
    await altoMinimo(page, '[data-testid=aviso-instalar] button');
    await sinScrollHorizontal(page);

    await aviso.getByRole('button', { name: /Cerrar el aviso/ }).click();
    await expect(aviso).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem('plata_aviso_instalar_descartado'))).toBe('1');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
    await page.waitForTimeout(500);
    await expect(aviso).toHaveCount(0);
  });

  test('si localStorage falla, el aviso igual funciona y se puede cerrar', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } });
    });
    await entrarPorApi(page);
    await page.goto('/');
    const aviso = page.getByTestId('aviso-instalar');
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
      return aviso.isVisible();
    }, { timeout: 15_000 }).toBe(true);
    await aviso.getByRole('button', { name: /Cerrar el aviso/ }).click();
    await expect(aviso).toBeHidden();
  });
});

test.describe('Aviso de instalar (iPhone)', () => {
  test.use({ userAgent: UA_IPHONE });
  test('explica Compartir → Añadir a pantalla de inicio', async ({ page }) => {
    await entrarPorApi(page);
    await page.goto('/');
    const aviso = page.getByTestId('aviso-instalar');
    await expect(aviso).toBeVisible({ timeout: 15_000 });
    await expect(aviso).toContainText('Compartir');
    await expect(aviso).toContainText('Añadir a pantalla de inicio');
    await expect(aviso.getByRole('button', { name: 'Instalar', exact: true })).toHaveCount(0);
    await altoMinimo(page, '[data-testid=aviso-instalar] button');
    await sinScrollHorizontal(page);
  });
});

test.describe('Manifest', () => {
  test('modo app, alcance y atajos a Inicio, Deudas y Simulador', async ({ request }) => {
    const r = await request.get('/manifest.webmanifest');
    expect(r.status()).toBe(200);
    const m = await r.json();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect((m.shortcuts as { url: string }[]).map((s) => s.url)).toEqual(['/', '/deudas', '/simulador']);
  });
});

test.describe('Control de Host', () => {
  test('un Host que no está en PLATA_HOSTS da 403', async ({ request }) => {
    for (const host of ['intruso.tail1a2b3.ts.net', 'evil.com']) {
      const r = await request.get('/api/salud', { headers: { Host: host } });
      expect(r.status(), host).toBe(403);
    }
    const x = await request.get('/api/salud', { headers: { 'X-Forwarded-Host': 'evil.com' } });
    expect(x.status()).toBe(403);
  });

  test('el nombre de Tailscale añadido a PLATA_HOSTS entra con PIN y recibe cookie Secure', async ({ request }) => {
    test.skip(!HOST_TS, 'Solo con playwright.movil.config.ts (PLATA_E2E_TS_HOST)');
    const comun = { Host: HOST_TS as string, 'X-Forwarded-Host': HOST_TS as string, 'X-Forwarded-Proto': 'https' };
    // Sin sesión, la página privada redirige al login por https en ese mismo host.
    const ir = await request.get('/', { headers: comun, maxRedirects: 0 });
    expect(ir.status()).toBe(303);
    expect(ir.headers()['location']).toBe(`https://${HOST_TS}/entrar`);
    // Origin https del host permitido: 204 + Secure. Origin http o ajeno: 403.
    const ok = await request.post('/api/sesion', { headers: { ...comun, Origin: `https://${HOST_TS}`, 'Content-Type': 'application/json' }, data: { pin: PIN_PRUEBA } });
    expect(ok.status()).toBe(204);
    const cookie = ok.headers()['set-cookie'] ?? '';
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    for (const origin of [`http://${HOST_TS}`, 'https://evil.com']) {
      const mal = await request.post('/api/sesion', { headers: { ...comun, Origin: origin, 'Content-Type': 'application/json' }, data: { pin: PIN_PRUEBA } });
      expect(mal.status(), origin).toBe(403);
    }
  });
});
