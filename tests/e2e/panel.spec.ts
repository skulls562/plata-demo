// Pruebas e2e del panel (escritorio 1440 y móvil emulado 390 con isMobile + hasTouch).
// Corren contra el servidor de desarrollo en 3011 con la base de demostración (datos sintéticos); el PIN de
// prueba lo crea global-setup y lo borra al terminar.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PIN_PRUEBA } from './pin';

const ORIGEN = 'http://127.0.0.1:3011';
const RUTAS = ['/', '/deudas', '/mes', '/recomendaciones', '/suscripciones', '/metas', '/simulador', '/movimientos', '/tendencias', '/pregunta', '/sistema'];
const CARPETA_CAPTURAS = process.env.PLATA_CAPTURAS ?? path.resolve('test-results', 'panel-capturas');

/** Escucha errores de consola y de página; se revisa al final de cada prueba. */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  return errores;
}

/** Inicio de sesión por la API (mismo origen) para no repetir la pantalla de PIN en cada prueba. */
async function entrarPorApi(page: Page) {
  const r = await page.request.post('/api/sesion', { headers: { Origin: ORIGEN, 'Content-Type': 'application/json' }, data: { pin: PIN_PRUEBA } });
  expect(r.status()).toBe(204);
}

async function sinScrollHorizontal(page: Page) {
  const [ancho, vista] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(ancho, 'scroll horizontal en ' + page.url()).toBeLessThanOrEqual(vista);
}

/** Recorre la página para que las entradas por scroll (ScrollTrigger) se disparen antes de capturar. */
async function recorrer(page: Page) {
  await page.evaluate(async () => {
    const alto = document.documentElement.scrollHeight;
    for (let y = 0; y < alto; y += 450) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 140));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1300);
}

