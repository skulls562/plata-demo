import { describe, expect, it } from 'vitest';
import {
  aBogota, deBogota, diasDelMes, diasEntre, escaparHTML, formatearCOP, formatearCOPCorto, formatearFechaCorta,
  formatearPct, mediana, mesAnterior, mesDe, normalizarComercio, normalizarTexto, parsearDineroCO,
  parsearFechaCorreo, parsearFechaUsuario, parsearMes, parsearMonto, rangoMes, recortar, sumarDias, sumarMeses,
} from './formato';

describe('parsearMonto (§6.3)', () => {
  const ok = (e: string, v: number) => expect(parsearMonto(e), e).toEqual({ ok: true, valor: v });
  it('80000 en todas sus formas', () => {
    for (const e of ['80k', '80 k', '80K', '80mil', '80 mil', '80 lucas', '80.000', '80,000', '$80.000', '80000']) ok(e, 80000);
  });
  it('1.500.000', () => {
    for (const e of ['1.5M', '1,5M', '1.5 m', '1.5 millones', '1,5 palos']) ok(e, 1500000);
  });
  it('2.000.000', () => {
    for (const e of ['2 palos', '2M', '2 millones']) ok(e, 2000000);
  });
  it('separadores completos', () => {
    ok('1.234.567', 1234567);
    ok('1.234.567,89', 1234568);
    ok('1.500k', 1500000);
    ok('50 lucas', 50000);
  });
  it('errores', () => {
    expect(parsearMonto('80.5')).toEqual({ ok: false, error: 'ambiguo' });
    expect(parsearMonto('1,5')).toEqual({ ok: false, error: 'ambiguo' });
    expect(parsearMonto('0')).toEqual({ ok: false, error: 'cero' });
    expect(parsearMonto('abc')).toEqual({ ok: false, error: 'formato' });
    expect(parsearMonto('1.5.3')).toEqual({ ok: false, error: 'formato' });
    expect(parsearMonto('80k500')).toEqual({ ok: false, error: 'formato' });
    expect(parsearMonto('20000000000')).toEqual({ ok: false, error: 'muy_grande' });
    expect(parsearMonto('')).toEqual({ ok: false, error: 'vacio' });
    expect(parsearMonto('   ')).toEqual({ ok: false, error: 'vacio' });
    expect(parsearMonto('k')).toEqual({ ok: false, error: 'formato' });
  });
});

describe('parsearDineroCO (§3.11)', () => {
  it('formatos de correo', () => {
    expect(parsearDineroCO('14.730,00')).toBe(14730);
    expect(parsearDineroCO('129,900')).toBe(129900);
    expect(parsearDineroCO('1.234.567,89')).toBe(1234568);
    expect(parsearDineroCO('129900')).toBe(129900);
    expect(parsearDineroCO('129,900.00')).toBe(129900);
    expect(parsearDineroCO('14.730')).toBe(14730);
    expect(parsearDineroCO('5.000.')).toBe(5000);          // punto final de la frase
  });
  it('null cuando no se entiende', () => {
    expect(parsearDineroCO('')).toBeNull();
    expect(parsearDineroCO('abc')).toBeNull();
    expect(parsearDineroCO('1.2.3')).toBeNull();
    expect(parsearDineroCO('0')).toBeNull();
    expect(parsearDineroCO('0,00')).toBeNull();
    expect(parsearDineroCO('99999999999')).toBeNull();
    expect(parsearDineroCO('1.234,567')).toBeNull();
  });
  it('un solo separador con 1-2 dígitos es decimal y se redondea', () => {
    expect(parsearDineroCO('80,5')).toBe(81);
    expect(parsearDineroCO('1500.75')).toBe(1501);
  });
});

describe('formateo', () => {
  it('formatearCOP', () => {
    expect(formatearCOP(0)).toBe('$0');
    expect(formatearCOP(999)).toBe('$999');
    expect(formatearCOP(1000)).toBe('$1.000');
    expect(formatearCOP(1234567)).toBe('$1.234.567');
    expect(formatearCOP(-5000)).toBe('−$5.000');
    expect(formatearCOP(1234.6)).toBe('$1.235');
  });
  it('formatearCOPCorto', () => {
    expect(formatearCOPCorto(80000)).toBe('$80k');
    expect(formatearCOPCorto(1500000)).toBe('$1,5M');
    expect(formatearCOPCorto(2000000)).toBe('$2M');
    expect(formatearCOPCorto(950)).toBe('$950');
    expect(formatearCOPCorto(1500)).toBe('$1,5k');
    expect(formatearCOPCorto(999990)).toBe('$1M');
    expect(formatearCOPCorto(-80000)).toBe('−$80k');
  });
  it('formatearPct', () => {
    expect(formatearPct(0.1326)).toBe('13%');
    expect(formatearPct(1.1326)).toBe('113%');
  });
  it('escaparHTML y recortar', () => {
    expect(escaparHTML('<b>x</b>&"')).toBe('&lt;b&gt;x&lt;/b&gt;&amp;&quot;');
    expect(recortar('hola mundo', 20)).toBe('hola mundo');
    expect(recortar('hola mundo', 5)).toBe('hola…');
    expect(recortar('hola', 4)).toBe('hola');
  });
});

describe('normalización', () => {
  it('normalizarTexto', () => {
    expect(normalizarTexto('  Café  Ñandú & Co. ')).toBe('cafe nandu co');
  });
  it('normalizarComercio (§3.10)', () => {
    expect(normalizarComercio('TIENDA D1 ANT MARINI')).toBe('tienda d1 ant marini');
    expect(normalizarComercio('PAGO PSE 12345678 EPM')).toBe('pago pse epm');
    expect(normalizarComercio('Pastelería Ñoño & Hijos 0000')).toBe('pasteleria nono hijos');
    expect(normalizarComercio('x'.repeat(200)).length).toBe(120);
    expect(normalizarComercio('Tienda 123')).toBe('tienda 123');   // < 4 dígitos se conserva
  });
});

