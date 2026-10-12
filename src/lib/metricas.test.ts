import { describe, expect, it, beforeEach } from 'vitest';
import {
  calcularDiasCerrados, calcularHormiga, calcularMetricas, calcularNocturnas, calcularRacha, calcularRitmo, calcularScore,
  calcularSemaforo, comprometidoPendiente, detectarAnomalias, esGastoVariable, esNocturna, excesoFijos, gastoVariableNeto,
  resolverBaseMensual, resumenPeriodo, umbralAtipico,
} from './metricas';
import type { Movimiento } from './tipos';
import { AHORA_CANONICO, config, escenarioCanonico, fijo, gasto, gastosDiarios, inst, mov, recurrente, reiniciarIds } from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

describe('ejemplo canónico (SPEC §3.5)', () => {
  it('reproduce todas las cifras del SPEC', () => {
    const m = calcularMetricas(escenarioCanonico());
    expect(m.fecha).toBe('2026-10-15');
    expect(m.hora).toBe('12:00');
    expect(m.dias_mes).toBe(31);
    expect(m.dia).toBe(15);
    expect(m.dias_restantes).toBe(17);
    expect(m.base.modo).toBe('ingreso_configurado');
    expect(m.base.ahorro).toBe(400_000);
    expect(m.base.disponible_variable).toBe(2_100_000);
    expect(m.gastado_mes).toBe(1_080_000);
    expect(m.gastado_hoy).toBe(30_000);
    expect(m.comprometido_pendiente).toBe(45_000);
    expect(m.limite_hoy).toBe(59_117);
    expect(m.libre_hoy).toBe(29_117);
    expect(m.restante_mes).toBe(975_000);
    expect(m.ritmo_diario).toBe(75_500);
    expect(m.proyeccion_fin_mes).toBe(2_378_500);
    expect(m.proyeccion_ratio).toBeCloseTo(1.1326, 4);
    expect(m.semaforo).toBe('rojo');
  });

  it('el componente ritmo del score vale 6,74 puntos', () => {
    const m = calcularMetricas(escenarioCanonico());
    const ritmo = m.score.componentes.find((c) => c.id === 'ritmo')!;
    expect(ritmo.peso).toBe(30);
    expect(ritmo.puntos!).toBeCloseTo(6.74, 2);
    expect(m.score.valor).not.toBeNull();
  });
});

describe('esGastoVariable / gastoVariableNeto', () => {
  it('excluye ligados a fijos, no computables y entradas', () => {
    expect(esGastoVariable(mov())).toBe(true);
    expect(esGastoVariable(mov({ fijo_id: 3 }))).toBe(false);
    expect(esGastoVariable(mov({ computa: false }))).toBe(false);
    expect(esGastoVariable(mov({ tipo: 'ingreso' }))).toBe(false);
  });

  it('un reverso resta; pago_tarjeta e interno quedan fuera', () => {
    const movs = [
      gasto('2026-10-10', 100_000),
      mov({ fecha: '2026-10-11', tipo: 'reverso', monto: 30_000 }),
      mov({ fecha: '2026-10-12', tipo: 'pago_tarjeta', monto: 500_000 }),
      mov({ fecha: '2026-10-12', tipo: 'interno', monto: 700_000 }),
      mov({ fecha: '2026-10-13', tipo: 'retiro', monto: 50_000 }),
    ];
    expect(gastoVariableNeto(movs, '2026-10-01', '2026-10-31')).toBe(120_000);
  });
});

