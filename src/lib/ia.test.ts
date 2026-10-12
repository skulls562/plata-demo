import { describe, expect, it, vi } from 'vitest';
import {
  crearClienteIA, extraerNumeros, plantillaPregunta, promptRedaccion, promptRouterPregunta, redactar, responderPregunta, verificarCifras,
} from './ia';
import { crearDatosFalsos } from '../../tests/fakes/datos-falsos';
import { crearIAFalsa, iaCaida } from '../../tests/fakes/ia-falsa';
import { config, escenarioCanonico, gasto, metaConAportes, recurrente } from '../../tests/fixtures/constructores';

const AHORA = new Date('2026-10-15T17:00:00Z');

describe('guardia de cifras', () => {
  const hechos = { contexto: 'x', hechos: { libre_hoy: '$29.117', pct: '13%', fecha: '2027-06-01' }, recomendaciones: [] };
  it('extrae números como solo dígitos', () => {
    expect(extraerNumeros('$52.300 y 13% el 2027-06-01')).toEqual(['52300', '13', '2027', '06', '01']);
  });
  it('acepta cifras copiadas', () => {
    expect(verificarCifras('Hoy te quedan $29.117, un 13% del mes.', hechos)).toBe(true);
    expect(verificarCifras('Sin cifras, solo ánimo.', hechos)).toBe(true);
  });
  it('rechaza cifra inventada, porcentaje nuevo y fecha nueva', () => {
    expect(verificarCifras('Te quedan $30.000', hechos)).toBe(false);
    expect(verificarCifras('Vas en 14%', hechos)).toBe(false);
    expect(verificarCifras('Llegas el 2027-07-01', hechos)).toBe(false);
  });
  it('rechaza HTML, enlaces, vacío y textos largos', () => {
    expect(verificarCifras('<b>$29.117</b>', hechos)).toBe(false);
    expect(verificarCifras('mira https://x.co', hechos)).toBe(false);
    expect(verificarCifras('  ', hechos)).toBe(false);
    expect(verificarCifras('a'.repeat(501), hechos)).toBe(false);
  });
});

describe('redactar', () => {
  const h = { contexto: 'Cierre', hechos: { libre_hoy: '$29.117' }, recomendaciones: [{ titulo: 'T', detalle: 'Detalle $29.117' }] };
  it('usa la IA si respeta las cifras', async () => {
    const ia = crearIAFalsa({ texto: 'Te quedan $29.117 hoy.' });
    expect(await redactar(h, ia, 'plantilla')).toEqual({ texto: 'Te quedan $29.117 hoy.', fuente: 'ia' });
  });
  it('plantilla si la IA miente, no responde o está caída', async () => {
    expect((await redactar(h, crearIAFalsa({ texto: 'Te quedan $99.999' }), 'plantilla')).fuente).toBe('plantilla');
    expect((await redactar(h, crearIAFalsa({ texto: null }), 'plantilla')).texto).toBe('plantilla');
    const caida = iaCaida();
    expect(await redactar(h, caida, 'plantilla')).toEqual({ texto: 'plantilla', fuente: 'plantilla' });
    expect(caida.llamadas).toHaveLength(0);
  });
  it('el prompt lleva hechos y recomendaciones en orden', () => {
    const p = promptRedaccion(h);
    expect(p.sistema).toContain('SOLO las cifras');
    expect(p.usuario).toContain('CONTEXTO: Cierre');
    expect(p.usuario).toContain('{"libre_hoy":"$29.117"}');
    expect(p.usuario).toContain('1. T: Detalle $29.117');
  });
});

