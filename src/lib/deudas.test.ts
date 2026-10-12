import { describe, expect, it } from 'vitest';
import {
  colchonDias, compararPlanes, cuotaParaMeses, fechaDePago, gastoDiarioTotal, interesDelMes, mesesLegible, minimosMes,
  ordenarDeudas, proximoVencimiento, resumenSaldos, simularPlan, simularSoloMinimo, tasaEADesdeMensual, tasaLegible,
  tasaMensual, TOPE_MESES, vencimientos,
} from './deudas';
import type { Cuenta, Deuda } from './tipos';

// Datos sintéticos.
const deuda = (over: Partial<Deuda> = {}): Deuda => ({
  id: 1, nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 1_000_000, tasa_ea: 0, pago_minimo: 100_000, dia_pago: null,
  activa: true, creado_en: '2026-10-01T00:00:00Z', actualizado_en: '2026-10-01T00:00:00Z', ...over,
});
const cuenta = (over: Partial<Cuenta> = {}): Cuenta => ({
  id: 1, nombre: 'Nequi', tipo: 'banco', saldo: 500_000, creado_en: '2026-10-01T00:00:00Z', actualizado_en: '2026-10-01T00:00:00Z', ...over,
});

describe('tasas', () => {
  it('E.A. → mensual equivalente y de vuelta', () => {
    expect(tasaEADesdeMensual(2)).toBe(26.82);
    expect(tasaMensual(26.82)).toBeCloseTo(0.02, 4);
    expect(tasaMensual(0)).toBe(0);
    expect(tasaMensual(-5)).toBe(0);
    expect(tasaMensual(Number.NaN)).toBe(0);
    expect(tasaEADesdeMensual(0)).toBe(0);
  });

  it('interés del mes redondeado al peso', () => {
    expect(interesDelMes(1_000_000, 0.02)).toBe(20_000);
    expect(interesDelMes(333, 0.02)).toBe(7);
    expect(interesDelMes(0, 0.02)).toBe(0);
    expect(interesDelMes(1_000_000, 0)).toBe(0);
  });

  it('cuota para salir en N meses', () => {
    expect(cuotaParaMeses(1_200_000, 0, 12)).toBe(100_000);
    expect(cuotaParaMeses(0, 30, 12)).toBe(0);
    // Con esa cuota fija, la deuda se acaba justo en 12 meses.
    const c = cuotaParaMeses(2_000_000, 30, 12);
    const sm = simularSoloMinimo(deuda({ saldo: 2_000_000, tasa_ea: 30, pago_minimo: c }));
    expect(sm.se_paga).toBe(true);
    expect(sm.meses).toBe(12);
  });

  it('textos', () => {
    expect(mesesLegible(1)).toBe('1 mes');
    expect(mesesLegible(8)).toBe('8 meses');
    expect(mesesLegible(12)).toBe('1 año');
    expect(mesesLegible(14)).toBe('1 año y 2 meses');
    expect(mesesLegible(25)).toBe('2 años y 1 mes');
    expect(tasaLegible(28.5)).toBe('28,5 %');
    expect(tasaLegible(30)).toBe('30 %');
  });
});

describe('fechas de pago', () => {
  it('día 31 en meses cortos: último día del mes', () => {
    expect(fechaDePago(31, '2026-02-10')).toBe('2026-02-28');
    expect(fechaDePago(31, '2028-02-10')).toBe('2028-02-29');   // bisiesto
    expect(fechaDePago(31, '2026-04-15')).toBe('2026-04-30');
    expect(fechaDePago(30, '2026-02-28')).toBe('2026-02-28');   // hoy mismo
  });

  it('si ya pasó este mes, el del mes siguiente (también recortado)', () => {
    expect(fechaDePago(15, '2026-10-16')).toBe('2026-11-15');
    expect(fechaDePago(31, '2026-01-31')).toBe('2026-01-31');
    expect(fechaDePago(30, '2026-01-31')).toBe('2026-02-28');
    expect(fechaDePago(5, '2026-12-20')).toBe('2027-01-05');
  });

  it('vencimientos: solo activas, con saldo, día y mínimo; en orden de fecha', () => {
    const ds = [
      deuda({ id: 1, nombre: 'A', dia_pago: 20 }),
      deuda({ id: 2, nombre: 'B', dia_pago: 16 }),
      deuda({ id: 3, nombre: 'C', dia_pago: 17, activa: false }),
      deuda({ id: 4, nombre: 'D', dia_pago: 17, saldo: 0 }),
      deuda({ id: 5, nombre: 'E', dia_pago: null }),
      deuda({ id: 6, nombre: 'F', dia_pago: 10 }),                       // pasó: noviembre
      deuda({ id: 7, nombre: 'G', dia_pago: 18, pago_minimo: 0 }),
    ];
    const v = vencimientos(ds, '2026-10-15');
    expect(v.map((x) => x.nombre)).toEqual(['B', 'A', 'F']);
    expect(v[0]).toEqual({ deuda_id: 2, nombre: 'B', fecha: '2026-10-16', dias: 1, pago_minimo: 100_000 });
    expect(v[2].fecha).toBe('2026-11-10');
    expect(proximoVencimiento(ds, '2026-10-15')?.deuda_id).toBe(2);
    expect(proximoVencimiento([], '2026-10-15')).toBeNull();
  });

  it('el mínimo efectivo nunca pasa del saldo', () => {
    expect(minimosMes([deuda({ saldo: 30_000, pago_minimo: 100_000 }), deuda({ id: 2, pago_minimo: 50_000 })])).toBe(80_000);
    expect(vencimientos([deuda({ saldo: 30_000, dia_pago: 20 })], '2026-10-15')[0].pago_minimo).toBe(30_000);
  });
});

