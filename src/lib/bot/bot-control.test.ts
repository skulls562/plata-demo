// Control total por Telegram (docs/BOT-UX.md §11): saldos, deudas, pago del mínimo, ingreso, «mis cuentas», plan a futuro y «Abrir panel».
// Datos falsos para los flujos y una base SQLite en memoria para comprobar que se usan las validaciones reales del panel.
import { describe, expect, it } from 'vitest';
import { abrirDB } from '../db';
import { crearAccesoDatos } from '../datos';
import { responderPregunta } from '../ia';
import { manejarUpdate } from '../bot';
import type { Cuenta, Deuda, RespuestaBot, UpdateBot, Veredicto } from '../tipos';
import { mensajeVeredicto } from './flujos';
import { entender } from './entender';
import { botonAbrirPanel } from './pantallas';
import { datosDe, nonceDe, pulsar, sesion, AHORA, CHAT, chequear, URL_PANEL } from '../../../tests/fakes/sesion-bot';
import { crearDatosFalsos } from '../../../tests/fakes/datos-falsos';
import { iaCaida } from '../../../tests/fakes/ia-falsa';
import { config } from '../../../tests/fixtures/constructores';

const iso = '2026-10-01T12:00:00Z';
const cuenta = (c: Partial<Cuenta> & Pick<Cuenta, 'id' | 'nombre'>): Cuenta => ({ tipo: 'banco', saldo: 0, creado_en: iso, actualizado_en: iso, ...c });
const deuda = (d: Partial<Deuda> & Pick<Deuda, 'id' | 'nombre'>): Deuda => ({
  tipo: 'tarjeta', saldo: 0, tasa_ea: 0, pago_minimo: 0, dia_pago: null, activa: true, creado_en: iso, actualizado_en: iso, ...d,
});
const cfg = () => config({ ingreso_mensual: 10_000_000 });

describe('entender: control de plata por texto', () => {
  it('saldo: «tengo 1,2 millones en Bancolombia» y variantes', () => {
    expect(entender('tengo 1,2 millones en Bancolombia')).toEqual({ tipo: 'saldo', monto: 1_200_000, nombre: 'Bancolombia' });
    expect(entender('en Nequi tengo 200k')).toEqual({ tipo: 'saldo', monto: 200_000, nombre: 'Nequi' });
    expect(entender('tengo 80 mil en efectivo')).toEqual({ tipo: 'saldo', monto: 80_000, nombre: 'Efectivo' });
    expect(entender('tengo 500 mil')).toEqual({ tipo: 'saldo', monto: 500_000, nombre: '' });
    expect(entender('¿cuánto tengo en Bancolombia?').tipo).toBe('pregunta');
  });
  it('deuda: monto, nombre, mínimo, día de pago y tasa', () => {
    expect(entender('debo 3 millones en la tarjeta, mínimo 150k, pago el 15'))
      .toEqual({ tipo: 'deuda', monto: 3_000_000, nombre: 'Tarjeta', minimo: 150_000, dia: 15 });
    expect(entender('debo 2M en la tarjeta Davivienda mínimo 100k pago el 5 al 28%'))
      .toEqual({ tipo: 'deuda', monto: 2_000_000, nombre: 'Tarjeta Davivienda', minimo: 100_000, dia: 5, tasa: 28 });
    expect(entender('debo 800 mil')).toEqual({ tipo: 'deuda', monto: 800_000, nombre: 'Deuda' });
  });
  it('pago del mínimo, ingreso mensual y «mis cuentas»', () => {
    expect(entender('pagué el mínimo de la tarjeta')).toEqual({ tipo: 'pago_minimo', nombre: 'Tarjeta' });
    expect(entender('pagué el mínimo')).toEqual({ tipo: 'pago_minimo', nombre: '' });
    expect(entender('mi ingreso es 3 millones')).toEqual({ tipo: 'mi_ingreso', monto: 3_000_000 });
    expect(entender('ingreso 3 millones')).toMatchObject({ tipo: 'ingreso', monto: 3_000_000 });   // sigue siendo un movimiento
    for (const t of ['mis cuentas', '🏦 Mis cuentas', 'mis deudas', 'ver mis cuentas', 'deudas']) expect(entender(t), t).toEqual({ tipo: 'menu', dest: 'cuentas' });
  });
});