describe('router de preguntas', () => {
  it('el prompt trae fecha, categorías y la pregunta como dato', () => {
    const p = promptRouterPregunta('¿cuánto gasté?', { hoy: '2026-10-15', mes_actual: '2026-10', categorias: ['comida', 'ocio'] });
    expect(p.sistema).toContain('Hoy es 2026-10-15');
    expect(p.sistema).toContain('comida, ocio');
    expect(p.usuario).toBe('<<<P\n¿cuánto gasté?\nP>>>');
    expect((p.esquema as { properties: { intencion: { enum: string[] } } }).properties.intencion.enum).toHaveLength(11);
  });

  const datos = () => {
    const i = escenarioCanonico();
    return crearDatosFalsos({
      movimientos: [
        ...i.movimientos,
        gasto('2026-09-10', 40_000, 'RAPPI COLOMBIA', { categoria_id: 'comida', id: 9001 }),
        gasto('2026-09-20', 60_000, 'RAPPI COLOMBIA', { categoria_id: 'comida', id: 9002 }),
      ],
      config: config({ ingreso_mensual: 4_000_000 }), fijos: i.fijos, recurrentes: [recurrente()], metas: [metaConAportes({ aportado: 500_000 })],
    });
  };
  const ruta = (intencion: string, parametros = {}) => crearIAFalsa({ json: { intencion, parametros }, texto: null });

  it('gasto_comercio suma lo del comercio en el rango', async () => {
    const r = await responderPregunta('¿cuánto gasté en Rappi en septiembre?', datos(), ruta('gasto_comercio', { comercio: 'Rappi', desde: '2026-09-01', hasta: '2026-09-30' }), AHORA);
    expect(r.intencion).toBe('gasto_comercio');
    expect(r.hechos).toMatchObject({ total: '$100.000', cantidad: '2' });
    expect(r.fuente).toBe('plantilla');
    expect(r.texto).toContain('$100.000');
  });

  it('usa la redacción de la IA si respeta cifras', async () => {
    const ia = crearIAFalsa({ json: { intencion: 'gasto_comercio', parametros: { comercio: 'Rappi', desde: '2026-09-01', hasta: '2026-09-30' } }, texto: 'En Rappi gastaste $100.000.' });
    const r = await responderPregunta('¿cuánto gasté en Rappi?', datos(), ia, AHORA);
    expect(r).toMatchObject({ fuente: 'ia', texto: 'En Rappi gastaste $100.000.' });
  });

  it('IA que inventa cifras → plantilla', async () => {
    const ia = crearIAFalsa({ json: { intencion: 'dinero_libre_hoy', parametros: {} }, texto: 'Te quedan $1.000.000' });
    const r = await responderPregunta('cómo voy hoy', datos(), ia, AHORA);
    expect(r.fuente).toBe('plantilla');
    expect(r.texto).toContain('$29.117');
  });

  it('intención desconocida o fuera de alcance → texto fijo', async () => {
    const d = datos();
    for (const ia of [ruta('hackear_banco'), ruta('fuera_de_alcance'), crearIAFalsa({ json: 'basura', texto: null })]) {
      const r = await responderPregunta('¿qué acciones compro?', d, ia, AHORA);
      expect(r.intencion).toBe('fuera_de_alcance');
      expect(r.texto).toContain('Eso no lo sé responder');
    }
  });

  it('con la IA caída usa palabras clave', async () => {
    const r = await responderPregunta('¿cuánto puedo gastar hoy?', datos(), iaCaida(), AHORA);
    expect(r.intencion).toBe('dinero_libre_hoy');
    expect(r.fuente).toBe('plantilla');
  });

  it('parámetros inválidos piden el dato', async () => {
    const d = datos();
    expect((await responderPregunta('x', d, ruta('gasto_categoria', { categoria: 'yates' }), AHORA)).texto).toContain('¿Qué categoría?');
    expect((await responderPregunta('x', d, ruta('resumen_mes', { mes: '2020-01' }), AHORA)).texto).toContain('¿De qué mes?');
    expect((await responderPregunta('x', d, ruta('top_comercios', { n: 99 }), AHORA)).texto).toContain('entre 1 y 10');
    expect((await responderPregunta('x', d, ruta('puedo', { monto_texto: 'abc' }), AHORA)).texto).toContain('¿Cuánto cuesta?');
    expect((await responderPregunta('x', d, ruta('gasto_comercio', { comercio: 'rappi', desde: 'ayer' }), AHORA)).texto).toContain('fechas');
  });

  it('las 11 funciones son de solo lectura', async () => {
    const d = datos();
    const casos: [string, object][] = [
      ['resumen_mes', { mes: '2026-09' }], ['gasto_categoria', { categoria: 'comida', mes: 'septiembre' }],
      ['gasto_comercio', { comercio: 'rappi' }], ['comparar_meses', { mes: '2026-10', mes_b: '2026-09' }], ['top_comercios', { mes: '2026-09', n: 3 }],
      ['dinero_libre_hoy', {}], ['suscripciones', {}], ['metas', {}], ['puedo', { monto_texto: '150k', descripcion: 'audífonos' }],
      ['buscar_movimientos', { comercio: 'rappi', desde: '2026-09-01', hasta: '2026-09-30' }], ['fuera_de_alcance', {}],
    ];
    for (const [i, p] of casos) {
      const r = await responderPregunta('pregunta', d, ruta(i, p), AHORA);
      expect(r.intencion).toBe(i);
      expect(r.texto.length).toBeGreaterThan(5);
    }
    expect(d.llamadas).toEqual([]);   // ninguna escritura (ni lista de espera con /puedo)
  });

  it('plantillaPregunta cubre casos sin datos', () => {
    expect(plantillaPregunta('metas', { lista: '' })).toBe('No tienes metas activas.');
    expect(plantillaPregunta('suscripciones', { cantidad: '0' })).toContain('No tengo');
    expect(plantillaPregunta('fuera_de_alcance', {})).toContain('Eso no lo sé');
  });
});

