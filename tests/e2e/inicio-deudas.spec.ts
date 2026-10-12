// e2e del Inicio con más información, la página /deudas, el asistente de bienvenida y el recorrido guiado.
// Corren contra el panel en 3011 con data/panel-dev.db (datos sintéticos). Todo lo que crean se limpia al terminar.
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { PIN_PRUEBA, RUTA_BASE_DEMO } from './pin';

const ORIGEN = process.env.PLATA_E2E_ORIGEN ?? 'http://127.0.0.1:3011';
const PREFIJO = 'Prueba e2e';

function vigilarConsola(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  return errores;
}

async function entrarPorApi(page: Page) {
  const r = await page.request.post('/api/sesion', { headers: { Origin: ORIGEN, 'Content-Type': 'application/json' }, data: { pin: PIN_PRUEBA } });
  expect(r.status()).toBe(204);
}

async function sinScrollHorizontal(page: Page) {
  const [ancho, vista] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(ancho, 'scroll horizontal en ' + page.url()).toBeLessThanOrEqual(vista);
}

async function ponerTutorialVisto(page: Page, valor: boolean) {
  const r = await page.request.patch('/api/config', { headers: { Origin: ORIGEN, 'Content-Type': 'application/json' }, data: { clave: 'tutorial_visto', valor } });
  expect(r.ok()).toBe(true);
}

/** Borra de la base de demostración lo que crearon las pruebas (las deudas se archivan por API, aquí se borran del todo). */
function limpiarDatosDePrueba() {
  const db = new DatabaseSync(RUTA_BASE_DEMO);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.prepare('DELETE FROM cuentas WHERE nombre LIKE ?').run(`${PREFIJO}%`);
    db.prepare('DELETE FROM deudas WHERE nombre LIKE ?').run(`${PREFIJO}%`);
  } finally {
    db.close();
  }
}

/** Controles interactivos visibles de al menos 44 px. */
async function controlesChicos(page: Page, raiz = 'body'): Promise<string[]> {
  return page.evaluate((sel) => {
    const malos: string[] = [];
    const base = document.querySelector(sel);
    if (!base) return ['sin raíz'];
    for (const el of base.querySelectorAll('button, select, input:not([type=hidden]), summary, a.btn')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      const e = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || e.visibility === 'hidden' || e.display === 'none') continue;
      if (el.closest('nextjs-portal')) continue;
      if (r.height < 43.5 || r.width < 43.5) malos.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return malos;
  }, raiz);
}

test.beforeEach(async ({ page }) => {
  await entrarPorApi(page);
  await ponerTutorialVisto(page, true);
});
test.afterEach(async ({ page }) => {
  limpiarDatosDePrueba();
  await ponerTutorialVisto(page, true);
});