describe('saldo por texto', () => {
  it('cuenta nueva con tipo claro: confirma con botones y crea al tocar Sí', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('tengo 1,2 millones en Bancolombia');
    expect(r.texto).toContain('Bancolombia');
    expect(r.texto).toContain('(banco)');
    expect(r.texto).toContain('$1.200.000');
    expect(s.datos.estado.cuentas).toHaveLength(0);
    const n = nonceDe(r);
    expect(datosDe(r)).toEqual([`f:${n}:si`, `f:${n}:no`]);
    const [ok] = await s.cb(`f:${n}:si`);
    expect(ok.editar_message_id).toBe(77);
    expect(ok.texto).toContain('queda en <b>$1.200.000</b>');
    expect(s.datos.estado.cuentas).toMatchObject([{ nombre: 'Bancolombia', tipo: 'banco', saldo: 1_200_000 }]);
    expect(datosDe(ok)).toEqual(['m:cuentas']);
  });
  it('si la cuenta ya existe, la actualiza en vez de duplicarla', async () => {
    const s = sesion({ config: cfg(), cuentas: [cuenta({ id: 1, nombre: 'Bancolombia', saldo: 500_000 })] });
    const [r] = await s.texto('tengo 1,2 millones en bancolombia');
    expect(r.texto).toContain('¿Actualizo <b>Bancolombia</b>?');
    expect(r.texto).toContain('$500.000 → <b>$1.200.000</b>');
    await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.cuentas).toHaveLength(1);
    expect(s.datos.estado.cuentas[0].saldo).toBe(1_200_000);
  });
  it('ambiguo: pregunta efectivo / banco / ahorro y luego confirma', async () => {
    const s = sesion({ config: cfg() });
    const [p] = await s.texto('tengo 300 mil en Pedro');
    const n = nonceDe(p);
    expect(p.texto).toContain('¿Qué tipo de cuenta es?');
    expect(datosDe(p)).toEqual([`f:${n}:te`, `f:${n}:tb`, `f:${n}:ta`, `f:${n}:no`]);
    const [c] = await s.cb(`f:${n}:ta`);
    expect(c.texto).toContain('(ahorro)');
    expect(c.texto).toContain('no cuenta para gastar hoy');
    await s.cb(`f:${n}:si`);
    expect(s.datos.estado.cuentas).toMatchObject([{ nombre: 'Pedro', tipo: 'ahorro', saldo: 300_000 }]);
  });
  it('sin nombre usa el tipo como nombre («Efectivo»)', async () => {
    const s = sesion({ config: cfg() });
    const [p] = await s.texto('tengo 500 mil');
    const n = nonceDe(p);
    await s.cb(`f:${n}:te`);
    await s.cb(`f:${n}:si`);
    expect(s.datos.estado.cuentas).toMatchObject([{ nombre: 'Efectivo', tipo: 'efectivo', saldo: 500_000 }]);
  });
  it('cancelar, botón viejo y estado vencido no cambian nada', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('tengo 1,2 millones en Bancolombia');
    const n = nonceDe(r);
    expect((await s.cb('f:zzz:si'))[0].answer_callback?.texto).toBe('Eso ya pasó');
    expect((await s.cb(`f:${n}:no`))[0].texto).toContain('no pasó nada');
    expect((await s.cb(`f:${n}:si`))[0].answer_callback?.texto).toBe('Eso ya pasó');
    const [r2] = await s.texto('tengo 1,2 millones en Bancolombia');
    s.avanzar(16);
    expect((await s.cb(`f:${nonceDe(r2)}:si`))[0].answer_callback?.texto).toBe('Eso ya pasó');
    expect(s.datos.estado.cuentas).toHaveLength(0);
  });
});

