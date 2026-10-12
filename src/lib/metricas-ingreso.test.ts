// A2 (2026-10-09): con `dia_ingreso`, la plata de las cuentas se reparte hasta el próximo ingreso y no hasta fin de mes.
// Datos sintéticos; AHORA_CANONICO = 2026-10-15 12:00 Bogotá (D = 31, d = 15, dr = 17).
import { beforeEach, describe, expect, it } from 'vitest';
import { minimosPendientesMes } from './deudas';
import { calcularMetricas, fijosPendientes, minimosPendientesHasta, proximoIngreso } from './metricas';
import type { Cuenta, Deuda } from './tipos';
import { config, escenarioCanonico, fijo, gastosDiarios, inst, mov, reiniciarIds } from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

let idCuenta = 0;
const cuenta = (over: Partial<Cuenta> = {}): Cuenta => ({
  id: ++idCuenta, nombre: 'Cuenta principal', tipo: 'banco', saldo: 1_000_000,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-15T14:00:00Z', // 09:00 Bogotá de hoy
  ...over,
});
const deuda = (over: Partial<Deuda> = {}): Deuda => ({
  id: 1, nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28, pago_minimo: 150_000, dia_pago: 20, activa: true,
  creado_en: '2026-10-01T12:00:00Z', actualizado_en: '2026-10-01T12:00:00Z',
  ...over,
});
const ingreso = (fecha: string, monto = 3_000_000) => mov({ fecha, tipo: 'ingreso', monto, comercio: 'NOMINA' });
const conDia = (dia: number | null) => config({ dia_ingreso: dia });

describe('proximoIngreso: la regla', () => {
  it('antes del día de ingreso es ese día; después, el del mes siguiente', () => {
    expect(proximoIngreso(20, '2026-10-15', [])).toBe('2026-10-20');
    expect(proximoIngreso(10, '2026-10-15', [])).toBe('2026-11-10');
    expect(proximoIngreso(1, '2026-12-15', [])).toBe('2027-01-01');
  });

  it('el día de ingreso sin registrar: llega hoy (hoy es el último día del período); ya registrado: el del mes siguiente', () => {
    expect(proximoIngreso(15, '2026-10-15', [])).toBe('2026-10-15');
    expect(proximoIngreso(15, '2026-10-15', [ingreso('2026-10-15')])).toBe('2026-11-15');
  });

  it('ingreso adelantado hasta 7 días antes cuenta como el de este ciclo; más temprano, no', () => {
    expect(proximoIngreso(20, '2026-10-15', [ingreso('2026-10-14')])).toBe('2026-11-20'); // 6 días antes
    expect(proximoIngreso(20, '2026-10-15', [ingreso('2026-10-13')])).toBe('2026-11-20'); // 7 días antes: borde
    expect(proximoIngreso(20, '2026-10-15', [ingreso('2026-10-12')])).toBe('2026-10-20'); // 8 días antes: otro ingreso
    // Lo que no es ingreso que cuenta (no computa, o es un reverso) no mueve la fecha.
    expect(proximoIngreso(20, '2026-10-15', [mov({ fecha: '2026-10-14', tipo: 'ingreso', monto: 3_000_000, computa: false })])).toBe('2026-10-20');
    expect(proximoIngreso(20, '2026-10-15', [mov({ fecha: '2026-10-14', tipo: 'reverso', monto: 50_000 })])).toBe('2026-10-20');
  });

  it('día 31 y meses cortos: cae el último día del mes', () => {
    expect(proximoIngreso(31, '2026-11-10', [])).toBe('2026-11-30');
    expect(proximoIngreso(31, '2026-11-30', [ingreso('2026-11-28')])).toBe('2026-12-31');
    expect(proximoIngreso(30, '2027-02-10', [])).toBe('2027-02-28');
    expect(proximoIngreso(30, '2027-02-28', [ingreso('2027-02-26')])).toBe('2027-03-30');
    expect(proximoIngreso(29, '2028-02-10', [])).toBe('2028-02-29');                        // bisiesto
  });

  it('ingreso tardío: pasado el día sin registrar, el saldo debe durar hasta el del mes siguiente (conservador)', () => {
    expect(proximoIngreso(30, '2026-10-31', [])).toBe('2026-11-30');
    // y cuando llega el 1.º, sigue siendo el del 30 de noviembre
    expect(proximoIngreso(30, '2026-11-01', [ingreso('2026-11-01')])).toBe('2026-11-30');
  });
});

