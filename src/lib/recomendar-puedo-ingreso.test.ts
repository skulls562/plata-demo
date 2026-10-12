// «¿puedo?» con dia_ingreso (2026-10-09): la plata de las cuentas solo tiene que durar hasta el próximo ingreso,
// igual que limite_saldo (base_hoy.hasta). Datos sintéticos. Hoy = 2026-10-15 12:00 Bogotá (D = 31, dr = 17).
// Sin ingreso ni historial: con cuentas manda el saldo (salvo donde se configura un ingreso).
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularMetricas } from './metricas';
import { veredictoPuedo } from './recomendar';
import type { Cuenta, Deuda, Instantanea } from './tipos';
import { config, escenarioCanonico, inst, itemEspera, recurrente, reiniciarIds } from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

const cuenta = (saldo: number): Cuenta => ({
  id: 1, nombre: 'Bancolombia', tipo: 'banco', saldo,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-15T14:00:00Z', // 09:00 Bogotá de hoy
});
const tarjeta = (over: Partial<Deuda> = {}): Deuda => ({
  id: 1, nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28, pago_minimo: 900_000, dia_pago: 25, activa: true,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z',
  ...over,
});
const COSA = 'audifonos';
/** Ya cumplió sus 48 h: salta p4 (regla de impulso) y deja ver la parte de la plata. */
const esperado = (monto: number) => itemEspera({ descripcion: COSA, monto, disponible_en: '2026-10-14T00:00:00Z' });
const escenario = (dia: number | null, saldo: number, monto: number, over: Partial<Instantanea> = {}) =>
  inst({ config: config({ dia_ingreso: dia }), cuentas: [cuenta(saldo)], lista_espera: [esperado(monto)], ...over });
const q = (i: Instantanea, monto: number, descripcion = COSA) => {
  const m = calcularMetricas(i);
  return { m, v: veredictoPuedo(i, m, { monto, descripcion, ahora: i.ahora }) };
};

describe('mínimo que vence DESPUÉS del próximo ingreso: lo paga el ingreso nuevo', () => {
  // Saldo 1.000.000; mínimo de 900.000 el 25 oct; compra de 150.000.
  it('sin dia_ingreso (hasta fin de mes): el mínimo cuenta y la compra no cabe (p1s)', () => {
    const { v } = q(escenario(null, 1_000_000, 150_000, { deudas: [tarjeta()] }), 150_000);
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p1s' });
    expect(v.razones[0]).toBe('Te dejaría sin con qué pagar tus deudas: en tus cuentas quedarían $850.000 y te faltan $900.000 de mínimos por pagar (te faltarían $50.000).');
    expect(v.cifras).toMatchObject({ minimos_pendientes: 900_000, falta_minimos: 50_000, dias_nuevo_limite: 17, hasta_ingreso: null });
  });

  it('con ingreso el 20: el mínimo del 25 no se reserva, cabe en lo de hoy y lo dice', () => {
    // disponible = 1.000.000 (sin mínimos antes del 20) → ⌊1.000.000 ÷ 6⌋ = 166.666 hoy; 150.000 ≤ 166.666 → p7.
    const { m, v } = q(escenario(20, 1_000_000, 150_000, { deudas: [tarjeta()] }), 150_000);
    expect(m.base_hoy).toMatchObject({ hasta: '2026-10-20', dias_hasta_ingreso: 6, minimos_pendientes: 0, limite_saldo: 166_666 });
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p7' });
    expect(v.razones[0]).toBe('Cabe en lo de hoy: te quedarían $16.666 para hoy.');
    expect(v.cifras).toMatchObject({ minimos_pendientes: 0, falta_minimos: 0, saldo_tras: 850_000, hasta_ingreso: '2026-10-20', proximo_minimo: 900_000 });
    expect(v.razones).toContain('El 25 oct vence el mínimo de Tarjeta: $900.000; vence después de tu próximo ingreso el 20 oct, así que sale de esa plata.');
    expect(v.razones.join(' ')).not.toMatch(/no alcanzas/);
  });

  it('si el saldo sí lo cubre, dice que alcanza (aunque venza después del ingreso)', () => {
    const { v } = q(escenario(20, 1_000_000, 50_000, { deudas: [tarjeta({ pago_minimo: 100_000 })] }), 50_000);
    expect(v.razones).toContain('El 25 oct vence el mínimo de Tarjeta: $100.000; te alcanza para pagarlo.');
  });
});

