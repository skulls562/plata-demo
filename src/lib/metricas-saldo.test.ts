// Fase A (2026-10-09): «hoy puedes gastar» híbrido = el menor entre el límite por ingreso/presupuesto y el de la plata real.
// Todo con datos sintéticos; AHORA_CANONICO = 2026-10-15 12:00 Bogotá (D = 31, d = 15, dr = 17).
import { beforeEach, describe, expect, it } from 'vitest';
import { minimosPendientesMes } from './deudas';
import { calcularMetricas, efectosLiquidos, esPosteriorA, fijosPendientes } from './metricas';
import type { AporteMeta, Cuenta, Deuda } from './tipos';
import {
  config, escenarioCanonico, fijo, gasto, gastosDiarios, inst, metaConAportes, mov, reiniciarIds,
} from '../../tests/fixtures/constructores';

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

describe('sin cuentas líquidas: igual que antes', () => {
  it('el ejemplo canónico no cambia y expone la base por ingreso', () => {
    const m = calcularMetricas(escenarioCanonico());
    expect(m.limite_hoy).toBe(59_117);
    expect(m.libre_hoy).toBe(29_117);
    expect(m.restante_mes).toBe(975_000);
    expect(m.semaforo).toBe('rojo');
    expect(m.base_hoy).toMatchObject({
      limita: 'ingreso', hay_cuentas: false, limite_ingreso: 59_117, limite_saldo: null, disponible_saldo: null,
      saldo_liquido: 0, saldo_antiguo_dias: null, dias_restantes: 17,
    });
  });

  it('una cuenta de AHORRO sola no cambia nada (no es plata para gastar)', () => {
    const { saldos: s1, ...sin } = calcularMetricas(escenarioCanonico());
    const { saldos: s2, ...con } = calcularMetricas(escenarioCanonico({ cuentas: [cuenta({ tipo: 'ahorro', saldo: 50_000_000 })] }));
    expect(con).toEqual(sin);                         // todo igual salvo el resumen de saldos (que sí la muestra)
    expect(s2.saldo_total - s1.saldo_total).toBe(50_000_000);
  });

  it('base estimada sin cuentas: limita «estimado»; sin datos: null', () => {
    const est = calcularMetricas(inst({ movimientos: gastosDiarios('2026-09-01', '2026-09-30', 50_000) }));
    expect(est.base.modo).toBe('gasto_historico');
    expect(est.base_hoy.limita).toBe('estimado');
    const nada = calcularMetricas(inst());
    expect(nada.base_hoy.limita).toBeNull();
    expect(nada.limite_hoy).toBeNull();
    expect(nada.semaforo).toBe('gris');
  });
});

describe('solo cuentas (sin ingreso ni presupuesto)', () => {
  it('manda el saldo: 1.700.000 ÷ 17 días = 100.000', () => {
    const m = calcularMetricas(inst({ cuentas: [cuenta({ saldo: 1_700_000 })] }));
    expect(m.base.modo).toBe('sin_datos');           // la base por ingreso no cambia
    expect(m.base_hoy).toMatchObject({ limita: 'saldo', hay_cuentas: true, saldo_liquido: 1_700_000, disponible_saldo: 1_700_000, limite_saldo: 100_000, limite_ingreso: null });
    expect(m.limite_hoy).toBe(100_000);
    expect(m.libre_hoy).toBe(100_000);
    expect(m.restante_mes).toBe(1_700_000);
    expect(m.semaforo).not.toBe('gris');
  });

  it('con historial de gasto (base estimada) no cae al histórico: manda el saldo y el rojo es rojo de verdad', () => {
    const m = calcularMetricas(inst({ movimientos: gastosDiarios('2026-09-01', '2026-09-30', 50_000), cuentas: [cuenta({ saldo: 0 })] }));
    expect(m.base.modo).toBe('gasto_historico');
    expect(m.base_hoy.limita).toBe('saldo');
    expect(m.limite_hoy).toBe(0);
    expect(m.semaforo).toBe('rojo');                  // no «estimando»: el saldo es dato real
  });

  it('el semáforo del mes compara con la plata de las cuentas y hay puntaje', () => {
    // 1–14 oct a 20.000 (antes de anotar el saldo). ritmo = 0,5·20.000 + 0,3·20.000 + 0,2·0 = 16.000
    // proyección = 280.000 + 16.000·16 + 16.000 = 552.000; de hoy a fin de mes: 272.000 ÷ 340.000 = 0,8
    const m = calcularMetricas(inst({ movimientos: gastosDiarios('2026-10-01', '2026-10-14', 20_000), cuentas: [cuenta({ saldo: 340_000 })] }));
    expect(m.limite_hoy).toBe(20_000);
    expect(m.proyeccion_ratio).toBeCloseTo(0.8, 6);
    expect(m.semaforo).toBe('verde');
    expect(m.semaforo_razon).toContain('de la plata de tus cuentas');
    expect(m.score.valor).not.toBeNull();
  });
});

