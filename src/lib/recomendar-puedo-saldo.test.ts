// Fase B (2026-10-09): «¿puedo?» con la plata real de las cuentas y las deudas (veredictoPuedo).
// Datos sintéticos. Hoy = 2026-10-15 12:00 Bogotá (D = 31, dr = 17). Umbral de impulso 100.000, espera 48 h.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularMetricas } from './metricas';
import { veredictoPuedo } from './recomendar';
import type { Categoria, Cuenta, Deuda, Instantanea, ReglaCategoria } from './tipos';
import {
  CATEGORIAS_BASE, config, escenarioCanonico, gastosDiarios, inst, itemEspera, metaConAportes, REGLAS_BASE, reiniciarIds,
} from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

// La categoría y la regla de la migración 6 (los constructores copian solo la migración 1).
const VIAJES: Categoria = { id: 'viajes', nombre: 'Viajes', emoji: '✈️', es_gasto: true, esencial: false, cuenta_hormiga: false, orden: 14, sistema: false, activa: true };
const REGLAS: ReglaCategoria[] = [...REGLAS_BASE, { id: 900, patron: 'hotel', categoria_id: 'viajes', origen: 'semilla', aciertos: 0 }];

const cuenta = (saldo: number, over: Partial<Cuenta> = {}): Cuenta => ({
  id: 1, nombre: 'Bancolombia', tipo: 'banco', saldo,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-15T14:00:00Z', // 09:00 Bogotá de hoy
  ...over,
});
const tarjeta = (over: Partial<Deuda> = {}): Deuda => ({
  id: 1, nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28, pago_minimo: 150_000, dia_pago: 20, activa: true,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z',
  ...over,
});
/** Sin ingreso configurado; gasto usual de 50.000 diarios (base estimada: con cuentas, manda el saldo). */
const escenario = (over: Partial<Instantanea> = {}) => inst({
  categorias: [...CATEGORIAS_BASE, VIAJES], reglas: REGLAS,
  movimientos: gastosDiarios('2026-09-01', '2026-10-14', 50_000),
  ...over,
});
const HOTEL = 'una reserva de hotel';
/** Ya esperó sus 48 h: salta p4 y deja ver el resto de la escalera. */
const yaEsperado = itemEspera({ descripcion: HOTEL, monto: 450_000, categoria_id: 'viajes', disponible_en: '2026-10-14T00:00:00Z' });
const q = (i: Instantanea, monto: number, descripcion = HOTEL) => {
  const m = calcularMetricas(i);
  return { m, v: veredictoPuedo(i, m, { monto, descripcion, ahora: i.ahora }) };
};

describe('hotel de $450.000 con saldo suficiente', () => {
  const i = () => escenario({ cuentas: [cuenta(5_000_000)], deudas: [tarjeta()] });

  it('la primera vez: espera 48 h (regla de impulso), con el saldo y el mínimo en las razones', () => {
    const { m, v } = q(i(), 450_000);
    expect(m.base_hoy.limita).toBe('saldo');
    expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p4', regla_48h: true, categoria_id: 'viajes', esencial: false });
    expect(v.razones[0]).toContain('48 horas');
    const g = m.saldos.gasto_diario;
    expect(g).toBeGreaterThan(0);
    expect(v.cifras).toMatchObject({
      monto: 450_000, saldo_total: 5_000_000, saldo_tras: 4_550_000, minimos_pendientes: 150_000, falta_minimos: 0,
      proximo_minimo: 150_000, proximo_minimo_dias: 5,
      colchon_dias: Math.floor(5_000_000 / g), colchon_dias_tras: Math.floor(4_550_000 / g),
    });
    expect(v.razones[1]).toBe(`En tus cuentas quedarían $4.550.000 de $5.000.000, unos ${Math.floor(4_550_000 / g)} días de gastos.`);
    expect(v.razones[2]).toBe('El 20 oct vence el mínimo de Tarjeta: $150.000; te alcanza para pagarlo.');
  });

  it('pasadas las 48 h: sí, y dice cuánto queda en las cuentas', () => {
    const { v } = q(escenario({ cuentas: [cuenta(5_000_000)], deudas: [tarjeta()], lista_espera: [yaEsperado] }), 450_000);
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p8', regla_48h: false });
    expect(v.razones[1]).toBe('Ya lo pensaste 48 horas.');
    expect(v.razones[2]).toContain('quedarían $4.550.000 de $5.000.000');
    expect(v.razones[3]).toContain('vence el mínimo de Tarjeta');
  });
});

