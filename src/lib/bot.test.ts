import { describe, expect, it } from 'vitest';
import {
  formatearHoy, formatearRecomendacion, formatearVeredicto, manejarUpdate, mensajeAviso, parsearCallback, parsearComando, partirMensaje,
  reporteCierre, reporteMensual, reporteSemanal, reporteSuscripciones, serializarCallback, tecladoCategorias, textoAyuda,
} from './bot';
import { calcularMetricas } from './metricas';
import { veredictoPuedo } from './recomendar';
import type { UpdateBot } from './tipos';
import { crearDatosFalsos } from '../../tests/fakes/datos-falsos';
import { crearIAFalsa, iaCaida } from '../../tests/fakes/ia-falsa';
import { CATEGORIAS_BASE, config, escenarioCanonico, gasto, mov, recurrente } from '../../tests/fixtures/constructores';

const AHORA = new Date('2026-10-15T17:00:00Z');
const URL = 'http://127.0.0.1:3010';

function entorno(extra: Parameters<typeof crearDatosFalsos>[0] = {}) {
  const i = escenarioCanonico();
  const datos = crearDatosFalsos({ movimientos: i.movimientos, fijos: i.fijos, recurrentes: i.recurrentes, config: i.config, ...extra });
  const ia = iaCaida();
  const texto = async (t: string, id = 1) => manejarUpdate({ update_id: id, chat_id: 1, tipo: 'texto', texto: t, message_id: 10 }, { datos, ia, ahora: AHORA, urlPanel: URL });
  const cb = async (data: string, id = 2) => manejarUpdate({ update_id: id, chat_id: 1, tipo: 'callback', callback_data: data, callback_query_id: 'q', message_id: 77 }, { datos, ia, ahora: AHORA, urlPanel: URL });
  return { datos, ia, texto, cb };
}

describe('parsearComando', () => {
  it('cada comando y alias', () => {
    const casos: [string, string][] = [
      ['/hoy', 'hoy'], ['/h', 'hoy'], ['/semana', 'semana'], ['/s', 'semana'], ['/mes', 'mes'], ['/m', 'mes'], ['/ultimos', 'ultimos'], ['/u', 'ultimos'],
      ['/categorias', 'categorias'], ['/cats', 'categorias'], ['/cat', 'cat'], ['/presupuesto', 'presupuesto'], ['/p', 'presupuesto'],
      ['/ingreso', 'ingreso'], ['/i', 'ingreso'], ['/meta', 'meta'], ['/puedo', 'puedo'], ['/quiero', 'quiero'],
      ['/suscripciones', 'suscripciones'], ['/subs', 'suscripciones'], ['/gasto', 'gasto'], ['/g', 'gasto'], ['/deshacer', 'deshacer'], ['/undo', 'deshacer'],
      ['/pausa', 'pausa'], ['/exportar', 'exportar'], ['/pregunta', 'pregunta'], ['/q', 'pregunta'], ['/panel', 'panel'],
      ['/ayuda', 'ayuda'], ['/start', 'ayuda'], ['/help', 'ayuda'],
    ];
    for (const [t, n] of casos) expect(parsearComando(t)).toEqual({ tipo: 'comando', nombre: n, args: '' });
  });
  it('argumentos, /cmd@Bot, mayúsculas y tildes', () => {
    expect(parsearComando('/puedo 80k audífonos')).toEqual({ tipo: 'comando', nombre: 'puedo', args: '80k audífonos' });
    expect(parsearComando('/hoy@PlataBot')).toEqual({ tipo: 'comando', nombre: 'hoy', args: '' });
    expect(parsearComando('/gasto@PlataBot 20k x')).toEqual({ tipo: 'comando', nombre: 'gasto', args: '20k x' });
    expect(parsearComando('/últimos 3')).toEqual({ tipo: 'comando', nombre: 'ultimos', args: '3' });
    expect(parsearComando('/HOY')).toMatchObject({ nombre: 'hoy' });
  });
  it('texto libre y desconocidos', () => {
    expect(parsearComando('hola qué tal')).toEqual({ tipo: 'texto_libre', texto: 'hola qué tal' });
    expect(parsearComando('/xyz')).toEqual({ tipo: 'desconocido', nombre: 'xyz' });
  });
});

describe('callbacks', () => {
  it('parsea y serializa cada acción (ida y vuelta)', () => {
    const datos = ['cat:1532', 'cs:1532:comida', 'ing:1', 'gas:1', 'int:1', 'rev:1', 'ign:1', 'und:88', 'dup:5', 'ndp:3:4', 'vol:1', 'sc:2', 'sd:2', 'ec:9', 'ed:9', 'e48:9', 'pz:24', 'ok',
      'm:hoy', 'm:mas', 'k:2h8:5', 'k:2h8:t', 'c:2h8:comida', 'f:2h8:vc', 'rm:7:comida', 'pc:7:ocio', 'ni:7', 'mv:7', 'cn:7', 'ps:7', 'pi:7', 'pu:5:7', 'bd:total', 'bm:comida', 'bp:comida', 'be:comida', 'bq:comida', 'ah:10', 'iu', 'me:3', 'ma:3', 'ms:3', 'mp:3'];
    for (const d of datos) {
      const c = parsearCallback(d);
      expect(c, d).not.toBeNull();
      expect(serializarCallback(c!)).toBe(d);
    }
    expect(parsearCallback('cs:1532:comida')).toEqual({ accion: 'cs', mov: 1532, cat: 'comida' });
  });
  it('inválidos: formato, números, desconocidos y más de 64 bytes', () => {
    for (const d of ['', 'cat', 'cat:abc', 'cat:0', 'cat:1:2:3', 'CAT:1', 'xx:1', 'pz:999', 'cs:1', 'ok:1', 'cat:1;drop', 'cat:-1', 'ndp:1', 'm:nada', 'k:2h8', 'k:muylargo1:5', 'ah:99', 'iu:1', 'pu:5', 'rm:7']) expect(parsearCallback(d), d).toBeNull();
    expect(parsearCallback(`cs:1:${'a'.repeat(70)}`)).toBeNull();
    expect(() => serializarCallback({ accion: 'cs', mov: 1, cat: 'a'.repeat(30) })).toThrow();
  });
});