describe('mínimos, fijos y ahorro pendientes', () => {
  it('saldo que no alcanza para los mínimos: límite 0, rojo y restante negativo', () => {
    const m = calcularMetricas(inst({ cuentas: [cuenta({ saldo: 300_000 })], deudas: [deuda({ pago_minimo: 500_000, dia_pago: 20 })] }));
    expect(m.base_hoy.minimos_pendientes).toBe(500_000);
    expect(m.base_hoy.disponible_saldo).toBe(-200_000);
    expect(m.limite_hoy).toBe(0);
    expect(m.libre_hoy).toBe(0);
    expect(m.restante_mes).toBe(-200_000);
    expect(m.semaforo).toBe('rojo');
    expect(m.semaforo_razon).toContain('no alcanza');
  });

  it('deuda que vence hoy y mañana cuenta; la que ya pasó este mes, no; sin día de pago, tampoco', () => {
    const deudas = [
      deuda({ id: 1, pago_minimo: 100_000, dia_pago: 15 }),   // hoy
      deuda({ id: 2, pago_minimo: 20_000, dia_pago: 16 }),    // mañana
      deuda({ id: 3, pago_minimo: 3_000, dia_pago: 14 }),     // ya pasó → próximo mes
      deuda({ id: 4, pago_minimo: 400, dia_pago: null }),
      deuda({ id: 5, pago_minimo: 50, dia_pago: 31 }),        // 31 de octubre: cuenta
      deuda({ id: 6, pago_minimo: 7, dia_pago: 25, saldo: 0 }), // ya pagada del todo
    ];
    expect(minimosPendientesMes(deudas, '2026-10-15')).toBe(120_050);
    const m = calcularMetricas(inst({ cuentas: [cuenta({ saldo: 1_700_000 })], deudas }));
    expect(m.base_hoy.minimos_pendientes).toBe(120_050);
    expect(m.limite_hoy).toBe(Math.floor((1_700_000 - 120_050) / 17));
  });

  it('día 31 en un mes de 30 cae el último día, y el último día del mes (dr = 1) el límite es todo lo disponible', () => {
    const ahora = new Date('2026-11-30T17:00:00Z');
    expect(minimosPendientesMes([deuda({ dia_pago: 31 })], '2026-11-29')).toBe(150_000);
    const m = calcularMetricas(inst({
      ahora, cuentas: [cuenta({ saldo: 500_000, actualizado_en: '2026-11-30T14:00:00Z' })],
      deudas: [deuda({ id: 1, dia_pago: 31, pago_minimo: 150_000 }), deuda({ id: 2, dia_pago: 29, pago_minimo: 90_000 })],
    }));
    expect(m.dias_restantes).toBe(1);
    expect(m.base_hoy.minimos_pendientes).toBe(150_000);
    expect(m.limite_hoy).toBe(350_000);
  });

  it('fijos configurados: cuenta lo que falta de los que no han vencido (o no tienen día)', () => {
    const fijos = [
      fijo({ id: 1, monto: 1_000_000, dia_mes: 20 }),             // pendiente entero
      fijo({ id: 2, monto: 200_000, dia_mes: 31, patron: 'gym' }), // pagado a medias: faltan 50.000
      fijo({ id: 3, monto: 300_000, dia_mes: 5, patron: 'luz' }),  // su día ya pasó
      fijo({ id: 4, monto: 80_000, dia_mes: null, patron: 'plan' }),
    ];
    const movs = [mov({ fecha: '2026-10-03', monto: 150_000, fijo_id: 2 }), mov({ fecha: '2026-09-28', monto: 200_000, fijo_id: 2 })];
    expect(fijosPendientes(movs, fijos, '2026-10-15')).toBe(1_130_000);
  });

  it('comprometido = P (suscripciones) + fijos pendientes; ahorro = % de lo que entró este mes − aportes del mes', () => {
    const aporte = (fecha: string, monto: number): AporteMeta => ({ id: 1, meta_id: 1, fecha, monto, nota: null });
    const i = escenarioCanonico({
      fijos: [fijo({ id: 1, monto: 1_500_000, dia_mes: 5 }), fijo({ id: 2, nombre: 'Gym', monto: 100_000, dia_mes: 25, patron: 'gym' })],
      metas: [metaConAportes({ aportes: [aporte('2026-10-02', 100_000), aporte('2026-09-20', 999_000)] })],
      cuentas: [cuenta({ saldo: 3_000_000 })],
    });
    i.movimientos.push(mov({ fecha: '2026-10-01', hora: '08:00', tipo: 'ingreso', monto: 3_000_000 }));
    const m = calcularMetricas(i);
    expect(m.base_hoy.comprometido).toBe(45_000 + 100_000);
    expect(m.base_hoy.ahorro_pendiente).toBe(300_000 - 100_000);
  });
});