describe('deuda por texto', () => {
  it('crea la deuda con mínimo y día; sin tasa la deja en 0 % y avisa', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('debo 3 millones en la tarjeta, mínimo 150k, pago el 15');
    expect(r.texto).toContain('<b>Tarjeta</b>: debes <b>$3.000.000</b>');
    expect(r.texto).toContain('$150.000 · pago el día 15');
    expect(r.texto).toContain('No me dijiste la tasa');
    expect(s.datos.estado.deudas).toHaveLength(0);
    const [ok] = await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.deudas).toMatchObject([{ nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 3_000_000, pago_minimo: 150_000, dia_pago: 15, tasa_ea: 0, activa: true }]);
    expect(ok.texto).toContain('La tasa quedó en 0 %');
  });
  it('con tasa en el mismo mensaje', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('debo 2M en la tarjeta Davivienda mínimo 100k pago el 5 al 28%');
    expect(r.texto).toContain('Tasa: 28 % E.A.');
    await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.deudas[0]).toMatchObject({ nombre: 'Tarjeta Davivienda', tasa_ea: 28, dia_pago: 5, pago_minimo: 100_000 });
  });
  it('si ya existe, actualiza solo lo que dijiste', async () => {
    const s = sesion({ config: cfg(), deudas: [deuda({ id: 1, nombre: 'Tarjeta', saldo: 3_000_000, pago_minimo: 150_000, dia_pago: 15, tasa_ea: 30 })] });
    const [r] = await s.texto('debo 2,5 millones en la tarjeta');
    expect(r.texto).toContain('¿Actualizo <b>Tarjeta</b>?');
    expect(r.texto).toContain('$3.000.000 → <b>$2.500.000</b>');
    await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.deudas).toHaveLength(1);
    expect(s.datos.estado.deudas[0]).toMatchObject({ saldo: 2_500_000, pago_minimo: 150_000, dia_pago: 15, tasa_ea: 30 });
  });
  it('una tasa fuera de rango la rechaza la misma validación del panel', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('debo 3 millones en la tarjeta al 2000%');
    const [e] = await s.cb(`f:${nonceDe(r)}:si`);
    expect(e.texto).toContain('tasa_ea');
    expect(s.datos.estado.deudas).toHaveLength(0);
  });
});

describe('pagué el mínimo', () => {
  const con = () => sesion({ config: cfg(), deudas: [deuda({ id: 1, nombre: 'Tarjeta', saldo: 3_000_000, pago_minimo: 150_000, dia_pago: 15 }), deuda({ id: 2, nombre: 'Moto', tipo: 'prestamo', saldo: 5_000_000, pago_minimo: 400_000 })] });
  it('confirma y resta el pago del saldo de la deuda', async () => {
    const s = con();
    const [r] = await s.texto('pagué el mínimo de la tarjeta');
    expect(r.texto).toContain('pago de <b>$150.000</b> a <b>Tarjeta</b>');
    expect(r.texto).toContain('$3.000.000 a <b>$2.850.000</b>');
    expect(s.datos.estado.deudas[0].saldo).toBe(3_000_000);
    const [ok] = await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.deudas[0].saldo).toBe(2_850_000);
    expect(s.datos.estado.deudas[1].saldo).toBe(5_000_000);
    expect(ok.texto).toContain('queda en <b>$2.850.000</b>');
  });
  it('el pago nunca pasa del saldo', async () => {
    const s = sesion({ config: cfg(), deudas: [deuda({ id: 1, nombre: 'Tarjeta', saldo: 100_000, pago_minimo: 150_000 })] });
    const [r] = await s.texto('pagué el mínimo');
    expect(r.texto).toContain('pago de <b>$100.000</b>');
    const [ok] = await s.cb(`f:${nonceDe(r)}:si`);
    expect(s.datos.estado.deudas[0].saldo).toBe(0);
    expect(ok.texto).toContain('Quedó en cero');
  });
  it('sin nombre y con varias deudas pregunta de cuál; si no existe o no hay, lo dice', async () => {
    const s = con();
    expect((await s.texto('pagué el mínimo'))[0].texto).toContain('¿De cuál? Tus deudas: Tarjeta, Moto');
    expect((await s.texto('pagué el mínimo de la hipoteca'))[0].texto).toContain('No encuentro una deuda «Hipoteca»');
    expect((await sesion({ config: cfg() }).texto('pagué el mínimo de la tarjeta'))[0].texto).toContain('No tienes deudas con saldo');
    expect(s.datos.estado.deudas.map((d) => d.saldo)).toEqual([3_000_000, 5_000_000]);
  });
  it('un mínimo sin anotar pide el valor', async () => {
    const s = sesion({ config: cfg(), deudas: [deuda({ id: 1, nombre: 'Tarjeta', saldo: 3_000_000, pago_minimo: 0 })] });
    expect((await s.texto('pagué el mínimo de la tarjeta'))[0].texto).toContain('no tiene un mínimo anotado');
  });
});