describe('textos y partirMensaje', () => {
  it('la ayuda describe el menú y frases de ejemplo, sin slash (docs/BOT-UX.md)', () => {
    const a = textoAyuda();
    expect(a.startsWith('<b>Plata</b>')).toBe(true);
    expect(a).toContain('«café 8000»');
    expect(a).toContain('«recibí 500k»');
    expect(a).toContain('Montos: 80k · 80 mil · 80.000 · 1.5M · 2 palos · 50 lucas');
    expect(a).not.toMatch(/(^|\s)\/[a-z]/);
    expect(a.split('\n').length).toBeLessThanOrEqual(12);
  });
  it('parte en 4096 por líneas', () => {
    const linea = 'x'.repeat(99);
    const html = Array.from({ length: 100 }, () => linea).join('\n');
    const ps = partirMensaje(html);
    expect(ps.length).toBeGreaterThan(1);
    for (const p of ps) expect(p.length).toBeLessThanOrEqual(4096);
    expect(ps.join('\n')).toBe(html);
    expect(partirMensaje('corto')).toEqual(['corto']);
    expect(partirMensaje('y'.repeat(9000)).every((p) => p.length <= 4096)).toBe(true);
  });
  it('teclado de categorías: 3 por fila + «Era ingreso» y volver', () => {
    const t = tecladoCategorias(1532, CATEGORIAS_BASE);
    expect(t.slice(0, 4).map((f) => f.length)).toEqual([3, 3, 3, 1]);
    expect(t[0][0]).toEqual({ texto: '🛒 Mercado', callback_data: 'cs:1532:mercado' });
    expect(t[4]).toEqual([{ texto: '💰 Era ingreso', callback_data: 'ing:1532' }, { texto: '↩ Volver', callback_data: 'vol:1532' }]);
    expect(t.flat().some((b) => b.callback_data!.includes('ingresos'))).toBe(false);
  });
});