describe('resolverBaseMensual', () => {
  it('presupuesto mayor que lo que deja el ingreso: usa I−F−A y avisa', () => {
    const i = escenarioCanonico({ presupuestos: [{ mes: '*', categoria_id: '*', monto: 3_000_000 }] });
    const b = resolverBaseMensual(i, '2026-10-15');
    expect(b.modo).toBe('presupuesto_total');
    expect(b.disponible_variable).toBe(2_100_000);
    expect(b.aviso_modo).toContain('presupuesto');
  });

  it('presupuesto del mes manda sobre el de «siempre»', () => {
    const i = escenarioCanonico({ presupuestos: [{ mes: '*', categoria_id: '*', monto: 1_000_000 }, { mes: '2026-10', categoria_id: '*', monto: 1_500_000 }] });
    expect(resolverBaseMensual(i, '2026-10-15').disponible_variable).toBe(1_500_000);
  });

  it('presupuesto sin ingreso conocido: Vmes = presupuesto', () => {
    const i = inst({ presupuestos: [{ mes: '*', categoria_id: '*', monto: 900_000 }] });
    const b = resolverBaseMensual(i, '2026-10-15');
    expect(b.modo).toBe('presupuesto_total');
    expect(b.disponible_variable).toBe(900_000);
  });

  it('ingreso estimado con 1 mes de historia', () => {
    const movs = [...gastosDiarios('2026-09-01', '2026-09-12', 20_000), mov({ fecha: '2026-09-05', tipo: 'ingreso', monto: 3_000_000 })];
    const i = inst({ movimientos: movs });
    const b = resolverBaseMensual(i, '2026-10-15');
    expect(b.modo).toBe('ingreso_estimado');
    expect(b.meses_referencia).toEqual(['2026-09']);
    expect(b.ingreso).toBe(3_000_000);
    expect(b.disponible_variable).toBe(2_700_000);
    expect(b.aviso_modo).toContain('1 mes');
  });

  it('ingreso estimado con 3 meses: promedio', () => {
    const movs = [
      ...gastosDiarios('2026-07-01', '2026-07-10', 1_000), mov({ fecha: '2026-07-02', tipo: 'ingreso', monto: 3_000_000 }),
      ...gastosDiarios('2026-08-01', '2026-08-10', 1_000), mov({ fecha: '2026-08-02', tipo: 'ingreso', monto: 3_600_000 }),
      ...gastosDiarios('2026-09-01', '2026-09-10', 1_000), mov({ fecha: '2026-09-02', tipo: 'ingreso', monto: 4_200_000 }),
    ];
    const b = resolverBaseMensual(inst({ movimientos: movs }), '2026-10-15');
    expect(b.meses_referencia).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(b.ingreso).toBe(3_600_000);
    expect(b.aviso_modo).toContain('3 meses');
  });

  it('gasto histórico cuando no hay ingresos', () => {
    const movs = gastosDiarios('2026-09-01', '2026-09-30', 50_000);
    const b = resolverBaseMensual(inst({ movimientos: movs, fijos: [fijo()] }), '2026-10-15');
    expect(b.modo).toBe('gasto_historico');
    expect(b.disponible_variable).toBe(1_500_000);
    expect(b.ahorro).toBe(0);
  });

  it('sin datos', () => {
    const b = resolverBaseMensual(inst(), '2026-10-15');
    expect(b.modo).toBe('sin_datos');
    expect(b.disponible_variable).toBeNull();
    expect(b.aviso_modo).toContain('Mi ingreso');
  });

  it('fijos + ahorro mayores que el ingreso → Vmes ≤ 0 y semáforo rojo', () => {
    const i = inst({ config: config({ ingreso_mensual: 1_000_000 }), fijos: [fijo({ monto: 1_200_000 })] });
    const m = calcularMetricas(i);
    expect(m.base.disponible_variable!).toBeLessThanOrEqual(0);
    expect(m.semaforo).toBe('rojo');
    expect(m.limite_hoy).toBe(0);
  });

  it('un ingreso recibido mayor que el configurado sube el ingreso', () => {
    const i = escenarioCanonico();
    i.movimientos.push(mov({ fecha: '2026-10-10', tipo: 'ingreso', monto: 5_000_000 }));
    expect(resolverBaseMensual(i, '2026-10-15').ingreso).toBe(5_000_000);
  });
});