describe('saldo justo', () => {
  it('alcanza para el hotel y el mínimo, pero el límite diario se desploma → mejor no, con la cifra', () => {
    // disponible = 700.000 − 150.000 = 550.000 → 32.352/día; tras 450.000, 5.881/día. Gasto usual bajo (20.000/día): sin rojo.
    const { m, v } = q(escenario({
      cuentas: [cuenta(700_000)], deudas: [tarjeta()], lista_espera: [yaEsperado], movimientos: gastosDiarios('2026-09-01', '2026-10-14', 20_000),
    }), 450_000);
    expect(m.semaforo).not.toBe('rojo');
    expect(m.limite_hoy).toBe(32_352);
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p10' });
    expect(v.cifras).toMatchObject({ saldo_tras: 250_000, falta_minimos: 0, nuevo_limite: 5_881 });
    expect(v.razones).toContain(`En tus cuentas quedarían $250.000 de $700.000, unos ${v.cifras.colchon_dias_tras} días de gastos.`);
  });
});

describe('la compra deja el saldo por debajo de los mínimos', () => {
  it('no esencial → no (p1s), con cuánto quedaría y cuánto faltaría', () => {
    const { v } = q(escenario({ cuentas: [cuenta(500_000)], deudas: [tarjeta()], lista_espera: [yaEsperado] }), 450_000);
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p1s', titulo: 'Mejor no' });
    expect(v.razones[0]).toBe('Te dejaría sin con qué pagar tus deudas: en tus cuentas quedarían $50.000 y te faltan $150.000 de mínimos por pagar (te faltarían $100.000).');
    expect(v.razones[1]).toBe('El 20 oct vence el mínimo de Tarjeta: $150.000.');
    expect(v.cifras).toMatchObject({ saldo_total: 500_000, saldo_tras: 50_000, minimos_pendientes: 150_000, falta_minimos: 100_000 });
  });

  it('esencial → espera, y pide asegurar primero los mínimos', () => {
    const { v } = q(escenario({ cuentas: [cuenta(500_000)], deudas: [tarjeta()] }), 450_000, 'drogueria');
    expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p1s', esencial: true });
    expect(v.razones[0]).toContain('asegura primero el pago de los mínimos');
  });

  it('si la compra cuesta más de lo que hay: «no tienes esa plata»', () => {
    const { v } = q(escenario({ cuentas: [cuenta(300_000)], deudas: [tarjeta()] }), 450_000);
    expect(v.regla_decisiva).toBe('p1s');
    expect(v.razones[0]).toBe('No tienes esa plata en tus cuentas: hay $300.000 y esto cuesta $450.000, y aún te faltan $150.000 de mínimos por pagar.');
    expect(v.cifras.saldo_tras).toBe(-150_000);
  });

  it('si las cuentas ya no alcanzan para los mínimos, ni una compra pequeña es «sí»', () => {
    const { v } = q(escenario({ cuentas: [cuenta(100_000)], deudas: [tarjeta()] }), 10_000, 'almuerzo');
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p1s' });
    expect(v.razones[0]).toBe('Tus cuentas ($100.000) ya no alcanzan para los mínimos que te faltan por pagar ($150.000); con esta compra te faltarían $60.000.');
  });

  it('un mínimo del mes que viene no frena la compra, pero avisa si no alcanzaría', () => {
    // día 5: el de octubre ya pasó (se asume pagado); el próximo es el 5 nov
    const { v } = q(escenario({ cuentas: [cuenta(500_000)], deudas: [tarjeta({ dia_pago: 5 })], lista_espera: [yaEsperado] }), 450_000);
    expect(v.regla_decisiva).not.toBe('p1s');
    expect(v.cifras).toMatchObject({ minimos_pendientes: 0, proximo_minimo: 150_000, proximo_minimo_dias: 21 });
    expect(v.razones.join(' ')).toContain('El 5 nov vence el mínimo de Tarjeta: $150.000; con lo que te quedaría no alcanzas a pagarlo si no te entra plata antes.');
  });
});

