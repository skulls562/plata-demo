import { beforeEach, describe, expect, it } from 'vitest';
import {
  cobrosEntre, costoAnual, costoMensual, detectarRecurrentes, fusionarDeteccion, proximoCobro, subioDePrecio,
} from './suscripciones';
import { CATEGORIAS_BASE, gasto, recurrente, reiniciarIds } from '../../tests/fixtures/constructores';

beforeEach(() => reiniciarIds());

const netflix = (fechas: string[], monto = 45_000) =>
  fechas.map((f) => gasto(f, monto, 'NETFLIX.COM', { categoria_id: 'suscripciones' }));

describe('detectarRecurrentes', () => {
  it('mensual de 3 cobros (Netflix sintético)', () => {
    const movs = netflix(['2026-07-20', '2026-08-20', '2026-09-20']);
    const [r] = detectarRecurrentes(movs, '2026-10-05', CATEGORIAS_BASE);
    expect(r).toMatchObject({
      comercio_norm: 'netflix com', nombre: 'NETFLIX.COM', periodo: 'mensual', clase: 'suscripcion',
      monto_tipico: 45_000, monto_anterior: 45_000, ocurrencias: 3,
      primer_cobro: '2026-07-20', ultimo_cobro: '2026-09-20', proximo_cobro: '2026-10-20',
      activa: true, costo_mensual: 45_000, costo_anual: 540_000,
    });
    expect(r.movimiento_ids).toHaveLength(3);
  });

  it('con dos cobros no es recurrente (salvo anual de suscripciones)', () => {
    expect(detectarRecurrentes(netflix(['2026-08-20', '2026-09-20']), '2026-10-05', CATEGORIAS_BASE)).toHaveLength(0);
  });

  it('anual con 2 cobros en categoría suscripciones', () => {
    const movs = [gasto('2025-10-10', 250_000, 'DOMINIO ANUAL', { categoria_id: 'suscripciones' }), gasto('2026-10-10', 250_000, 'DOMINIO ANUAL', { categoria_id: 'suscripciones' })];
    const [r] = detectarRecurrentes(movs, '2026-10-12', CATEGORIAS_BASE);
    expect(r.periodo).toBe('anual');
    expect(r.costo_anual).toBe(250_000);
    expect(r.costo_mensual).toBe(20_833);
    expect(r.proximo_cobro).toBe('2027-10-10');
    // fuera de la categoría de suscripciones no vale con 2
    const otro = movs.map((m) => ({ ...m, id: m.id + 100, categoria_id: 'compras', comercio: 'OTRA COSA', comercio_norm: 'otra cosa' }));
    expect(detectarRecurrentes(otro, '2026-10-12', CATEGORIAS_BASE)).toHaveLength(0);
  });

  it('mensual con un hueco (un cobro no visto)', () => {
    const movs = netflix(['2026-04-20', '2026-05-20', '2026-07-20', '2026-08-20', '2026-09-20']);
    const [r] = detectarRecurrentes(movs, '2026-10-05', CATEGORIAS_BASE);
    expect(r.periodo).toBe('mensual');
    expect(r.ocurrencias).toBe(5);
  });

  it('cobro del 31 en meses cortos vuelve al 31', () => {
    const movs = netflix(['2026-06-30', '2026-07-31', '2026-08-31']);
    // el 30 de junio y el 31 después: día preferido = 31
    const [r] = detectarRecurrentes(movs, '2026-09-05', CATEGORIAS_BASE);
    expect(r.proximo_cobro).toBe('2026-09-30');
    expect(proximoCobro('2026-09-30', 'mensual', 31, '2026-10-01')).toBe('2026-10-31');
  });

  it('semanal → hábito', () => {
    const movs = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].map((f) => gasto(f, 12_000, 'GIMNASIO CLASE', { categoria_id: 'ocio' }));
    const [r] = detectarRecurrentes(movs, '2026-10-07', CATEGORIAS_BASE);
    expect(r.periodo).toBe('semanal');
    expect(r.clase).toBe('habito');
    expect(r.proximo_cobro).toBe('2026-10-12');
    expect(r.costo_anual).toBe(12_000 * 52);
  });

  it('arriendo mensual sin ser suscripción → fijo', () => {
    const movs = ['2026-07-05', '2026-08-05', '2026-09-05'].map((f) => gasto(f, 1_200_000, 'ARRIENDO APTO', { categoria_id: 'servicios' }));
    expect(detectarRecurrentes(movs, '2026-09-20', CATEGORIAS_BASE)[0].clase).toBe('fijo');
  });

  it('montos que varían más de 15 % → no es recurrente', () => {
    const movs = [gasto('2026-07-05', 30_000, 'CAFE X'), gasto('2026-08-05', 60_000, 'CAFE X'), gasto('2026-09-05', 100_000, 'CAFE X')];
    expect(detectarRecurrentes(movs, '2026-09-20', CATEGORIAS_BASE)).toHaveLength(0);
  });

  it('inactiva a los 45 días y activa a los 44', () => {
    const movs = netflix(['2026-06-20', '2026-07-20', '2026-08-20']);
    const activa = detectarRecurrentes(movs, '2026-10-03', CATEGORIAS_BASE)[0];     // 44 días
    const inactiva = detectarRecurrentes(movs, '2026-10-04', CATEGORIAS_BASE)[0];   // 45 días
    expect(activa.activa).toBe(true);
    expect(inactiva.activa).toBe(false);
    expect(inactiva.proximo_cobro).toBeNull();
  });

  it('cobros del mismo día cuentan como uno', () => {
    const movs = [...netflix(['2026-07-20', '2026-08-20', '2026-09-20'], 22_500), ...netflix(['2026-07-20', '2026-08-20', '2026-09-20'], 22_500)];
    const [r] = detectarRecurrentes(movs, '2026-10-05', CATEGORIAS_BASE);
    expect(r.ocurrencias).toBe(3);
    expect(r.monto_tipico).toBe(45_000);
  });

  it('subió de precio: monto_anterior distinto del típico', () => {
    const movs = [gasto('2026-06-20', 17_900, 'SPOTIFY', { categoria_id: 'suscripciones' }), gasto('2026-07-20', 17_900, 'SPOTIFY', { categoria_id: 'suscripciones' }),
      gasto('2026-08-20', 17_900, 'SPOTIFY', { categoria_id: 'suscripciones' }), gasto('2026-09-20', 19_900, 'SPOTIFY', { categoria_id: 'suscripciones' })];
    const [r] = detectarRecurrentes(movs, '2026-10-05', CATEGORIAS_BASE);
    expect(r.monto_tipico).toBe(19_900);
    expect(r.monto_anterior).toBe(17_900);
    expect(subioDePrecio(r.monto_tipico, r.monto_anterior)).toBe(true);
  });

  it('ignora entradas, no computables y más de 400 días', () => {
    const viejos = netflix(['2025-01-20', '2025-02-20', '2025-03-20']);
    expect(detectarRecurrentes(viejos, '2026-10-05', CATEGORIAS_BASE)).toHaveLength(0);
  });
});