describe('excesoFijos y comprometido pendiente', () => {
  it('fijo pagado de más suma el exceso a G', () => {
    const f = fijo({ id: 7, monto: 1_000_000 });
    const movs = [mov({ fecha: '2026-10-05', monto: 1_100_000, fijo_id: 7 }), mov({ fecha: '2026-09-05', monto: 5_000_000, fijo_id: 7 })];
    expect(excesoFijos(movs, [f], '2026-10')).toBe(100_000);
    const pagadoMenos = [mov({ fecha: '2026-10-05', monto: 900_000, fijo_id: 7 })];
    expect(excesoFijos(pagadoMenos, [f], '2026-10')).toBe(0);
  });

  it('el exceso se refleja en gastado_mes', () => {
    const f = fijo({ id: 7, monto: 1_000_000 });
    const i = inst({ config: config({ ingreso_mensual: 4_000_000 }), fijos: [f], movimientos: [mov({ fecha: '2026-10-05', monto: 1_100_000, fijo_id: 7 })] });
    expect(calcularMetricas(i).gastado_mes).toBe(100_000);
  });

  it('suma suscripciones que caen entre hoy y fin de mes y excluye las que ya son un fijo', () => {
    const recs = [
      recurrente({ id: 1, comercio_norm: 'netflix', monto_tipico: 45_000, proximo_cobro: '2026-10-20' }),
      recurrente({ id: 2, comercio_norm: 'spotify', monto_tipico: 20_000, proximo_cobro: '2026-11-02' }),
      recurrente({ id: 3, comercio_norm: 'hbo', monto_tipico: 30_000, proximo_cobro: '2026-10-25', estado: 'descartada' }),
      recurrente({ id: 4, comercio_norm: 'arriendo casa', clase: 'fijo', monto_tipico: 1_000_000, proximo_cobro: '2026-10-28' }),
      recurrente({ id: 5, comercio_norm: 'gym', clase: 'habito', periodo: 'semanal', monto_tipico: 10_000, proximo_cobro: '2026-10-22' }),
      recurrente({ id: 6, comercio_norm: 'viejo', monto_tipico: 9_000, proximo_cobro: '2026-10-18', activa: false }),
    ];
    expect(comprometidoPendiente(recs, [fijo({ patron: 'arriendo' })], '2026-10-15')).toBe(45_000);
  });
});

describe('umbralAtipico y ritmo', () => {
  it('con menos de 10 gastos en 90 días usa el umbral configurado', () => {
    expect(umbralAtipico([gasto('2026-10-10', 1_000_000)], '2026-10-15', config())).toBe(200_000);
  });

  it('con historia usa max(umbral, 3×mediana)', () => {
    const movs = gastosDiarios('2026-10-01', '2026-10-14', 100_000);
    expect(umbralAtipico(movs, '2026-10-15', config())).toBe(300_000);
  });

  it('un atípico no se extrapola en el ritmo', () => {
    const base = escenarioCanonico();
    const sinAtipico = calcularRitmo(base, '2026-10-15', resolverBaseMensual(base, '2026-10-15'));
    const con = escenarioCanonico();
    con.movimientos.push(mov({ fecha: '2026-10-09', monto: 2_000_000, comercio: 'TV GRANDE' }));
    const conAtipico = calcularRitmo(con, '2026-10-15', resolverBaseMensual(con, '2026-10-15'));
    expect(conAtipico.ritmo).toBe(sinAtipico.ritmo);
  });

  it('día 1 sin historial: ritmo base = Vmes / D', () => {
    const i = inst({ ahora: new Date('2026-11-01T17:00:00Z'), config: config({ ingreso_mensual: 3_000_000 }) });
    const b = resolverBaseMensual(i, '2026-11-01');
    const r = calcularRitmo(i, '2026-11-01', b);
    expect(b.disponible_variable).toBe(2_700_000);
    expect(r.ritmo_mes).toBeNull();
    expect(r.ritmo).toBe(2_700_000 / 30);
  });

  it('día 4 mezcla con el ritmo base según n/7', () => {
    const movs = gastosDiarios('2026-11-01', '2026-11-03', 60_000);
    const i = inst({ ahora: new Date('2026-11-04T17:00:00Z'), config: config({ ingreso_mensual: 3_000_000 }), movimientos: movs });
    const b = resolverBaseMensual(i, '2026-11-04');
    const r = calcularRitmo(i, '2026-11-04', b);
    const rb = 2_700_000 / 30;
    expect(r.ritmo).toBeCloseTo((3 / 7) * 60_000 + (4 / 7) * rb, 5);
  });
});

