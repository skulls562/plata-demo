// Reglas de saldos y deudas (R26–R30) sobre el escenario canónico: ingreso 4M, ahorro 10 %, fijos 1,5M,
// hoy = 2026-10-15 (Bogotá). Datos sintéticos.
import { describe, expect, it } from 'vitest';
import { config, escenarioCanonico } from '../../tests/fixtures/constructores';
import { cuotaParaMeses, simularSoloMinimo } from './deudas';
import { calcularMetricas } from './metricas';
import { evaluarReglas, reglasDeudas } from './recomendar';
import type { Cuenta, Deuda, Instantanea, Recomendacion, ReglaId } from './tipos';

const deuda = (over: Partial<Deuda> = {}): Deuda => ({
  id: 1, nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 0, pago_minimo: 100_000, dia_pago: null,
  activa: true, creado_en: '2026-10-01T00:00:00Z', actualizado_en: '2026-10-01T00:00:00Z', ...over,
});
const cuenta = (over: Partial<Cuenta> = {}): Cuenta => ({
  id: 1, nombre: 'Nequi', tipo: 'banco', saldo: 5_000_000, creado_en: '2026-10-01T00:00:00Z', actualizado_en: '2026-10-01T00:00:00Z', ...over,
});

const evaluar = (over: Partial<Instantanea>) => {
  const i = escenarioCanonico(over);
  const m = calcularMetricas(i);
  return { i, m, recs: evaluarReglas(i, m), propias: reglasDeudas(i, m) };
};
const de = (rs: Recomendacion[], regla: ReglaId) => rs.filter((r) => r.regla === regla);
const NUEVAS: ReglaId[] = ['minimos_vs_ingreso', 'vencimiento_deuda', 'plan_deudas', 'solo_minimo', 'colchon_bajo'];

describe('métricas: saldos', () => {
  it('sin cuentas ni deudas: ceros y colchón null; ninguna regla nueva', () => {
    const { m, recs } = evaluar({});
    expect(m.saldos).toMatchObject({ hay_cuentas: false, hay_deudas: false, saldo_total: 0, deuda_total: 0, minimos_mes: 0, colchon_dias: null, proximo_vencimiento: null });
    expect(m.saldos.gasto_diario).toBe(Math.round(m.ritmo_diario + 1_500_000 / 31));
    expect(recs.filter((r) => NUEVAS.includes(r.regla))).toEqual([]);
  });

  it('expone saldo_total, deuda_total, mínimos, próximo vencimiento y colchón', () => {
    const { m } = evaluar({
      cuentas: [cuenta({ saldo: 3_000_000 }), cuenta({ id: 2, nombre: 'Efectivo', tipo: 'efectivo', saldo: 200_000 })],
      deudas: [deuda({ saldo: 2_000_000, pago_minimo: 150_000, dia_pago: 31 }), deuda({ id: 2, nombre: 'Moto', tipo: 'prestamo', saldo: 5_000_000, pago_minimo: 400_000, dia_pago: 20 })],
    });
    const g = Math.round(m.ritmo_diario + (1_500_000 + 550_000) / 31);
    expect(m.saldos).toMatchObject({
      hay_cuentas: true, hay_deudas: true, saldo_total: 3_200_000, deuda_total: 7_000_000, patrimonio_neto: -3_800_000,
      minimos_mes: 550_000, gasto_diario: g, colchon_dias: Math.floor(3_200_000 / g),
    });
    expect(m.saldos.proximo_vencimiento).toEqual({ deuda_id: 2, nombre: 'Moto', fecha: '2026-10-20', dias: 5, pago_minimo: 400_000 });
  });
});