describe('saldo ajustado por lo que pasó después de anotarlo', () => {
  it('resta gastos y suma ingresos posteriores; ignora crédito, internos y lo que no computa (salvo pago de tarjeta)', () => {
    const corte = '2026-10-10T15:00:00Z'; // 10:00 Bogotá del 10 de octubre
    const movimientos = [
      gasto('2026-10-10', 50_000, 'ANTES', { hora: '09:00' }),
      gasto('2026-10-10', 30_000, 'DESPUES', { hora: '11:00' }),                                     // −30.000
      gasto('2026-10-12', 20_000, 'SIN HORA', { hora: null }),                                       // −20.000
      gasto('2026-10-10', 7_000, 'MISMO DIA ANTES', { hora: null, creado_en: '2026-10-10T14:00:00Z' }),
      gasto('2026-10-10', 8_000, 'MISMO DIA DESPUES', { hora: null, creado_en: '2026-10-10T16:00:00Z' }), // −8.000
      mov({ fecha: '2026-10-13', tipo: 'ingreso', monto: 1_000_000 }),                               // +1.000.000
      gasto('2026-10-13', 200_000, 'TV', { medio: 'credito' }),
      mov({ fecha: '2026-10-13', tipo: 'interno', monto: 300_000 }),
      mov({ fecha: '2026-10-13', tipo: 'pago_tarjeta', monto: 100_000 }),                            // −100.000
      mov({ fecha: '2026-10-14', tipo: 'reverso', monto: 5_000 }),                                   // +5.000
      mov({ fecha: '2026-10-14', tipo: 'transferencia', monto: 60_000, computa: false }),
      gasto('2026-10-14', 400_000, 'ARRIENDO', { fijo_id: 9 }),                                      // −400.000
    ];
    const m = calcularMetricas(inst({ movimientos, cuentas: [cuenta({ saldo: 2_000_000, actualizado_en: corte })] }));
    expect(m.base_hoy.saldo_anotado).toBe(2_000_000);
    expect(m.base_hoy.saldo_liquido).toBe(2_447_000);
    expect(m.base_hoy.ahorro_pendiente).toBe(100_000);       // 10 % del ingreso recibido este mes
    expect(m.base_hoy.disponible_saldo).toBe(2_347_000);
    expect(m.limite_hoy).toBe(Math.floor(2_347_000 / 17)); // 138.058
    expect(m.base_hoy.saldo_antiguo_dias).toBe(5);
  });

  it('zona horaria: 23:30 del día 10 en Bogotá es DESPUÉS de las 22:00 del día 10, aunque en UTC ya sea el 11', () => {
    const corte = '2026-10-11T03:00:00Z';             // 22:00 Bogotá del 10
    expect(esPosteriorA({ fecha: '2026-10-10', hora: '23:30', creado_en: '2026-10-11T04:31:00Z' }, corte)).toBe(true);
    expect(esPosteriorA({ fecha: '2026-10-10', hora: '21:59', creado_en: '2026-10-11T04:31:00Z' }, corte)).toBe(false);
    // Sin hora, el mismo día de Bogotá decide creado_en
    expect(esPosteriorA({ fecha: '2026-10-10', hora: null, creado_en: '2026-10-11T02:00:00Z' }, corte)).toBe(false);
    expect(esPosteriorA({ fecha: '2026-10-10', hora: null, creado_en: '2026-10-11T03:30:00Z' }, corte)).toBe(true);
    expect(esPosteriorA({ fecha: '2026-10-11', hora: null, creado_en: '2026-10-11T02:00:00Z' }, corte)).toBe(true);
    expect(esPosteriorA({ fecha: '2026-10-11', hora: '00:00', creado_en: '' }, 'no-es-fecha')).toBe(false);
  });

  it('gastar hoy no cambia el límite de hoy, se anote el saldo antes o después del gasto', () => {
    const antes = calcularMetricas(inst({
      movimientos: [gasto('2026-10-15', 40_000, 'HOY', { hora: '10:00' })],
      cuentas: [cuenta({ saldo: 1_000_000, actualizado_en: '2026-10-14T20:00:00Z' })],   // ayer: el gasto se resta
    }));
    const despues = calcularMetricas(inst({
      movimientos: [gasto('2026-10-15', 40_000, 'HOY', { hora: '10:00' })],
      cuentas: [cuenta({ saldo: 960_000, actualizado_en: '2026-10-15T16:00:00Z' })],     // 11:00: ya lo incluye
    }));
    expect(antes.base_hoy.saldo_liquido).toBe(960_000);
    expect(antes.base_hoy.saldo_inicio_hoy).toBe(1_000_000);
    expect(despues.base_hoy.saldo_inicio_hoy).toBe(1_000_000);
    expect(antes.limite_hoy).toBe(Math.floor(1_000_000 / 17));
    expect(despues.limite_hoy).toBe(antes.limite_hoy);
    expect(despues.libre_hoy).toBe(antes.limite_hoy! - 40_000);
  });

  it('retiros y efectivo: el retiro pasa la plata del banco al bolsillo; sin cuenta de efectivo, sale', () => {
    const retiro = mov({ fecha: '2026-10-14', tipo: 'retiro', monto: 100_000 });
    const enEfectivo = gasto('2026-10-14', 20_000, 'TIENDA', { banco: 'efectivo', medio: 'efectivo', origen: 'manual' });
    expect(efectosLiquidos(retiro)).toEqual([{ grupo: 'banco', monto: -100_000 }, { grupo: 'efectivo', monto: 100_000 }]);
    const corte = '2026-10-10T15:00:00Z';
    const soloBanco = calcularMetricas(inst({ movimientos: [retiro, enEfectivo], cuentas: [cuenta({ saldo: 1_000_000, actualizado_en: corte })] }));
    expect(soloBanco.base_hoy.saldo_liquido).toBe(900_000);
    const ambas = calcularMetricas(inst({
      movimientos: [retiro, enEfectivo],
      cuentas: [cuenta({ saldo: 1_000_000, actualizado_en: corte }), cuenta({ nombre: 'Efectivo', tipo: 'efectivo', saldo: 50_000, actualizado_en: corte })],
    }));
    expect(ambas.base_hoy.saldo_anotado).toBe(1_050_000);
    expect(ambas.base_hoy.saldo_liquido).toBe(1_030_000);
  });

  it('varias cuentas: cada movimiento se compara con la cuenta de su banco; avisa la más vieja', () => {
    const cuentas = [
      cuenta({ nombre: 'Bancolombia', saldo: 1_000_000, actualizado_en: '2026-10-14T15:00:00Z' }),
      cuenta({ nombre: 'Nequi', saldo: 200_000, actualizado_en: '2026-10-05T15:00:00Z' }),
    ];
    const movimientos = [
      gasto('2026-10-10', 70_000, 'EXITO'),                          // Bancolombia (actualizada el 14): ya incluido
      gasto('2026-10-10', 30_000, 'TIENDA', { banco: 'nequi' }),     // Nequi (actualizada el 5): se resta
    ];
    const m = calcularMetricas(inst({ movimientos, cuentas }));
    expect(m.base_hoy.saldo_liquido).toBe(1_170_000);
    expect(m.base_hoy.saldo_antiguo_dias).toBe(10);
    expect(m.base_hoy.saldo_antiguo_cuenta).toBe('Nequi');
  });
});