describe('mi ingreso', () => {
  it('«mi ingreso es 3 millones» abre el teclado de ingreso con el valor puesto y guarda al tocar Listo', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('mi ingreso es 3 millones');
    expect(r.texto).toContain('<b>$3.000.000</b>');
    const n = nonceDe(r);
    expect(s.datos.estado.config.ingreso_mensual).toBe(10_000_000);
    const [ok] = await pulsar(s, n, ['l']);
    expect(ok.texto).toContain('queda en <b>$3.000.000</b>');
    expect(s.datos.estado.config.ingreso_mensual).toBe(3_000_000);
  });
});

describe('mis cuentas', () => {
  it('sin nada anotado explica cómo empezar', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('🏦 Mis cuentas');
    expect(r.texto).toContain('Aún no tienes cuentas ni deudas');
    expect(datosDe(r)).toEqual(['m:mas']);
  });
  it('resume saldo total, deuda total, mínimos y próximo vencimiento', async () => {
    const s = sesion({
      config: cfg(),
      cuentas: [cuenta({ id: 1, nombre: 'Bancolombia', saldo: 1_200_000 }), cuenta({ id: 2, nombre: 'Efectivo', tipo: 'efectivo', saldo: 80_000 })],
      deudas: [deuda({ id: 1, nombre: 'Tarjeta', saldo: 3_000_000, pago_minimo: 150_000, dia_pago: 20 }), deuda({ id: 2, nombre: 'Moto', tipo: 'prestamo', saldo: 5_000_000, pago_minimo: 400_000, dia_pago: 28 })],
    });
    for (const [r] of [await s.texto('mis cuentas'), await s.texto('mis deudas'), await s.cb('m:cuentas')]) {
      expect(r.texto).toContain('Bancolombia · $1.200.000');
      expect(r.texto).toContain('Saldo total: <b>$1.280.000</b>');
      expect(r.texto).toContain('Tarjeta · $3.000.000 · mín. $150.000 · día 20');
      expect(r.texto).toContain('Deuda total: <b>$8.000.000</b> · mínimos del mes: $550.000');
      expect(r.texto).toContain('Próximo pago: Tarjeta en 5 días');
    }
  });
  it('con muchas filas no pasa de 12 líneas', async () => {
    const cuentas = Array.from({ length: 6 }, (_, i) => cuenta({ id: i + 1, nombre: `Cuenta ${i + 1}`, saldo: 10_000 * (i + 1) }));
    const deudas = Array.from({ length: 6 }, (_, i) => deuda({ id: i + 1, nombre: `Deuda ${i + 1}`, saldo: 100_000, pago_minimo: 10_000, dia_pago: 20 }));
    const [r] = await sesion({ config: cfg(), cuentas, deudas }).texto('mis cuentas');
    expect(r.texto).toContain('… y 4 más');
    expect(r.texto.split('\n').length).toBeLessThanOrEqual(12);
  });
});

describe('«Abrir panel»', () => {
  it('solo con una URL pública (Telegram rechaza localhost e IP)', () => {
    expect(botonAbrirPanel('https://plata.tail1234.ts.net')).toEqual({ texto: '🌐 Abrir panel', url: 'https://plata.tail1234.ts.net/' });
    for (const u of ['http://127.0.0.1:3010', 'http://localhost:3010', 'http://192.168.1.5:3010', 'http://mipc:3010', 'ftp://x.com', 'no es url', '']) expect(botonAbrirPanel(u), u).toBeNull();
  });
  it('sale en «Mis cuentas» y en Panel cuando hay URL pública, y no cuando es local', async () => {
    const pub = sesion({ config: cfg() }, 'https://plata.tail1234.ts.net');
    for (const rs of [await pub.texto('mis cuentas'), await pub.cb('m:panel')]) {
      expect(rs[0].botones!.flat()[0]).toEqual({ texto: '🌐 Abrir panel', url: 'https://plata.tail1234.ts.net/' });
    }
    const local = sesion({ config: cfg() }, URL_PANEL);
    for (const rs of [await local.texto('mis cuentas'), await local.cb('m:panel')]) expect(rs[0].botones!.flat().some((b) => b.url)).toBe(false);
  });
});

