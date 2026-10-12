import { beforeEach, describe, expect, it } from 'vitest';
import { calcularMetricas } from './metricas';
import {
  evaluarReglas, filtrarParaPush, horaLegible, ordenarRecomendaciones, REGLAS, reglasDeMovimiento, semanaISO, veredictoPuedo,
} from './recomendar';
import type { EmisionPrevia, Instantanea, Metricas, ReglaId, Recomendacion } from './tipos';
import {
  config, escenarioCanonico, gasto, gastosDiarios, inst, itemEspera, metaConAportes, mov, recurrente, reiniciarIds, sistemaVacio,
} from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

const evaluar = (i: Instantanea, over: Partial<Metricas> = {}) => evaluarReglas(i, { ...calcularMetricas(i), ...over });
const ids = (rs: Recomendacion[]) => rs.map((r) => r.regla);
const hay = (rs: Recomendacion[], regla: ReglaId) => rs.some((r) => r.regla === regla);
const de = (rs: Recomendacion[], regla: ReglaId) => rs.find((r) => r.regla === regla)!;

describe('catálogo', () => {
  it('tiene las 30 reglas (25 + 5 de deudas), sin repetir, con CD infinito donde corresponde', () => {
    expect(REGLAS).toHaveLength(30);
    expect(new Set(REGLAS.map((r) => r.id)).size).toBe(30);
    expect(REGLAS.find((r) => r.id === 'posible_duplicado')!.cooldown_h).toBe(Infinity);
    expect(REGLAS.find((r) => r.id === 'riesgo_fin_de_mes')).toMatchObject({ cooldown_h: 24, reemite_si_cambia: 0.1, prioridad: 10 });
  });

  it('ordena por severidad, prioridad y valor_ref', () => {
    const r = (regla: ReglaId, severidad: 'info' | 'aviso' | 'alerta', prioridad: number, valor_ref = 0): Recomendacion =>
      ({ id: regla, regla, severidad, prioridad, titulo: '', detalle_con_cifras: '', cifras: {}, push: true, valor_ref });
    const o = ordenarRecomendaciones([r('buen_ritmo', 'info', 80), r('riesgo_fin_de_mes', 'alerta', 10), r('gasto_hormiga', 'aviso', 45), r('pin_bloqueado', 'alerta', 1), r('compras_nocturnas', 'aviso', 45, 5)]);
    expect(ids(o)).toEqual(['pin_bloqueado', 'riesgo_fin_de_mes', 'compras_nocturnas', 'gasto_hormiga', 'buen_ritmo']);
  });

  it('utilidades de fecha y hora', () => {
    expect(horaLegible('22:00')).toBe('10 p. m.');
    expect(horaLegible('05:00')).toBe('5 a. m.');
    expect(horaLegible('00:30')).toBe('12:30 a. m.');
    expect(semanaISO('2026-10-15')).toBe('2026-W42');
    expect(semanaISO('2027-01-01')).toBe('2026-W53');
  });
});