test.describe('Inicio', () => {
  test('muestra el héroe y todas las secciones con información, sin scroll horizontal ni errores', async ({ page }) => {
    const errores = vigilarConsola(page);
    await page.goto('/');
    await expect(page.getByTestId('libre-hoy')).toBeVisible();
    await expect(page.getByTestId('razon-semaforo')).toBeVisible();
    await expect(page.getByTestId('cinta')).toBeVisible();
    for (const t of ['Tu plata hoy', 'Ritmo del mes', 'Gasto por categoría', 'Últimos movimientos', 'Lo que viene', 'Lo que te conviene mirar', 'Metas', 'Calendario de gasto']) {
      await expect(page.getByRole('heading', { name: t, exact: true }), t).toBeAttached();
    }
    await expect(page.getByTestId('calendario-calor')).toBeAttached();
    await expect(page.getByTestId('nota-asesoria')).toBeAttached();
    await expect(page.getByRole('link', { name: '¿Puedo comprarlo?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Añadir un gasto' })).toBeVisible();
    await page.waitForTimeout(600);
    await sinScrollHorizontal(page);
    expect(await controlesChicos(page, 'main'), 'controles chicos en Inicio').toEqual([]);
    expect(errores).toEqual([]);
  });

  test('con una cuenta y día de ingreso, base-hoy y «Te queda» cuentan hasta el próximo ingreso', async ({ page }) => {
    const cab = { Origin: ORIGEN, 'Content-Type': 'application/json' };
    const previo = ((await (await page.request.get('/api/config')).json()) as { dia_ingreso: number | null }).dia_ingreso;
    const fijarDia = (valor: number | null) => page.request.patch('/api/config', { headers: cab, data: { clave: 'dia_ingreso', valor } });
    try {
      // Saldo chico a propósito: así manda la cuenta («Según tus cuentas») y la línea habla del próximo ingreso.
      expect((await page.request.post('/api/cuentas', { headers: cab, data: { nombre: `${PREFIJO} caja`, tipo: 'banco', saldo: 50_000 } })).status()).toBe(201);
      const errores = vigilarConsola(page);

      expect((await fijarDia(null)).ok()).toBe(true);
      await page.goto('/');
      await expect(page.getByTestId('base-hoy')).toContainText('Según tus cuentas');
      await expect(page.getByTestId('base-hoy')).not.toContainText('próximo ingreso el');
      await expect(page.getByText(/días? con hoy/)).toBeVisible();

      expect((await fijarDia(28)).ok()).toBe(true);
      await page.goto('/');
      const base = page.getByTestId('base-hoy');
      await expect(base).toBeVisible();
      await expect(base).toContainText('Según tus cuentas');
      await expect(base).toContainText(/próximo ingreso( el \d{1,2} de [a-záéíóú]+)?|día de tu ingreso/);
      await expect(page.getByText(/\d+ días? hasta tu ingreso del \d{1,2} de [a-záéíóú]+/)).toBeVisible();
      await expect(page.getByText(/días? con hoy/)).toHaveCount(0);
      await expect(page.getByTestId('libre-hoy')).toBeVisible();
      await expect(page.getByTestId('razon-semaforo')).toBeVisible();
      await page.waitForTimeout(600);
      await sinScrollHorizontal(page);

      // El simulador suma la plata real al veredicto: saldo tras comprar y colchón.
      await page.goto('/simulador');
      await page.getByLabel('¿Cuánto cuesta?').fill('20000');
      await page.getByRole('button', { name: '¿Puedo comprarlo?' }).click();
      const veredicto = page.getByTestId('veredicto');
      await expect(veredicto.locator('[data-decision]')).toBeVisible();
      await expect(veredicto.getByTestId('v-saldo-tras')).toContainText('$30.000');
      await sinScrollHorizontal(page);
      expect(errores).toEqual([]);
    } finally {
      await fijarDia(previo);
    }
  });
});