describe('solo el mínimo', () => {
  it('tasa 0: meses = saldo ÷ mínimo, sin intereses', () => {
    expect(simularSoloMinimo(deuda({ saldo: 1_000_000, tasa_ea: 0, pago_minimo: 100_000 }))).toMatchObject({
      se_paga: true, meses: 10, intereses: 0, total_pagado: 1_000_000, interes_primer_mes: 0,
    });
    expect(simularSoloMinimo(deuda({ saldo: 1_050_000, tasa_ea: 0, pago_minimo: 100_000 })).meses).toBe(11);
  });

  it('tasa 0 y mínimo 0: no se paga (sin bucle)', () => {
    expect(simularSoloMinimo(deuda({ tasa_ea: 0, pago_minimo: 0 }))).toMatchObject({ se_paga: false, meses: null, intereses: null });
  });

  it('con interés: coincide con la fórmula cerrada y total = saldo + intereses', () => {
    const tasa = tasaEADesdeMensual(2);          // ≈ 2 % mensual
    const sm = simularSoloMinimo(deuda({ saldo: 1_000_000, tasa_ea: tasa, pago_minimo: 100_000 }));
    const r = tasaMensual(tasa);
    const nExacto = -Math.log(1 - (r * 1_000_000) / 100_000) / Math.log(1 + r);   // ≈ 11,27
    expect(sm.se_paga).toBe(true);
    expect(sm.meses).toBe(Math.ceil(nExacto));
    expect(sm.total_pagado).toBe(1_000_000 + (sm.intereses as number));
    expect(Math.abs((sm.intereses as number) - (nExacto * 100_000 - 1_000_000))).toBeLessThan(2_000);
    expect(sm.interes_primer_mes).toBe(Math.round(1_000_000 * r));
  });

  it('mínimo menor o igual que el interés del mes: «no se paga» sin simular', () => {
    const r = tasaMensual(30);
    const i1 = Math.round(10_000_000 * r);
    const menor = simularSoloMinimo(deuda({ saldo: 10_000_000, tasa_ea: 30, pago_minimo: 200_000 }));
    expect(menor).toMatchObject({ se_paga: false, meses: null, intereses: null, total_pagado: null, interes_primer_mes: i1 });
    expect(simularSoloMinimo(deuda({ saldo: 10_000_000, tasa_ea: 30, pago_minimo: i1 })).se_paga).toBe(false);
  });

  it('mínimo apenas mayor que el interés: corta en el tope de 50 años', () => {
    const r = tasaMensual(30);
    const i1 = interesDelMes(100_000_000, r);
    const t0 = Date.now();
    const sm = simularSoloMinimo(deuda({ saldo: 100_000_000, tasa_ea: 30, pago_minimo: i1 + 1 }));
    expect(sm.se_paga).toBe(false);
    expect(sm.meses).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(TOPE_MESES).toBe(600);
  });

  it('saldo 0: ya está paga', () => {
    expect(simularSoloMinimo(deuda({ saldo: 0, tasa_ea: 30 }))).toMatchObject({ se_paga: true, meses: 0, intereses: 0 });
  });
});