describe('día límite, último día y febrero', () => {
  it('último día: el límite es todo lo que queda', () => {
    const movs = gastosDiarios('2026-10-01', '2026-10-30', 50_000);
    const i = inst({ ahora: new Date('2026-10-31T17:00:00Z'), config: config({ ingreso_mensual: 3_000_000, pct_ahorro: 0 }), movimientos: movs });
    const m = calcularMetricas(i);
    expect(m.dias_restantes).toBe(1);
    expect(m.limite_hoy).toBe(3_000_000 - 1_500_000);
  });

  it('febrero de 2027 tiene 28 días', () => {
    const i = inst({ ahora: new Date('2027-02-10T17:00:00Z'), config: config({ ingreso_mensual: 2_800_000, pct_ahorro: 0 }) });
    const m = calcularMetricas(i);
    expect(m.dias_mes).toBe(28);
    expect(m.dias_restantes).toBe(19);
    expect(m.limite_hoy).toBe(Math.floor(2_800_000 / 19));
  });

  it('gastar hoy no cambia el límite de hoy (se descuenta de hoy)', () => {
    const a = calcularMetricas(escenarioCanonico());
    const i2 = escenarioCanonico();
    i2.movimientos.push(mov({ fecha: '2026-10-15', hora: '12:00', monto: 50_000 }));
    const b = calcularMetricas(i2);
    expect(b.limite_hoy).toBe(a.limite_hoy);
    expect(b.libre_hoy).toBe(a.libre_hoy! - 50_000);
  });
});

describe('calcularSemaforo', () => {
  const base = (modo: 'ingreso_configurado' | 'sin_datos' | 'gasto_historico', v: number | null) =>
    ({ modo, aviso_modo: null, ingreso: 1, ingresos_recibidos: 0, fijos: 0, ahorro: 0, disponible_variable: v, meses_referencia: [] });
  const cfg = config();
  const sem = (limite: number | null, hoy: number, ratio: number | null, modo: 'ingreso_configurado' | 'sin_datos' | 'gasto_historico' = 'ingreso_configurado') =>
    calcularSemaforo({ base: base(modo, 1_000), limite_hoy: limite, gastado_hoy: hoy, proyeccion_ratio: ratio }, cfg).semaforo;

  it('gris sin datos', () => expect(sem(null, 0, null, 'sin_datos')).toBe('gris'));
  it('día: 0.7 verde, 1.0 amarillo, más rojo; límite 0 rojo', () => {
    expect(sem(100, 70, 0.5)).toBe('verde');
    expect(sem(100, 71, 0.5)).toBe('amarillo');
    expect(sem(100, 100, 0.5)).toBe('amarillo');
    expect(sem(100, 101, 0.5)).toBe('rojo');
    expect(sem(0, 0, 0.5)).toBe('rojo');
  });
  it('mes: 0.95 verde, 1.05 amarillo, más rojo', () => {
    expect(sem(100, 0, 0.95)).toBe('verde');
    expect(sem(100, 0, 1.0)).toBe('amarillo');
    expect(sem(100, 0, 1.05)).toBe('amarillo');
    expect(sem(100, 0, 1.06)).toBe('rojo');
  });
  it('gana el peor de los dos', () => {
    expect(sem(100, 50, 1.2)).toBe('rojo');
    expect(sem(100, 120, 0.5)).toBe('rojo');
    expect(sem(100, 80, 0.5)).toBe('amarillo');
  });
  it('con una base ESTIMADA (ingreso estimado o gasto histórico) el rojo se muestra como «estimando»; el amarillo y el verde no cambian', () => {
    for (const modo of ['ingreso_estimado', 'gasto_historico'] as const) {
      const f = (limite: number | null, hoy: number, ratio: number | null, v: number | null = 1_000) =>
        calcularSemaforo({ base: { ...base('gasto_historico', v), modo }, limite_hoy: limite, gastado_hoy: hoy, proyeccion_ratio: ratio }, cfg).semaforo;
      expect(f(100, 0, 1.2)).toBe('estimando');
      expect(f(100, 150, 0.5)).toBe('estimando');
      expect(f(0, 0, 0.5)).toBe('estimando');
      expect(f(100, 0, 0.5, -5)).toBe('estimando');     // fijos + ahorro > ingreso estimado
      expect(f(100, 80, 0.5)).toBe('amarillo');
      expect(f(100, 10, 0.5)).toBe('verde');
    }
    expect(sem(100, 0, 1.2)).toBe('rojo');             // ingreso configurado: sigue siendo rojo de verdad
    expect(calcularSemaforo({ base: { ...base('gasto_historico', 1_000), modo: 'ingreso_estimado' }, limite_hoy: 100, gastado_hoy: 0, proyeccion_ratio: 1.2 }, cfg).razon)
      .toContain('A este ritmo cierras el mes en');
  });
  it('Vmes ≤ 0 es rojo; en histórico la razón habla del gasto usual', () => {
    expect(calcularSemaforo({ base: base('ingreso_configurado', -5), limite_hoy: 0, gastado_hoy: 0, proyeccion_ratio: null }, cfg).semaforo).toBe('rojo');
    const r = calcularSemaforo({ base: base('gasto_historico', 1_000), limite_hoy: 100, gastado_hoy: 10, proyeccion_ratio: 1.2 }, cfg);
    expect(r.razon).toContain('gasto usual');
  });
});