describe('mínimo que vence ANTES del próximo ingreso aunque sea del mes que viene', () => {
  // Ingreso el 10 → hoy (15 oct) el próximo es el 10 nov: 27 días. El mínimo del 5 nov cae antes y sí se reserva.
  it('sin dia_ingreso: el 5 nov es «del mes que viene», no frena y cabe en el mes (p8)', () => {
    // ⌊1.000.000 ÷ 17⌋ = 58.823; nuevo = ⌊58.823 − 150.000 ÷ 17⌋ = ⌊49.999,47⌋ = 49.999 ≥ 80 % (47.058).
    const { v } = q(escenario(null, 1_000_000, 150_000, { deudas: [tarjeta({ dia_pago: 5 })] }), 150_000);
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p8' });
    expect(v.razones[0]).toBe('Cabe en el mes: tu límite diario bajaría de $58.823 a $49.999 los próximos 17 días.');
    expect(v.razones.join(' ')).toContain('El 5 nov vence el mínimo de Tarjeta: $900.000; con lo que te quedaría no alcanzas a pagarlo si no te entra plata antes.');
  });

  it('con ingreso el 10: el mínimo del 5 nov hay que pagarlo con esta plata → no (p1s), con la fecha del ingreso', () => {
    const { m, v } = q(escenario(10, 1_000_000, 150_000, { deudas: [tarjeta({ dia_pago: 5 })] }), 150_000);
    expect(m.base_hoy).toMatchObject({ hasta: '2026-11-10', dias_hasta_ingreso: 27, minimos_pendientes: 900_000 });
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p1s' });
    expect(v.razones[0]).toBe('Te dejaría sin con qué pagar tus deudas: en tus cuentas quedarían $850.000 y te faltan $900.000 de mínimos por pagar hasta tu próximo ingreso el 10 nov (te faltarían $50.000).');
    expect(v.razones[1]).toBe('El 5 nov vence el mínimo de Tarjeta: $900.000.');
    expect(v.cifras).toMatchObject({ minimos_pendientes: 900_000, falta_minimos: 50_000, hasta_ingreso: '2026-11-10' });
  });

  it('dos mínimos antes del ingreso: el total también dice «hasta tu próximo ingreso»', () => {
    const deudas = [tarjeta({ id: 1, pago_minimo: 100_000, dia_pago: 18 }), tarjeta({ id: 2, nombre: 'Moto', pago_minimo: 200_000, dia_pago: 19 })];
    const { v } = q(escenario(20, 2_000_000, 20_000, { deudas }), 20_000);
    expect(v.cifras.minimos_pendientes).toBe(300_000);
    expect(v.razones).toContain('El 18 oct vence el mínimo de Tarjeta: $100.000 (en total te faltan $300.000 de mínimos hasta tu próximo ingreso el 20 oct); te alcanza para pagarlo.');
  });
});