describe('mensajeAviso (§6.5)', () => {
  const i = escenarioCanonico();
  const m = calcularMetricas(i);
  const m1 = mov({ id: 1532, fecha: '2026-10-06', hora: '13:59', monto: 14_730, comercio: 'TIENDA D1 ANT MARINI', categoria_id: 'mercado', medio: 'debito' });

  it('gasto: líneas y botones exactos', () => {
    const [r] = mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, m, CATEGORIAS_BASE, []);
    expect(r.texto).toBe('🛒 <b>$14.730</b> · TIENDA D1 ANT MARINI\nMercado · débito · 6 oct 13:59\nHoy te quedan <b>$29.117</b> 🟢 · Mes 🔴 113%');
    // categoría segura: solo Cambiar e Ignorar («Era ingreso» pasó al teclado de categorías)
    expect(r.botones).toEqual([[{ texto: '🏷 Cambiar', callback_data: 'cat:1532' }, { texto: '🙈 Ignorar', callback_data: 'ign:1532' }]]);
  });
  it('escapa HTML del comercio', () => {
    const [r] = mensajeAviso({ estado: 'creado', movimiento: { ...m1, comercio: '<b>x</b>&' }, anomalias: [] }, m, CATEGORIAS_BASE, []);
    expect(r.texto).toContain('&lt;b&gt;x&lt;/b&gt;&amp;');
    expect(r.texto).not.toContain('<b>x</b>');
  });
  it('transferencia: Fue un gasto / Es mía / Ignorar en una fila; el duplicado agrega otra', () => {
    const t = mov({ id: 5, tipo: 'transferencia', monto: 100_000, comercio: 'JUAN', computa: false });
    const [r] = mensajeAviso({ estado: 'creado', movimiento: t, anomalias: [{ tipo: 'posible_duplicado', movimiento_id: 5, otro_id: 4, detalle: '', cifras: {} }] }, m, CATEGORIAS_BASE, []);
    expect(r.botones![0].map((b) => b.callback_data)).toEqual(['gas:5', 'int:5', 'ign:5']);
    expect(r.botones![1].map((b) => b.callback_data)).toEqual(['dup:5', 'ndp:4:5']);
  });
  it('categoría insegura («Otros» o Pago por QR): el mismo aviso pregunta «¿En qué se fue?» con las más usadas + Más', () => {
    const q = mov({ id: 9, comercio: 'Pago por QR', monto: 18_000, categoria_id: 'otros', categoria_fuente: 'defecto' });
    const [r] = mensajeAviso({ estado: 'creado', movimiento: q, anomalias: [] }, m, CATEGORIAS_BASE, [], ['comida', 'mercado', 'transporte', 'compras', 'ocio', 'servicios']);
    expect(r.texto).toContain('¿En qué se fue?');
    expect(r.botones!.slice(0, 2).map((f) => f.map((b) => b.callback_data))).toEqual([
      ['cs:9:comida', 'cs:9:mercado', 'cs:9:transporte'], ['cs:9:compras', 'cs:9:ocio', 'cs:9:servicios'],
    ]);
    expect(r.botones![2].map((b) => b.callback_data)).toEqual(['cat:9', 'ign:9']);
  });
  it('con una base estimada el aviso no pinta rojo (naranja «estimando»)', () => {
    // Sin cuentas, una base estimada deja limita = 'estimado' (ver BaseHoy).
    const est = { ...m, base: { ...m.base, modo: 'ingreso_estimado' as const }, base_hoy: { ...m.base_hoy, limita: 'estimado' as const } };
    const [r] = mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, est, CATEGORIAS_BASE, []);
    expect(r.texto).toContain('Mes 🟠 113%');
    expect(r.texto).not.toContain('🔴');
    // Con cuentas manda el saldo (dato real): el rojo es rojo aunque el ingreso sea estimado.
    const conSaldo = { ...est, base_hoy: { ...m.base_hoy, limita: 'saldo' as const, hay_cuentas: true } };
    const [r2] = mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, conSaldo, CATEGORIAS_BASE, []);
    expect(r2.texto).toContain('Mes 🔴 113%');
  });
  it('solo con cuentas (sin ingreso) ya hay base: muestra lo de hoy y no pide el ingreso', () => {
    const soloCuentas = { ...m, base: { ...m.base, modo: 'sin_datos' as const }, base_hoy: { ...m.base_hoy, limita: 'saldo' as const, hay_cuentas: true } };
    const [r] = mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, soloCuentas, CATEGORIAS_BASE, []);
    expect(r.texto).not.toContain('Cuéntame tu ingreso');
    expect(r.texto).toMatch(/Hoy te (quedan|pasaste)/);
    const nada = { ...soloCuentas, base_hoy: { ...m.base_hoy, limita: null } };
    expect(mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, nada, CATEGORIAS_BASE, [])[0].texto).toContain('Cuéntame tu ingreso');
  });
  it('transferencia (no cuenta): se muestra como «Movimiento», sin «te quedan» y con «Fue un gasto»', () => {
    const t = mov({ id: 5, tipo: 'transferencia', monto: 100_000, comercio: 'JUAN', categoria_id: 'transferencias', computa: false, medio: 'cuenta' });
    const [r] = mensajeAviso({ estado: 'creado', movimiento: t, anomalias: [] }, m, CATEGORIAS_BASE, []);
    expect(r.texto).toContain('<b>$100.000</b> · JUAN');
    expect(r.texto).toContain('Movimiento');
    expect(r.texto).not.toContain('Gasto');
    expect(r.texto).toContain('No cuenta como gasto');
    expect(r.texto).not.toMatch(/te quedan|te pasaste/i);
    expect(r.botones![0]).toEqual([
      { texto: '💸 Fue un gasto', callback_data: 'gas:5' }, { texto: '🔁 Es mía', callback_data: 'int:5' }, { texto: '🙈 Ignorar', callback_data: 'ign:5' },
    ]);
    expect(r.botones!.flat().some((b) => b.callback_data!.startsWith('ing:'))).toBe(false);   // «Era ingreso» no aplica a una salida de transferencia
  });
  it('transferencia marcada como gasto vuelve al mensaje de gasto y pregunta la categoría', () => {
    const t = mov({ id: 5, tipo: 'transferencia', monto: 100_000, comercio: 'JUAN', categoria_id: 'transferencias', categoria_fuente: 'defecto', computa: true });
    const [r] = mensajeAviso({ estado: 'creado', movimiento: t, anomalias: [] }, m, CATEGORIAS_BASE, []);
    expect(r.texto).toMatch(/Hoy te (quedan|pasaste)/);
    expect(r.texto).toContain('¿En qué se fue?');
    expect(r.botones!.flat().some((b) => b.callback_data === 'cs:5:comida')).toBe(true);
  });
  it('ingreso, IA, sin verificar, sin datos y líneas extra', () => {
    const ing = mov({ id: 7, tipo: 'ingreso', monto: 500_000, comercio: 'EMPRESA', confianza: 'ia', verificado: false });
    const extra = [{ id: 'x', regla: 'ingreso_recibido' as const, severidad: 'info' as const, prioridad: 1, titulo: 't', detalle_con_cifras: 'Te entraron $500.000', cifras: {}, push: false, valor_ref: 1 }];
    const [r] = mensajeAviso({ estado: 'creado', movimiento: ing, anomalias: [] }, m, CATEGORIAS_BASE, extra);
    expect(r.texto).toContain('💰 Te entraron <b>$500.000</b> · EMPRESA');
    expect(r.texto).toContain('ℹ️ Te entraron $500.000');
    expect(r.texto).toContain('🤖 Lo leí con IA');
    expect(r.texto).toContain('🔓 No pude verificar el remitente.');
    expect(r.botones).toEqual([[{ texto: '➖ No es ingreso', callback_data: 'ni:7' }]]);   // ingreso: sin más botones
    const vacio = calcularMetricas({ ...i, movimientos: [], recurrentes: [], fijos: [], config: config() });
    expect(mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, vacio, CATEGORIAS_BASE, [])[0].texto).toContain('Mi ingreso');
  });
  it('por_revisar avisa; los demás estados no mandan nada', () => {
    expect(mensajeAviso({ estado: 'por_revisar', por_revisar_id: 1, motivo: 'ia_invalida', ref_correo: 'h:x', banco: 'rappicard' }, m, CATEGORIAS_BASE, [])[0].texto).toContain('📭 No pude leer un aviso de rappicard');
    expect(mensajeAviso({ estado: 'duplicado', movimiento_id: 1, ref_correo: 'x' }, m, CATEGORIAS_BASE, [])).toEqual([]);
    expect(mensajeAviso({ estado: 'ignorado', motivo: 'publicidad', ref_correo: 'x' }, m, CATEGORIAS_BASE, [])).toEqual([]);
    expect(mensajeAviso({ estado: 'fusionado', movimiento: m1 }, m, CATEGORIAS_BASE, [])).toEqual([]);
  });
  it('pasarse del límite se dice con claridad', () => {
    const mm = { ...m, libre_hoy: -5_000 };
    expect(mensajeAviso({ estado: 'creado', movimiento: m1, anomalias: [] }, mm, CATEGORIAS_BASE, [])[0].texto).toContain('Hoy te pasaste <b>$5.000</b>');
  });
});