test.describe('Deudas y saldos', () => {
  test('crear, editar y archivar cuentas y deudas; el plan compara avalancha y bola de nieve', async ({ page }) => {
    const errores = vigilarConsola(page);
    await page.goto('/deudas');
    await expect(page.getByRole('heading', { level: 1, name: 'Deudas y saldos' })).toBeVisible();
    await expect(page.getByTestId('nota-deudas')).toBeAttached();
    await sinScrollHorizontal(page);

    // Cuenta
    await expect(async () => {
      await page.getByRole('button', { name: 'Añadir cuenta' }).first().click({ timeout: 2000 });
      await expect(page.getByRole('dialog', { name: 'Añadir cuenta' })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    const hoja = page.getByRole('dialog', { name: 'Añadir cuenta' });
    expect(await controlesChicos(page, 'dialog[open]'), 'controles chicos en el formulario').toEqual([]);
    await hoja.getByLabel('Nombre').fill(`${PREFIJO} nequi`);
    await hoja.getByLabel('Saldo').fill('350000');
    await hoja.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByTestId('lista-cuentas')).toContainText(`${PREFIJO} nequi`);
    await expect(page.getByTestId('lista-cuentas')).toContainText('$350.000');

    // Dos deudas: la de tasa alta es grande y la de tasa baja es chica, para que las estrategias difieran.
    const nuevaDeuda = async (nombre: string, saldo: string, tasa: string, minimo: string, dia: string) => {
      await page.getByRole('button', { name: 'Añadir deuda' }).first().click();
      const d = page.getByRole('dialog', { name: 'Añadir deuda' });
      await d.getByLabel('Nombre').fill(nombre);
      await d.getByLabel('Cuánto debes').fill(saldo);
      await d.getByLabel('Tasa E.A. (%)').fill(tasa);
      await d.getByLabel('Pago mínimo al mes').fill(minimo);
      await d.getByLabel('Día de pago').fill(dia);
      await d.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.getByTestId('lista-deudas')).toContainText(nombre);
    };
    await nuevaDeuda(`${PREFIJO} tarjeta`, '4000000', '32', '160000', '15');
    await nuevaDeuda(`${PREFIJO} moto`, '900000', '12', '90000', '28');

    const lista = page.getByTestId('lista-deudas');
    await expect(lista).toContainText('$4.000.000');
    await expect(lista).toContainText('32 %');
    await expect(page.getByTestId('resumen-deudas')).toContainText('Próximo vencimiento');
    // Mínimos: 160.000 + 90.000
    await expect(page.getByTestId('resumen-deudas')).toContainText('$250');

    // Plan: ambas estrategias con meses e intereses; simular un pago mayor reduce los meses.
    const plan = page.getByTestId('plan-deudas');
    await expect(plan.getByTestId('meses-avalancha')).toBeVisible();
    await expect(plan.getByTestId('meses-bola_nieve')).toBeVisible();
    await expect(page.getByTestId('ahorro-intereses')).toContainText(/ahorra|cuestan lo mismo/);
    const mesesAntes = await plan.getByTestId('meses-avalancha').innerText();
    const interesesAntes = await plan.getByTestId('intereses-avalancha').innerText();
    await plan.getByLabel('Pago mensual a deudas').fill('900000');
    await expect(plan.getByTestId('meses-avalancha')).not.toHaveText(mesesAntes);
    await expect(plan.getByTestId('intereses-avalancha')).not.toHaveText(interesesAntes);

    // Editar una deuda
    await page.getByRole('button', { name: `Editar la deuda ${PREFIJO} moto` }).click();
    const ed = page.getByRole('dialog', { name: 'Editar deuda' });
    await ed.getByLabel('Cuánto debes').fill('800000');
    await ed.getByRole('button', { name: 'Guardar' }).click();
    await expect(lista).toContainText('$800.000');

    // Archivar y reactivar
    await page.getByRole('button', { name: `Editar la deuda ${PREFIJO} moto` }).click();
    await page.getByRole('dialog', { name: 'Editar deuda' }).getByRole('button', { name: 'Archivar deuda' }).click();
    await page.getByRole('dialog', { name: 'Editar deuda' }).getByRole('button', { name: 'Sí, archivar' }).click();
    await expect(lista).not.toContainText(`${PREFIJO} moto`);
    await page.getByText(/Archivadas \(1\)/).click();
    await page.getByRole('button', { name: 'Reactivar' }).click();
    await expect(lista).toContainText(`${PREFIJO} moto`);

    // Borrar la cuenta
    await page.getByRole('button', { name: `Editar la cuenta ${PREFIJO} nequi` }).click();
    await page.getByRole('dialog', { name: 'Editar cuenta' }).getByRole('button', { name: 'Borrar cuenta' }).click();
    await page.getByRole('dialog', { name: 'Editar cuenta' }).getByRole('button', { name: 'Sí, borrar' }).click();
    await expect(page.getByTestId('lista-cuentas')).toHaveCount(0);

    await sinScrollHorizontal(page);
    expect(await controlesChicos(page, 'main'), 'controles chicos en /deudas').toEqual([]);
    expect(errores).toEqual([]);
  });

  test('con datos, el Inicio muestra saldo, deuda, mínimos y próximo vencimiento', async ({ page }) => {
    const hacer = (ruta: string, data: unknown) => page.request.post(ruta, { headers: { Origin: ORIGEN, 'Content-Type': 'application/json' }, data });
    expect((await hacer('/api/cuentas', { nombre: `${PREFIJO} banco`, tipo: 'banco', saldo: 1_200_000 })).status()).toBe(201);
    expect((await hacer('/api/deudas', { nombre: `${PREFIJO} visa`, tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28, pago_minimo: 120_000, dia_pago: 20 })).status()).toBe(201);
    const errores = vigilarConsola(page);
    await page.goto('/');
    const plata = page.getByRole('region', { name: 'Tu plata hoy' }).or(page.locator('section[aria-labelledby="t-plata"]'));
    await expect(plata).toContainText('Saldo total');
    await expect(plata).toContainText('$1.200.000');
    await expect(plata).toContainText('Deuda total');
    await expect(plata).toContainText('Pagos mínimos del mes');
    await expect(plata).toContainText(`${PREFIJO} visa`);
    await expect(page.getByTestId('inicio-proximos')).toContainText(`${PREFIJO} visa`);
    await sinScrollHorizontal(page);
    expect(errores).toEqual([]);
  });
});

test.describe('Asistente de bienvenida', () => {
  test('guía por cuentas, deudas e ingreso y termina con el primer plan', async ({ page }) => {
    const errores = vigilarConsola(page);
    await page.goto('/');
    const abrir = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('plata:tutorial', { detail: { que: 'asistente' } })));
    await expect(async () => {
      await abrir();
      await expect(page.getByRole('dialog', { name: '¿Con cuánta plata cuentas hoy?' })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    const d = page.getByRole('dialog');
    await expect(d.getByText('Paso 1 de 3')).toBeVisible();
    expect(await controlesChicos(page, 'dialog[open]'), 'controles chicos en el asistente').toEqual([]);
    await sinScrollHorizontal(page);

    // Paso 1: cuentas (si ya hay datos, se parte de ellos; aquí se añade una de prueba)
    await expect(d.getByText('Mirando lo que ya tienes anotado')).toBeHidden();
    await d.getByRole('button', { name: 'Añadir otra cuenta' }).click();
    const nombres = d.getByLabel(/^Nombre de la cuenta/);
    const n = await nombres.count();
    await nombres.nth(n - 1).fill(`${PREFIJO} cuenta`);
    await d.getByLabel('Saldo hoy').nth(n - 1).fill('500000');
    await d.getByRole('button', { name: 'Siguiente' }).click();

    // Paso 2: deudas
    await expect(page.getByRole('dialog', { name: '¿Qué deudas tienes?' })).toBeVisible();
    await d.getByRole('button', { name: 'Añadir otra deuda' }).click();
    const nd = await d.getByLabel(/^Nombre de la deuda/).count();
    await d.getByLabel(/^Nombre de la deuda/).nth(nd - 1).fill(`${PREFIJO} tarjeta`);
    await d.getByLabel('Cuánto debes').nth(nd - 1).fill('2000000');
    await d.getByLabel('Tasa E.A. (%)').nth(nd - 1).fill('30');
    await d.getByLabel('Pago mínimo').nth(nd - 1).fill('100000');
    await d.getByLabel('Día de pago').nth(nd - 1).fill('10');
    await d.getByRole('button', { name: 'Siguiente' }).click();

    // Paso 3: ingreso, ahorro y tope
    await expect(page.getByRole('dialog', { name: 'Tu ingreso y cuánto quieres gastar' })).toBeVisible();
    await d.getByLabel('Ingreso mensual').fill('4200000');
    await d.getByRole('button', { name: 'Guardar y ver mi plan' }).click();

    // Paso 4: resumen con el plan
    await expect(page.getByRole('dialog', { name: 'Este es tu primer plan' })).toBeVisible();
    await expect(page.getByTestId('asistente-plan')).toContainText('Plan recomendado');
    await expect(page.getByTestId('asistente-plan')).toContainText(`${PREFIJO} tarjeta`);
    await d.getByRole('button', { name: 'Ir a mi Inicio' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cuentas = await (await page.request.get('/api/cuentas')).json();
    expect(JSON.stringify(cuentas)).toContain(`${PREFIJO} cuenta`);
    expect(errores).toEqual([]);
  });

  test('Escape lo cierra sin guardar nada', async ({ page }) => {
    await page.goto('/');
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('plata:tutorial', { detail: { que: 'asistente' } })));
      await expect(page.getByRole('dialog', { name: '¿Con cuánta plata cuentas hoy?' })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Recorrido guiado', () => {
  async function dentroDeLaVentana(page: Page) {
    const caja = await page.getByTestId('tour').boundingBox();
    const vista = page.viewportSize()!;
    expect(caja).not.toBeNull();
    expect(caja!.x).toBeGreaterThanOrEqual(0);
    expect(caja!.y).toBeGreaterThanOrEqual(0);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(vista.width + 1);
    expect(caja!.y + caja!.height).toBeLessThanOrEqual(vista.height + 1);
  }

  test('se lanza solo la primera vez, avanza con botones y teclado y deja tutorial_visto', async ({ page }) => {
    const errores = vigilarConsola(page);
    await ponerTutorialVisto(page, false);
    await page.goto('/');
    const tour = page.getByRole('dialog', { name: 'Tu cifra del día' });
    await expect(tour).toBeVisible({ timeout: 20_000 });
    await expect(tour.getByText('Paso 1 de 6')).toBeVisible();
    // El foco queda dentro de la tarjeta
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'))).toBe(true);
    await dentroDeLaVentana(page);
    expect(await controlesChicos(page, '[data-testid="tour"]'), 'controles chicos en el recorrido').toEqual([]);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Tu plata hoy' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('dialog', { name: 'Tu cifra del día' })).toBeVisible();
    const titulos = ['Tu plata hoy', 'El ritmo del mes', 'Todo está en el menú', 'Deudas y saldos', 'Vuelve cuando quieras'];
    for (const t of titulos) {
      await page.getByTestId('tour').getByRole('button', { name: 'Siguiente' }).click();
      await expect(page.getByRole('dialog', { name: t })).toBeVisible();
      await page.waitForTimeout(700); // deja que termine el desplazamiento y se recoloque la tarjeta
      await dentroDeLaVentana(page);
    }
    await page.getByTestId('tour').getByRole('button', { name: 'Terminar' }).click();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/config')).json()).tutorial_visto).toBe(true);

    // Recargar ya no lo vuelve a abrir
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await sinScrollHorizontal(page);
    expect(errores).toEqual([]);
  });

  test('el botón Tutorial lo reabre y Escape lo cierra devolviendo el foco', async ({ page, isMobile }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: isMobile ? 'Secciones (móvil)' : 'Secciones', exact: true });
    const mas = nav.getByRole('button', { name: 'Más' });
    const boton = nav.getByRole('button', { name: 'Tutorial' });
    await expect(async () => {
      if (isMobile && (await mas.getAttribute('aria-expanded')) !== 'true') await mas.click();
      await boton.click({ timeout: 2000 });
      await expect(page.getByTestId('tour')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour')).toHaveCount(0);
  });

  test('desde otra página lleva el recorrido a Inicio y respeta prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/metas');
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('plata:tutorial')));
      await expect(page.getByTestId('tour')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL(`${ORIGEN}/`);
    await expect(page.getByRole('dialog', { name: 'Tu cifra del día' })).toBeVisible();
    // Sin animación: la tarjeta no tiene transición ni opacidad intermedia
    const opacidad = await page.getByTestId('tour').evaluate((el) => getComputedStyle(el).opacity);
    expect(opacidad).toBe('1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour')).toHaveCount(0);
  });
});