describe('ventana de pagos hasta el próximo ingreso', () => {
  it('mínimos: solo los que vencen de hoy a `hasta`, aunque crucen de mes; dos vencimientos de la misma deuda cuentan dos veces', () => {
    const deudas = [
      deuda({ id: 1, pago_minimo: 100_000, dia_pago: 18 }),
      deuda({ id: 2, pago_minimo: 200_000, dia_pago: 25 }),
      deuda({ id: 3, pago_minimo: 30_000, dia_pago: 5 }),
      deuda({ id: 4, pago_minimo: 900_000, dia_pago: 17, saldo: 1_000_000 }),
    ];
    expect(minimosPendientesHasta(deudas, '2026-10-15', '2026-10-20')).toBe(100_000 + 900_000);
    expect(minimosPendientesHasta(deudas, '2026-10-15', '2026-11-10')).toBe(100_000 + 200_000 + 30_000 + 900_000);
    // 15-oct → 20-nov: la del 18 vence el 18-oct y el 18-nov; la del 17 también, pero no más que su saldo
    expect(minimosPendientesHasta(deudas, '2026-10-15', '2026-11-20')).toBe(200_000 + 200_000 + 30_000 + 1_000_000);
    // con `hasta` = fin de mes da lo mismo que minimosPendientesMes
    expect(minimosPendientesHasta(deudas, '2026-10-15', '2026-10-31')).toBe(minimosPendientesMes(deudas, '2026-10-15'));
  });

  it('fijos: el arriendo del 5 del mes siguiente cuenta si el ingreso llega después; uno sin día se reserva en cada mes', () => {
    const fijos = [fijo({ id: 1, monto: 1_500_000, dia_mes: 5 }), fijo({ id: 2, monto: 80_000, dia_mes: null, patron: 'plan' })];
    const movs = [mov({ fecha: '2026-10-03', monto: 80_000, fijo_id: 2 })];
    expect(fijosPendientes(movs, fijos, '2026-10-15')).toBe(0);                            // fin de mes: como antes
    expect(fijosPendientes(movs, fijos, '2026-10-15', '2026-10-20')).toBe(0);
    expect(fijosPendientes(movs, fijos, '2026-10-15', '2026-11-10')).toBe(1_500_000 + 80_000);
  });
});