describe('fechas Bogotá', () => {
  it('aBogota cruza el día UTC', () => {
    // 23:30 Bogotá = 04:30Z del día siguiente
    expect(aBogota(new Date('2026-10-07T04:30:00Z'))).toEqual({ fecha: '2026-10-06', hora: '23:30', diaSemana: 2 });
    // 00:30 Bogotá = 05:30Z
    expect(aBogota(new Date('2026-10-07T05:30:00Z'))).toEqual({ fecha: '2026-10-07', hora: '00:30', diaSemana: 3 });
    expect(aBogota(new Date('2026-10-04T12:00:00Z')).diaSemana).toBe(0);   // domingo
  });
  it('deBogota es la inversa', () => {
    expect(deBogota('2026-10-06', '13:59').toISOString()).toBe('2026-10-06T18:59:00.000Z');
    expect(deBogota('2026-10-06').toISOString()).toBe('2026-10-06T05:00:00.000Z');
    expect(aBogota(deBogota('2026-12-31', '23:59'))).toMatchObject({ fecha: '2026-12-31', hora: '23:59' });
  });
  it('meses y días', () => {
    expect(diasDelMes('2026-10')).toBe(31);
    expect(diasDelMes('2027-02')).toBe(28);
    expect(diasDelMes('2028-02')).toBe(29);
    expect(mesDe('2026-10-06')).toBe('2026-10');
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(rangoMes('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(sumarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(diasEntre('2026-10-01', '2026-10-15')).toBe(14);
    expect(diasEntre('2026-10-15', '2026-10-01')).toBe(-14);
  });
  it('sumarMeses recorta al último día', () => {
    expect(sumarMeses('2027-01-31', 1)).toBe('2027-02-28');
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(sumarMeses('2026-11-30', 3)).toBe('2027-02-28');
    expect(sumarMeses('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(sumarMeses('2026-12-15', 1)).toBe('2027-01-15');
    expect(sumarMeses('2026-01-15', -2)).toBe('2025-11-15');
  });
  it('parsearFechaCorreo', () => {
    expect(parsearFechaCorreo('Tue, 06 Oct 2026 13:59:40 -0500')?.toISOString()).toBe('2026-10-06T18:59:40.000Z');
    expect(parsearFechaCorreo('2026-10-06T18:59:40Z')?.toISOString()).toBe('2026-10-06T18:59:40.000Z');
    expect(parsearFechaCorreo('Tue, 06 Oct 2026 13:59:40 -0500 (COT)')?.toISOString()).toBe('2026-10-06T18:59:40.000Z');
    expect(parsearFechaCorreo('2026-10-06T13:59:00')?.toISOString()).toBe('2026-10-06T18:59:00.000Z');
    expect(parsearFechaCorreo('no es fecha')).toBeNull();
    expect(parsearFechaCorreo('')).toBeNull();
  });
  it('parsearFechaUsuario', () => {
    const hoy = '2026-10-01';
    expect(parsearFechaUsuario('hoy', hoy)).toBe('2026-10-01');
    expect(parsearFechaUsuario('ayer', hoy)).toBe('2026-09-30');          // ayer el día 1
    expect(parsearFechaUsuario('Anteayer', hoy)).toBe('2026-09-29');
    expect(parsearFechaUsuario('6/9', hoy)).toBe('2026-09-06');
    expect(parsearFechaUsuario('06/09/2026', hoy)).toBe('2026-09-06');
    expect(parsearFechaUsuario('2026-09-06', hoy)).toBe('2026-09-06');
    expect(parsearFechaUsuario('6/10', hoy)).toBe('2025-10-06');   // futura sin año → año anterior
  });
  it('parsearFechaUsuario: futuras y antiguas', () => {
    expect(parsearFechaUsuario('2026-10-02', '2026-10-01')).toBeNull();
    expect(parsearFechaUsuario('02/10/2026', '2026-10-01')).toBeNull();
    expect(parsearFechaUsuario('30/02', '2026-10-01')).toBeNull();
    expect(parsearFechaUsuario('2025-01-01', '2026-10-01')).toBeNull();   // > 400 días
    expect(parsearFechaUsuario('basura', '2026-10-01')).toBeNull();
    // Sin año y futura dentro del año → toma el año anterior (si está en 400 días)
    expect(parsearFechaUsuario('20/12', '2026-01-10')).toBe('2025-12-20');
  });
  it('parsearMes', () => {
    const hoy = '2026-10-15';
    expect(parsearMes('2026-09', hoy)).toBe('2026-09');
    expect(parsearMes('septiembre', hoy)).toBe('2026-09');
    expect(parsearMes('Sep', hoy)).toBe('2026-09');
    expect(parsearMes('sep 2025', hoy)).toBe('2025-09');
    expect(parsearMes('pasado', hoy)).toBe('2026-09');
    expect(parsearMes('noviembre', hoy)).toBe('2025-11');                  // no futuro
    expect(parsearMes('octubre', hoy)).toBe('2026-10');
    expect(parsearMes('2026-13', hoy)).toBeNull();
    expect(parsearMes('xyz', hoy)).toBeNull();
    expect(parsearMes('pasado', '2026-01-05')).toBe('2025-12');
  });
  it('formatearFechaCorta y mediana', () => {
    expect(formatearFechaCorta('2026-10-06')).toBe('6 oct');
    expect(formatearFechaCorta('2026-01-31')).toBe('31 ene');
    expect(mediana([])).toBe(0);
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });
});