describe('R27 vencimiento_deuda', () => {
  it('avisa 3 días antes, no 5', () => {
    const { propias } = evaluar({ deudas: [deuda({ id: 1, dia_pago: 18 }), deuda({ id: 2, nombre: 'Moto', dia_pago: 20 })] });
    const v = de(propias, 'vencimiento_deuda');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: 'vencimiento_deuda:1:2026-10-18', severidad: 'aviso', titulo: 'Tarjeta vence el 18 oct', cifras: { pago_minimo: 100_000, dias: 3 } });
    expect(v[0].detalle_con_cifras).toContain('$100.000');
    expect(v[0].detalle_con_cifras).toContain('en 3 días');
  });

  it('hoy vence → alerta; mañana → «Mañana vence»', () => {
    const hoy = de(evaluar({ deudas: [deuda({ dia_pago: 15 })] }).propias, 'vencimiento_deuda')[0];
    expect(hoy).toMatchObject({ titulo: 'Hoy vence Tarjeta', severidad: 'alerta' });
    const manana = de(evaluar({ deudas: [deuda({ dia_pago: 16 })] }).propias, 'vencimiento_deuda')[0];
    expect(manana).toMatchObject({ titulo: 'Mañana vence Tarjeta', severidad: 'aviso' });
  });

  it('si las cuentas no alcanzan para el mínimo → alerta con la cifra', () => {
    const r = de(evaluar({ cuentas: [cuenta({ saldo: 60_000 })], deudas: [deuda({ dia_pago: 17 })] }).recs, 'vencimiento_deuda')[0];
    expect(r.severidad).toBe('alerta');
    expect(r.detalle_con_cifras).toContain('tienes $60.000, no te alcanza');
    expect(r.cifras.saldo_cuentas).toBe(60_000);
  });

  it('no se degrada con base estimada', () => {
    const { recs } = evaluar({ config: config({ ingreso_mensual: null }), deudas: [deuda({ dia_pago: 15 })] });
    expect(de(recs, 'vencimiento_deuda')[0].severidad).toBe('alerta');
  });
});

describe('R26 minimos_vs_ingreso', () => {
  it('menos del 20 % y caben: nada', () => {
    expect(de(evaluar({ deudas: [deuda({ pago_minimo: 300_000 })] }).propias, 'minimos_vs_ingreso')).toEqual([]);
  });

  it('22,5 % → aviso con el porqué en números', () => {
    const r = de(evaluar({ deudas: [deuda({ saldo: 9_000_000, pago_minimo: 900_000 })] }).propias, 'minimos_vs_ingreso')[0];
    expect(r).toMatchObject({ severidad: 'aviso', cifras: { minimos: 900_000, ingreso: 4_000_000, pct: 23, libre: 2_100_000 } });
    expect(r.detalle_con_cifras).toBe(
      'Tus pagos mínimos suman $900.000 al mes: el 23% de tu ingreso ($4.000.000). Después de fijos ($1.500.000) y ahorro ($400.000) ' +
      'te quedan $2.100.000; los mínimos se llevan el 43%. Por encima del 20 % las deudas empiezan a apretar; mejor no sacar crédito nuevo.',
    );
  });

  it('≥ 35 % o más que lo libre → alerta «no te caben»', () => {
    const r = de(evaluar({ deudas: [deuda({ saldo: 30_000_000, pago_minimo: 2_200_000 })] }).propias, 'minimos_vs_ingreso')[0];
    expect(r).toMatchObject({ severidad: 'alerta', titulo: 'Los mínimos no te caben' });
  });
});

describe('R30 colchon_bajo', () => {
  it('sin cuentas registradas no opina', () => {
    expect(de(evaluar({ deudas: [deuda()] }).propias, 'colchon_bajo')).toEqual([]);
  });

  it('pocos días → alerta con saldo, gasto diario y días', () => {
    const { m, propias } = evaluar({ cuentas: [cuenta({ saldo: 500_000 })] });
    const r = de(propias, 'colchon_bajo')[0];
    const dias = Math.floor(500_000 / m.saldos.gasto_diario);
    expect(dias).toBeLessThan(10);
    expect(r).toMatchObject({ severidad: 'alerta', titulo: `Tu plata alcanza para ${dias} días`, cifras: { saldo: 500_000, dias } });
  });

  it('entre 10 y 29 días → aviso; 30 o más → nada', () => {
    const { m } = evaluar({ cuentas: [cuenta({ saldo: 1 })] });
    const g = m.saldos.gasto_diario;
    expect(de(evaluar({ cuentas: [cuenta({ saldo: g * 15 })] }).propias, 'colchon_bajo')[0].severidad).toBe('aviso');
    expect(de(evaluar({ cuentas: [cuenta({ saldo: g * 30 })] }).propias, 'colchon_bajo')).toEqual([]);
  });
});