describe('subioDePrecio', () => {
  it('requiere +5 % y al menos $1.000', () => {
    expect(subioDePrecio(19_900, 17_900)).toBe(true);
    expect(subioDePrecio(18_800, 17_900)).toBe(false);   // +5,03 % pero 900 < 1.000
    expect(subioDePrecio(10_400, 10_000)).toBe(false);   // < 5 %
    expect(subioDePrecio(50_000, null)).toBe(false);
  });
});

describe('costos y próximo cobro', () => {
  it('costo anual y mensual', () => {
    expect(costoAnual(10_000, 'semanal')).toBe(520_000);
    expect(costoAnual(10_000, 'quincenal')).toBe(240_000);
    expect(costoAnual(10_000, 'bimestral')).toBe(60_000);
    expect(costoAnual(10_000, 'trimestral')).toBe(40_000);
    expect(costoAnual(10_000, 'semestral')).toBe(20_000);
    expect(costoMensual(10_000, 'mensual')).toBe(10_000);
    expect(costoMensual(10_000, 'anual')).toBe(833);
  });

  it('proximoCobro avanza hasta quedar ≥ hoy', () => {
    expect(proximoCobro('2026-07-20', 'mensual', 20, '2026-10-05')).toBe('2026-10-20');
    expect(proximoCobro('2026-09-20', 'mensual', null, '2026-10-05')).toBe('2026-10-20');
    expect(proximoCobro('2026-09-20', 'semanal', null, '2026-10-05')).toBe('2026-10-11');
    expect(proximoCobro('2026-01-31', 'mensual', 31, '2026-03-01')).toBe('2026-03-31');
  });
});

describe('cobrosEntre', () => {
  it('proyecta cobros en el rango y salta los descartados e inactivos', () => {
    const recs = [
      recurrente({ id: 1, proximo_cobro: '2026-10-20' }),
      recurrente({ id: 2, nombre: 'Semanal', periodo: 'semanal', proximo_cobro: '2026-10-16', ultimo_cobro: '2026-10-09' }),
      recurrente({ id: 3, estado: 'descartada', proximo_cobro: '2026-10-18' }),
      recurrente({ id: 4, activa: false, proximo_cobro: null }),
    ];
    const res = cobrosEntre(recs, '2026-10-15', '2026-10-31');
    expect(res.map((x) => x.recurrente.id + '@' + x.fecha)).toEqual(['2@2026-10-16', '1@2026-10-20', '2@2026-10-23', '2@2026-10-30']);
  });
});

describe('fusionarDeteccion', () => {
  it('respeta «descartada» e inactiva lo que ya no se detecta', () => {
    const previos = [
      recurrente({ id: 1, comercio_norm: 'netflix', estado: 'descartada' }),
      recurrente({ id: 2, comercio_norm: 'spotify', estado: 'confirmada' }),
      recurrente({ id: 3, comercio_norm: 'viejo', estado: 'detectada', activa: true }),
      recurrente({ id: 4, comercio_norm: 'ya inactivo', activa: false }),
    ];
    const nuevos = detectarRecurrentes(
      [...netflix(['2026-07-20', '2026-08-20', '2026-09-20']),
        ...['2026-07-21', '2026-08-21', '2026-09-21'].map((f) => gasto(f, 17_900, 'SPOTIFY', { categoria_id: 'suscripciones' })),
        ...['2026-07-22', '2026-08-22', '2026-09-22'].map((f) => gasto(f, 5_000, 'HBO', { categoria_id: 'suscripciones' }))],
      '2026-10-05', CATEGORIAS_BASE,
    ).map((n) => (n.comercio_norm === 'netflix com' ? { ...n, comercio_norm: 'netflix' } : n.comercio_norm === 'spotify' ? n : n));
    const { upserts, inactivar } = fusionarDeteccion(previos, nuevos);
    expect(upserts.find((u) => u.comercio_norm === 'netflix')!.estado).toBe('descartada');
    expect(upserts.find((u) => u.comercio_norm === 'spotify')!.estado).toBe('confirmada');
    expect(upserts.find((u) => u.comercio_norm === 'hbo')!.estado).toBe('detectada');
    expect(inactivar).toEqual(['viejo']);
  });
});