describe('reglas globales: dispara y no dispara justo debajo del umbral', () => {
  const canon = () => escenarioCanonico();

  it('R24 pin_bloqueado: solo bloqueos largos', () => {
    const c = canon();
    const t = (ms: number) => new Date(c.ahora.getTime() + ms).toISOString();
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ pin_bloqueado_hasta: t(24 * 3_600_000) }) }), 'pin_bloqueado')).toBe(true);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ pin_bloqueado_hasta: t(5 * 60_000) }) }), 'pin_bloqueado')).toBe(false);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ pin_bloqueado_hasta: t(-1000) }) }), 'pin_bloqueado')).toBe(false);
    expect(de(evaluar({ ...c, sistema: sistemaVacio({ pin_bloqueado_hasta: t(24 * 3_600_000) }) }), 'pin_bloqueado').severidad).toBe('alerta');
  });

  it('R25 fijos_superan_ingreso', () => {
    const malo = inst({ config: config({ ingreso_mensual: 1_000_000 }), fijos: [{ id: 1, nombre: 'Arriendo', monto: 1_200_000, dia_mes: 5, patron: 'arriendo', categoria_id: 'servicios', activo: true }] });
    const r = de(evaluar(malo), 'fijos_superan_ingreso');
    expect(r.detalle_con_cifras).toContain('$1.200.000');
    expect(r.detalle_con_cifras).toContain('$1.000.000');
    expect(hay(evaluar(canon()), 'fijos_superan_ingreso')).toBe(false);
  });

  it('R04 riesgo_fin_de_mes: ratio > 1,05 y día ≥ 5', () => {
    const c = canon();
    const m = calcularMetricas(c);
    expect(hay(evaluarReglas(c, m), 'riesgo_fin_de_mes')).toBe(true);
    expect(hay(evaluarReglas(c, { ...m, proyeccion_ratio: 1.05 }), 'riesgo_fin_de_mes')).toBe(false);
    expect(hay(evaluarReglas(c, { ...m, proyeccion_ratio: 1.0501 }), 'riesgo_fin_de_mes')).toBe(true);
    expect(hay(evaluarReglas(c, { ...m, dia: 4 }), 'riesgo_fin_de_mes')).toBe(false);
    const r = de(evaluarReglas(c, m), 'riesgo_fin_de_mes');
    expect(r.cifras).toMatchObject({ proyeccion: 2_378_500, disponible: 2_100_000, exceso: 278_500, ritmo_objetivo: Math.floor(975_000 / 17), dias: 17 });
    expect(r.detalle_con_cifras).toContain('$2.378.500');
    expect(r.severidad).toBe('alerta');
  });

  it('base ESTIMADA: las alertas se degradan un nivel (no alarmar con datos supuestos), salvo PIN y duplicados', () => {
    const c = canon();
    const m = calcularMetricas(c);
    expect(de(evaluarReglas(c, m), 'riesgo_fin_de_mes').severidad).toBe('alerta');
    for (const modo of ['ingreso_estimado', 'gasto_historico'] as const) {
      const est = { ...m, base: { ...m.base, modo } };
      const rs = evaluarReglas(c, est);
      expect(de(rs, 'riesgo_fin_de_mes').severidad, modo).toBe('aviso');
      expect(rs.some((r) => r.severidad === 'alerta' && r.regla !== 'pin_bloqueado' && r.regla !== 'posible_duplicado')).toBe(false);
    }
    const bloqueado = { ...c, sistema: sistemaVacio({ pin_bloqueado_hasta: new Date(c.ahora.getTime() + 24 * 3_600_000).toISOString() }) };
    const rs = evaluarReglas(bloqueado, { ...calcularMetricas(bloqueado), base: { ...m.base, modo: 'ingreso_estimado' } });
    expect(de(rs, 'pin_bloqueado').severidad).toBe('alerta');
  });

  it('R21 sin_avisos: > 72 h y promedio ≥ 1', () => {
    const c = canon();
    const hace = (h: number) => new Date(c.ahora.getTime() - h * 3_600_000).toISOString();
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ ultimo_aviso_en: hace(73), avisos_promedio_diario_90d: 2 }) }), 'sin_avisos')).toBe(true);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ ultimo_aviso_en: hace(72), avisos_promedio_diario_90d: 2 }) }), 'sin_avisos')).toBe(false);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ ultimo_aviso_en: hace(100), avisos_promedio_diario_90d: 0.9 }) }), 'sin_avisos')).toBe(false);
  });

  it('R05 y R06: presupuesto por categoría', () => {
    const con = (gastado: number) => inst({
      config: config({ ingreso_mensual: 6_000_000 }),
      presupuestos: [{ mes: '*', categoria_id: 'comida', monto: 100_000 }],
      movimientos: [gasto('2026-10-05', gastado, 'REST', { categoria_id: 'comida' })],
    });
    const pasado = evaluar(con(120_000));
    expect(hay(pasado, 'categoria_sobre_presupuesto')).toBe(true);
    expect(de(pasado, 'categoria_sobre_presupuesto').id).toBe('categoria_sobre_presupuesto:comida:2026-10');
    expect(hay(evaluar(con(100_000)), 'categoria_sobre_presupuesto')).toBe(false);
    expect(hay(evaluar(con(100_000)), 'categoria_cerca_presupuesto')).toBe(true);
    expect(hay(evaluar(con(80_000)), 'categoria_cerca_presupuesto')).toBe(true);
    expect(hay(evaluar(con(79_999)), 'categoria_cerca_presupuesto')).toBe(false);
    // avanzado el mes (d/D ≥ 0.8) ya no avisa «va rápido»
    const tarde = { ...con(90_000), ahora: new Date('2026-10-28T17:00:00Z') };
    expect(hay(evaluar(tarde), 'categoria_cerca_presupuesto')).toBe(false);
  });

  it('R10 y R11 vienen de las anomalías', () => {
    const a = gasto('2026-10-15', 15_000, 'PIZZA', { id: 1, hora: '11:00' });
    const b = gasto('2026-10-15', 15_000, 'PIZZA', { id: 2, hora: '11:05' });
    const r = de(evaluar(inst({ config: config({ ingreso_mensual: 4_000_000 }), movimientos: [a, b] })), 'posible_duplicado');
    expect(r.id).toBe('posible_duplicado:1-2');
    expect(r.push).toBe(false);
    expect(r.detalle_con_cifras).toContain('5 min');
  });

  it('R02 limite_dia_superado: severidad y mañana', () => {
    const c = canon();
    expect(hay(evaluar(c), 'limite_dia_superado')).toBe(false);
    const con = (extra: number) => ({ ...c, movimientos: [...c.movimientos, mov({ fecha: '2026-10-15', monto: extra, comercio: 'EXTRA' })] });
    expect(hay(evaluar(con(29_117)), 'limite_dia_superado')).toBe(false);        // gastado_hoy = límite exacto
    const r = de(evaluar(con(40_000)), 'limite_dia_superado');                    // 70.000 > 59.117
    expect(r.severidad).toBe('aviso');
    expect(r.cifras.exceso).toBe(70_000 - 59_117);
    expect(r.detalle_con_cifras).toContain('Mañana tu límite queda en');
    expect(de(evaluar(con(100_000)), 'limite_dia_superado').severidad).toBe('alerta');   // 130.000 > 2×59.117
  });

  it('R02 el último día no habla de mañana', () => {
    const movs = gastosDiarios('2026-10-01', '2026-10-30', 50_000);
    movs.push(mov({ fecha: '2026-10-31', monto: 2_000_000, comercio: 'GRANDE' }));
    const i = inst({ ahora: new Date('2026-10-31T17:00:00Z'), config: config({ ingreso_mensual: 3_000_000, pct_ahorro: 0 }), movimientos: movs });
    const r = de(evaluar(i), 'limite_dia_superado');
    expect(r.detalle_con_cifras).not.toContain('Mañana');
  });

  it('R07 ritmo_mayor_mes_pasado', () => {
    const c = canon();
    const m = calcularMetricas(c);
    const con = (G: number, Gp: number, dia = 15) => evaluarReglas(c, { ...m, dia, gastado_mes: G, mes_pasado: { gastado_a_la_fecha: Gp, diferencia: G - Gp, ratio: G / Gp } });
    expect(hay(con(1_300_000, 1_000_000), 'ritmo_mayor_mes_pasado')).toBe(true);
    expect(hay(con(1_200_000, 1_000_000), 'ritmo_mayor_mes_pasado')).toBe(false);      // exactamente 1,2×
    expect(hay(con(495_000, 400_000), 'ritmo_mayor_mes_pasado')).toBe(false);          // >1,2× pero diferencia < 100.000
    expect(hay(con(1_300_000, 1_000_000, 4), 'ritmo_mayor_mes_pasado')).toBe(false);   // d < 5
    expect(de(con(1_300_000, 1_000_000), 'ritmo_mayor_mes_pasado').detalle_con_cifras).toContain('30%');
  });

  it('R16 meta_atrasada y R17 meta_cumplida', () => {
    const meta = (aportado: number) => metaConAportes({ id: 5, nombre: 'Viaje', objetivo: 3_000_000, fecha_objetivo: '2027-01-01', creada_en: '2026-07-01T12:00:00Z', aportado });
    const base = canon();
    const atrasada = evaluar({ ...base, metas: [meta(1_000_000)] });
    expect(hay(atrasada, 'meta_atrasada')).toBe(true);
    expect(de(atrasada, 'meta_atrasada').cifras.requerido_mes).toBe(Math.ceil(2_000_000 / 3));
    expect(hay(evaluar({ ...base, metas: [meta(1_600_000)] }), 'meta_atrasada')).toBe(false);
    expect(hay(evaluar({ ...base, metas: [meta(3_000_000)] }), 'meta_cumplida')).toBe(true);
    expect(hay(evaluar({ ...base, metas: [meta(2_999_999)] }), 'meta_cumplida')).toBe(false);
    expect(hay(evaluar({ ...base, metas: [{ ...meta(3_000_000), estado: 'pausada' }] }), 'meta_cumplida')).toBe(false);
  });

  it('R08 gasto_hormiga: por porcentaje o por semana', () => {
    const c = canon();
    const m = calcularMetricas(c);
    const h = m.hormiga;
    const con = (x: Partial<Metricas['hormiga']>) => evaluarReglas(c, { ...m, hormiga: { ...h, ...x } });
    expect(hay(con({ pct_variable: 0.15, cantidad: 10 }), 'gasto_hormiga')).toBe(true);
    expect(hay(con({ pct_variable: 0.149, cantidad: 10 }), 'gasto_hormiga')).toBe(false);
    expect(hay(con({ pct_variable: 0.2, cantidad: 9 }), 'gasto_hormiga')).toBe(false);
    expect(hay(con({ total_7d: 50_000, promedio_semanal_previo: 30_000 }), 'gasto_hormiga')).toBe(true);
    expect(hay(con({ total_7d: 49_999, promedio_semanal_previo: 10_000 }), 'gasto_hormiga')).toBe(false);
    expect(hay(con({ total_7d: 39_000, promedio_semanal_previo: 30_000 }), 'gasto_hormiga')).toBe(false);   // = 1,3×, no más
  });

  it('R09 compras_nocturnas: ≥ 3 en 7 días', () => {
    const c = canon();
    const m = calcularMetricas(c);
    expect(hay(evaluarReglas(c, { ...m, nocturnas: { ...m.nocturnas, cantidad_7d: 3, total_7d: 60_000 } }), 'compras_nocturnas')).toBe(true);
    expect(hay(evaluarReglas(c, { ...m, nocturnas: { ...m.nocturnas, cantidad_7d: 2 } }), 'compras_nocturnas')).toBe(false);
    expect(de(evaluarReglas(c, { ...m, nocturnas: { ...m.nocturnas, cantidad_7d: 3, total_7d: 60_000 } }), 'compras_nocturnas').detalle_con_cifras).toContain('10 p. m. y las 5 a. m.');
  });

  it('R23 espera_lista', () => {
    const c = canon();
    const con = (x: Partial<ReturnType<typeof itemEspera>>) => evaluar({ ...c, lista_espera: [itemEspera(x)] });
    expect(hay(con({ disponible_en: '2026-10-15T16:59:59Z' }), 'espera_lista')).toBe(true);
    expect(hay(con({ disponible_en: '2026-10-15T17:00:01Z' }), 'espera_lista')).toBe(false);
    expect(hay(con({ disponible_en: '2026-10-12T00:00:00Z', recordado_en: '2026-10-14T00:00:00Z' }), 'espera_lista')).toBe(false);
    expect(de(con({ disponible_en: '2026-10-12T00:00:00Z' }), 'espera_lista').detalle_con_cifras).toContain('«Audífonos»');
  });

  it('R14 / R13 / R15 recurrentes', () => {
    const c = canon();
    const sube = evaluar({ ...c, recurrentes: [recurrente({ monto_tipico: 19_900, monto_anterior: 17_900 })] });
    expect(de(sube, 'suscripcion_subio').id).toBe('suscripcion_subio:1:19900');
    expect(hay(evaluar({ ...c, recurrentes: [recurrente({ monto_tipico: 18_800, monto_anterior: 17_900 })] }), 'suscripcion_subio')).toBe(false);
    expect(hay(evaluar({ ...c, recurrentes: [recurrente({ proximo_cobro: '2026-10-16' })] }), 'suscripcion_manana')).toBe(true);
    expect(hay(evaluar({ ...c, recurrentes: [recurrente({ proximo_cobro: '2026-10-17' })] }), 'suscripcion_manana')).toBe(false);
    const det = evaluar({ ...c, recurrentes: [recurrente({ estado: 'detectada' })] });
    expect(hay(det, 'suscripcion_detectada')).toBe(true);
    expect(de(det, 'suscripcion_detectada').detalle_con_cifras).toContain('cada mes');
    expect(hay(evaluar({ ...c, recurrentes: [recurrente({ estado: 'confirmada' })] }), 'suscripcion_detectada')).toBe(false);
    expect(hay(evaluar({ ...c, recurrentes: [recurrente({ estado: 'descartada', proximo_cobro: '2026-10-16' })] }), 'suscripcion_manana')).toBe(false);
  });

  it('R12 gasto_alto y R22 ingreso_recibido (solo de hoy)', () => {
    const c = canon();
    const alto = (monto: number, fecha = '2026-10-15') => evaluar({ ...c, movimientos: [...c.movimientos, mov({ fecha, monto, comercio: 'TV' })] });
    expect(hay(alto(200_000), 'gasto_alto')).toBe(true);
    expect(hay(alto(199_999), 'gasto_alto')).toBe(false);
    expect(hay(alto(500_000, '2026-10-14'), 'gasto_alto')).toBe(false);
    const ing = (monto: number, extra = {}) => evaluar({ ...c, movimientos: [...c.movimientos, mov({ fecha: '2026-10-15', tipo: 'ingreso', monto, comercio: 'EMPRESA', ...extra })] });
    expect(hay(ing(100_000), 'ingreso_recibido')).toBe(true);
    expect(hay(ing(99_999), 'ingreso_recibido')).toBe(false);
    expect(de(ing(500_000), 'ingreso_recibido').detalle_con_cifras).toContain('$50.000');
    expect(de(ing(1_000_000, { verificado: false }), 'ingreso_recibido').detalle_con_cifras).toContain('no pude verificar');
  });

  it('R20 por_revisar_pendientes: más de 24 h', () => {
    const c = canon();
    const hace = (h: number) => new Date(c.ahora.getTime() - h * 3_600_000).toISOString();
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ por_revisar_pendientes: 2, por_revisar_mas_viejo_en: hace(25) }) }), 'por_revisar_pendientes')).toBe(true);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ por_revisar_pendientes: 2, por_revisar_mas_viejo_en: hace(24) }) }), 'por_revisar_pendientes')).toBe(false);
    expect(hay(evaluar({ ...c, sistema: sistemaVacio({ por_revisar_pendientes: 0, por_revisar_mas_viejo_en: hace(99) }) }), 'por_revisar_pendientes')).toBe(false);
  });

  it('R19 buen_ritmo', () => {
    const c = canon();
    const m = calcularMetricas(c);
    const con = (ratio: number, dia = 15) => evaluarReglas(c, { ...m, proyeccion_ratio: ratio, dia, proyeccion_fin_mes: Math.round(ratio * 2_100_000) });
    expect(hay(con(0.85), 'buen_ritmo')).toBe(true);
    expect(hay(con(0.86), 'buen_ritmo')).toBe(false);
    expect(hay(con(0.5, 9), 'buen_ritmo')).toBe(false);
    expect(de(con(0.5), 'buen_ritmo').detalle_con_cifras).toContain('Podrías guardar');
    const conMeta = evaluarReglas({ ...c, metas: [metaConAportes({ nombre: 'Viaje' })] }, { ...m, proyeccion_ratio: 0.5, proyeccion_fin_mes: 1_050_000 });
    expect(de(conMeta, 'buen_ritmo').detalle_con_cifras).toContain('a Viaje');
  });

  it('R18 racha_hito y R03 limite_dia_cerca', () => {
    const c = canon();
    const m = calcularMetricas(c);
    for (const n of [3, 7, 14, 30, 60, 90]) expect(hay(evaluarReglas(c, { ...m, racha: { dias: n, record: n, hoy_bajo_limite: true } }), 'racha_hito')).toBe(true);
    expect(hay(evaluarReglas(c, { ...m, racha: { dias: 5, record: 9, hoy_bajo_limite: true } }), 'racha_hito')).toBe(false);
    expect(de(evaluarReglas(c, { ...m, racha: { dias: 7, record: 9, hoy_bajo_limite: true } }), 'racha_hito').id).toBe('racha_hito:7:2026-10-08');

    const lim = m.limite_hoy!;
    expect(hay(evaluarReglas(c, { ...m, gastado_hoy: Math.ceil(lim * 0.8) }), 'limite_dia_cerca')).toBe(true);
    expect(hay(evaluarReglas(c, { ...m, gastado_hoy: Math.floor(lim * 0.79) }), 'limite_dia_cerca')).toBe(false);
    expect(hay(evaluarReglas(c, { ...m, gastado_hoy: lim + 1 }), 'limite_dia_cerca')).toBe(false);
  });

  it('R01 sin_ingreso_configurado según el modo', () => {
    expect(hay(evaluar(inst()), 'sin_ingreso_configurado')).toBe(true);
    expect(hay(evaluar(canon()), 'sin_ingreso_configurado')).toBe(false);
    expect(de(evaluar(inst()), 'sin_ingreso_configurado').detalle_con_cifras).toContain('Mi ingreso');
  });

  it('el canónico entrega la lista ordenada y con ids estables', () => {
    const r = evaluar(canon());
    expect(ids(r)[0]).toBe('riesgo_fin_de_mes');
    for (const x of r) expect(x.id.startsWith(`${x.regla}:`)).toBe(true);
    for (const x of r) expect(x.titulo.length).toBeLessThanOrEqual(60);
  });
});