describe('sin deudas', () => {
  it('no habla de mínimos; sí del saldo', () => {
    const { v } = q(escenario({ cuentas: [cuenta(2_000_000)] }), 450_000);
    expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p4' });
    expect(v.cifras).toMatchObject({ minimos_pendientes: 0, falta_minimos: 0, proximo_minimo: null, proximo_minimo_dias: null, saldo_tras: 1_550_000 });
    expect(v.razones.join(' ')).not.toMatch(/mínimo/);
    expect(v.razones[1]).toContain('quedarían $1.550.000 de $2.000.000');
  });
});

describe('solo cuentas, sin ingreso ni historial', () => {
  it('ya hay base: da veredicto (antes era «aún no sé»)', () => {
    const i = inst({ categorias: [...CATEGORIAS_BASE, VIAJES], reglas: REGLAS, cuentas: [cuenta(1_700_000)] });
    const { m, v } = q(i, 50_000, 'almuerzo');
    expect(m.base.modo).toBe('sin_datos');
    expect(m.base_hoy.limita).toBe('saldo');
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p7' });     // 1.700.000 ÷ 17 = 100.000 hoy
    expect(v.cifras).toMatchObject({ saldo_total: 1_700_000, saldo_tras: 1_650_000, colchon_dias: null, colchon_dias_tras: null }); // sin gasto no hay colchón
    expect(v.razones[1]).toBe('En tus cuentas quedarían $1.650.000 de $1.700.000.');
  });

  it('sin cuentas ni ingreso ni historial sigue siendo «aún no sé» (p0)', () => {
    const { v } = q(inst(), 50_000, 'almuerzo');
    expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p0' });
    expect(v.razones[0]).toContain('cuánta plata tienes en tus cuentas');
  });

  it('base estimada sin cuentas: veredicto normal y aviso de que es un estimado', () => {
    const { m, v } = q(escenario(), 20_000, 'almuerzo');
    expect(m.base_hoy.limita).toBe('estimado');
    expect(v.regla_decisiva).not.toBe('p0');
    expect(v.cifras).toMatchObject({ saldo_total: null, saldo_tras: null, falta_minimos: null, colchon_dias: null });
    expect(v.razones[v.razones.length - 1]).toBe('Lo calculo con un estimado: dime tu ingreso o cuánto tienes en tus cuentas para afinarlo.');
  });
});

describe('compatibilidad y tope de razones', () => {
  it('el canónico (ingreso, sin cuentas) no cambia de decisión y deja los campos de saldo en null', () => {
    const c = escenarioCanonico();
    const v = veredictoPuedo(c, calcularMetricas(c), { monto: 80_000, descripcion: 'audífonos', ahora: c.ahora });
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p2' });
    expect(v.cifras).toMatchObject({ saldo_total: null, saldo_tras: null, minimos_pendientes: 0, falta_minimos: null, proximo_minimo: null });
  });

  it('máximo 4 razones: primero la decisiva, la espera, el saldo y el mínimo; lo informativo queda por fuera', () => {
    const i = escenario({
      config: config({ ingreso_mensual: 10_000_000 }),
      cuentas: [cuenta(5_000_000)], deudas: [tarjeta()], lista_espera: [yaEsperado],
      presupuestos: [{ mes: '*', categoria_id: 'viajes', monto: 2_000_000 }],
      metas: [metaConAportes({ nombre: 'Moto', aportes: [{ id: 1, meta_id: 1, fecha: '2026-09-20', monto: 90_000, nota: null }] })],
    });
    const m = { ...calcularMetricas(i), mes_pasado: { gastado_a_la_fecha: 100_000, diferencia: 600_000, ratio: 7 }, gastado_mes: 700_000 };
    const v = veredictoPuedo(i, m, { monto: 450_000, descripcion: HOTEL, ahora: i.ahora });
    expect(v.razones).toHaveLength(4);
    expect(v.razones[1]).toBe('Ya lo pensaste 48 horas.');
    expect(v.razones[2]).toMatch(/^En tus cuentas quedarían/);
    expect(v.razones[3]).toMatch(/vence el mínimo de Tarjeta/);
    expect(v.razones.join(' ')).not.toMatch(/Moto|mes pasado/);
    expect(v.cifras.retraso_meta_dias).not.toBeNull();       // la cifra sigue disponible aunque no salga la frase
  });
});