describe('plan a futuro: «voy a gastar 450 mil en un hotel»', () => {
  it('no anota solo: pregunta si ya lo pagó o es una consulta', async () => {
    const s = sesion({ config: cfg() });
    const antes = s.datos.estado.movimientos.length;
    const [r] = await s.texto('voy a gastar 450 mil en un hotel');
    expect(r.texto).toContain('¿Ya lo pagaste o es una consulta?');
    expect(r.texto).toContain('$450.000');
    expect(s.datos.estado.movimientos).toHaveLength(antes);
    const n = nonceDe(r);
    expect(datosDe(r)).toEqual([`f:${n}:g`, `f:${n}:p`, `f:${n}:no`]);
  });
  it('«Ya lo pagué» lo anota; «Es una consulta» da el veredicto con los tres botones y no anota', async () => {
    const s = sesion({ config: cfg() });
    const antes = s.datos.estado.movimientos.length;
    const n = nonceDe((await s.texto('voy a gastar 450 mil en un hotel'))[0]);
    const [v] = await s.cb(`f:${n}:p`);
    const m = nonceDe(v);
    expect(datosDe(v)).toEqual([`f:${m}:vc`, `f:${m}:ve`, `f:${m}:vn`]);
    expect(s.datos.estado.movimientos).toHaveLength(antes);
    const n2 = nonceDe((await s.texto('quiero reservar un hotel de 450k'))[0]);
    const [a] = await s.cb(`f:${n2}:g`);
    expect(a.texto).toContain('Anotado');
    expect(s.ultimo()).toMatchObject({ monto: 450_000, sentido: 'salida' });
    expect(s.ultimo().comercio.toLowerCase()).toContain('hotel');
  });
  it('sin descripción, al pagar pregunta la categoría', async () => {
    const s = sesion({ config: cfg() });
    const n = nonceDe((await s.texto('voy a gastar 450 mil'))[0]);
    const [c] = await s.cb(`f:${n}:g`);
    expect(c.texto).toContain('¿En qué se fue?');
  });
});

describe('«¿puedo…?» con veredicto de botones', () => {
  it('/pregunta con un monto usa el flujo de veredicto, no texto suelto', async () => {
    const s = sesion({ config: cfg() });
    const [v] = await s.texto('/pregunta ¿puedo gastar 450 mil en un hotel?');
    const m = nonceDe(v);
    expect(datosDe(v)).toEqual([`f:${m}:vc`, `f:${m}:ve`, `f:${m}:vn`]);
    expect(v.texto).toContain('$450.000');
  });
  it('responderPregunta reconoce «puedo» sin Ollama y no lo confunde con «cuánto me queda hoy»', async () => {
    const datos = crearDatosFalsos({ config: cfg() });
    const r = await responderPregunta('¿será que puedo gastar 450 mil en una reserva de hotel?', datos, iaCaida(), AHORA);
    expect(r.intencion).toBe('puedo');
    expect(r.hechos.titulo).toBeTruthy();
    const hoy = await responderPregunta('¿cuánto puedo gastar hoy?', datos, iaCaida(), AHORA);
    expect(hoy.intencion).toBe('dinero_libre_hoy');
  });
});

