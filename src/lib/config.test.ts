import { describe, expect, it } from 'vitest';
import { CONFIG_POR_DEFECTO, mezclarConfig, validarValorConfig } from './config';
import { ErrorUsuario } from './tipos';

describe('CONFIG_POR_DEFECTO (§8.1)', () => {
  it('valores del SPEC', () => {
    expect(CONFIG_POR_DEFECTO).toMatchObject({
      ingreso_mensual: null, pct_ahorro: 10, umbral_gasto_alto: 200000, umbral_hormiga: 25000, umbral_impulso: 100000,
      horas_espera_impulso: 48, minutos_fusion: 30, minutos_duplicado: 10, max_push_por_evaluacion: 3, pausa_hasta: null,
    });
    expect(CONFIG_POR_DEFECTO.nocturno).toEqual({ desde: '22:00', hasta: '05:00' });
    expect(CONFIG_POR_DEFECTO.horario_push).toEqual({ desde: '07:00', hasta: '21:30' });
    expect(CONFIG_POR_DEFECTO.semaforo).toEqual({ dia_amarillo: 0.7, dia_rojo: 1.0, mes_amarillo: 0.95, mes_rojo: 1.05 });
    expect(CONFIG_POR_DEFECTO.patrones_pago_tarjeta).toContain('rappicard');
    expect(CONFIG_POR_DEFECTO.patrones_interno).toContain('bolsillo');
  });
  it('cada valor por defecto es válido según su propia validación', () => {
    for (const k of Object.keys(CONFIG_POR_DEFECTO) as (keyof typeof CONFIG_POR_DEFECTO)[]) {
      expect(validarValorConfig(k, CONFIG_POR_DEFECTO[k])).toEqual(CONFIG_POR_DEFECTO[k]);
    }
  });
});

describe('validarValorConfig', () => {
  const falla = (k: Parameters<typeof validarValorConfig>[0], v: unknown) => {
    try {
      validarValorConfig(k, v);
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorUsuario);
      expect((e as ErrorUsuario).codigo).toBe('validacion');
      return;
    }
    throw new Error(`debió fallar: ${String(k)}=${JSON.stringify(v)}`);
  };

  it('enteros con rango', () => {
    expect(validarValorConfig('umbral_hormiga', 30000)).toBe(30000);
    falla('umbral_hormiga', 999);
    falla('umbral_hormiga', 200001);
    falla('umbral_hormiga', 30000.5);
    falla('umbral_hormiga', '30000');
    falla('umbral_gasto_alto', 9999);
    falla('horas_espera_impulso', 0);
    falla('horas_espera_impulso', 337);
    falla('minutos_fusion', 4);
    falla('minutos_duplicado', 61);
    falla('max_push_por_evaluacion', 11);
  });
  it('ingreso_mensual acepta null y 0..10^10', () => {
    expect(validarValorConfig('ingreso_mensual', null)).toBeNull();
    expect(validarValorConfig('ingreso_mensual', 4_000_000)).toBe(4000000);
    falla('ingreso_mensual', -1);
    falla('ingreso_mensual', 10_000_000_001);
    falla('ingreso_mensual', NaN);
  });
  it('pct_ahorro 0..80', () => {
    expect(validarValorConfig('pct_ahorro', 0)).toBe(0);
    expect(validarValorConfig('pct_ahorro', 80)).toBe(80);
    falla('pct_ahorro', 81);
    falla('pct_ahorro', -1);
    falla('pct_ahorro', Infinity);
  });
  it('horas HH:MM', () => {
    expect(validarValorConfig('nocturno', { desde: '23:00', hasta: '04:30' })).toEqual({ desde: '23:00', hasta: '04:30' });
    falla('nocturno', { desde: '24:00', hasta: '05:00' });
    falla('nocturno', { desde: '22:00' });
    falla('nocturno', { desde: '22:00', hasta: '22:00' });
    falla('horario_push', 'x');
    falla('horario_push', null);
  });
  it('un objeto de horas descarta claves extra', () => {
    expect(validarValorConfig('horario_push', { desde: '08:00', hasta: '20:00', otra: 1 })).toEqual({ desde: '08:00', hasta: '20:00' });
  });
  it('pausa_hasta', () => {
    expect(validarValorConfig('pausa_hasta', null)).toBeNull();
    expect(validarValorConfig('pausa_hasta', '2026-10-16T12:00:00Z')).toBe('2026-10-16T12:00:00Z');
    expect(validarValorConfig('pausa_hasta', '2026-10-16T12:00:00.000Z')).toBe('2026-10-16T12:00:00Z');
    falla('pausa_hasta', '2026-10-16');
    falla('pausa_hasta', '2026-13-45T00:00:00Z');
    falla('pausa_hasta', 12345);
  });
  it('semaforo', () => {
    expect(validarValorConfig('semaforo', { dia_amarillo: 0.6, dia_rojo: 0.9, mes_amarillo: 0.9, mes_rojo: 1.1 })).toEqual({
      dia_amarillo: 0.6, dia_rojo: 0.9, mes_amarillo: 0.9, mes_rojo: 1.1,
    });
    falla('semaforo', { dia_amarillo: 1, dia_rojo: 0.5, mes_amarillo: 0.9, mes_rojo: 1.1 });
    falla('semaforo', { dia_amarillo: 0.05, dia_rojo: 0.5, mes_amarillo: 0.9, mes_rojo: 1.1 });
    falla('semaforo', { dia_amarillo: 0.7, dia_rojo: 1, mes_amarillo: 0.9 });
  });
  it('patrones se normalizan, se deduplican y se limitan', () => {
    expect(validarValorConfig('patrones_interno', ['Bolsillo Ahorro', 'bolsillo  ahorro', 'Ñandú 123456'])).toEqual([
      'bolsillo ahorro', 'nandu',
    ]);
    falla('patrones_interno', ['a']);
    falla('patrones_interno', [1]);
    falla('patrones_interno', 'bolsillo');
    falla('patrones_interno', Array.from({ length: 21 }, (_, i) => `patron ${i}x`));
  });
  it('clave desconocida', () => {
    falla('no_existe' as never, 1);
  });
});