describe('límite por saldo con dia_ingreso', () => {
  it('reparte hasta el próximo ingreso (hoy y ese día incluidos): 600.000 ÷ 6 = 100.000 en vez de ÷ 17', () => {
    const sin = calcularMetricas(inst({ cuentas: [cuenta({ saldo: 600_000 })] }));
    const con = calcularMetricas(inst({ config: conDia(20), cuentas: [cuenta({ saldo: 600_000 })] }));
    expect(sin.base_hoy).toMatchObject({ hasta: null, dias_hasta_ingreso: null, limite_saldo: Math.floor(600_000 / 17) });
    expect(con.base_hoy).toMatchObject({ hasta: '2026-10-20', dias_hasta_ingreso: 6, limite_saldo: 100_000, dias_restantes: 17 });
    expect(con.limite_hoy).toBe(100_000);
    expect(con.dias_restantes).toBe(17);                    // el mes no cambia
  });

  it('después del día de ingreso (ya llegó): reparte hasta el del mes siguiente', () => {
    const m = calcularMetricas(inst({
      config: conDia(10), cuentas: [cuenta({ saldo: 3_100_000 })],
      movimientos: [ingreso('2026-10-10')],                 // anotado antes que el saldo: ya está incluido
    }));
    expect(m.base_hoy.hasta).toBe('2026-11-10');
    expect(m.base_hoy.dias_hasta_ingreso).toBe(27);
    expect(m.base_hoy.ahorro_pendiente).toBe(300_000);      // 10 % del ingreso de este mes
    expect(m.limite_hoy).toBe(Math.floor((3_100_000 - 300_000) / 27));
  });

  it('hoy es el día de ingreso y aún no llega: hoy es el último día del período (todo lo disponible, como el último del mes)', () => {
    const m = calcularMetricas(inst({ config: conDia(15), cuentas: [cuenta({ saldo: 90_000 })], deudas: [deuda({ dia_pago: 16 })] }));
    expect(m.base_hoy).toMatchObject({ hasta: '2026-10-15', dias_hasta_ingreso: 1, minimos_pendientes: 0, limite_saldo: 90_000 });
    // Ya llegó hoy: el período nuevo va hasta el 15 de noviembre y la deuda del 16 de octubre sí se reserva.
    const llego = calcularMetricas(inst({
      config: conDia(15), cuentas: [cuenta({ saldo: 3_090_000, actualizado_en: '2026-10-15T16:00:00Z' })],
      movimientos: [ingreso('2026-10-15')], deudas: [deuda({ dia_pago: 16 })],
    }));
    expect(llego.base_hoy).toMatchObject({ hasta: '2026-11-15', dias_hasta_ingreso: 32, minimos_pendientes: 150_000 });
  });

  it('día 31 en un mes de 30: el ingreso cae el 30 y el divisor llega hasta ese día', () => {
    const m = calcularMetricas(inst({
      ahora: new Date('2026-11-20T17:00:00Z'), config: conDia(31),
      cuentas: [cuenta({ saldo: 1_100_000, actualizado_en: '2026-11-20T14:00:00Z' })],
    }));
    expect(m.base_hoy).toMatchObject({ hasta: '2026-11-30', dias_hasta_ingreso: 11, limite_saldo: 100_000 });
  });

  it('mes corto: ingreso el 30 en febrero cae el 28; pasado ese día, el siguiente es el 30 de marzo', () => {
    const feb = calcularMetricas(inst({
      ahora: new Date('2027-02-20T17:00:00Z'), config: conDia(30),
      cuentas: [cuenta({ saldo: 900_000, actualizado_en: '2027-02-20T14:00:00Z' })],
    }));
    expect(feb.base_hoy).toMatchObject({ hasta: '2027-02-28', dias_hasta_ingreso: 9, limite_saldo: 100_000 });
    const mar = calcularMetricas(inst({
      ahora: new Date('2027-03-01T17:00:00Z'), config: conDia(30), movimientos: [ingreso('2027-02-26')],
      cuentas: [cuenta({ saldo: 3_000_000, actualizado_en: '2027-03-01T14:00:00Z' })],
    }));
    expect(mar.base_hoy).toMatchObject({ hasta: '2027-03-30', dias_hasta_ingreso: 30 });
  });

  it('los mínimos que vencen después del próximo ingreso no se restan (los paga el ingreso nuevo)', () => {
    const deudas = [deuda({ id: 1, pago_minimo: 100_000, dia_pago: 18 }), deuda({ id: 2, pago_minimo: 200_000, dia_pago: 25 })];
    const sin = calcularMetricas(inst({ cuentas: [cuenta({ saldo: 1_000_000 })], deudas }));
    const con = calcularMetricas(inst({ config: conDia(20), cuentas: [cuenta({ saldo: 1_000_000 })], deudas }));
    expect(sin.base_hoy.minimos_pendientes).toBe(300_000);
    expect(con.base_hoy.minimos_pendientes).toBe(100_000);
    expect(con.base_hoy.disponible_saldo).toBe(900_000);
    expect(con.limite_hoy).toBe(150_000);                   // 900.000 ÷ 6
  });

  it('dia_ingreso null: idéntico a antes; y sin cuentas, dia_ingreso no cambia nada', () => {
    const conCuentas = { cuentas: [cuenta({ saldo: 725_000, actualizado_en: '2026-10-15T16:30:00Z' })], deudas: [deuda({ dia_pago: 25 })] };
    const antes = calcularMetricas(escenarioCanonico(conCuentas));
    const nulo = calcularMetricas(escenarioCanonico({ ...conCuentas, config: config({ ingreso_mensual: 4_000_000, dia_ingreso: null }) }));
    expect(nulo).toEqual(antes);
    expect(nulo.base_hoy).toMatchObject({ hasta: null, dias_hasta_ingreso: null });
    const sinCuentas = calcularMetricas(escenarioCanonico());
    const sinCuentasConDia = calcularMetricas(escenarioCanonico({ config: config({ ingreso_mensual: 4_000_000, dia_ingreso: 20 }) }));
    expect(sinCuentasConDia).toEqual(sinCuentas);
  });

  it('ejemplo verificado a mano (escenario canónico + tarjeta del 18 y préstamo del 25, ingreso el 20)', () => {
    // Saldo 325.000 anotado a las 11:30 (ya sin el gasto de 30.000 de las 11:00) → inicio del día 355.000.
    // hasta = 20-oct (no hay ingresos del 13 al 15) → 6 días (15, 16, 17, 18, 19, 20).
    // Mínimos: tarjeta del 18 = 100.000; el préstamo del 25 lo paga el ingreso nuevo. Comprometido: Netflix del 20 = 45.000;
    // el arriendo (día 5) ya pasó y el del 5-nov queda después del ingreso. Ahorro: sin ingresos este mes → 0.
    // disponible = 355.000 − 100.000 − 45.000 = 210.000 → ⌊210.000 ÷ 6⌋ = 35.000 < 59.117 (ingreso) → mandan las cuentas.
    // libre = 35.000 − 30.000 = 5.000; restante = min(975.000, 210.000 − 30.000) = 180.000.
    // Antes (hasta fin de mes): 355.000 − 300.000 − 45.000 = 10.000 → ⌊10.000 ÷ 17⌋ = 588.
    const deudas = [deuda({ id: 1, pago_minimo: 100_000, dia_pago: 18 }), deuda({ id: 2, pago_minimo: 200_000, dia_pago: 25 })];
    const cuentas = [cuenta({ saldo: 325_000, actualizado_en: '2026-10-15T16:30:00Z' })];
    const antes = calcularMetricas(escenarioCanonico({ cuentas, deudas }));
    expect(antes.limite_hoy).toBe(588);
    const m = calcularMetricas(escenarioCanonico({ cuentas, deudas, config: config({ ingreso_mensual: 4_000_000, dia_ingreso: 20 }) }));
    expect(m.base_hoy).toMatchObject({
      limita: 'saldo', saldo_inicio_hoy: 355_000, minimos_pendientes: 100_000, comprometido: 45_000, ahorro_pendiente: 0,
      disponible_saldo: 210_000, limite_saldo: 35_000, limite_ingreso: 59_117, hasta: '2026-10-20', dias_hasta_ingreso: 6,
    });
    expect(m.limite_hoy).toBe(35_000);
    expect(m.libre_hoy).toBe(5_000);
    expect(m.restante_mes).toBe(180_000);
  });
});