describe('formateadores', () => {
  const i = escenarioCanonico();
  const m = calcularMetricas(i);
  it('formatearHoy trae semáforo, libre, gastado, proyección y racha', () => {
    const t = formatearHoy(m, CATEGORIAS_BASE, i.movimientos.filter((x) => x.fecha === '2026-10-15'));
    expect(t).toContain('🔴 <b>Hoy</b> · 15 oct');
    expect(t).toContain('Puedes gastar <b>$29.117</b> más hoy (límite $59.117)');
    expect(t).toContain('Gastado hoy: <b>$30.000</b>');
    expect(t).toContain('TIENDA HOY');
    expect(t).toContain('cierras en <b>$2.378.500</b> (113% de lo disponible)');
    expect(t).toContain('Racha: 0 días');
  });
  it('veredicto y recomendaciones con botones', () => {
    const v = veredictoPuedo(i, m, { monto: 80_000, descripcion: 'audífonos', ahora: AHORA });
    const r = formatearVeredicto(v);
    expect(r.texto).toContain('🚫 <b>Mejor no</b> · $80.000');
    const base = { regla: 'suscripcion_detectada' as const, severidad: 'info' as const, prioridad: 65, titulo: 'T', detalle_con_cifras: 'D <x>', cifras: {}, push: true, valor_ref: 1 };
    const rec = formatearRecomendacion({ ...base, id: 'suscripcion_detectada:4' });
    expect(rec.botones![0].map((b) => b.callback_data)).toEqual(['sc:4', 'sd:4']);
    expect(rec.texto).toContain('D &lt;x&gt;');
    const esp = formatearRecomendacion({ ...base, regla: 'espera_lista', id: 'espera_lista:9' });
    expect(esp.botones![0].map((b) => b.callback_data)).toEqual(['ec:9', 'ed:9', 'e48:9']);
  });
});

describe('reportes', () => {
  const i = escenarioCanonico();
  const m = calcularMetricas(i);
  it('cierre con y sin gasto', () => {
    expect(reporteCierre(i, m)[0].texto).toContain('🌙 <b>Cierre del 15 oct</b>');
    expect(reporteCierre(i, m)[0].texto).toContain('Gastaste <b>$30.000</b> de $59.117');
    const sin = { ...i, movimientos: i.movimientos.filter((x) => x.fecha !== '2026-10-15') };
    expect(reporteCierre(sin, calcularMetricas(sin))[0].texto).toContain('Hoy no gastaste nada 👏');
    const pasado = { ...i, movimientos: [...i.movimientos, mov({ fecha: '2026-10-15', monto: 100_000 })] };
    expect(reporteCierre(pasado, calcularMetricas(pasado))[0].texto).toContain('te pasaste $70.883');
  });
  it('semanal, mensual y suscripciones de mañana', () => {
    expect(reporteSemanal(i, m)[0].texto).toContain('Últimos 7 días');
    expect(reporteMensual(i, '2026-09')[0].texto).toContain('2026-09');
    expect(reporteMensual(i, '2026-10')[0].texto).toContain('Proyección');
    expect(reporteSuscripciones(i)).toEqual([]);
    const manana = { ...i, recurrentes: [recurrente({ proximo_cobro: '2026-10-16' })] };
    expect(reporteSuscripciones(manana)[0].texto).toContain('Netflix');
  });
});