describe('hormiga y nocturnas', () => {
  it('esNocturna en los bordes 22:00–05:00', () => {
    const r = { desde: '22:00', hasta: '05:00' };
    expect(esNocturna('21:59', r)).toBe(false);
    expect(esNocturna('22:00', r)).toBe(true);
    expect(esNocturna('04:59', r)).toBe(true);
    expect(esNocturna('05:00', r)).toBe(false);
    expect(esNocturna(null, r)).toBe(false);
  });

  it('calcularHormiga: cuenta solo pequeños de categorías hormiga', () => {
    const i = inst({
      movimientos: [
        gasto('2026-10-02', 5_000, 'TINTO', { categoria_id: 'comida' }),
        gasto('2026-10-03', 8_000, 'TINTO', { categoria_id: 'comida' }),
        gasto('2026-10-04', 12_000, 'PAN', { categoria_id: 'comida' }),
        gasto('2026-10-05', 30_000, 'ALMUERZO', { categoria_id: 'comida' }),      // > umbral
        gasto('2026-10-06', 10_000, 'NETFLIX', { categoria_id: 'suscripciones' }), // categoría no hormiga
        gasto('2026-10-07', 10_000, 'TRANSF', { categoria_id: 'otros', tipo: 'transferencia' }), // tipo
      ],
    });
    const h = calcularHormiga(i, '2026-10-15', 100_000);
    expect(h.cantidad).toBe(3);
    expect(h.total).toBe(25_000);
    expect(h.pct_variable).toBeCloseTo(0.25);
    expect(h.top[0]).toMatchObject({ comercio: 'TINTO', total: 13_000, cantidad: 2 });
    expect(h.proyeccion_mes).toBe(Math.round((25_000 / 15) * 31));
    expect(h.proyeccion_anual).toBe(h.proyeccion_mes * 12);
  });

  it('calcularNocturnas', () => {
    const i = inst({
      movimientos: [
        gasto('2026-10-14', 20_000, 'BAR', { hora: '23:30' }),
        gasto('2026-10-13', 20_000, 'BAR', { hora: '02:10' }),
        gasto('2026-10-12', 20_000, 'BAR', { hora: '21:59' }),
        gasto('2026-10-03', 20_000, 'BAR', { hora: '22:00' }),
        gasto('2026-10-04', 20_000, 'BAR', { hora: null }),
      ],
    });
    const n = calcularNocturnas(i, '2026-10-15');
    expect(n.cantidad_7d).toBe(2);
    expect(n.total_7d).toBe(40_000);
    expect(n.cantidad_mes).toBe(3);
    expect(n.cantidad_30d).toBe(3);
  });
});

