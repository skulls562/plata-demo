// Pruebas del bot sin comandos (docs/BOT-UX.md): menú fijo, teclado numérico, texto libre, avisos que enseñan,
// pendientes y navegación. Datos y IA falsos, nada de red. Cada respuesta pasa por `chequear` (invariantes del contrato).
import { describe, expect, it } from 'vitest';
import { entender, etiquetaMenu } from './entender';
import { aplicarTecla, tecladoMenu } from './teclados';
import { datosDe, nonceDe, sesion } from '../../../tests/fakes/sesion-bot';
import { config, mov, recurrente } from '../../../tests/fixtures/constructores';

describe('entender: texto libre sin comandos', () => {
  it('gastos: «café 8000», «8k café», «uber 12.500», «gasté 20 mil en la tienda»', () => {
    expect(entender('café 8000')).toEqual({ tipo: 'gasto', monto: 8000, desc: 'café' });
    expect(entender('8k café')).toEqual({ tipo: 'gasto', monto: 8000, desc: 'café' });
    expect(entender('uber 12.500')).toEqual({ tipo: 'gasto', monto: 12_500, desc: 'uber' });
    expect(entender('gasté 20 mil en la tienda')).toEqual({ tipo: 'gasto', monto: 20_000, desc: 'tienda' });
    expect(entender('2 empanadas 6000')).toEqual({ tipo: 'gasto', monto: 6000, desc: '2 empanadas' });
    expect(entender('gasté 20 mil')).toEqual({ tipo: 'gasto', monto: 20_000, desc: '' });
  });
  it('ingresos, «puedo comprar…» y número suelto', () => {
    expect(entender('recibí 500k')).toEqual({ tipo: 'ingreso', monto: 500_000, desc: '' });
    expect(entender('me pagaron 2M')).toEqual({ tipo: 'ingreso', monto: 2_000_000, desc: '' });
    expect(entender('me pagaron 1,5 millones por el trabajo')).toMatchObject({ tipo: 'ingreso', monto: 1_500_000, desc: 'trabajo' });
    expect(entender('puedo comprar unos tenis de 200k')).toEqual({ tipo: 'puedo', monto: 200_000, desc: 'tenis' });
    expect(entender('80000')).toEqual({ tipo: 'monto', monto: 80_000 });
    expect(entender('$80.000')).toEqual({ tipo: 'monto', monto: 80_000 });
    expect(entender('80k')).toEqual({ tipo: 'monto', monto: 80_000 });
  });
  it('preguntas, saludos y números chicos no se anotan', () => {
    expect(entender('¿cuánto gasté en septiembre de 2026?').tipo).toBe('pregunta');
    expect(entender('cuánto llevo en comida').tipo).toBe('pregunta');
    expect(entender('hola').tipo).toBe('nada');
    expect(entender('compré 2 cosas').tipo).toBe('nada');
    expect(entender('').tipo).toBe('nada');
  });
  it('etiquetas del menú fijo: tolera mayúsculas, emoji y el contador', () => {
    for (const [t, d] of [['💰 Hoy', 'hoy'], ['HOY', 'hoy'], ['📅 Mes', 'mes'], ['➕ Gasto', 'gasto'], ['🛒 ¿Puedo comprar?', 'puedo'], ['puedo comprar', 'puedo'],
      ['🧾 Pendientes (3)', 'pend'], ['🧾 Pendientes', 'pend'], ['⚙️ Más', 'mas'], ['mas', 'mas'], ['ayuda', 'ayuda']] as const) {
      expect(etiquetaMenu(t), t).toBe(d);
    }
    expect(etiquetaMenu('hoy fue un día largo')).toBeNull();
  });
});