describe('cliente Ollama (fetch inyectado, sin red)', () => {
  const resp = (cuerpo: unknown, ok = true) => ({ ok, json: async () => cuerpo }) as Response;

  it('chatJSON envía esquema y opciones, y parsea', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => resp({ message: { content: '{"a":1}' } }));
    const c = crearClienteIA({ url: 'http://127.0.0.1:11434/', modelo: 'qwen2.5:7b', fetch: f as unknown as typeof fetch });
    expect(await c.chatJSON('s', 'u', { type: 'object' })).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: 'qwen2.5:7b', stream: false, format: { type: 'object' }, options: { temperature: 0 } });
  });

  it('errores, JSON roto o HTTP malo → null, sin lanzar', async () => {
    const mal = crearClienteIA({ url: 'http://x', modelo: 'm', fetch: (async () => { throw new Error('boom'); }) as unknown as typeof fetch });
    expect(await mal.chatJSON('s', 'u', {})).toBeNull();
    expect(await mal.chatTexto('s', 'u')).toBeNull();
    const roto = crearClienteIA({ url: 'http://x', modelo: 'm', fetch: (async () => resp({ message: { content: 'no json' } })) as unknown as typeof fetch });
    expect(await roto.chatJSON('s', 'u', {})).toBeNull();
    const http = crearClienteIA({ url: 'http://x', modelo: 'm', fetch: (async () => resp({}, false)) as unknown as typeof fetch });
    expect(await http.chatTexto('s', 'u')).toBeNull();
  });

  it('chatTexto recorta y disponible() se cachea 60 s', async () => {
    const f = vi.fn(async (u: string) => (u.endsWith('/api/tags') ? resp({}) : resp({ message: { content: '  hola mundo  ' } })));
    const c = crearClienteIA({ url: 'http://x', modelo: 'm', fetch: f as unknown as typeof fetch });
    expect(await c.chatTexto('s', 'u', { maxCaracteres: 4 })).toBe('hola');
    expect(await c.disponible()).toBe(true);
    await c.disponible();
    expect(f.mock.calls.filter((x) => String(x[0]).endsWith('/api/tags'))).toHaveLength(1);
  });
});