describe('con la base real (validaciones del panel)', () => {
  const real = () => {
    const db = abrirDB(':memory:');
    const datos = crearAccesoDatos(db, () => AHORA);
    let id = 5000;
    const enviar = async (u: Omit<UpdateBot, 'update_id' | 'chat_id'>): Promise<RespuestaBot[]> => {
      const rs = await manejarUpdate({ update_id: id++, chat_id: CHAT, ...u }, { datos, ia: iaCaida(), ahora: AHORA, urlPanel: URL_PANEL });
      chequear(rs);
      return rs;
    };
    return {
      datos,
      texto: (t: string) => enviar({ tipo: 'texto', texto: t, message_id: 10 }),
      cb: (d: string) => enviar({ tipo: 'callback', callback_data: d, callback_query_id: 'q', message_id: 77 }),
    };
  };
  it('crea cuenta y deuda, resta el pago y las ve en «mis cuentas»', async () => {
    const s = real();
    await s.cb(`f:${nonceDe((await s.texto('tengo 1,2 millones en Bancolombia'))[0])}:si`);
    await s.cb(`f:${nonceDe((await s.texto('debo 3 millones en la tarjeta, mínimo 150k, pago el 15'))[0])}:si`);
    await s.cb(`f:${nonceDe((await s.texto('pagué el mínimo de la tarjeta'))[0])}:si`);
    const inst = s.datos.instantanea(AHORA);
    expect(inst.cuentas).toMatchObject([{ nombre: 'Bancolombia', tipo: 'banco', saldo: 1_200_000 }]);
    expect(inst.deudas).toMatchObject([{ nombre: 'Tarjeta', tipo: 'tarjeta', saldo: 2_850_000, pago_minimo: 150_000, dia_pago: 15, tasa_ea: 0 }]);
    const [r] = await s.texto('mis cuentas');
    expect(r.texto).toContain('Saldo total: <b>$1.200.000</b>');
    expect(r.texto).toContain('Deuda total: <b>$2.850.000</b>');
  });
  it('actualiza el saldo de una cuenta existente (sin duplicar) y rechaza nombres inválidos', async () => {
    const s = real();
    await s.cb(`f:${nonceDe((await s.texto('tengo 500 mil en Nequi'))[0])}:si`);
    await s.cb(`f:${nonceDe((await s.texto('tengo 700 mil en Nequi'))[0])}:si`);
    expect(s.datos.instantanea(AHORA).cuentas).toMatchObject([{ nombre: 'Nequi', saldo: 700_000 }]);
    const [e] = await s.cb(`f:${nonceDe((await s.texto('debo 3 millones en la tarjeta al 2000%'))[0])}:si`);
    expect(e.texto).toContain('tasa_ea');
    expect(s.datos.instantanea(AHORA).deudas).toHaveLength(0);
  });
});

describe('día de ingreso por texto', () => {
  it('entender: «me entra el 20» y variantes; un monto o una pregunta no son un día', () => {
    expect(entender('me entra el 20')).toEqual({ tipo: 'dia_ingreso', dia: 20 });
    expect(entender('me pagan el 15 de cada mes')).toEqual({ tipo: 'dia_ingreso', dia: 15 });
    expect(entender('mi sueldo llega el día 30')).toEqual({ tipo: 'dia_ingreso', dia: 30 });
    expect(entender('Me pagan el día 5 de cada mes.')).toEqual({ tipo: 'dia_ingreso', dia: 5 });
    expect(entender('me entra el 40').tipo).not.toBe('dia_ingreso');
    expect(entender('¿cuándo me entra el 20?').tipo).toBe('pregunta');
    expect(entender('me pagaron 500k el 5')).toMatchObject({ tipo: 'ingreso', monto: 500_000 });
  });
  it('confirma con botones y guarda dia_ingreso al tocar Sí', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('me entra el 20');
    expect(r.texto).toContain('el día <b>20</b> de cada mes');
    expect(s.datos.estado.config.dia_ingreso).toBeNull();
    const n = nonceDe(r);
    expect(datosDe(r)).toEqual([`f:${n}:si`, `f:${n}:no`]);
    const [ok] = await s.cb(`f:${n}:si`);
    expect(ok.editar_message_id).toBe(77);
    expect(ok.texto).toContain('✅ Anotado');
    expect(s.datos.estado.config.dia_ingreso).toBe(20);
    expect((await s.cb(`f:${n}:si`))[0].answer_callback?.texto).toBe('Eso ya pasó');
  });
  it('No, botón viejo y estado vencido no cambian nada; el día 31 avisa del último día', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('me entra el 31');
    expect(r.texto).toContain('cuento el último');
    const n = nonceDe(r);
    expect((await s.cb('f:zzz:si'))[0].answer_callback?.texto).toBe('Eso ya pasó');
    expect((await s.cb(`f:${n}:no`))[0].texto).toContain('no pasó nada');
    const [r2] = await s.texto('me entra el 20');
    s.avanzar(16);
    expect((await s.cb(`f:${nonceDe(r2)}:si`))[0].answer_callback?.texto).toBe('Eso ya pasó');
    expect(s.datos.estado.config.dia_ingreso).toBeNull();
  });
  it('si ya está fijado ese día, lo dice sin pedir confirmación', async () => {
    const s = sesion({ config: config({ ingreso_mensual: 10_000_000, dia_ingreso: 20 }) });
    const [r] = await s.texto('me entra el 20');
    expect(r.texto).toContain('Ya lo tengo así');
    expect(r.botones).toBeUndefined();
  });
  it('tras «mi ingreso es 3 millones» pregunta el día con botones; tocar un día lo guarda', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('mi ingreso es 3 millones');
    const [ok, pregunta] = await pulsar(s, nonceDe(r), ['l']);
    expect(ok.texto).toContain('queda en <b>$3.000.000</b>');
    expect(pregunta.texto).toContain('¿Qué día del mes te entra?');
    expect(pregunta.editar_message_id).toBeUndefined();
    const datos = datosDe(pregunta);
    const n = nonceDe(pregunta);
    expect(datos).toHaveLength(32);
    expect(datos).toContain(`f:${n}:d15`);
    expect(datos.at(-1)).toBe(`f:${n}:dx`);
    expect(s.datos.estado.config.dia_ingreso).toBeNull();
    await s.cb(`f:${n}:d15`);
    expect(s.datos.estado.config.dia_ingreso).toBe(15);
  });
  it('se puede omitir, y si ya hay día no vuelve a preguntar', async () => {
    const s = sesion({ config: cfg() });
    const [r] = await s.texto('mi ingreso es 3 millones');
    const [, pregunta] = await pulsar(s, nonceDe(r), ['l']);
    const [omitido] = await s.cb(`f:${nonceDe(pregunta)}:dx`);
    expect(omitido.texto).toContain('sin día fijo');
    expect(s.datos.estado.config.dia_ingreso).toBeNull();
    const s2 = sesion({ config: config({ ingreso_mensual: 10_000_000, dia_ingreso: 30 }) });
    const [r2] = await s2.texto('mi ingreso es 3 millones');
    expect(await pulsar(s2, nonceDe(r2), ['l'])).toHaveLength(1);
  });
});

