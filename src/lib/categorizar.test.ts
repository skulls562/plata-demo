import { describe, expect, it } from 'vitest';
import { abrirDB } from './db';
import { normalizarComercio } from './formato';
import { categorizar, coincide, patronAprendido, REGLAS_SEMILLA, resolverCategoria } from './categorizar';
import type { Categoria, ReglaCategoria, TipoMovimiento } from './tipos';

let seq = 0;
const regla = (patron: string, categoria_id: string, origen: ReglaCategoria['origen'] = 'semilla', aciertos = 0): ReglaCategoria => ({
  id: ++seq, patron, categoria_id, origen, aciertos,
});
const semillas: ReglaCategoria[] = REGLAS_SEMILLA.map((r) => regla(r.patron, r.categoria_id));

const cat = (id: string, nombre: string, emoji: string, extra: Partial<Categoria> = {}): Categoria => ({
  id, nombre, emoji, es_gasto: true, esencial: false, cuenta_hormiga: true, orden: 1, sistema: false, activa: true, ...extra,
});
const cats: Categoria[] = [
  cat('mercado', 'Mercado', '🛒'), cat('comida', 'Comida', '🍔'), cat('compras', 'Compras', '🛍'),
  cat('transporte', 'Transporte', '🚕'), cat('ocio', 'Ocio', '🎟'), cat('otros', 'Otros', '📦'),
  cat('ingresos', 'Ingresos', '💰', { es_gasto: false, sistema: true }),
];

describe('coincide', () => {
  it('patrón de ≤ 3 caracteres = token completo', () => {
    expect(coincide('tienda d1 ant marini', 'd1')).toBe(true);
    expect(coincide('tienda d10', 'd1')).toBe(false);
    expect(coincide('supermercado ara', 'ara')).toBe(true);
    expect(coincide('arana cafe', 'ara')).toBe(false);
    expect(coincide('d1', 'd1')).toBe(true);
  });
  it('patrón largo = prefijo de token', () => {
    expect(coincide('clinica las vegas', 'clinica')).toBe(true);
    expect(coincide('odontologia sonrisa', 'odontolog')).toBe(true);
    expect(coincide('subclinica', 'clinica')).toBe(false);
    expect(coincide('pago amazon prime video', 'amazon prime')).toBe(true);
  });
  it('vacíos no coinciden', () => {
    expect(coincide('', 'abc')).toBe(false);
    expect(coincide('abc', '')).toBe(false);
  });
});

describe('categorizar', () => {
  const c = (comercio: string, tipo: TipoMovimiento = 'compra', computa = true, reglas = semillas) =>
    categorizar(normalizarComercio(comercio), tipo, computa, reglas);

  it('el ejemplo del SPEC', () => {
    expect(c('TIENDA D1 ANT MARINI')).toMatchObject({ categoria_id: 'mercado', fuente: 'regla' });
  });
  it('gana el patrón más largo', () => {
    expect(c('AMAZON PRIME VIDEO').categoria_id).toBe('suscripciones');
    expect(c('AMAZON COLOMBIA').categoria_id).toBe('compras');
    expect(c('MERCADO LIBRE COLOMBIA').categoria_id).toBe('compras');
    expect(c('MERCADOLIBRE').categoria_id).toBe('compras');
    expect(c('SUPERMERCADO LA 14').categoria_id).toBe('mercado');
  });
  it('d1 como token y ara no coincide con arana', () => {
    expect(c('D10 PRUEBA').categoria_id).toBe('otros');
    expect(c('ARANA PRUEBA').categoria_id).toBe('otros');
    expect(c('ARA CENTRO').categoria_id).toBe('mercado');
  });
  it('aprendida gana a semilla en empate', () => {
    const reglas = [...semillas, regla('rappi', 'ocio', 'aprendida', 3)];
    expect(c('RAPPI CENTRO', 'compra', true, reglas)).toMatchObject({ categoria_id: 'ocio', fuente: 'aprendida' });
    expect(c('RAPPI CENTRO').categoria_id).toBe('comida');
  });
  it('una semilla más larga le gana a una aprendida más corta', () => {
    const reglas = [...semillas, regla('amazon', 'ocio', 'aprendida')];
    expect(c('AMAZON PRIME', 'compra', true, reglas).categoria_id).toBe('suscripciones');
  });
  it('una regla manual cuenta como regla', () => {
    const reglas = [regla('kiosco don pepe', 'comida', 'manual')];
    expect(c('KIOSCO DON PEPE 2', 'compra', true, reglas)).toMatchObject({ categoria_id: 'comida', fuente: 'regla' });
  });
  it('ingreso → ingresos; computa=false → interno', () => {
    expect(c('EMPRESA PRUEBA', 'ingreso')).toEqual({ categoria_id: 'ingresos', fuente: 'regla', regla_id: null });
    expect(c('RAPPICARD', 'pago_tarjeta', false)).toEqual({ categoria_id: 'interno', fuente: 'regla', regla_id: null });
    expect(c('TIENDA D1', 'interno', false).categoria_id).toBe('interno');
  });
  it('reverso → la categoría que daría el comercio', () => {
    expect(c('TIENDA D1 ANT MARINI', 'reverso').categoria_id).toBe('mercado');
  });
  it('sin coincidencia → otros / defecto', () => {
    expect(c('COMERCIO RARO SIN REGLA')).toEqual({ categoria_id: 'otros', fuente: 'defecto', regla_id: null });
    expect(c('')).toEqual({ categoria_id: 'otros', fuente: 'defecto', regla_id: null });
  });
  it('devuelve el id de la regla usada', () => {
    const r = regla('tienda x', 'compras', 'aprendida');
    expect(c('TIENDA X CENTRO', 'compra', true, [r]).regla_id).toBe(r.id);
  });
});