describe('reglasDeMovimiento', () => {
  it('devuelve R10/R11/R12/R22 solo para ese movimiento', () => {
    const c = canon2();
    const m = calcularMetricas(c);
    const grande = mov({ id: 900, fecha: '2026-10-15', monto: 250_000, comercio: 'TV' });
    expect(reglasDeMovimiento(c, m, grande, []).map((r) => r.regla)).toEqual(['gasto_alto']);
    expect(reglasDeMovimiento(c, m, { ...grande, origen: 'historial' }, [])).toHaveLength(0);
    const ing = mov({ id: 901, fecha: '2026-10-15', tipo: 'ingreso', monto: 300_000, comercio: 'EMPRESA' });
    expect(reglasDeMovimiento(c, m, ing, []).map((r) => r.regla)).toEqual(['ingreso_recibido']);
    const dup = reglasDeMovimiento(c, m, grande, [
      { tipo: 'posible_duplicado', movimiento_id: 900, otro_id: 800, detalle: '', cifras: { monto: 250_000, minutos: 3 } },
      { tipo: 'monto_inusual', movimiento_id: 777, otro_id: null, detalle: '', cifras: { monto: 1, mediana: 1, veces: 1 } },
    ]);
    expect(dup.map((r) => r.regla)).toEqual(['posible_duplicado', 'gasto_alto']);
    expect(dup[0].id).toBe('posible_duplicado:800-900');
  });
  const canon2 = () => escenarioCanonico();
});