test.describe('Acceso', () => {
  test('sin sesión: la API responde 401 y las páginas mandan a /entrar', async ({ page, request }) => {
    for (const ruta of ['/api/metricas', '/api/recomendaciones', '/api/estado', '/api/movimientos']) {
      const r = await request.get(ruta);
      expect(r.status(), ruta).toBe(401);
    }
    for (const ruta of RUTAS) {
      await page.goto(ruta);
      await expect(page, ruta).toHaveURL(/\/entrar$/);
    }
  });

  test('login: PIN malo avisa, PIN bueno entra, salir cierra la sesión', async ({ page, isMobile }) => {
    const errores = vigilarConsola(page);
    await page.goto('/entrar');
    await page.locator('#pin').fill('111222');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('#error-pin')).toContainText('Ese PIN no es');
    await page.locator('#pin').fill(PIN_PRUEBA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(`${ORIGEN}/`);
    await expect(page.getByText('Hoy puedes gastar').or(page.getByText('Hoy te pasaste en')).first()).toBeVisible();
    await sinScrollHorizontal(page);

    const nav = page.getByRole('navigation', { name: isMobile ? 'Secciones (móvil)' : 'Secciones' });
    if (isMobile) await nav.getByRole('button', { name: 'Más' }).click();
    await nav.getByRole('button', { name: 'Salir' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto('/mes');
    await expect(page).toHaveURL(/\/entrar$/);
    // El 401 del PIN malo es esperado: el navegador lo registra como error de recurso.
    expect(errores.filter((e) => !/401/.test(e))).toEqual([]);
  });
});

test.describe('Panel con sesión', () => {
  test.beforeEach(async ({ page }) => {
    await entrarPorApi(page);
  });

  test('navegación completa: cada sección carga, sin scroll horizontal y sin errores de consola', async ({ page, isMobile }) => {
    const errores = vigilarConsola(page);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: isMobile ? 'Secciones (móvil)' : 'Secciones' });
    const etiquetas = ['Mes', 'Recomendaciones', 'Suscripciones', 'Metas', 'Simulador', 'Movimientos', 'Tendencias', 'Pregunta', 'Sistema', 'Inicio'];
    const destinos = ['/mes', '/recomendaciones', '/suscripciones', '/metas', '/simulador', '/movimientos', '/tendencias', '/pregunta', '/sistema', '/'];
    // En el celular solo cuatro secciones van en la barra; el resto está en «Más».
    const enBarraMovil = ['Inicio', 'Mes', 'Movimientos', 'Simulador'];
    for (let i = 0; i < etiquetas.length; i++) {
      if (isMobile && !enBarraMovil.includes(etiquetas[i])) await nav.getByRole('button', { name: 'Más' }).click();
      await nav.getByRole('link', { name: etiquetas[i], exact: true }).click();
      await expect(page).toHaveURL(`${ORIGEN}${destinos[i]}`);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(etiquetas[i]);
      await page.waitForTimeout(400);
      await sinScrollHorizontal(page);
    }
    expect(errores).toEqual([]);
  });

  test('celular: «Más» abre las otras secciones y se cierra con Escape', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'La barra de pestañas solo existe en el celular');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Secciones (móvil)' });
    const mas = nav.getByRole('button', { name: 'Más' });
    await expect(mas).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Sistema', exact: true })).toBeHidden();
    await mas.click();
    await expect(mas).toHaveAttribute('aria-expanded', 'true');
    for (const n of ['Recomendaciones', 'Suscripciones', 'Deudas y saldos', 'Metas', 'Tendencias', 'Pregunta', 'Sistema']) {
      await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'Tutorial' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mas).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Sistema', exact: true })).toBeHidden();
  });

  test('escritorio: el menú lateral está agrupado, se contrae a íconos y lo recuerda', async ({ page, isMobile }) => {
    test.skip(isMobile, 'El menú lateral solo existe en escritorio');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Secciones', exact: true });
    for (const g of ['Resumen', 'Mi plata', 'Decidir', 'Sistema']) await expect(nav.getByRole('group', { name: g })).toBeVisible();
    for (const n of ['Deudas y saldos', 'Tendencias']) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Tutorial' })).toBeVisible();
    const ancho = () => page.locator('nav.lateral').evaluate((el) => el.getBoundingClientRect().width);
    await expect.poll(ancho).toBeGreaterThan(200);
    // Reintenta hasta que la página hidrate (en desarrollo el primer clic puede llegar antes que React).
    const lateral = page.locator('nav.lateral');
    await expect(async () => {
      if ((await lateral.getAttribute('data-min')) !== 'true') await nav.getByRole('button', { name: 'Contraer menú' }).click({ timeout: 2000 });
      await expect(lateral).toHaveAttribute('data-min', 'true', { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(nav.getByRole('link', { name: 'Mes', exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(ancho).toBeLessThan(100);
    await nav.getByRole('button', { name: 'Expandir menú' }).click();
    await expect.poll(ancho).toBeGreaterThan(200);
    await sinScrollHorizontal(page);
  });

  test('tutorial: el botón dispara el evento plata:tutorial', async ({ page, isMobile }) => {
    await page.addInitScript(() => { (window as unknown as { __tut: number }).__tut = 0; window.addEventListener('plata:tutorial', () => { (window as unknown as { __tut: number }).__tut++; }); });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: isMobile ? 'Secciones (móvil)' : 'Secciones', exact: true });
    const mas = nav.getByRole('button', { name: 'Más' });
    // Reintenta hasta que la página hidrate (en desarrollo el primer clic puede llegar antes que React).
    await expect(async () => {
      if (isMobile && (await mas.getAttribute('aria-expanded')) !== 'true') await mas.click();
      await nav.getByRole('button', { name: 'Tutorial' }).click({ timeout: 2000 });
      expect(await page.evaluate(() => (window as unknown as { __tut: number }).__tut)).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  });

  test('instalable: manifest e íconos públicos, y el manifest apunta a íconos que existen', async ({ request }) => {
    const r = await request.get('/manifest.webmanifest');
    expect(r.status()).toBe(200);
    const m = await r.json();
    expect(m.name).toBe('Plata');
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of m.icons as { src: string }[]) expect((await request.get(i.src)).status(), i.src).toBe(200);
    for (const ruta of ['/favicon.ico', '/apple-icon.png']) expect((await request.get(ruta)).status(), ruta).toBe(200);
  });

  test('la nota de «no es asesoría financiera» es visible en Inicio y Recomendaciones', async ({ page }) => {
    for (const ruta of ['/', '/recomendaciones']) {
      await page.goto(ruta);
      await expect(page.getByTestId('nota-asesoria')).toBeVisible();
    }
  });

  test('controles de al menos 44 px en todas las páginas', async ({ page, isMobile }) => {
    for (const ruta of RUTAS) {
      await page.goto(ruta);
      await page.waitForTimeout(500);
      const chicos = await page.evaluate((movil) => {
        const malos: string[] = [];
        const visible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const e = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && e.visibility !== 'hidden' && e.display !== 'none';
        };
        const sel = 'button, select, input:not([type=hidden]), summary, a.btn, nav a';
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el)) continue;
          if (el.closest('nextjs-portal') || el.closest('[data-nextjs-dev-tools-button]')) continue;
          void movil;
          const r = (el as HTMLElement).getBoundingClientRect();
          const t = (el as HTMLInputElement).type;
          const esCheck = t === 'checkbox' || t === 'radio';
          if (r.height < 43.5 || (!esCheck && r.width < 43.5)) {
            malos.push(`${el.tagName.toLowerCase()} "${(el.textContent || (el as HTMLInputElement).id || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return malos;
      }, isMobile);
      expect(chicos, `controles chicos en ${ruta}`).toEqual([]);
    }
  });

  test('gasto en efectivo: se anota, aparece en la lista y se puede deshacer', async ({ page }) => {
    const errores = vigilarConsola(page);
    await page.goto('/movimientos');
    const nombre = `Tienda de prueba ${String.fromCharCode(97 + (Date.now() % 26))}${String.fromCharCode(97 + (Date.now() % 7))}`;
    const form = page.getByRole('form', { name: 'Añadir gasto en efectivo' });
    await form.getByLabel('Monto').fill('12500');
    await form.getByLabel('¿En qué lo gastaste?').fill(nombre);
    await form.getByLabel('Categoría').selectOption('otros');
    await form.getByRole('button', { name: 'Añadir gasto' }).click();
    await expect(page.getByTestId('gasto-ok')).toContainText('$12.500');
    await expect(page.getByTestId('lista-movimientos')).toContainText(nombre);
    await page.getByRole('button', { name: 'Deshacer lo último' }).click();
    await expect(page.getByTestId('deshacer-msg')).toContainText('Deshecho');
    await expect(page.getByTestId('lista-movimientos')).not.toContainText(nombre);
    expect(errores).toEqual([]);
  });

  test('recategorizar un movimiento avisa que Plata aprende y se puede deshacer', async ({ page }) => {
    await page.goto('/movimientos');
    const fila = page.getByTestId('movimiento').filter({ has: page.locator('select') }).first();
    const select = fila.locator('select');
    const antes = await select.inputValue();
    const nuevo = antes === 'ocio' ? 'compras' : 'ocio';
    await select.selectOption(nuevo);
    await expect(page.getByRole('status').filter({ hasText: /Aprendí|ya lo sé/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Deshacer lo último' }).click();
    await expect(page.getByTestId('deshacer-msg')).toContainText('Deshecho');
  });

  test('simulador: da veredicto con razones y cifras', async ({ page }) => {
    const errores = vigilarConsola(page);
    await page.goto('/simulador');
    await page.getByLabel('¿Cuánto cuesta?').fill('9000');
    await page.getByLabel(/¿Qué es\?/).fill('tinto');
    await page.getByRole('button', { name: '¿Puedo comprarlo?' }).click();
    const veredicto = page.getByTestId('veredicto');
    await expect(veredicto.locator('[data-decision]')).toBeVisible();
    await expect(veredicto.locator('li').first()).toBeVisible();

    await page.getByLabel('¿Cuánto cuesta?').fill('9000000');
    await page.getByLabel(/¿Qué es\?/).fill('moto');
    await page.getByRole('button', { name: '¿Puedo comprarlo?' }).click();
    await expect(veredicto.locator('[data-decision="no"], [data-decision="espera"]')).toBeVisible();
    expect(errores).toEqual([]);
  });

  test('lista de espera: muestra el contador de 48 h', async ({ page }) => {
    await page.goto('/simulador');
    await expect(page.getByTestId('lista-espera')).toContainText(/Faltan|Ya pasaron/);
  });

  test('pregúntale a tu plata responde', async ({ page }) => {
    await page.goto('/pregunta');
    await page.getByLabel('Tu pregunta').fill('¿cuánto llevo gastado este mes?');
    await page.getByRole('button', { name: 'Preguntar' }).click();
    await expect(page.getByTestId('respuesta').first()).toBeVisible({ timeout: 45_000 });
  });

  test('sistema muestra n8n por latidos y los pendientes', async ({ page }) => {
    await page.goto('/sistema');
    await expect(page.getByTestId('flujos').locator('[data-estado="vivo"]').first()).toBeVisible();
    await expect(page.getByTestId('flujos').locator('[data-estado="caido"]').first()).toBeVisible();
    await expect(page.getByTestId('lista-por-revisar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actualizar Gmail' })).toBeVisible();   // no se pulsa: tocaría el Gmail real si está configurado
  });

  test('capturas de todas las páginas', async ({ page }, info) => {
    fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });
    for (const ruta of RUTAS) {
      await page.goto(ruta);
      await page.waitForTimeout(900);
      await recorrer(page);
      const nombre = `${info.project.name}${ruta === '/' ? '-inicio' : ruta.replace('/', '-')}.png`;
      await page.screenshot({ path: path.join(CARPETA_CAPTURAS, nombre), fullPage: true });
    }
    await page.context().clearCookies();
    await page.goto('/entrar');
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(CARPETA_CAPTURAS, `${info.project.name}-entrar.png`), fullPage: true });
  });
});