describe('manejarUpdate: comandos', () => {
  it('/hoy', async () => {
    const { texto } = entorno();
    const [r] = await texto('/hoy');
    expect(r.texto).toContain('Te quedan <b>$29.117</b> de $59.117');
    expect(r.botones!.flat().map((b) => b.callback_data)).toEqual(['m:mov', 'm:rec', 'm:mes']);
    expect(r.texto.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('/puedo 80000 audífonos → no (p2); /puedo 150k audifonos agrega a la lista de espera', async () => {
    const e = entorno();
    expect((await e.texto('/puedo 80000 audífonos'))[0].texto).toContain('🚫 <b>Mejor no</b>');
    expect(e.datos.llamadas).not.toContain('agregarEspera');
    const holgado = entorno({ config: config({ ingreso_mensual: 10_000_000 }) });
    const r = await holgado.texto('/puedo 150k audifonos');
    expect(r[0].texto).toContain('espérala 48 horas');
    expect(r[0].texto).toContain('lista de espera');
    expect(r[0].botones![0].map((b) => b.texto)).toEqual(['✅ Lo compré', '⏳ Esperar 48 h', '❌ No lo compro']);
    expect(holgado.datos.estado.espera).toHaveLength(1);
    await holgado.texto('/puedo 150k audifonos', 3);
    expect(holgado.datos.estado.espera).toHaveLength(1);   // no la duplica
    expect((await holgado.texto('/puedo')) [0].texto).toContain('¿Cuánto cuesta?');   // sin monto abre el teclado numérico
    expect((await holgado.texto('/puedo abc'))[0].texto).toContain('No entendí el monto «abc»');
  });

  it('/quiero', async () => {
    const e = entorno();
    expect((await e.texto('/quiero'))[0].texto).toContain('vacía');
    expect((await e.texto('/quiero 300k chaqueta'))[0].texto).toContain('Guardé «chaqueta» ($300.000)');
    expect((await e.texto('/quiero 300k chaqueta'))[0].texto).toContain('ya está');
    expect((await e.texto('/quiero'))[0].texto).toContain('#1 chaqueta');
    expect((await e.texto('/quiero 300k'))[0].texto).toBe('Dime qué y cuánto. Ej: 300k chaqueta');
  });

  it('/gasto registra, con fecha, categoría e ingreso', async () => {
    const e = entorno();
    const [r] = await e.texto('/gasto 20k almuerzo');
    expect(r.texto).toContain('✅ Registrado');
    expect(r.texto).toContain('$20.000');
    const creado = e.datos.estado.movimientos.at(-1)!;
    expect(creado).toMatchObject({ monto: 20_000, banco: 'efectivo', medio: 'efectivo', origen: 'manual', tipo: 'compra', fecha: '2026-10-15' });
    await e.texto('/gasto 80 mil cena #ocio ayer');
    expect(e.datos.estado.movimientos.at(-1)).toMatchObject({ monto: 80_000, fecha: '2026-10-14', categoria_id: 'ocio', comercio: 'cena', hora: null });
    await e.texto('/gasto +500k pago cliente');
    expect(e.datos.estado.movimientos.at(-1)).toMatchObject({ tipo: 'ingreso', sentido: 'entrada', monto: 500_000 });
    expect((await e.texto('/gasto 20k'))[0].texto).toContain('Falta la descripción');
    expect((await e.texto('/gasto 20k pan 25/12'))[0].texto).toContain('fecha futura');
    expect((await e.texto('/gasto 80.5 pan'))[0].texto).toContain('¿80,5 pesos?');
  });

  it('/cat: teclado, cambio con aprendizaje y errores', async () => {
    const e = entorno({ movimientos: [mov({ id: 50, comercio: 'TIENDA X', monto: 14_730 }), mov({ id: 51, comercio: 'TIENDA X', monto: 5_000, fecha: '2026-10-10' }), mov({ id: 52, comercio: 'OTRA', fecha: '2026-10-01' })] });
    const k = await e.texto('/cat');
    expect(k[0].botones!.at(-1)!.map((b) => b.callback_data)).toEqual(['ing:50', 'vol:50']);
    const r = await e.texto('/cat comida');
    expect(r[0].texto).toContain('ahora es <b>Comida</b>');
    expect(r[0].texto).toContain('(cambié 1 más)');
    expect(e.datos.estado.movimientos.find((m) => m.id === 51)!.categoria_id).toBe('comida');
    expect((await e.texto('/cat #52 ocio'))[0].texto).toContain('<b>Ocio</b>');
    expect((await e.texto('/cat #999 ocio'))[0].texto).toBe('No encontré el movimiento #999.');
    expect((await e.texto('/cat 52 s'))[0].texto).toContain('¿Cuál categoría? Opciones');
  });

  it('/deshacer revierte la última acción', async () => {
    const e = entorno();
    expect((await e.texto('/deshacer'))[0].texto).toBe('No hay nada para deshacer en las últimas 24 horas.');
    await e.texto('/gasto 20k almuerzo');
    const n = e.datos.estado.movimientos.length;
    const [r] = await e.texto('/deshacer');
    expect(r.texto).toContain('↩ Deshecho: Registraste almuerzo');
    expect(e.datos.estado.borrados.has(e.datos.estado.movimientos[n - 1].id)).toBe(true);
  });

  it('/ultimos, /categorias, /mes, /exportar, /panel, /ayuda y desconocido', async () => {
    const e = entorno();
    expect((await e.texto('/ultimos 2'))[0].texto.split('\n')).toHaveLength(2);
    expect((await e.texto('/ultimos'))[0].botones![0][0].callback_data).toMatch(/^mv:\d+$/);   // sin número: los últimos como botones
    expect((await e.texto('/ultimos 99'))[0].texto).toBe('Dame un número entre 1 y 20.');
    expect((await e.texto('/categorias'))[0].texto).toContain('Mercado <code>mercado</code>');
    expect((await e.texto('/mes pasado'))[0].texto).toContain('2026-09');
    expect((await e.texto('/mes xyz'))[0].texto).toContain('No entendí el mes «xyz»');
    expect((await e.texto('/exportar 2026-09'))[0].texto).toContain(`${URL}/movimientos?exportar=2026-09`);
    expect((await e.texto('/panel'))[0].texto).toContain('Solo abre en tu PC');
    expect((await e.texto('/ayuda'))[0].texto).toBe(textoAyuda());
    const raro = (await e.texto('/xyz'))[0];
    expect(raro.texto).toBe('Ese comando no lo conozco. Usa los botones de abajo o escríbeme normal.');
    expect(raro.teclado).toBeDefined();
    expect((await e.texto('/semana'))[0].texto).toContain('Últimos 7 días');
  });

  it('/presupuesto', async () => {
    const e = entorno();
    expect((await e.texto('/presupuesto'))[0].texto).toContain('Aún no tienes un tope total');
    expect((await e.texto('/presupuesto comida 400k siempre'))[0].texto).toContain('todos los meses');
    expect(e.datos.estado.presupuestos).toContainEqual({ mes: '*', categoria_id: 'comida', monto: 400_000 });
    expect((await e.texto('/p total 2M'))[0].texto).toContain('sin contar fijos');
    expect(e.datos.estado.presupuestos).toContainEqual({ mes: '2026-10', categoria_id: '*', monto: 2_000_000 });
    expect((await e.texto('/presupuesto'))[0].texto).toContain('Tope total día a día: <b>$2.000.000</b>');
    await e.texto('/presupuesto comida 0 siempre');
    expect(e.datos.estado.presupuestos.some((p) => p.categoria_id === 'comida')).toBe(false);
    expect((await e.texto('/presupuesto comida 1.5'))[0].texto).toContain('¿1,5 pesos?');
  });

  it('/ingreso: monto, ahorro, fijos', async () => {
    const e = entorno();
    await e.texto('/ingreso 4M');
    expect(e.datos.estado.config.ingreso_mensual).toBe(4_000_000);
    expect((await e.texto('/ingreso ahorro 95%'))[0].texto).toBe('El ahorro va de 0 % a 80 %.');
    await e.texto('/ingreso ahorro 15%');
    expect(e.datos.estado.config.pct_ahorro).toBe(15);
    expect((await e.texto('/ingreso fijo arriendo casa 1.2M día 5'))[0].texto).toContain('$1.200.000');
    expect(e.datos.estado.fijos.find((f) => f.nombre === 'arriendo casa')).toMatchObject({ monto: 1_200_000, dia_mes: 5, patron: 'arriendo casa' });
    expect((await e.texto('/ingreso quitarfijo arriendo casa'))[0].texto).toContain('Quité');
    expect((await e.texto('/ingreso quitarfijo nada'))[0].texto).toBe('No tengo un fijo llamado «nada».');
    expect((await e.texto('/ingreso'))[0].texto).toContain('Ahorro: 15 %');
  });

  it('/meta: crear, aportar, retirar, estados', async () => {
    const e = entorno();
    expect((await e.texto('/meta'))[0].texto).toContain('Aún no tienes metas');
    expect((await e.texto('/meta nueva viaje 3M para 2027-06'))[0].texto).toContain('$3.000.000');
    expect(e.datos.estado.metas[0].fecha_objetivo).toBe('2027-06-30');
    expect((await e.texto('/meta nueva viaje 1M'))[0].texto).toBe('Ya tienes una meta «viaje».');
    expect((await e.texto('/meta nueva pasada 1M para 2020-01-01'))[0].texto).toBe('La fecha debe ser futura.');
    expect((await e.texto('/meta viaje +200k'))[0].texto).toContain('$200.000');
    expect((await e.texto('/meta viaje -500k'))[0].texto).toBe('No puedes sacar más de lo que llevas ($200.000).');
    expect((await e.texto('/meta viaje -50k'))[0].texto).toContain('$150.000');
    expect((await e.texto('/meta zzz +10k'))[0].texto).toContain('No encontré la meta');
    expect((await e.texto('/meta viaje pausar'))[0].texto).toContain('en pausa');
    expect((await e.texto('/meta'))[0].texto).toContain('viaje');
  });

  it('/suscripciones con botones para las detectadas', async () => {
    const e = entorno({ recurrentes: [recurrente({ id: 1 }), recurrente({ id: 2, nombre: 'HBO', comercio_norm: 'hbo', estado: 'detectada' })] });
    const [r] = await e.texto('/suscripciones');
    expect(r.texto).toContain('Total:');
    expect(r.botones![0].map((b) => b.callback_data)).toEqual(['sc:2', 'sd:2']);
  });

  it('/pausa', async () => {
    const e = entorno();
    expect((await e.texto('/pausa 999'))[0].texto).toBe('Entre 1 y 168 horas.');
    expect((await e.texto('/pausa 2'))[0].texto).toContain('pausa hasta el 15 oct 14:00');
    expect(e.datos.estado.config.pausa_hasta).toBe('2026-10-15T19:00:00Z');
    await e.texto('/pausa off');
    expect(e.datos.estado.config.pausa_hasta).toBeNull();
  });

  it('texto libre: una pregunta va a la IA (con la IA caída usa palabras clave)', async () => {
    const e = entorno();
    expect((await e.texto('¿cuánto puedo gastar hoy?'))[0].texto).toContain('$29.117');
    expect((await e.texto('/pregunta'))[0].texto).toContain('¿Qué quieres saber?');
    expect((await e.texto('qué acciones compro'))[0].texto).toContain('Eso no lo sé responder');
  });

  it('/pregunta usa la IA y escapa el resultado', async () => {
    const i = escenarioCanonico();
    const datos = crearDatosFalsos({ movimientos: i.movimientos, config: i.config, fijos: i.fijos, recurrentes: i.recurrentes });
    const ia = crearIAFalsa({ json: { intencion: 'dinero_libre_hoy', parametros: {} }, texto: 'Hoy te quedan $29.117 & ya.' });
    const r = await manejarUpdate({ update_id: 1, chat_id: 1, tipo: 'texto', texto: '/q cómo voy' }, { datos, ia, ahora: AHORA, urlPanel: URL });
    expect(r[0].texto).toBe('Hoy te quedan $29.117 &amp; ya.');
  });

  it('un error inesperado devuelve un texto amable y deja un evento sin datos', async () => {
    const e = entorno();
    e.datos.listarCategorias = () => { throw new TypeError('boom con datos sensibles'); };
    const [r] = await e.texto('/categorias');
    expect(r.texto).toContain('Algo salió mal');
    expect(e.datos.estado.eventos[0]).toEqual({ nivel: 'error', tipo: 'bot_error', detalle: 'TypeError' });
  });
});

describe('manejarUpdate: callbacks', () => {
  const base = () => entorno({ movimientos: [mov({ id: 50, comercio: 'TIENDA X', monto: 14_730, categoria_id: 'mercado' }), mov({ id: 51, comercio: 'TIENDA X', fecha: '2026-10-10' })] });

  it('cat → teclado; vol → vuelve a dibujar; edita el mismo mensaje', async () => {
    const e = base();
    const [k] = await e.cb('cat:50');
    expect(k.editar_message_id).toBe(77);
    expect(k.botones!.flat().some((b) => b.callback_data === 'cs:50:comida')).toBe(true);
    const [v] = await e.cb('vol:50');
    expect(v.botones![0][0].callback_data).toBe('cat:50');
  });

  it('cs: la primera vez cambia solo ese movimiento y pregunta «¿Recordar?»; «Sí, siempre» aprende y aplica a los demás', async () => {
    const e = base();
    const [r] = await e.cb('cs:50:comida');
    expect(r.texto).toContain('¿Recordar «TIENDA X» → 🍔 Comida?');
    expect(r.botones![0].map((b) => b.callback_data)).toEqual(['rm:50:comida', 'vol:50']);
    expect(r.answer_callback).toEqual({ texto: 'Categoría cambiada' });
    expect(e.datos.estado.movimientos.find((m) => m.id === 50)!.categoria_id).toBe('comida');
    expect(e.datos.estado.movimientos.find((m) => m.id === 51)!.categoria_id).toBe('otros');   // aún no se tocó el otro
    const [ok] = await e.cb('rm:50:comida');
    expect(ok.texto).toContain('🧠 Aprendí: TIENDA X → 🍔 Comida (cambié 1 más)');
    expect(e.datos.estado.movimientos.find((m) => m.id === 51)!.categoria_id).toBe('comida');
    expect((await e.cb('cs:50:yates'))[0].answer_callback!.alerta).toBe(true);
  });
  it('cs: a la segunda coincidencia aprende solo y avisa; un comercio genérico (Pago por QR) nunca se aprende', async () => {
    const e = entorno({ movimientos: [
      mov({ id: 60, comercio: 'GOPASS', categoria_id: 'transporte', categoria_fuente: 'manual' }),
      mov({ id: 61, comercio: 'GOPASS', categoria_id: 'otros', categoria_fuente: 'defecto' }),
      mov({ id: 62, comercio: 'Pago por QR', categoria_id: 'otros', categoria_fuente: 'defecto' }),
    ] });
    const [r] = await e.cb('cs:61:transporte');
    expect(r.texto).toContain('🧠 Aprendí: GOPASS → 🚕 Transporte');
    expect(e.datos.estado.reglas.some((x) => x.origen === 'aprendida')).toBe(true);
    const antes = e.datos.estado.reglas.length;
    const [q] = await e.cb('cs:62:comida');
    expect(q.texto).not.toContain('Aprendí');
    expect(q.texto).not.toContain('¿Recordar');
    expect(e.datos.estado.reglas).toHaveLength(antes);
    expect(e.datos.estado.movimientos.find((m) => m.id === 62)!.categoria_id).toBe('comida');
  });

  it('ing, int y rev editan el movimiento', async () => {
    const e = base();
    await e.cb('ing:50');
    expect(e.datos.estado.movimientos.find((m) => m.id === 50)).toMatchObject({ tipo: 'ingreso', sentido: 'entrada', categoria_id: 'ingresos' });
    await e.cb('int:51');
    expect(e.datos.estado.movimientos.find((m) => m.id === 51)).toMatchObject({ tipo: 'interno', computa: false, categoria_id: 'interno' });
    const e2 = base();
    await e2.cb('rev:50');
    expect(e2.datos.estado.movimientos.find((m) => m.id === 50)).toMatchObject({ tipo: 'reverso', sentido: 'entrada' });
  });

  it('gas marca una transferencia como gasto, la redibuja con botón Deshacer y /deshacer la revierte', async () => {
    const e = entorno({ movimientos: [mov({ id: 60, tipo: 'transferencia', comercio: 'JUAN', monto: 80_000, categoria_id: 'transferencias', computa: false })] });
    const [r] = await e.cb('gas:60');
    expect(e.datos.estado.movimientos.find((m) => m.id === 60)).toMatchObject({ computa: true, tipo: 'transferencia' });
    expect(r.texto).toContain('Lo conté como gasto');
    expect(r.texto).not.toContain('/deshacer');
    expect(r.botones!.flat().some((b) => /^und:\d+$/.test(b.callback_data!))).toBe(true);
    expect(r.answer_callback).toEqual({ texto: 'Contada como gasto' });
    expect(r.editar_message_id).toBe(77);
    const [u] = await e.texto('/deshacer');
    expect(u.texto).toContain('Deshecho');
    expect(e.datos.estado.movimientos.find((m) => m.id === 60)!.computa).toBe(false);
    expect((await e.cb('gas:999'))[0].answer_callback).toEqual({ texto: 'Ese movimiento ya no existe', alerta: true });
  });

  it('/gasto manual siempre cuenta', async () => {
    const e = entorno();
    const antes = e.datos.estado.movimientos.length;
    await e.texto('/gasto 20k almuerzo');
    const nuevo = e.datos.estado.movimientos[antes];
    expect(nuevo).toMatchObject({ tipo: 'compra', computa: true, origen: 'manual' });
  });

  it('ign tacha y ofrece deshacer; und restituye', async () => {
    const e = base();
    const [r] = await e.cb('ign:50');
    expect(r.texto).toContain('<s>');
    expect(r.texto).toContain('Ignorado');
    const und = r.botones![0][0].callback_data!;
    expect(und).toMatch(/^und:\d+$/);
    expect(e.datos.estado.borrados.has(50)).toBe(true);
    const [u] = await e.cb(und);
    expect(u.texto).toContain('Deshecho');
    expect(e.datos.estado.borrados.has(50)).toBe(false);
    expect((await e.cb('und:999'))[0].answer_callback!.alerta).toBe(true);
  });

  it('movimiento inexistente o borrado → alerta', async () => {
    const e = base();
    for (const d of ['cat:999', 'vol:999', 'ing:999', 'ign:999', 'cs:999:comida']) {
      const [r] = await e.cb(d);
      expect(r.answer_callback).toEqual({ texto: 'Ese movimiento ya no existe', alerta: true });
    }
  });

  it('data inválida → evento y callback vacío', async () => {
    const e = base();
    const [r] = await e.cb('DROP;--');
    expect(r).toEqual({ texto: '', answer_callback: {} });
    expect(e.datos.estado.eventos[0]).toMatchObject({ tipo: 'callback_invalido' });
    expect((await e.cb('ok'))[0]).toEqual({ texto: '', answer_callback: {} });
  });

  it('ndp silencia el par; dup borra el duplicado', async () => {
    const e = base();
    const [r] = await e.cb('ndp:50:51');
    expect(r.answer_callback).toEqual({ texto: 'Listo, son dos compras' });
    expect(e.datos.estado.silenciadas.get('posible_duplicado:50-51')).toBe('9999-12-31T00:00:00Z');
    await e.cb('dup:51');
    expect(e.datos.estado.borrados.has(51)).toBe(true);
  });

  it('sc/sd y lista de espera', async () => {
    const e = entorno({ recurrentes: [recurrente({ id: 3, nombre: 'HBO', estado: 'detectada' })] });
    expect((await e.cb('sc:3'))[0].texto).toContain('Confirmé HBO');
    expect(e.datos.estado.recurrentes[0].estado).toBe('confirmada');
    await e.cb('sd:3');
    expect(e.datos.estado.silenciadas.has('suscripcion_detectada:3')).toBe(true);
    expect((await e.cb('sc:99'))[0].answer_callback!.alerta).toBe(true);

    await e.texto('/quiero 300k chaqueta');
    expect((await e.cb('e48:1'))[0].texto).toContain('48 horas');
    expect((await e.cb('ed:1'))[0].texto).toContain('Te ahorraste $300.000');
    expect((await e.cb('ec:1'))[0].answer_callback!.alerta).toBe(true);   // ya no está esperando
  });

  it('pz pausa', async () => {
    const e = base();
    const [pz] = await e.cb('pz:24');
    expect(pz.answer_callback).toEqual({ texto: 'Pausado 24 h' });
    expect(pz.texto).toContain('en pausa hasta el 16 oct');
    expect(e.datos.estado.config.pausa_hasta).toBe('2026-10-16T17:00:00Z');
  });
});

describe('rutas de aviso no usan más que lo permitido', () => {
  it('gasto() de fixtures sigue sintético', () => {
    expect(gasto('2026-10-01', 1_000).comercio).toBe('TIENDA PRUEBA');
  });
});