describe('REGLAS_SEMILLA', () => {
  it('coincide exactamente con las semillas que inserta la migración 1', () => {
    const db = abrirDB(':memory:');
    const filas = db.prepare("SELECT patron, categoria_id FROM reglas_categoria WHERE origen = 'semilla' ORDER BY id").all() as {
      patron: string; categoria_id: string;
    }[];
    expect(filas.map((f) => ({ patron: f.patron, categoria_id: f.categoria_id }))).toEqual(
      REGLAS_SEMILLA.map((r) => ({ patron: r.patron, categoria_id: r.categoria_id })),
    );
    db.close();
  });
  it('todos los patrones ya están normalizados y sin duplicados', () => {
    const vistos = new Set<string>();
    for (const r of REGLAS_SEMILLA) {
      expect(normalizarComercio(r.patron)).toBe(r.patron);
      expect(vistos.has(r.patron)).toBe(false);
      vistos.add(r.patron);
    }
  });
});

describe('patronAprendido', () => {
  it('usa el comercio normalizado', () => {
    expect(patronAprendido('tienda d1 ant marini')).toBe('tienda d1 ant marini');
  });
  it('recorta a 40 caracteres por token entero', () => {
    const p = patronAprendido('supermercado de la esquina del barrio norte sector uno')!;
    expect(p.length).toBeLessThanOrEqual(40);
    expect('supermercado de la esquina del barrio norte sector uno'.startsWith(p)).toBe(true);
    expect(p).toBe('supermercado de la esquina del barrio');
  });
  it('un token enorme se corta a 40', () => {
    expect(patronAprendido('a'.repeat(80))).toBe('a'.repeat(40));
  });
  it('null si queda menos de 2 caracteres', () => {
    expect(patronAprendido('')).toBeNull();
    expect(patronAprendido('a')).toBeNull();
    expect(patronAprendido('123456')).toBeNull();     // número largo se descarta al normalizar
  });
});

describe('resolverCategoria', () => {
  it('por id, nombre y emoji', () => {
    expect(resolverCategoria('comida', cats)).toMatchObject({ ok: true, categoria: { id: 'comida' } });
    expect(resolverCategoria('Transporte', cats)).toMatchObject({ ok: true, categoria: { id: 'transporte' } });
    expect(resolverCategoria('🍔', cats)).toMatchObject({ ok: true, categoria: { id: 'comida' } });
    expect(resolverCategoria('🎟️', cats)).toMatchObject({ ok: true, categoria: { id: 'ocio' } });
  });
  it('por prefijo único de ≥ 3 caracteres', () => {
    expect(resolverCategoria('tran', cats)).toMatchObject({ ok: true, categoria: { id: 'transporte' } });
    expect(resolverCategoria('mer', cats)).toMatchObject({ ok: true, categoria: { id: 'mercado' } });
  });
  it('prefijo ambiguo devuelve las opciones', () => {
    const r = resolverCategoria('com', cats);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.opciones.map((o) => o.id).sort()).toEqual(['comida', 'compras']);
  });
  it('menos de 3 caracteres o desconocida: todas las activas', () => {
    const r1 = resolverCategoria('co', cats);
    expect(r1.ok).toBe(false);
    const r2 = resolverCategoria('zzz', cats);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.opciones.length).toBe(cats.length);
  });
  it('ignora categorías inactivas', () => {
    const r = resolverCategoria('ocio', cats.map((c) => (c.id === 'ocio' ? { ...c, activa: false } : c)));
    expect(r.ok).toBe(false);
  });
  it('acepta #', () => {
    expect(resolverCategoria('#comida', cats).ok).toBe(true);
  });
});