describe('el nuevo límite diario se reparte hasta el ingreso', () => {
  it('p8: 600.000 entre 6 días, la compra de 110.000 también entre 6 (ejemplo a mano)', () => {
    // limite = ⌊600.000 ÷ 6⌋ = 100.000; nuevo = ⌊100.000 − 110.000 ÷ 6⌋ = ⌊81.666,67⌋ = 81.666 ≥ 80.000 → sí.
    const { v } = q(escenario(20, 600_000, 110_000), 110_000);
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p8' });
    expect(v.razones[0]).toBe('Cabe hasta tu próximo ingreso el 20 oct: tu límite diario bajaría de $100.000 a $81.666 los próximos 6 días.');
    expect(v.cifras).toMatchObject({ limite_hoy: 100_000, nuevo_limite: 81_666, dias_restantes: 17, dias_nuevo_limite: 6, hasta_ingreso: '2026-10-20' });
    // Sin dia_ingreso: ⌊600.000 ÷ 17⌋ = 35.294; nuevo = ⌊35.294 − 6.470,59⌋ = ⌊28.823,41⌋ = 28.823, los próximos 17 días.
    const { v: antes } = q(escenario(null, 600_000, 110_000), 110_000);
    expect(antes.razones[0]).toBe('Cabe en el mes: tu límite diario bajaría de $35.294 a $28.823 los próximos 17 días.');
  });

  it('p10: si deja muy justo, lo dice frente al ingreso y no frente al mes', () => {
    // nuevo = ⌊100.000 − 350.000 ÷ 6⌋ = ⌊41.666,67⌋ = 41.666 < 50 % → no.
    const { v } = q(escenario(20, 600_000, 350_000), 350_000);
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p10' });
    expect(v.razones[0]).toBe('Te dejaría muy justo hasta tu próximo ingreso el 20 oct: tu límite diario quedaría en $41.666.');
  });

  it('p1: lo que queda es hasta el ingreso (con Netflix del 20 reservado)', () => {
    // disponible = 300.000 − 45.000 = 255.000 < 280.000; el saldo sí da 280.000 y no hay mínimos → no es p1s.
    const { v } = q(escenario(20, 300_000, 280_000, { recurrentes: [recurrente()] }), 280_000);
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p1', cifras: { restante_mes: 255_000 } });
    expect(v.razones[0]).toBe('No te alcanza: te quedan $255.000 hasta tu próximo ingreso el 20 oct y esto cuesta $280.000.');
  });

  it('p1e (esencial): «no te alcanza hasta tu próximo ingreso»', () => {
    const { v } = q(escenario(20, 300_000, 280_000, { recurrentes: [recurrente()] }), 280_000, 'drogueria');
    expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p1e', esencial: true });
    expect(v.razones[0]).toMatch(/^No te alcanza hasta tu próximo ingreso el 20 oct \(\$255\.000 libres\)\./);
  });

  it('si manda el ingreso mensual (configurado y más bajo), el horizonte sigue siendo el mes', () => {
    const i = escenario(20, 6_000_000, 110_000, { config: config({ dia_ingreso: 20, ingreso_mensual: 2_000_000 }) });
    const { m, v } = q(i, 110_000);
    const li = m.base_hoy.limite_ingreso as number;
    expect(m.base_hoy.limita).toBe('ingreso');
    expect(li).toBeLessThan(m.base_hoy.limite_saldo as number);
    expect(v.cifras).toMatchObject({ nuevo_limite: Math.floor(li - 110_000 / 17), dias_nuevo_limite: 17, hasta_ingreso: '2026-10-20' });
    expect(v.razones[0]).toMatch(/^Cabe en el mes: .* los próximos 17 días\.$/);
  });
});

describe('dia_ingreso null: igual que antes', () => {
  it('el canónico con cuentas y deudas da el mismo veredicto con y sin la clave', () => {
    const extra = { cuentas: [cuenta(725_000)], deudas: [tarjeta({ pago_minimo: 150_000, dia_pago: 25 })] };
    const sinClave = escenarioCanonico(extra);
    const conNull = escenarioCanonico({ ...extra, config: config({ ingreso_mensual: 4_000_000, dia_ingreso: null }) });
    for (const [monto, desc] of [[30_000, 'almuerzo'], [80_000, 'audífonos'], [700_000, 'drogueria']] as const) {
      const a = veredictoPuedo(sinClave, calcularMetricas(sinClave), { monto, descripcion: desc, ahora: sinClave.ahora });
      const b = veredictoPuedo(conNull, calcularMetricas(conNull), { monto, descripcion: desc, ahora: conNull.ahora });
      expect(b).toEqual(a);
      expect(b.cifras).toMatchObject({ dias_nuevo_limite: 17, hasta_ingreso: null });
    }
  });

  it('sin cuentas, dia_ingreso no cambia nada (no hay saldo que repartir)', () => {
    const a = escenarioCanonico();
    const b = escenarioCanonico({ config: config({ ingreso_mensual: 4_000_000, dia_ingreso: 20 }) });
    const va = veredictoPuedo(a, calcularMetricas(a), { monto: 80_000, descripcion: 'audífonos', ahora: a.ahora });
    const vb = veredictoPuedo(b, calcularMetricas(b), { monto: 80_000, descripcion: 'audífonos', ahora: b.ahora });
    expect(vb).toEqual(va);
  });
});