describe('semáforo antes del ingreso (caso demo: saldo bajo a 5 días del sueldo)', () => {
  // 1–14 oct a 40.000/día (antes de anotar el saldo); saldo 300.000 hoy a las 9:00; sin ingreso ni historial.
  // ritmo = 0,5·40.000 + 0,3·40.000 + 0,2·0 = 32.000; hoy no ha gastado.
  const demo = (dia: number | null) => inst({
    config: conDia(dia), movimientos: gastosDiarios('2026-10-01', '2026-10-14', 40_000), cuentas: [cuenta({ saldo: 300_000 })],
  });

  it('sin dia_ingreso: proyecta hasta fin de mes y sale rojo falso (544.000 ÷ 300.000 = 181 %)', () => {
    const m = calcularMetricas(demo(null));
    expect(m.proyeccion_ratio).toBeCloseTo(544_000 / 300_000, 6);
    expect(m.semaforo).toBe('rojo');
    expect(m.limite_hoy).toBe(Math.floor(300_000 / 17));
  });

  it('con el ingreso el 20: solo cuenta hasta el sueldo (192.000 ÷ 300.000 = 64 %) → verde, y lo dice', () => {
    // gasto por venir = 0 (hoy) + 32.000 × 5 + max(0, 32.000 − 0) = 192.000
    const m = calcularMetricas(demo(20));
    expect(m.proyeccion_ratio).toBeCloseTo(0.64, 6);
    expect(m.limite_hoy).toBe(50_000);
    expect(m.semaforo).toBe('verde');
    expect(m.semaforo_razon).toContain('antes de tu próximo ingreso');
  });

  it('si de verdad no alcanza para lo que vence antes del ingreso, sigue siendo rojo y lo dice', () => {
    const m = calcularMetricas(inst({ config: conDia(20), cuentas: [cuenta({ saldo: 100_000 })], deudas: [deuda({ pago_minimo: 150_000, dia_pago: 18 })] }));
    expect(m.semaforo).toBe('rojo');
    expect(m.semaforo_razon).toBe('La plata de tus cuentas no alcanza para lo que falta pagar antes de tu próximo ingreso');
  });
});