describe('filtrarParaPush (cooldown, §4.2)', () => {
  const c = escenarioCanonico();
  const cfg = c.config;
  const r = (regla: ReglaId, id = `${regla}:x`, over: Partial<Recomendacion> = {}): Recomendacion => {
    const def = REGLAS.find((d) => d.id === regla)!;
    return { id, regla, severidad: def.severidad, prioridad: def.prioridad, titulo: '', detalle_con_cifras: '', cifras: {}, push: def.push, valor_ref: 1, ...over };
  };
  const em = (clave: string, regla: ReglaId, horasAtras: number, over: Partial<EmisionPrevia> = {}): EmisionPrevia => ({
    clave, regla, severidad: REGLAS.find((d) => d.id === regla)!.severidad, valor_ref: 1,
    primera_en: '2026-10-01T00:00:00Z', ultima_en: new Date(c.ahora.getTime() - horasAtras * 3_600_000).toISOString(), veces: 1, silenciada_hasta: null, ...over,
  });
  const motivo = (res: ReturnType<typeof filtrarParaPush>, id: string) => res.suprimidas.find((s) => s.id === id)?.motivo;

  it('sin emisión previa se envía; las que no son push no', () => {
    const res = filtrarParaPush([r('riesgo_fin_de_mes'), r('posible_duplicado')], [], c.ahora, cfg);
    expect(res.enviar.map((x) => x.regla)).toEqual(['riesgo_fin_de_mes']);
    expect(motivo(res, 'posible_duplicado:x')).toBe('sin_push');
  });

  it('cooldown: 23 h no, 24 h sí', () => {
    expect(motivo(filtrarParaPush([r('riesgo_fin_de_mes')], [em('riesgo_fin_de_mes:x', 'riesgo_fin_de_mes', 23)], c.ahora, cfg), 'riesgo_fin_de_mes:x')).toBe('cooldown');
    expect(filtrarParaPush([r('riesgo_fin_de_mes')], [em('riesgo_fin_de_mes:x', 'riesgo_fin_de_mes', 24)], c.ahora, cfg).enviar).toHaveLength(1);
  });

  it('cooldown infinito: una sola vez', () => {
    const rr = r('meta_cumplida', 'meta_cumplida:1');
    expect(filtrarParaPush([rr], [em('meta_cumplida:1', 'meta_cumplida', 99_999)], c.ahora, cfg).enviar).toHaveLength(0);
  });

  it('la severidad que sube reemite', () => {
    const e = em('limite_dia_superado:x', 'limite_dia_superado', 1, { severidad: 'aviso' });
    expect(filtrarParaPush([r('limite_dia_superado', undefined, { severidad: 'alerta' })], [e], c.ahora, cfg).enviar).toHaveLength(1);
    expect(filtrarParaPush([r('limite_dia_superado')], [e], c.ahora, cfg).enviar).toHaveLength(0);
  });

  it('reemite si valor_ref cambia ≥ 10 % (riesgo_fin_de_mes)', () => {
    const e = (v: number) => em('riesgo_fin_de_mes:x', 'riesgo_fin_de_mes', 1, { valor_ref: v });
    expect(filtrarParaPush([r('riesgo_fin_de_mes', undefined, { valor_ref: 1.13 })], [e(1.0)], c.ahora, cfg).enviar).toHaveLength(1);
    expect(filtrarParaPush([r('riesgo_fin_de_mes', undefined, { valor_ref: 1.13 })], [e(1.05)], c.ahora, cfg).enviar).toHaveLength(0);
  });

  it('presupuesto sobrepasado sube de nivel al cruzar 120 % y 150 %', () => {
    const id = 'categoria_sobre_presupuesto:comida:2026-10';
    const e = em(id, 'categoria_sobre_presupuesto', 1, { valor_ref: 1.1 });
    expect(filtrarParaPush([r('categoria_sobre_presupuesto', id, { valor_ref: 1.15 })], [e], c.ahora, cfg).enviar).toHaveLength(0);
    expect(filtrarParaPush([r('categoria_sobre_presupuesto', id, { valor_ref: 1.2 })], [e], c.ahora, cfg).enviar).toHaveLength(1);
    expect(filtrarParaPush([r('categoria_sobre_presupuesto', id, { valor_ref: 1.5 })], [em(id, 'categoria_sobre_presupuesto', 1, { valor_ref: 1.3 })], c.ahora, cfg).enviar).toHaveLength(1);
  });

  it('silenciada', () => {
    const e = em('gasto_hormiga:x', 'gasto_hormiga', 999, { silenciada_hasta: '9999-12-31T00:00:00Z' });
    expect(motivo(filtrarParaPush([r('gasto_hormiga')], [e], c.ahora, cfg), 'gasto_hormiga:x')).toBe('silenciada');
    const vencida = em('gasto_hormiga:x', 'gasto_hormiga', 999, { silenciada_hasta: '2026-10-01T00:00:00Z' });
    expect(filtrarParaPush([r('gasto_hormiga')], [vencida], c.ahora, cfg).enviar).toHaveLength(1);
  });

  it('pausa y fuera de horario (el PIN las ignora)', () => {
    const pausada = { ...cfg, pausa_hasta: '2026-10-16T00:00:00Z' };
    const res = filtrarParaPush([r('gasto_hormiga'), r('pin_bloqueado')], [], c.ahora, pausada);
    expect(res.enviar.map((x) => x.regla)).toEqual(['pin_bloqueado']);
    expect(motivo(res, 'gasto_hormiga:x')).toBe('pausa');
    expect(filtrarParaPush([r('gasto_hormiga')], [], c.ahora, { ...cfg, pausa_hasta: '2026-10-15T16:00:00Z' }).enviar).toHaveLength(1);

    const noche = new Date('2026-10-16T03:00:00Z');   // 22:00 en Bogotá
    const res2 = filtrarParaPush([r('gasto_hormiga'), r('pin_bloqueado')], [], noche, cfg);
    expect(res2.enviar.map((x) => x.regla)).toEqual(['pin_bloqueado']);
    expect(motivo(res2, 'gasto_hormiga:x')).toBe('fuera_de_horario');
    expect(filtrarParaPush([r('gasto_hormiga')], [], new Date('2026-10-16T02:30:00Z'), cfg).enviar).toHaveLength(1); // 21:30 justo
  });

  it('máximo max_push_por_evaluacion, por orden', () => {
    const recs = [r('buen_ritmo'), r('gasto_hormiga'), r('riesgo_fin_de_mes'), r('compras_nocturnas'), r('limite_dia_superado')];
    const res = filtrarParaPush(recs, [], c.ahora, cfg);
    expect(res.enviar).toHaveLength(3);
    expect(res.enviar.map((x) => x.regla)).toEqual(['riesgo_fin_de_mes', 'limite_dia_superado', 'gasto_hormiga']);
    expect(res.suprimidas.filter((s) => s.motivo === 'limite_por_evaluacion')).toHaveLength(2);
  });
});