describe('categoría por defecto según el tipo (calidad de datos)', () => {
  it('un retiro va a «efectivo» sin mirar reglas (el cajero no es un comercio)', () => {
    // «upb1» es el nombre de un cajero: no debe heredar «estudio» por el prefijo upb.
    expect(categorizar('upb1', 'retiro', true, semillas)).toEqual({ categoria_id: 'efectivo', fuente: 'defecto', regla_id: null });
  });
  it('una transferencia sin regla va a «transferencias»; con regla manual gana la regla', () => {
    expect(categorizar('persona prueba', 'transferencia', true, semillas).categoria_id).toBe('transferencias');
    const manual = regla('persona prueba', 'mercado', 'manual');
    expect(categorizar('persona prueba', 'transferencia', true, [manual]).categoria_id).toBe('mercado');
  });
  it('una transferencia que no computa (el nuevo valor por defecto) se queda en «transferencias», no en interno', () => {
    expect(categorizar('persona prueba', 'transferencia', false, semillas).categoria_id).toBe('transferencias');
    expect(categorizar('persona prueba', 'interno', false, semillas).categoria_id).toBe('interno');
  });
  it('un pago o compra sin regla sigue en «otros»', () => {
    expect(categorizar('comercio inventado', 'compra', true, semillas).categoria_id).toBe('otros');
    expect(categorizar('pago por qr', 'pago', true, semillas).categoria_id).toBe('otros');
  });
});

describe('reglas semilla de la migración 2 (comercios colombianos frecuentes)', () => {
  const casos: Array<[string, string]> = [
    ['gopass', 'transporte'], ['eds la 33 fr', 'transporte'], ['the parking viva env', 'transporte'],
    ['pon tu precio', 'transporte'], ['s publicas de medellin', 'servicios'], ['univers pontificia b', 'estudio'],
    ['univ pontificia boli', 'estudio'], ['novaventa medellin c', 'compras'], ['recanto bolivariana', 'comida'],
    ['taco factory s a s', 'comida'], ['coffee lab med', 'comida'], ['sabor llanero andino', 'comida'],
    ['rapipharma sas', 'salud'], ['el faro de la marinilla', 'mercado'], ['superoriente simona', 'mercado'],
    ['banco davivienda sa', 'deudas'], ['mcdonal d a reles', 'comida'], ['dollarcity marinilla', 'compras'],
  ];
  for (const [comercio, esperada] of casos) {
    it(`${comercio} → ${esperada}`, () => {
      expect(categorizar(comercio, 'compra', true, semillas).categoria_id).toBe(esperada);
    });
  }
});

describe('viajes (migración 6)', () => {
  const cId = (comercio: string) => categorizar(normalizarComercio(comercio), 'compra', true, semillas).categoria_id;
  it('hotel, hospedaje, airbnb, vuelos y reservas van a viajes', () => {
    for (const x of ['HOTEL DECAMERON', 'Hoteles Estelar', 'una reserva de hotel', 'AIRBNB * HMXYZ', 'BOOKING.COM', 'AVIANCA', 'LATAM AIRLINES',
      'hospedaje en Guatapé', 'tiquetes aéreos a Cartagena', 'pasaje aereo', 'vuelo a Bogotá', 'DESPEGAR COM']) {
      expect(cId(x), x).toBe('viajes');
    }
  });
  it('el tiquete del metro y el pasaje del bus no son viajes', () => {
    expect(cId('METRO DE MEDELLIN')).toBe('transporte');
    expect(cId('tiquete del metro')).not.toBe('viajes');
    expect(cId('pasaje del bus')).not.toBe('viajes');
    expect(cId('reserva en el restaurante')).toBe('comida');
  });
});