describe('plan avalancha / bola de nieve', () => {
  const tarjeta = deuda({ id: 1, nombre: 'Tarjeta', saldo: 2_000_000, tasa_ea: 30, pago_minimo: 100_000 });
  const prestamo = deuda({ id: 2, nombre: 'Préstamo', saldo: 500_000, tasa_ea: 15, pago_minimo: 50_000 });

  it('orden de ataque', () => {
    expect(ordenarDeudas([prestamo, tarjeta], 'avalancha').map((d) => d.id)).toEqual([1, 2]);
    expect(ordenarDeudas([tarjeta, prestamo], 'bola_nieve').map((d) => d.id)).toEqual([2, 1]);
    const empate = [deuda({ id: 3, saldo: 100, tasa_ea: 20 }), deuda({ id: 2, saldo: 100, tasa_ea: 20 })];
    expect(ordenarDeudas(empate, 'avalancha').map((d) => d.id)).toEqual([2, 3]);
  });

  it('sin deudas: plan vacío y pagado', () => {
    expect(simularPlan([], null, 'avalancha')).toEqual({ estrategia: 'avalancha', pago_mensual: 0, se_paga: true, meses: 0, intereses: 0, orden: [] });
    const c = compararPlanes([], 500_000);
    expect(c.ahorro_intereses).toBe(0);
    expect(c.recomendada).toBe('avalancha');
  });

  it('tasa 0, una deuda: meses = saldo ÷ pago', () => {
    const p = simularPlan([deuda({ saldo: 1_000_000, pago_minimo: 100_000 })], 250_000, 'avalancha');
    expect(p).toMatchObject({ se_paga: true, meses: 4, intereses: 0, pago_mensual: 250_000 });
    expect(p.orden).toEqual([{ deuda_id: 1, nombre: 'Tarjeta', mes_pagada: 4 }]);
  });

  it('un pago menor que la suma de mínimos se sube a esa suma', () => {
    expect(simularPlan([tarjeta, prestamo], 10, 'avalancha').pago_mensual).toBe(150_000);
    expect(simularPlan([tarjeta, prestamo], null, 'avalancha').pago_mensual).toBe(150_000);
  });

  it('avalancha paga menos intereses; bola de nieve salda primero la pequeña', () => {
    const c = compararPlanes([tarjeta, prestamo], 300_000);
    expect(c.avalancha.se_paga && c.bola_nieve.se_paga).toBe(true);
    expect(c.avalancha.intereses!).toBeLessThan(c.bola_nieve.intereses!);
    expect(c.recomendada).toBe('avalancha');
    expect(c.ahorro_intereses).toBe(c.bola_nieve.intereses! - c.avalancha.intereses!);
    expect(c.ahorro_intereses!).toBeGreaterThan(0);
    const bn = c.bola_nieve.orden;
    expect(bn[0].deuda_id).toBe(2);
    expect(bn[0].mes_pagada!).toBeLessThan(bn[1].mes_pagada!);
    // Más pago → menos meses y menos intereses.
    const mas = simularPlan([tarjeta, prestamo], 600_000, 'avalancha');
    expect(mas.meses!).toBeLessThan(c.avalancha.meses!);
    expect(mas.intereses!).toBeLessThan(c.avalancha.intereses!);
  });

  it('el mínimo de una deuda saldada pasa a la siguiente (bola de nieve)', () => {
    // Solo mínimos: sin rodar el pago, la tarjeta tardaría 26 meses; con el pago del préstamo encima, menos.
    const soloTarjeta = simularSoloMinimo(tarjeta).meses!;
    const plan = simularPlan([tarjeta, prestamo], null, 'bola_nieve');
    expect(plan.orden.find((o) => o.deuda_id === 1)!.mes_pagada!).toBeLessThan(soloTarjeta);
  });

  it('pago que no cubre intereses: «no se paga», sin bucle infinito', () => {
    const grande = deuda({ id: 9, nombre: 'Grande', saldo: 10_000_000, tasa_ea: 30, pago_minimo: 100_000 });
    const p = simularPlan([grande], null, 'avalancha');
    expect(p).toMatchObject({ se_paga: false, meses: null, intereses: null });
    expect(p.orden[0].mes_pagada).toBeNull();
    const c = compararPlanes([grande, prestamo], null);
    expect(c.ahorro_intereses).toBeNull();
  });

  it('ignora deudas archivadas o en cero', () => {
    const p = simularPlan([tarjeta, deuda({ id: 5, activa: false }), deuda({ id: 6, saldo: 0 })], 300_000, 'avalancha');
    expect(p.orden.map((o) => o.deuda_id)).toEqual([1]);
  });
});

describe('resumen y colchón', () => {
  it('gasto diario total y colchón', () => {
    expect(gastoDiarioTotal(50_000, 1_500_000, 300_000, 30)).toBe(110_000);
    expect(gastoDiarioTotal(0, 0, 0, 30)).toBe(0);
    expect(colchonDias(1_000_000, 50_000)).toBe(20);
    expect(colchonDias(1_000_000, 0)).toBeNull();
    expect(colchonDias(0, 50_000)).toBe(0);
  });

  it('sin cuentas ni deudas', () => {
    expect(resumenSaldos([], [], '2026-10-15', 80_000)).toEqual({
      hay_cuentas: false, hay_deudas: false, saldo_total: 0, deuda_total: 0, patrimonio_neto: 0, minimos_mes: 0,
      proximo_vencimiento: null, gasto_diario: 80_000, colchon_dias: null,
    });
  });

  it('con cuentas y deudas', () => {
    const r = resumenSaldos(
      [cuenta({ saldo: 700_000 }), cuenta({ id: 2, nombre: 'Efectivo', tipo: 'efectivo', saldo: 100_000 })],
      [deuda({ saldo: 2_000_000, pago_minimo: 120_000, dia_pago: 31 }), deuda({ id: 2, saldo: 900_000, activa: false })],
      '2026-11-20', 100_000,
    );
    expect(r).toMatchObject({
      hay_cuentas: true, hay_deudas: true, saldo_total: 800_000, deuda_total: 2_000_000, patrimonio_neto: -1_200_000,
      minimos_mes: 120_000, colchon_dias: 8,
    });
    expect(r.proximo_vencimiento).toEqual({ deuda_id: 1, nombre: 'Tarjeta', fecha: '2026-11-30', dias: 10, pago_minimo: 120_000 });
  });
});