describe('detectarAnomalias', () => {
  it('posible duplicado: mismo monto y comercio con menos de 10 minutos', () => {
    const a = gasto('2026-10-15', 15_000, 'PIZZA', { id: 1, hora: '13:00' });
    const b = gasto('2026-10-15', 15_000, 'PIZZA', { id: 2, hora: '13:08' });
    const c = gasto('2026-10-15', 15_000, 'PIZZA', { id: 3, hora: '13:20' });
    const an = detectarAnomalias([a, b, c], [b], config(), new Set());
    expect(an.filter((x) => x.tipo === 'posible_duplicado')).toHaveLength(1);
    expect(an[0]).toMatchObject({ tipo: 'posible_duplicado', movimiento_id: 2, otro_id: 1 });
    expect(detectarAnomalias([a, b], [b], config(), new Set(['posible_duplicado:1-2']))).toHaveLength(0);
  });

  it('el duplicado cruza la medianoche', () => {
    const a = gasto('2026-10-14', 15_000, 'BAR', { id: 1, hora: '23:57' });
    const b = gasto('2026-10-15', 15_000, 'BAR', { id: 2, hora: '00:03' });
    expect(detectarAnomalias([a, b], [b], config(), new Set())).toHaveLength(1);
  });

  it('monto inusual no dispara para transferencias ni para comercios genéricos, aunque haya muchos previos', () => {
    const casos: [string, Partial<Movimiento>][] = [
      ['Transferencia a cuenta', { tipo: 'transferencia' }], ['JUAN PEREZ', { tipo: 'transferencia' }],
      ['Transferencia a cuenta', {}], ['Pago por QR', {}], ['Llave Bre-B', {}], ['Pago', {}], ['Compra', {}],
    ];
    for (const [nombre, extra] of casos) {
      const previos = [30_000, 30_000, 30_000, 30_000].map((m, i) => gasto(`2026-09-0${i + 1}`, m, nombre, { id: i + 1, ...extra }));
      const nuevo = gasto('2026-10-15', 400_000, nombre, { id: 9, ...extra });
      expect(detectarAnomalias([...previos, nuevo], [nuevo], config(), new Set()), nombre).toHaveLength(0);
    }
    // un comercio con nombre propio y 3 previos sí dispara (control)
    const previos = [30_000, 30_000, 30_000].map((m, i) => gasto(`2026-09-0${i + 1}`, m, 'REST X', { id: i + 1 }));
    const nuevo = gasto('2026-10-15', 400_000, 'REST X', { id: 9 });
    expect(detectarAnomalias([...previos, nuevo], [nuevo], config(), new Set())).toHaveLength(1);
    // con solo 2 previos no dispara
    expect(detectarAnomalias([previos[0], previos[1], nuevo], [nuevo], config(), new Set())).toHaveLength(0);
  });

  it('monto inusual: más de 3× la mediana, con ≥3 previos y diferencia ≥ 20.000', () => {
    const previos = [30_000, 30_000, 30_000].map((m, i) => gasto(`2026-09-0${i + 1}`, m, 'REST X', { id: i + 1 }));
    const nuevo = gasto('2026-10-15', 100_000, 'REST X', { id: 9 });
    const an = detectarAnomalias([...previos, nuevo], [nuevo], config(), new Set());
    expect(an).toHaveLength(1);
    expect(an[0].tipo).toBe('monto_inusual');
    // justo en el umbral (3×) no se dispara
    const igual = gasto('2026-10-15', 90_000, 'REST X', { id: 10 });
    expect(detectarAnomalias([...previos, igual], [igual], config(), new Set())).toHaveLength(0);
    // pocos previos
    expect(detectarAnomalias([previos[0], nuevo], [nuevo], config(), new Set())).toHaveLength(0);
    // diferencia chica
    const chicos = [1_000, 1_000, 1_000].map((m, i) => gasto(`2026-09-0${i + 1}`, m, 'TINTO', { id: 20 + i }));
    const n2 = gasto('2026-10-15', 5_000, 'TINTO', { id: 30 });
    expect(detectarAnomalias([...chicos, n2], [n2], config(), new Set())).toHaveLength(0);
  });
});