describe('veredicto con hasta 4 razones', () => {
  const v = (razones: string[], lista: number | null = null): Veredicto => ({
    decision: 'no', titulo: 'Mejor no', razones, regla_decisiva: 'p1', categoria_id: 'otros', esencial: false, regla_48h: false, lista_espera_id: lista,
    cifras: {
      monto: 700_000, libre_hoy: null, restante_mes: null, limite_hoy: null, nuevo_limite: null, presupuesto_cat: null, restante_cat: null, dias_restantes: 10, retraso_meta_dias: null,
      saldo_total: null, saldo_tras: null, minimos_pendientes: 0, falta_minimos: null, proximo_minimo: null, proximo_minimo_dias: null, colchon_dias: null, colchon_dias_tras: null, dias_nuevo_limite: 10, hasta_ingreso: null,
    },
  });
  it('muestra 4 razones, no más, y deja la lista de espera al final', () => {
    const r = mensajeVeredicto(v(['uno', 'dos', 'tres', 'cuatro', 'cinco'], 7), 'abc', 'tenis');
    expect(r.texto.split('\n')).toEqual(['🚫 <b>Mejor no</b> · $700.000 · tenis', '• uno', '• dos', '• tres', '• cuatro', '📝 Lo guardé en tu lista de espera.']);
  });
  it('nunca pasa de 4096 caracteres: la primera razón se recorta y las demás caben o se omiten', () => {
    const r = mensajeVeredicto(v(['a'.repeat(3000), 'b'.repeat(1500), 'c'.repeat(100), 'd'.repeat(5000)], 7), 'abc', 'x'.repeat(200));
    expect(r.texto.length).toBeLessThanOrEqual(4096);
    expect(r.texto).toContain('• aaa');
    expect(r.texto).not.toContain('ddd');
    expect(r.texto.endsWith('📝 Lo guardé en tu lista de espera.')).toBe(true);
    expect(mensajeVeredicto(v(['z'.repeat(9000)], 7), 'abc', '').texto.length).toBeLessThanOrEqual(4096);
  });
});