describe('el menor de los dos', () => {
  it('con mucho saldo manda el ingreso', () => {
    const m = calcularMetricas(escenarioCanonico({ cuentas: [cuenta({ saldo: 10_000_000 })] }));
    expect(m.base_hoy.limita).toBe('ingreso');
    expect(m.limite_hoy).toBe(59_117);
    expect(m.restante_mes).toBe(975_000);
    expect(m.base_hoy.limite_saldo).toBeGreaterThan(59_117);
  });

  it('con poco saldo mandan las cuentas (verificado a mano)', () => {
    // Saldo 725.000 anotado a las 11:30 (ya sin el gasto de 30.000 de las 11:00). Inicio del día: 755.000.
    // P (Netflix el 20) = 45.000; arriendo (día 5) ya pasó; sin ingresos este mes → ahorro 0; sin deudas.
    // disponible = 755.000 − 45.000 = 710.000 → ⌊710.000 ÷ 17⌋ = 41.764; libre = 41.764 − 30.000 = 11.764.
    const m = calcularMetricas(escenarioCanonico({ cuentas: [cuenta({ saldo: 725_000, actualizado_en: '2026-10-15T16:30:00Z' })] }));
    expect(m.base_hoy).toMatchObject({
      limita: 'saldo', saldo_liquido: 725_000, saldo_inicio_hoy: 755_000, comprometido: 45_000, ahorro_pendiente: 0,
      minimos_pendientes: 0, disponible_saldo: 710_000, limite_saldo: 41_764, limite_ingreso: 59_117,
    });
    expect(m.limite_hoy).toBe(41_764);
    expect(m.libre_hoy).toBe(11_764);
    expect(m.restante_mes).toBe(680_000);     // min(975.000, 710.000 − 30.000)
  });

  it('un presupuesto total sin ingreso también compite con el saldo', () => {
    const m = calcularMetricas(inst({ presupuestos: [{ mes: '*', categoria_id: '*', monto: 900_000 }], cuentas: [cuenta({ saldo: 10_000_000 })] }));
    expect(m.base_hoy.limita).toBe('ingreso');
    expect(m.limite_hoy).toBe(Math.floor(900_000 / 17));
  });

  it('el ingreso configurado con fijos que se lo comen sigue siendo rojo aunque haya saldo', () => {
    const m = calcularMetricas(inst({ config: config({ ingreso_mensual: 1_000_000 }), fijos: [fijo({ monto: 1_200_000, dia_mes: 5 })], cuentas: [cuenta({ saldo: 5_000_000 })] }));
    expect(m.limite_hoy).toBe(0);
    expect(m.base_hoy.limita).toBe('ingreso');
    expect(m.semaforo).toBe('rojo');
  });
});