describe('días cerrados y racha', () => {
  it('calcularDiasCerrados usa solo lo anterior a cada día y P = 0', () => {
    const i = escenarioCanonico();
    const dias = calcularDiasCerrados(i, '2026-10-13', '2026-10-14');
    expect(dias).toHaveLength(2);
    const d14 = dias[1];
    // 14 oct: d=14, dr=18. G_antes = 70k*7 + 80k*6 = 970.000; Vmes = 2.100.000; sin P
    expect(d14.limite).toBe(Math.floor((2_100_000 - 970_000) / 18));
    expect(d14.gastado).toBe(80_000);
    expect(d14.bajo_limite).toBe(false);
    expect(d14.modo).toBe('ingreso_configurado');
  });

  it('día sin base de cálculo: límite null y bajo_limite null', () => {
    const i = inst({ movimientos: [gasto('2026-10-10', 1_000)] });
    const [d] = calcularDiasCerrados(i, '2026-10-12', '2026-10-12');
    expect(d.limite).toBeNull();
    expect(d.bajo_limite).toBeNull();
    expect(d.modo).toBe('sin_datos');
  });

  const dia = (fecha: string, bajo: boolean | null) => ({ fecha, limite: 100, gastado: 0, bajo_limite: bajo, modo: 'ingreso_configurado' as const });

  it('racha: cortada por un false o un null', () => {
    const dias = [dia('2026-10-08', true), dia('2026-10-09', true), dia('2026-10-10', false), dia('2026-10-11', true),
      dia('2026-10-12', true), dia('2026-10-13', null), dia('2026-10-14', true)];
    const r = calcularRacha(dias, '2026-10-15', 5_000);
    expect(r.dias).toBe(1);
    expect(r.record).toBe(2);
    expect(r.hoy_bajo_limite).toBe(true);
  });

  it('racha continua hasta ayer; hoy_bajo_limite es informativo', () => {
    const dias = ['10', '11', '12', '13', '14'].map((d) => dia(`2026-10-${d}`, true));
    const r = calcularRacha(dias, '2026-10-15', -1);
    expect(r.dias).toBe(5);
    expect(r.record).toBe(5);
    expect(r.hoy_bajo_limite).toBe(false);
    expect(calcularRacha(dias, '2026-10-15', null).hoy_bajo_limite).toBeNull();
  });

  it('si ayer no está cerrado la racha es 0', () => {
    expect(calcularRacha([dia('2026-10-12', true)], '2026-10-15', 0).dias).toBe(0);
  });
});

describe('score', () => {
  it('sin ratio → score null, y con componentes omitidos se renormaliza', () => {
    const sin = calcularMetricas(inst());
    expect(sin.score.valor).toBeNull();
    expect(sin.score.nivel).toBeNull();

    // Escenario holgado: ratio < 0.9, sin presupuestos por categoría ni metas
    const i = inst({
      config: config({ ingreso_mensual: 10_000_000 }),
      movimientos: gastosDiarios('2026-10-01', '2026-10-14', 50_000),
    });
    const m = calcularMetricas(i);
    expect(m.score.componentes.find((c) => c.id === 'presupuestos')!.puntos).toBeNull();
    expect(m.score.componentes.find((c) => c.id === 'metas')!.puntos).toBeNull();
    expect(m.score.valor).toBeGreaterThanOrEqual(80);
    expect(m.score.nivel).toBe('solida');
  });

  it('calcularScore es consistente con calcularMetricas', () => {
    const i = escenarioCanonico();
    const m = calcularMetricas(i);
    const { score, ...parcial } = m;
    expect(calcularScore(i, parcial)).toEqual(score);
  });

  it('nivel «riesgo» con ritmo muy malo', () => {
    const i = inst({
      config: config({ ingreso_mensual: 2_000_000 }),
      movimientos: gastosDiarios('2026-10-01', '2026-10-14', 150_000, 'GASTO'),
    });
    const m = calcularMetricas(i);
    expect(m.score.nivel === 'riesgo' || m.score.nivel === 'apretada').toBe(true);
  });
});