describe('menú fijo', () => {
  it('3 filas, el contador sale de la cola y /menu lo manda como mensaje sin botones en línea', async () => {
    expect(tecladoMenu(0)).toEqual([['💰 Hoy', '📅 Mes', '➕ Gasto'], ['🛒 ¿Puedo comprar?', '💵 Ingreso', '🧾 Pendientes'], ['🏦 Mis cuentas', '⚙️ Más']]);
    const s = sesion({ movimientos: [mov({ id: 201, comercio: 'X1', categoria_id: 'otros', categoria_fuente: 'defecto' }), mov({ id: 202, comercio: 'X2', categoria_id: 'otros', categoria_fuente: 'defecto' })] });
    const [r] = await s.texto('/menu');
    expect(r.teclado).toEqual([['💰 Hoy', '📅 Mes', '➕ Gasto'], ['🛒 ¿Puedo comprar?', '💵 Ingreso', '🧾 Pendientes (2)'], ['🏦 Mis cuentas', '⚙️ Más']]);
    expect(r.botones).toBeUndefined();
    expect((await s.texto('/start'))[0].teclado).toBeDefined();
  });
  it('un texto cualquiera sin sentido responde una línea amable y el menú', async () => {
    const s = sesion();
    const [r] = await s.texto('hola');
    expect(r.texto).toMatch(/^No te entendí/);
    expect(r.texto.split('\n')).toHaveLength(1);
    expect(r.teclado).toBeDefined();
  });
  it('cada etiqueta abre su pantalla; «Más» lista los 8 accesos', async () => {
    const s = sesion();
    expect((await s.texto('💰 Hoy'))[0].texto).toContain('<b>Hoy</b>');
    expect((await s.texto('📅 Mes'))[0].texto).toContain('2026-10');
    expect((await s.texto('➕ Gasto'))[0].texto).toContain('¿Cuánto fue?');
    expect((await s.texto('🛒 ¿Puedo comprar?'))[0].texto).toContain('¿Cuánto cuesta?');
    const [mas] = await s.texto('⚙️ Más');
    expect(datosDe(mas)).toEqual(['m:metas', 'm:ult', 'm:subs', 'm:ing', 'm:pres', 'm:panel', 'm:pausa', 'm:ayuda']);
    expect(mas.botones!.flat().map((b) => b.texto)).toEqual(['🎯 Metas', '📋 Últimos', '🔁 Suscripciones', '💵 Mi ingreso', '📊 Presupuesto', '🌐 Panel', '⏸ Pausar avisos', '❓ Ayuda']);
  });
  it('los botones de navegación editan el mismo mensaje', async () => {
    const s = sesion({ recurrentes: [recurrente({ id: 1 })] });
    for (const d of ['m:hoy', 'm:mes', 'm:mas', 'm:ult', 'm:mov', 'm:rec', 'm:metas', 'm:subs', 'm:ing', 'm:pres', 'm:panel', 'm:pausa', 'm:ayuda', 'm:pend']) {
      const [r] = await s.cb(d);
      expect(r.editar_message_id, d).toBe(77);
      expect(r.texto, d).not.toBe('');
    }
    // y se puede volver: Hoy → Mes → Hoy
    expect(datosDe((await s.cb('m:hoy'))[0])).toContain('m:mes');
    expect(datosDe((await s.cb('m:mes'))[0])).toContain('m:hoy');
  });
});