describe('mezclarConfig', () => {
  it('sin filas = valores por defecto (copia independiente)', () => {
    const c = mezclarConfig([]);
    expect(c).toEqual(CONFIG_POR_DEFECTO);
    c.nocturno.desde = '20:00';
    expect(CONFIG_POR_DEFECTO.nocturno.desde).toBe('22:00');
  });
  it('aplica los valores guardados', () => {
    const c = mezclarConfig([
      { clave: 'ingreso_mensual', valor: '4000000' },
      { clave: 'pct_ahorro', valor: '15' },
      { clave: 'nocturno', valor: '{"desde":"23:00","hasta":"04:00"}' },
    ]);
    expect(c.ingreso_mensual).toBe(4000000);
    expect(c.pct_ahorro).toBe(15);
    expect(c.nocturno).toEqual({ desde: '23:00', hasta: '04:00' });
    expect(c.umbral_hormiga).toBe(25000);
  });
  it('ignora claves desconocidas, JSON roto y valores fuera de rango', () => {
    const c = mezclarConfig([
      { clave: 'inventada', valor: '1' },
      { clave: 'pct_ahorro', valor: '{roto' },
      { clave: 'umbral_hormiga', valor: '5' },
      { clave: '__proto__', valor: '{"x":1}' },
      { clave: 'constructor', valor: '1' },
    ]);
    expect(c).toEqual(CONFIG_POR_DEFECTO);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('claves del rediseño (tutorial y deudas)', () => {
  it('valores por defecto', () => {
    expect(CONFIG_POR_DEFECTO).toMatchObject({ tutorial_visto: false, estrategia_deudas: 'avalancha', pago_deudas_mensual: null });
  });

  it('validación', () => {
    expect(validarValorConfig('tutorial_visto', true)).toBe(true);
    expect(() => validarValorConfig('tutorial_visto', 'si')).toThrow(ErrorUsuario);
    expect(validarValorConfig('estrategia_deudas', 'bola_nieve')).toBe('bola_nieve');
    expect(() => validarValorConfig('estrategia_deudas', 'nieve')).toThrow(ErrorUsuario);
    expect(validarValorConfig('pago_deudas_mensual', 500_000)).toBe(500_000);
    expect(validarValorConfig('pago_deudas_mensual', null)).toBeNull();
    expect(() => validarValorConfig('pago_deudas_mensual', 0)).toThrow(ErrorUsuario);
    expect(() => validarValorConfig('pago_deudas_mensual', 1.5)).toThrow(ErrorUsuario);
  });

  it('mezclarConfig respeta lo guardado e ignora lo inválido', () => {
    const c = mezclarConfig([
      { clave: 'tutorial_visto', valor: 'true' },
      { clave: 'estrategia_deudas', valor: '"cualquiera"' },
      { clave: 'pago_deudas_mensual', valor: '800000' },
    ]);
    expect(c).toMatchObject({ tutorial_visto: true, estrategia_deudas: 'avalancha', pago_deudas_mensual: 800_000 });
  });
});

describe('dia_ingreso (A2: día del mes en que entra el ingreso)', () => {
  it('por defecto null (ingreso irregular); acepta enteros 1..31 o null', () => {
    expect(CONFIG_POR_DEFECTO.dia_ingreso).toBeNull();
    expect(validarValorConfig('dia_ingreso', 1)).toBe(1);
    expect(validarValorConfig('dia_ingreso', 31)).toBe(31);
    expect(validarValorConfig('dia_ingreso', null)).toBeNull();
    for (const malo of [0, 32, 15.5, '15', -1]) expect(() => validarValorConfig('dia_ingreso', malo)).toThrow(ErrorUsuario);
  });

  it('mezclarConfig: lo guardado válido se usa; lo inválido vuelve a null', () => {
    expect(mezclarConfig([{ clave: 'dia_ingreso', valor: '30' }]).dia_ingreso).toBe(30);
    expect(mezclarConfig([{ clave: 'dia_ingreso', valor: '40' }]).dia_ingreso).toBeNull();
  });
});