describe('R29 solo_minimo', () => {
  it('tasa 0: no opina', () => {
    expect(de(evaluar({ deudas: [deuda({ tasa_ea: 0 })] }).propias, 'solo_minimo')).toEqual([]);
  });

  it('mínimo menor que el interés: alerta «nunca pagas» con la cuota para 12 meses', () => {
    const d = deuda({ saldo: 10_000_000, tasa_ea: 30, pago_minimo: 200_000 });
    const r = de(evaluar({ deudas: [d] }).propias, 'solo_minimo')[0];
    expect(r).toMatchObject({ severidad: 'alerta', titulo: 'Con el mínimo nunca pagas Tarjeta' });
    expect(r.detalle_con_cifras).toContain('no baja');
    expect(r.detalle_con_cifras).toContain(`$${cuotaParaMeses(10_000_000, 30, 12).toLocaleString('de-DE')}`);
  });

  it('«solo pagando el mínimo tardas X meses y pagas $Y de intereses»', () => {
    const d = deuda({ saldo: 2_000_000, tasa_ea: 30, pago_minimo: 100_000 });
    const sm = simularSoloMinimo(d);
    const r = de(evaluar({ deudas: [d] }).propias, 'solo_minimo')[0];
    expect(r.detalle_con_cifras).toContain(`Solo pagando el mínimo ($100.000) tardas ${sm.meses} meses`);
    expect(r.detalle_con_cifras).toContain(`pagas $${sm.intereses!.toLocaleString('de-DE')} de intereses`);
    expect(r.cifras).toMatchObject({ meses: sm.meses, intereses: sm.intereses });
  });

  it('se paga en menos de 12 meses: nada', () => {
    expect(de(evaluar({ deudas: [deuda({ saldo: 500_000, tasa_ea: 30, pago_minimo: 100_000 })] }).propias, 'solo_minimo')).toEqual([]);
  });
});

describe('R28 plan_deudas', () => {
  const tarjeta = deuda({ id: 1, nombre: 'Tarjeta', saldo: 2_000_000, tasa_ea: 30, pago_minimo: 100_000 });
  const prestamo = deuda({ id: 2, nombre: 'Préstamo', tipo: 'prestamo', saldo: 500_000, tasa_ea: 15, pago_minimo: 50_000 });

  it('una sola deuda sin pago mensual configurado: no hay plan que comparar', () => {
    expect(de(evaluar({ deudas: [tarjeta] }).propias, 'plan_deudas')).toEqual([]);
  });

  it('avalancha: la de mayor tasa primero, con meses e intereses y la comparación', () => {
    const r = de(evaluar({ deudas: [tarjeta, prestamo], config: config({ ingreso_mensual: 4_000_000, pago_deudas_mensual: 300_000 }) }).propias, 'plan_deudas')[0];
    expect(r.titulo).toBe('Paga primero Tarjeta');
    expect(r.detalle_con_cifras).toMatch(/^Es la de mayor tasa \(30 % E\.A\.\)/);
    expect(r.detalle_con_cifras).toContain('Con $300.000 al mes');
    expect(r.detalle_con_cifras).toContain('Con bola de nieve (la más pequeña primero) serían');
    expect(r.cifras.intereses_otra).toBeGreaterThan(r.cifras.intereses);
    expect(r.push).toBe(false);
  });

  it('bola de nieve si Jero la eligió', () => {
    const cfg = config({ ingreso_mensual: 4_000_000, estrategia_deudas: 'bola_nieve', pago_deudas_mensual: 300_000 });
    const r = de(evaluar({ deudas: [tarjeta, prestamo], config: cfg }).propias, 'plan_deudas')[0];
    expect(r.titulo).toBe('Paga primero Préstamo');
    expect(r.detalle_con_cifras).toContain('Es la más pequeña ($500.000)');
    expect(r.detalle_con_cifras).toMatch(/\(\$[\d.]+ menos\)\.$/);   // avalancha saldría más barata
  });

  it('solo con los mínimos las dos estrategias empatan: lo dice', () => {
    const cfg = config({ ingreso_mensual: 4_000_000, estrategia_deudas: 'bola_nieve' });
    const r = de(evaluar({ deudas: [tarjeta, prestamo], config: cfg }).propias, 'plan_deudas')[0];
    expect(r.detalle_con_cifras).toMatch(/\(lo mismo\)\.$/);
    expect(r.detalle_con_cifras).toContain('Con $150.000 al mes');
  });

  it('pago que no alcanza ni para los intereses', () => {
    const grande = deuda({ id: 3, nombre: 'Crédito', saldo: 20_000_000, tasa_ea: 40, pago_minimo: 100_000 });
    const r = de(evaluar({ deudas: [grande, prestamo] }).propias, 'plan_deudas')[0];
    expect(r).toMatchObject({ titulo: 'Con este pago no sales de deudas', severidad: 'aviso' });
    expect(r.detalle_con_cifras).toContain('renegocia Crédito (40 % E.A.)');
  });
});