describe('Hoy y Mes compactos', () => {
  it('Hoy: semáforo, cifra, una recomendación y tres botones', async () => {
    const s = sesion();
    const [r] = await s.texto('💰 Hoy');
    expect(r.texto).toMatch(/^🔴 <b>Hoy<\/b> · 15 oct/);
    expect(r.texto).toContain('Te quedan <b>$29.117</b> de $59.117');
    expect(r.texto.match(/💡/g)).toHaveLength(1);
    expect(r.botones!.flat().map((b) => b.texto)).toEqual(['📋 Ver movimientos', '💡 ¿Qué me recomiendas?', '📅 Mes']);
  });
  it('Mes: botones [Ver movimientos] [Qué me recomiendas] [Hoy]', async () => {
    const s = sesion();
    const [r] = await s.cb('m:mes');
    expect(r.texto).toContain('Cierras en <b>$2.378.500</b> (113% de lo disponible)');
    expect(r.botones!.flat().map((b) => b.texto)).toEqual(['📋 Ver movimientos', '💡 ¿Qué me recomiendas?', '💰 Hoy']);
  });
  it('¿Qué me recomiendas? lista hasta 3 con su título', async () => {
    const s = sesion();
    const [r] = await s.cb('m:rec');
    expect(r.texto).toContain('Lo que yo haría');
    expect((r.texto.match(/<b>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('teclado numérico', () => {
  it('aplicarTecla: dígitos, 000, ⌫, montos rápidos y tope de dígitos', () => {
    expect(aplicarTecla('', '0')).toBeNull();        // un cero a la izquierda no cambia nada
    expect(aplicarTecla('', 't')).toBeNull();        // «000» sobre vacío tampoco
    expect(aplicarTecla('', '2')).toBe('2');
    expect(aplicarTecla('25', 't')).toBe('25000');
    expect(aplicarTecla('25000', 'b')).toBe('2500');
    expect(aplicarTecla('', 'b')).toBeNull();
    expect(aplicarTecla('123', 'q20')).toBe('20000');
    expect(aplicarTecla('1234567890', '1')).toBeNull();   // 10 dígitos máximo
  });

  it('Gasto: teclado → monto → categoría → «✅ Anotado $25.000 · 🍔 Comida» con Deshacer y Cambiar', async () => {
    const s = sesion();
    const [k] = await s.texto('➕ Gasto');
    expect(k.texto).toBe('➕ <b>Gasto</b>\n¿Cuánto fue?\n<b>$0</b>');
    expect(k.botones!.map((f) => f.map((b) => b.texto))).toEqual([
      ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['000', '0', '⌫'], ['$5.000', '$10.000', '$20.000', '$50.000'], ['✖ Cancelar', '✔ Listo'],
    ]);
    const n = nonceDe(k);
    const [a] = await s.cb(`k:${n}:2`);
    expect(a.editar_message_id).toBe(77);
    const [b] = await s.cb(`k:${n}:5`);
    expect(b.texto).toContain('<b>$25</b>');
    const [c] = await s.cb(`k:${n}:t`);
    expect(c.texto).toContain('<b>$25.000</b>');
    const [cat] = await s.cb(`k:${n}:l`);
    expect(cat.texto).toContain('Gasto de $25.000');
    expect(cat.botones![0].map((x) => x.texto)).toEqual(['🛒 Mercado', '🍔 Comida', '🚕 Transporte']);
    const antes = s.datos.estado.movimientos.length;
    const [ok] = await s.cb(`c:${n}:comida`);
    expect(ok.texto).toBe('✅ Anotado <b>$25.000</b> · 🍔 Comida');
    expect(ok.editar_message_id).toBe(77);
    expect(ok.botones![0].map((x) => x.texto)).toEqual(['↩ Deshacer', '🏷 Cambiar categoría']);
    expect(s.datos.estado.movimientos).toHaveLength(antes + 1);
    expect(s.ultimo()).toMatchObject({ monto: 25_000, categoria_id: 'comida', categoria_fuente: 'manual', origen: 'manual', tipo: 'compra', computa: true });
    // Cambiar abre las categorías; Deshacer revierte
    expect(datosDe((await s.cb(ok.botones![0][1].callback_data!))[0])).toContain(`cs:${s.ultimo().id}:ocio`);
    const [u] = await s.cb(ok.botones![0][0].callback_data!);
    expect(u.texto).toContain('Deshecho');
    expect(s.datos.estado.borrados.has(s.ultimo().id)).toBe(true);
  });

  it('montos rápidos, ⌫, Listo en cero y Cancelar', async () => {
    const s = sesion();
    const n = nonceDe((await s.texto('➕ Gasto'))[0]);
    expect((await s.cb(`k:${n}:l`))[0].answer_callback).toEqual({ texto: 'Pon un monto primero', alerta: true });
    expect((await s.cb(`k:${n}:q20`))[0].texto).toContain('<b>$20.000</b>');
    expect((await s.cb(`k:${n}:b`))[0].texto).toContain('<b>$2.000</b>');
    expect((await s.cb(`k:${n}:0`))[0].texto).toContain('<b>$20.000</b>');
    const [x] = await s.cb(`f:${n}:no`);
    expect(x.texto).toBe('✖ Listo, no pasó nada.');
    expect(s.datos.estado.estadosBot.size).toBe(0);
  });

  it('pulsar una tecla que no cambia nada solo contesta el callback (no edita el mensaje)', async () => {
    const s = sesion();
    const n = nonceDe((await s.texto('➕ Gasto'))[0]);
    expect(await s.cb(`k:${n}:b`)).toEqual([{ texto: '', answer_callback: { texto: '' } }]);
  });

  it('un monto escrito a mano también vale mientras el teclado está abierto', async () => {
    const s = sesion();
    await s.texto('➕ Gasto');
    const [cat] = await s.texto('35k');
    expect(cat.texto).toContain('Gasto de $35.000');
    expect(cat.editar_message_id).toBeUndefined();
  });

  it('botones viejos: otro nonce, flujo terminado o estado vencido → «Eso ya pasó» sin romper nada', async () => {
    const s = sesion();
    const n = nonceDe((await s.texto('➕ Gasto'))[0]);
    const ya = { texto: '', answer_callback: { texto: 'Eso ya pasó' } };
    expect(await s.cb('k:zzz:5')).toEqual([ya]);                  // nonce ajeno
    await s.cb(`k:${n}:5`); await s.cb(`k:${n}:l`); await s.cb(`c:${n}:comida`);
    expect(await s.cb(`k:${n}:5`)).toEqual([ya]);                 // el flujo ya terminó
    expect(await s.cb(`c:${n}:comida`)).toEqual([ya]);
    expect(await s.cb(`f:${n}:vc`)).toEqual([ya]);
    expect(s.datos.estado.movimientos.filter((m) => m.origen === 'manual')).toHaveLength(1);   // no se duplicó
    // vencimiento a los 15 minutos
    const n2 = nonceDe((await s.texto('➕ Gasto'))[0]);
    s.avanzar(16);
    expect(await s.cb(`k:${n2}:5`)).toEqual([ya]);
    // abrir otro flujo invalida los botones del anterior
    const n3 = nonceDe((await s.texto('➕ Gasto'))[0]);
    await s.texto('🛒 ¿Puedo comprar?');
    expect(await s.cb(`k:${n3}:5`)).toEqual([ya]);
  });

  it('un callback con data basura no rompe: evento y respuesta vacía', async () => {
    const s = sesion();
    expect(await s.cb('k:!!:5')).toEqual([{ texto: '', answer_callback: {} }]);
    expect(s.datos.estado.eventos.some((e) => e.tipo === 'callback_invalido')).toBe(true);
  });
});

describe('texto libre', () => {
  it('«uber 12.500» se anota solo en Transporte con Deshacer y Cambiar', async () => {
    const s = sesion();
    const [r] = await s.texto('uber 12.500');
    expect(r.texto).toBe('✅ Anotado <b>$12.500</b> · 🚕 Transporte\nuber');
    expect(r.botones![0].map((b) => b.texto)).toEqual(['↩ Deshacer', '🏷 Cambiar categoría']);
    expect(s.ultimo()).toMatchObject({ monto: 12_500, comercio: 'uber', categoria_id: 'transporte', origen: 'manual' });
    expect(r.editar_message_id).toBeUndefined();   // un texto nunca edita el mensaje del usuario
  });
  it('«8k rappi» y «rappi 8000» dan lo mismo', async () => {
    const s = sesion();
    expect((await s.texto('8k rappi'))[0].texto).toContain('🍔 Comida');
    expect((await s.texto('rappi 8000'))[0].texto).toContain('🍔 Comida');
  });
  it('sin regla: se anota y pregunta «¿En qué se fue?» con botones; elegir enseña (pregunta «¿Recordar?» la primera vez)', async () => {
    const s = sesion();
    const [r] = await s.texto('gasté 20 mil en la tienda doña rosa');
    expect(r.texto).toContain('✅ Anotado <b>$20.000</b> · tienda doña rosa');
    expect(r.texto).toContain('¿En qué se fue?');
    const id = s.ultimo().id;
    expect(s.ultimo().categoria_id).toBe('otros');
    expect(datosDe(r).filter((d) => d.startsWith('cs:'))).toHaveLength(6);
    expect(datosDe(r).slice(-2)).toEqual([`cat:${id}`, `ign:${id}`]);
    const [q] = await s.cb(`cs:${id}:mercado`);
    expect(q.texto).toContain('¿Recordar «tienda doña rosa» → 🛒 Mercado?');
    const [ok] = await s.cb(`rm:${id}:mercado`);
    expect(ok.texto).toContain('🧠 Aprendí: tienda doña rosa → 🛒 Mercado');
    // la próxima vez ya cae sola
    const [otra] = await s.texto('tienda doña rosa 15000');
    expect(otra.texto).toContain('🛒 Mercado');
    expect(otra.texto).not.toContain('¿En qué se fue?');
  });
  it('«gasté 20 mil» (sin descripción) pregunta la categoría con botones del flujo', async () => {
    const s = sesion();
    const [r] = await s.texto('gasté 20 mil');
    expect(r.texto).toContain('Gasto de $20.000');
    const n = nonceDe(r);
    const [ok] = await s.cb(`c:${n}:salud`);
    expect(ok.texto).toContain('💊 Salud');
    expect(s.ultimo()).toMatchObject({ monto: 20_000, categoria_id: 'salud', comercio: 'Gasto salud' });
  });
  it('«recibí 500k» propone el ingreso y lo anota con un toque', async () => {
    const s = sesion();
    const [r] = await s.texto('recibí 500k');
    expect(r.texto).toBe('💰 ¿Anoto un ingreso de <b>$500.000</b>?');
    const n = nonceDe(r);
    expect(r.botones![0].map((b) => b.texto)).toEqual(['✅ Sí, anotar', '✖ No']);
    const antes = s.datos.estado.movimientos.length;
    const [ok] = await s.cb(`f:${n}:si`);
    expect(ok.texto).toBe('✅ Anotado 💰 <b>$500.000</b> · Ingreso');
    expect(s.ultimo()).toMatchObject({ tipo: 'ingreso', sentido: 'entrada', monto: 500_000, categoria_id: 'ingresos' });
    expect(s.datos.estado.movimientos).toHaveLength(antes + 1);
    // «No» no anota nada
    const r2 = await s.texto('me pagaron 2M');
    await s.cb(`f:${nonceDe(r2[0])}:no`);
    expect(s.datos.estado.movimientos).toHaveLength(antes + 1);
  });
  it('un número suelto pregunta con tres botones: ya lo gasté / ¿puedo comprarlo? / es un ingreso', async () => {
    const s = sesion({ config: config({ ingreso_mensual: 10_000_000 }) });
    const [r] = await s.texto('80000');
    expect(r.texto).toBe('¿Qué es <b>$80.000</b>?');
    expect(r.botones!.flat().map((b) => b.texto)).toEqual(['✅ Ya lo gasté', '🤔 ¿Puedo comprarlo?', '💰 Es un ingreso']);
    const n = nonceDe(r);
    // ya lo gasté → categoría
    const [g] = await s.cb(`f:${n}:g`);
    expect(g.texto).toContain('Gasto de $80.000');
    expect(datosDe(g)[0]).toBe(`c:${n}:mercado`);
    // ¿puedo comprarlo? (otra conversación)
    const n2 = nonceDe((await s.texto('80000'))[0]);
    const [p] = await s.cb(`f:${n2}:p`);
    expect(p.texto).toContain('$80.000');
    expect(p.botones![0].map((b) => b.texto)).toEqual(['✅ Lo compré', '⏳ Esperar 48 h', '❌ No lo compro']);
    // es un ingreso → se anota directo
    const n3 = nonceDe((await s.texto('80000'))[0]);
    const [i] = await s.cb(`f:${n3}:i`);
    expect(i.texto).toContain('✅ Anotado 💰 <b>$80.000</b>');
    expect(s.ultimo()).toMatchObject({ tipo: 'ingreso', monto: 80_000 });
  });
  it('«puedo comprar unos tenis de 200k» da el veredicto con tres botones', async () => {
    const s = sesion({ config: config({ ingreso_mensual: 10_000_000 }) });
    const [r] = await s.texto('puedo comprar unos tenis de 200k');
    expect(r.texto).toContain('$200.000 · tenis');
    expect(r.texto).toContain('lista de espera');
    expect(r.botones![0].map((b) => b.texto)).toEqual(['✅ Lo compré', '⏳ Esperar 48 h', '❌ No lo compro']);
    expect(s.datos.estado.espera).toHaveLength(1);
  });
});

describe('entender: «¿puedo…?» no anclado y plan a futuro', () => {
  it('«¿será que puedo gastar 450 mil en una reserva de hotel?» y variantes', () => {
    const hotel = { tipo: 'puedo', monto: 450_000, desc: 'hotel' };
    for (const t of [
      '¿será que puedo gastar 450 mil en una reserva de hotel?',
      'oye, ¿puedo gastar 450 mil en un hotel?',
      'Oye será que puedo reservar un hotel de 450k',
      'tengo 450k, ¿puedo reservar un hotel?',
      '¿y si gasto 450 mil en un hotel?',
      'y si reservo un hotel de 450k',
      'voy a gastar 450 mil en un hotel, ¿puedo?',
      'quiero reservar un hotel de 450 mil, ¿podré?',
      'me puedo gastar 450k en un hotel',
      'me da para un hotel de 450 mil?',
      'alcanza para un hotel de 450 mil',
      'podré pagar un hotel de $450.000',
    ]) expect(entender(t), t).toEqual(hotel);
    expect(entender('podré comprar una nevera de 1,5 millones')).toEqual({ tipo: 'puedo', monto: 1_500_000, desc: 'nevera' });
    expect(entender('puedo comprar unos tenis de 200k')).toEqual({ tipo: 'puedo', monto: 200_000, desc: 'tenis' });
  });
  it('lo que parece «puedo» pero no lo es', () => {
    expect(entender('¿cuánto puedo gastar hoy?').tipo).toBe('pregunta');
    expect(entender('¿cuánto puedo gastar si tengo 2 millones?').tipo).toBe('pregunta');
    expect(entender('no puedo creer que gasté 20 mil en café').tipo).not.toBe('puedo');
    expect(entender('gasté 20 mil, no sé si puedo seguir así').tipo).not.toBe('puedo');
    expect(entender('puedo comprar tenis').tipo).toBe('nada');
  });
  it('«voy a gastar 450 mil en un hotel» es un plan: no se anota como gasto', () => {
    expect(entender('voy a gastar 450 mil en un hotel')).toEqual({ tipo: 'futuro', monto: 450_000, desc: 'hotel' });
    expect(entender('voy a reservar un hotel de 450k')).toEqual({ tipo: 'futuro', monto: 450_000, desc: 'hotel' });
    expect(entender('pienso comprar unos tenis de 200k')).toEqual({ tipo: 'futuro', monto: 200_000, desc: 'tenis' });
    expect(entender('gasté 450 mil en un hotel')).toMatchObject({ tipo: 'gasto', monto: 450_000 });
  });
  it('el chat completo: la consulta con «¿puedo…?» abre el veredicto con tres botones y no anota nada', async () => {
    const s = sesion({ config: config({ ingreso_mensual: 10_000_000 }) });
    const antes = s.datos.estado.movimientos.length;
    for (const t of ['¿será que puedo gastar 450 mil en una reserva de hotel?', 'oye ¿puedo reservar un hotel de 450k?', '¿y si gasto 450 mil en un hotel?']) {
      const [v] = await s.texto(t);
      const m = nonceDe(v);
      expect(datosDe(v), t).toEqual([`f:${m}:vc`, `f:${m}:ve`, `f:${m}:vn`]);
      expect(v.texto).toContain('$450.000');
    }
    expect(s.datos.estado.movimientos).toHaveLength(antes);
  });
});

describe('ingresos: «mamá me dio 200 mil» y el botón 💵 Ingreso', () => {
  it('entiende que alguien le dio plata, en cualquier parte de la frase', () => {
    expect(entender('mamá me dio 200 mil')).toEqual({ tipo: 'ingreso', monto: 200_000, desc: 'mamá' });
    expect(entender('de mamá me dieron 200 mil')).toEqual({ tipo: 'ingreso', monto: 200_000, desc: 'mamá' });
    expect(entender('me pasaron 50 mil')).toEqual({ tipo: 'ingreso', monto: 50_000, desc: '' });
    expect(entender('mi tío me regaló 100k')).toMatchObject({ tipo: 'ingreso', monto: 100_000 });
    expect(entender('me pagaron 500k')).toMatchObject({ tipo: 'ingreso', monto: 500_000 });
  });
  it('un cobro o una cuenta no es ingreso', () => {
    expect(entender('me pasaron la cuenta de 50 mil')).toMatchObject({ tipo: 'gasto' });
    expect(entender('le di 50 mil a mi hermano')).toMatchObject({ tipo: 'gasto' });
    expect(entender('me cobraron 30 mil')).toMatchObject({ tipo: 'gasto' });
  });
  it('el botón 💵 Ingreso: monto, origen y queda anotado como entrada', async () => {
    const s = sesion();
    expect(etiquetaMenu('💵 Ingreso')).toBe('ing1');
    const n = nonceDe((await s.texto('💵 Ingreso'))[0]);
    await s.cb(`k:${n}:q20`);
    const [o] = await s.cb(`k:${n}:l`);
    expect(o.texto).toContain('¿De dónde viene?');
    const [r] = await s.cb(`f:${n}:fa`);
    expect(r.texto).toContain('Anotado');
    expect(s.datos.estado.movimientos.at(-1)).toMatchObject({ tipo: 'ingreso', sentido: 'entrada', monto: 20_000, comercio: 'Familia' });
    expect(s.datos.estado.estadosBot.size).toBe(0);
  });
  it('el origen también se puede escribir', async () => {
    const s = sesion();
    const n = nonceDe((await s.texto('💵 Ingreso'))[0]);
    await s.cb(`k:${n}:q50`);
    await s.cb(`k:${n}:l`);
    const [r] = await s.texto('Mamá');
    expect(r.texto).toContain('Anotado');
    expect(s.datos.estado.movimientos.at(-1)).toMatchObject({ tipo: 'ingreso', monto: 50_000, comercio: 'Mamá' });
  });
});