describe('veredictoPuedo (§4.3)', () => {
  const c = escenarioCanonico();
  const m0 = calcularMetricas(c);
  const q = (monto: number, descripcion: string, i: Instantanea = c, m: Metricas = m0, ahora = i.ahora) =>
    veredictoPuedo(i, m, { monto, descripcion, ahora });

  it('canónico: 80.000 audífonos → no por p2', () => {
    const v = q(80_000, 'audífonos');
    expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p2', titulo: 'Mejor no', categoria_id: 'otros', esencial: false, regla_48h: false, lista_espera_id: null });
    expect(v.razones[0]).toContain('Vas en rojo');
    expect(v.razones[0]).toContain('$29.117');
    expect(v.cifras).toMatchObject({ monto: 80_000, libre_hoy: 29_117, restante_mes: 975_000, limite_hoy: 59_117, dias_restantes: 17 });
  });

  it('canónico: 25.000 almuerzo → sí por p7', () => {
    const v = q(25_000, 'almuerzo');
    expect(v).toMatchObject({ decision: 'si', regla_decisiva: 'p7', titulo: 'Sí, cabe' });
    expect(v.razones[0]).toContain('$4.117');
  });

  it('p0 sin datos', () => {
    const i = inst();
    expect(q(10_000, 'algo', i, calcularMetricas(i))).toMatchObject({ decision: 'espera', regla_decisiva: 'p0' });
  });

  it('p1 no alcanza el mes / p1e esencial', () => {
    expect(q(1_000_000, 'tele')).toMatchObject({ decision: 'no', regla_decisiva: 'p1' });
    const e = q(1_000_000, 'drogueria');
    expect(e).toMatchObject({ decision: 'espera', regla_decisiva: 'p1e', esencial: true, categoria_id: 'salud' });
    expect(e.razones[0]).toContain('$400.000');   // ahorro
  });

  it('esencial nunca recibe p2 ni p4–p6', () => {
    const v = q(80_000, 'drogueria');
    expect(['p2', 'p4', 'p5', 'p6']).not.toContain(v.regla_decisiva);
    expect(v.decision).toBe('si');
    const grande = q(150_000, 'drogueria');
    expect(grande.regla_48h).toBe(false);
    expect(['p2', 'p4', 'p5', 'p6']).not.toContain(grande.regla_decisiva);
    // de noche tampoco
    const nocheI = { ...c, ahora: new Date('2026-10-16T03:00:00Z') };
    const nocheV = veredictoPuedo(nocheI, calcularMetricas(nocheI), { monto: 30_000, descripcion: 'drogueria', ahora: nocheI.ahora });
    expect(nocheV.regla_decisiva).not.toBe('p5');
  });

  describe('con holgura (sin rojo)', () => {
    const holgado = (extra: Partial<Instantanea> = {}) => inst({
      config: config({ ingreso_mensual: 10_000_000 }),
      movimientos: gastosDiarios('2026-10-01', '2026-10-14', 50_000),
      ...extra,
    });

    it('p3 pasa más de 20 % del presupuesto de la categoría', () => {
      const i = holgado({ presupuestos: [{ mes: '*', categoria_id: 'comida', monto: 100_000 }] });
      const v = q(130_000, 'rappi', i, calcularMetricas(i));
      expect(v).toMatchObject({ decision: 'no', regla_decisiva: 'p3', categoria_id: 'comida' });
      expect(v.cifras).toMatchObject({ presupuesto_cat: 100_000, restante_cat: 100_000 });
    });

    it('p4 compra grande no esencial → espera 48 h (y esperado la salta)', () => {
      const i = holgado();
      const v = q(150_000, 'audifonos', i, calcularMetricas(i));
      expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p4', regla_48h: true });
      expect(v.razones[0]).toContain('48 horas');
      expect(v.razones[0]).toContain('17 oct');

      const ya = holgado({ lista_espera: [itemEspera({ descripcion: 'Audifonos', monto: 150_000, disponible_en: '2026-10-14T00:00:00Z' })] });
      const v2 = q(150_000, 'audifonos', ya, calcularMetricas(ya));
      expect(v2.regla_decisiva).not.toBe('p4');
      expect(v2.regla_48h).toBe(false);
      expect(v2.razones.join(' ')).toContain('Ya lo pensaste 48 horas');
      // si aún no pasaron las 48 h, sigue en p4
      const aun = holgado({ lista_espera: [itemEspera({ descripcion: 'Audifonos', monto: 150_000, disponible_en: '2026-10-16T00:00:00Z' })] });
      expect(q(150_000, 'audifonos', aun, calcularMetricas(aun)).regla_decisiva).toBe('p4');
    });

    it('p5 compra nocturna de más de $25.000', () => {
      const i = holgado({ ahora: new Date('2026-10-16T03:00:00Z') });
      const v = q(30_000, 'bar', i, calcularMetricas(i));
      expect(v).toMatchObject({ decision: 'espera', regla_decisiva: 'p5' });
      expect(v.razones[0]).toContain('22:00');
      expect(q(20_000, 'bar', i, calcularMetricas(i)).regla_decisiva).not.toBe('p5');
    });

    it('p6 cabe en el mes pero pasa del presupuesto de la categoría', () => {
      const i = holgado({ presupuestos: [{ mes: '*', categoria_id: 'ocio', monto: 50_000 }] });
      expect(q(60_000, 'cine', i, calcularMetricas(i))).toMatchObject({ decision: 'espera', regla_decisiva: 'p6' });
      expect(q(61_000, 'cine', i, calcularMetricas(i)).regla_decisiva).toBe('p3');
    });

    const ajustado = (over: Partial<Metricas>) => ({ ...calcularMetricas(holgado()), limite_hoy: 100_000, libre_hoy: 0, restante_mes: 5_000_000, semaforo: 'verde' as const, dias_restantes: 17, ...over });

    it('p8 / p9 / p10 según cuánto baja el límite diario', () => {
      const i = holgado();
      const m = ajustado({});
      const p8 = q(40_000, 'cine', i, m);
      expect(p8).toMatchObject({ decision: 'si', regla_decisiva: 'p8' });
      expect(p8.cifras.nuevo_limite).toBe(Math.floor(100_000 - 40_000 / 17));
      const p9 = q(600_000, 'drogueria', i, m);          // esencial: salta p4
      expect(p9).toMatchObject({ decision: 'espera', regla_decisiva: 'p9' });
      const p10 = q(1_200_000, 'drogueria', i, m);
      expect(p10).toMatchObject({ decision: 'no', regla_decisiva: 'p10' });
    });

    it('razones extra: presupuesto, meta principal y ritmo del mes pasado (máximo 4)', () => {
      const i = holgado({
        presupuestos: [{ mes: '*', categoria_id: 'ocio', monto: 500_000 }],
        metas: [metaConAportes({ nombre: 'Viaje', aportes: [{ id: 1, meta_id: 1, fecha: '2026-09-20', monto: 90_000, nota: null }] })],
      });
      const m = { ...calcularMetricas(i), mes_pasado: { gastado_a_la_fecha: 500_000, diferencia: 400_000, ratio: 1.8 }, gastado_mes: 900_000 };
      const v = q(40_000, 'cine', i, m);
      expect(v.razones.length).toBeLessThanOrEqual(4);
      expect(v.razones.some((x) => x.includes('de Viaje'))).toBe(true);
      expect(v.cifras.retraso_meta_dias).toBe(Math.ceil(40_000 / (90_000 / 90)));
      expect(v.razones.some((x) => x.includes('mes pasado'))).toBe(true);
      expect(v.razones.some((x) => x.includes('$500.000'))).toBe(true);
    });
  });
});