describe('por_categoria, mes pasado y resumenPeriodo', () => {
  it('estados de presupuesto por categoría', () => {
    const i = inst({
      config: config({ ingreso_mensual: 4_000_000 }),
      presupuestos: [
        { mes: '*', categoria_id: 'comida', monto: 100_000 },
        { mes: '2026-10', categoria_id: 'ocio', monto: 100_000 },
        { mes: '*', categoria_id: 'salud', monto: 100_000 },
      ],
      movimientos: [
        gasto('2026-10-02', 120_000, 'X', { categoria_id: 'comida' }),
        gasto('2026-10-03', 85_000, 'Y', { categoria_id: 'ocio' }),
        gasto('2026-10-03', 10_000, 'Z', { categoria_id: 'salud' }),
        gasto('2026-10-04', 10_000, 'W', { categoria_id: 'compras' }),
      ],
    });
    const m = calcularMetricas(i);
    const e = (id: string) => m.por_categoria.find((c) => c.categoria_id === id)!;
    expect(e('comida').estado).toBe('pasado');
    expect(e('ocio').estado).toBe('cerca');
    expect(e('salud').estado).toBe('ok');
    expect(e('compras').estado).toBe('sin_presupuesto');
  });

  it('mes_pasado compara a la misma fecha', () => {
    const i = inst({
      config: config({ ingreso_mensual: 4_000_000 }),
      movimientos: [gasto('2026-09-05', 100_000), gasto('2026-09-20', 900_000), gasto('2026-10-05', 150_000)],
    });
    const m = calcularMetricas(i);
    expect(m.mes_pasado).toEqual({ gastado_a_la_fecha: 100_000, diferencia: 50_000, ratio: 1.5 });
    expect(calcularMetricas(inst({ config: config({ ingreso_mensual: 4_000_000 }) })).mes_pasado).toBeNull();
  });

  it('resumenPeriodo agrega por categoría y comercio', () => {
    const i = inst({
      movimientos: [
        gasto('2026-09-02', 10_000, 'RAPPI', { categoria_id: 'comida' }),
        gasto('2026-09-03', 20_000, 'RAPPI', { categoria_id: 'comida' }),
        gasto('2026-09-04', 500_000, 'ARRIENDO', { categoria_id: 'servicios', fijo_id: 3 }),
        mov({ fecha: '2026-09-05', tipo: 'ingreso', monto: 3_000_000, comercio: 'EMPRESA SA' }),
        mov({ fecha: '2026-09-06', tipo: 'transferencia', monto: 40_000, comercio: 'JUAN PEREZ' }),
        gasto('2026-10-02', 99_000, 'FUERA'),
      ],
    });
    const r = resumenPeriodo(i, '2026-09-01', '2026-09-30');
    expect(r.gastado_variable).toBe(70_000);
    expect(r.gastado_fijos).toBe(500_000);
    expect(r.ingresos).toBe(3_000_000);
    expect(r.cantidad).toBe(4);
    expect(r.por_categoria[0]).toMatchObject({ categoria_id: 'servicios', total: 500_000 });
    expect(r.top_comercios.find((c) => c.comercio === 'RAPPI')).toMatchObject({ total: 30_000, cantidad: 2 });
    expect(r.top_comercios.some((c) => c.comercio.includes('JUAN'))).toBe(false);
    expect(r.top_comercios.some((c) => c.comercio === 'Transferencias enviadas')).toBe(true);
    expect(r.mayor_gasto?.comercio).toBe('ARRIENDO');
  });

  it('el reloj siempre se inyecta: AHORA_CANONICO es 12:00 Bogotá', () => {
    expect(AHORA_CANONICO.toISOString()).toBe('2026-10-15T17:00:00.000Z');
  });
});
