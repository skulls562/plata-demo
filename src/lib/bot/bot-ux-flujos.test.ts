// Flujos del bot sin comandos, parte 2 (docs/BOT-UX.md): ¿Puedo comprar?, ingreso, presupuesto, metas, avisos que enseñan,
// pendientes, últimos y contrato. Misma sesión falsa que bot-ux.test.ts; cada respuesta pasa por las invariantes.
import { describe, expect, it } from 'vitest';
import { datosDe, nonceDe, pulsar, sesion, type Sesion } from '../../../tests/fakes/sesion-bot';
import { config, mov, recurrente } from '../../../tests/fixtures/constructores';

describe('¿Puedo comprar? con teclado', () => {
  const abrir = async (s: Sesion) => {
    const n = nonceDe((await s.texto('🛒 ¿Puedo comprar?'))[0]);
    const cat = (await pulsar(s, n, ['2', '0', '0', 't', 'l']))[0];
    return { n, cat };
  };

  it('monto → categoría → veredicto; «Lo compré» anota el gasto y cierra la lista de espera', async () => {
    const s = sesion({ config: config({ ingreso_mensual: 10_000_000 }) });
    const { n, cat } = await abrir(s);
    expect(cat.texto).toContain('$200.000');
    expect(datosDe(cat).at(-1)).toBe(`c:${n}:nosabe`);
    const [v] = await s.cb(`c:${n}:ocio`);
    expect(v.texto).toContain('⏳ <b>Espera</b> · $200.000');
    expect(s.datos.estado.espera).toHaveLength(1);
    expect(s.datos.estado.espera[0].categoria_id).toBe('ocio');
    const [c] = await s.cb(`f:${nonceDe(v)}:vc`);
    expect(c.texto).toContain('✅ Anotado <b>$200.000</b> · 🎟 Ocio');
    expect(s.ultimo()).toMatchObject({ monto: 200_000, categoria_id: 'ocio' });
    expect(s.datos.estado.espera[0].estado).toBe('comprado');
  });

  it('«Esperar 48 h» guarda el ítem y «No lo compro» no anota nada', async () => {
    const s = sesion();   // ingreso 4M: 200k dice «no» (sin lista de espera automática)
    const { n } = await abrir(s);
    const [v] = await s.cb(`c:${n}:nosabe`);
    expect(v.texto).toContain('$200.000');
    const [e] = await s.cb(`f:${nonceDe(v)}:ve`);
    expect(e.texto).toContain('Te pregunto en 48 horas');
    expect(s.datos.estado.espera).toHaveLength(1);
    const { n: n2 } = await abrir(s);
    const [v2] = await s.cb(`c:${n2}:ocio`);
    const [no] = await s.cb(`f:${nonceDe(v2)}:vn`);
    expect(no.texto).toBe('🙌 Bien pensado. Te ahorras $200.000.');
    expect(s.datos.estado.movimientos.some((m) => m.monto === 200_000)).toBe(false);
  });
});

describe('ingreso, ahorro y presupuesto por botones', () => {
  it('Mi ingreso muestra el actual y [Cambiar] abre el teclado; Listo lo guarda', async () => {
    const s = sesion();
    const [p] = await s.cb('m:ing');
    expect(p.texto).toContain('Ingreso al mes: <b>$4.000.000</b>');
    expect(datosDe(p)).toEqual(['m:ingk', 'ah:5', 'ah:10', 'ah:15', 'ah:20', 'm:mas']);
    const [k] = await s.cb('m:ingk');
    const [fin] = await pulsar(s, nonceDe(k), ['3', 't', 't', 'l']);
    expect(fin.texto).toBe('✅ Tu ingreso al mes queda en <b>$3.000.000</b>.');
    expect(s.datos.estado.config.ingreso_mensual).toBe(3_000_000);
  });
  it('sin ingreso configurado ofrece «Usar mi promedio» y lo guarda de un toque', async () => {
    const s = sesion({ config: config({ ingreso_mensual: null }) });
    // septiembre (30 gastos del escenario) + un ingreso de $3M: el promedio de referencia es $3M
    s.datos.estado.movimientos.push(mov({ id: 301, tipo: 'ingreso', sentido: 'entrada', monto: 3_000_000, fecha: '2026-09-05', categoria_id: 'ingresos' }));
    const [p] = await s.cb('m:ing');
    expect(p.botones![0][0]).toEqual({ texto: '✔ Usar mi promedio $3.000.000', callback_data: 'iu' });
    const [ok] = await s.cb('iu');
    expect(s.datos.estado.config.ingreso_mensual).toBe(3_000_000);
    expect(ok.texto).toContain('Ingreso al mes: <b>$3.000.000</b>');
    expect((await s.cb('iu'))[0].answer_callback).toEqual({ texto: 'Eso ya pasó' });   // ya no hay promedio que ofrecer
  });
  it('ahorro 5/10/15/20 %', async () => {
    const s = sesion();
    const [r] = await s.cb('ah:15');
    expect(s.datos.estado.config.pct_ahorro).toBe(15);
    expect(r.texto).toContain('Ahorro: 15 %');
    expect(r.botones![1].map((b) => b.texto)).toEqual(['5 %', '10 %', '✔ 15 %', '20 %']);
  });
  it('presupuesto por categoría: −$50.000, +$50.000, ✏️ y quitar', async () => {
    const s = sesion();
    const [lista] = await s.cb('m:pres');
    expect(datosDe(lista)[0]).toBe('bd:total');
    expect(datosDe(lista)).toContain('bd:comida');
    const [c0] = await s.cb('bd:comida');
    expect(c0.texto).toContain('Sin tope por ahora');
    await s.cb('bp:comida'); await s.cb('bp:comida');
    expect(s.datos.estado.presupuestos).toContainEqual({ mes: '*', categoria_id: 'comida', monto: 100_000 });
    const [c1] = await s.cb('bm:comida');
    expect(c1.texto).toContain('Tope al mes: <b>$50.000</b>');
    const [c2] = await s.cb('bm:comida');   // llega a cero: se quita
    expect(c2.texto).toContain('Sin tope por ahora');
    expect(s.datos.estado.presupuestos.some((p) => p.categoria_id === 'comida')).toBe(false);
    // ✏️ con el teclado
    const [k] = await s.cb('be:comida');
    expect(k.texto).toContain('Comida');
    const [fin] = await pulsar(s, nonceDe(k), ['4', '0', '0', 't', 'l']);
    expect(fin.texto).toContain('Tope al mes: <b>$400.000</b>');
    expect(s.datos.estado.presupuestos).toContainEqual({ mes: '*', categoria_id: 'comida', monto: 400_000 });
    // quitar
    expect((await s.cb('bq:comida'))[0].texto).toContain('Sin tope por ahora');
    // total
    await s.cb('bp:total');
    expect(s.datos.estado.presupuestos).toContainEqual({ mes: '*', categoria_id: '*', monto: 50_000 });
    expect((await s.cb('bd:nope'))[0].answer_callback).toEqual({ texto: 'Eso ya pasó' });
  });
});

describe('metas por botones', () => {
  it('nueva meta: nombre por texto → teclado → crea; aportar y sacar con teclado; pausar', async () => {
    const s = sesion();
    const [vacia] = await s.cb('m:metas');
    expect(vacia.texto).toContain('Aún no tienes metas');
    const [nm] = await s.cb('m:nmeta');
    expect(nm.texto).toContain('¿Cómo se llama?');
    const [k] = await s.texto('Viaje');
    expect(k.texto).toContain('🎯 <b>Viaje</b>\n¿Cuánto quieres juntar?');
    const [fin] = await pulsar(s, nonceDe(k), ['3', 't', 't', 'l']);
    expect(fin.texto).toContain('Meta «Viaje» creada: <b>$3.000.000</b>');
    const meta = s.datos.estado.metas[0];
    expect(meta).toMatchObject({ nombre: 'Viaje', objetivo: 3_000_000 });

    const [m1] = await s.cb(`me:${meta.id}`);
    expect(datosDe(m1)).toEqual([`ma:${meta.id}`, `ms:${meta.id}`, `mp:${meta.id}`, 'm:metas']);
    const [ka] = await s.cb(`ma:${meta.id}`);
    expect(ka.texto).toContain('¿Cuánto aportas?');
    const [ap] = await pulsar(s, nonceDe(ka), ['q50', 'l']);
    expect(ap.texto).toContain('$50.000 de $3.000.000');
    expect(meta.aportado).toBe(50_000);
    const [ks] = await s.cb(`ms:${meta.id}`);
    expect(ks.texto).toContain('¿Cuánto sacas?');
    const [sac] = await pulsar(s, nonceDe(ks), ['q20', 'l']);
    expect(sac.texto).toContain('$30.000 de $3.000.000');
    // sacar de más: alerta, no rompe
    const [kx] = await s.cb(`ms:${meta.id}`);
    const sobra = await pulsar(s, nonceDe(kx), ['q50', 'l']);
    expect(sobra[0].answer_callback).toMatchObject({ alerta: true });
    expect(meta.aportado).toBe(30_000);
    expect((await s.cb(`mp:${meta.id}`))[0].texto).toContain('en pausa');
    expect((await s.cb('me:999'))[0].answer_callback).toEqual({ texto: 'Esa meta ya no existe', alerta: true });
  });
  it('el nombre repetido se rechaza y deja escribir otro', async () => {
    const s = sesion();
    s.datos.crearMeta({ nombre: 'Viaje', objetivo: 1_000_000, fecha_objetivo: null });
    await s.cb('m:nmeta');
    expect((await s.texto('viaje'))[0].texto).toContain('Ya tienes una meta');
    expect((await s.texto('Moto'))[0].texto).toContain('¿Cuánto quieres juntar?');
  });
});

describe('avisos del banco que enseñan', () => {
  const base = () => sesion({ movimientos: [
    mov({ id: 400, comercio: 'GOPASS', monto: 9_000, categoria_id: 'otros', categoria_fuente: 'defecto' }),
    mov({ id: 401, comercio: 'Pago por QR', monto: 18_000, categoria_id: 'otros', categoria_fuente: 'defecto' }),
    mov({ id: 402, comercio: 'JUAN PEREZ', monto: 60_000, tipo: 'transferencia', categoria_id: 'transferencias', categoria_fuente: 'defecto', computa: false }),
    mov({ id: 403, comercio: 'EMPRESA', monto: 500_000, tipo: 'ingreso', categoria_id: 'ingresos' }),
  ] });

  it('«Cambiar» abre las categorías (3 por fila) y Volver redibuja', async () => {
    const s = base();
    const [k] = await s.cb('cat:400');
    expect(k.botones![0].map((b) => b.callback_data)).toEqual(['cs:400:mercado', 'cs:400:comida', 'cs:400:transporte']);
    expect(datosDe(k).slice(-2)).toEqual(['ing:400', 'vol:400']);
    expect(datosDe((await s.cb('vol:400'))[0])).toContain('cs:400:comida');   // sigue incierta: vuelve a preguntar
  });
  it('comercio específico: primera vez pregunta «¿Recordar?»; «Sí, siempre» deja la regla aprendida', async () => {
    const s = base();
    const [q] = await s.cb('cs:400:transporte');
    expect(q.texto).toContain('¿Recordar «GOPASS» → 🚕 Transporte?');
    expect(s.datos.estado.reglas.some((r) => r.origen === 'aprendida')).toBe(false);
    const [ok] = await s.cb('rm:400:transporte');
    expect(ok.texto).toContain('🧠 Aprendí: GOPASS → 🚕 Transporte');
    expect(s.datos.estado.reglas.find((r) => r.origen === 'aprendida')).toBeDefined();
    expect(datosDe(ok).slice(0, 2)).toEqual(['cat:400', 'ign:400']);
  });
  it('«Solo esta vez» no enseña nada', async () => {
    const s = base();
    await s.cb('cs:400:compras');
    const [r] = await s.cb('vol:400');
    expect(r.texto).toContain('Compras');
    expect(s.datos.estado.reglas.some((x) => x.origen === 'aprendida')).toBe(false);
  });
  it('Pago por QR: se categoriza ese movimiento y no se aprende por comercio', async () => {
    const s = base();
    const reglas = s.datos.estado.reglas.length;
    const [r] = await s.cb('cs:401:comida');
    expect(r.texto).not.toContain('Recordar');
    expect(r.texto).not.toContain('Aprendí');
    expect(s.datos.estado.reglas).toHaveLength(reglas);
    expect(s.datos.estado.movimientos.find((m) => m.id === 401)!.categoria_id).toBe('comida');
  });
  it('transferencia: «Fue un gasto» pregunta la categoría y se puede deshacer', async () => {
    const s = base();
    const [g] = await s.cb('gas:402');
    expect(g.texto).toContain('Lo conté como gasto');
    expect(g.texto).toContain('¿En qué se fue?');
    expect(datosDe(g)).toContain('cs:402:comida');
    expect(datosDe(g).some((d) => d.startsWith('und:'))).toBe(true);
  });
  it('ingreso: «No es ingreso» ofrece Es mía / Reembolso / Ignorar', async () => {
    const s = base();
    const [m] = await s.cb('ni:403');
    expect(datosDe(m)).toEqual(['int:403', 'rev:403', 'ign:403', 'vol:403']);
    await s.cb('int:403');
    expect(s.datos.estado.movimientos.find((x) => x.id === 403)).toMatchObject({ tipo: 'interno', computa: false });
  });
  it('un aviso ignorado se deshace con el botón', async () => {
    const s = base();
    const [i] = await s.cb('ign:400');
    expect(i.texto).toContain('🙈 Ignorado');
    await s.cb(datosDe(i)[0]);
    expect(s.datos.estado.borrados.has(400)).toBe(false);
  });
});

describe('🧾 Pendientes', () => {
  const pend = (id: number, comercio: string) => mov({ id, comercio, monto: id * 100, categoria_id: 'otros', categoria_fuente: 'defecto', fecha: '2026-10-14' });
  const base = () => sesion({ movimientos: [pend(501, 'GOPASS'), pend(502, 'Pago por QR'), pend(503, 'TIENDA ROSA'), mov({ id: 504, categoria_id: 'comida', categoria_fuente: 'regla' })] });

  it('muestra de a uno, el más nuevo primero, con contador y categorías', async () => {
    const s = base();
    const [r] = await s.texto('🧾 Pendientes (3)');
    expect(r.texto).toContain('quedan 2 más');
    expect(r.texto).toContain('TIENDA ROSA');
    expect(datosDe(r).slice(0, 3)).toEqual(['pc:503:mercado', 'pc:503:comida', 'pc:503:transporte']);
    expect(datosDe(r).slice(-2)).toEqual(['ps:503', 'pi:503']);
    expect(r.botones!.at(-1)!.map((b) => b.texto)).toEqual(['⏭ Saltar', '🙈 Ignorar']);
  });
  it('elegir categoría aprende (si es específico), pasa al siguiente y deja deshacer lo anterior', async () => {
    const s = base();
    await s.texto('🧾 Pendientes (3)');
    const [n1] = await s.cb('pc:503:mercado');
    expect(n1.texto).toContain('🧠 Aprendí: TIENDA ROSA → 🛒 Mercado');
    expect(n1.texto).toContain('Pago por QR');
    expect(n1.texto).toContain('quedan 1 más');
    expect(n1.editar_message_id).toBe(77);
    expect(datosDe(n1).some((d) => d.startsWith('pu:'))).toBe(true);
    // QR: no se aprende
    const reglas = s.datos.estado.reglas.length;
    const [n2] = await s.cb('pc:502:comida');
    expect(s.datos.estado.reglas).toHaveLength(reglas);
    expect(n2.texto).toContain('GOPASS');
    expect(n2.texto).toContain('es el último');
    // saltar el último: llegó al final pero queda uno
    const [fin] = await s.cb('ps:501');
    expect(fin.texto).toContain('Llegaste al final');
    // ignorar el último → todo al día
    const [uno] = await s.cb('m:pend');
    expect(uno.texto).toContain('GOPASS');
    const [al] = await s.cb('pi:501');
    expect(al.texto).toContain('Todo al día');
    // deshacer lo anterior lo trae de vuelta
    const [vuelve] = await s.cb(datosDe(al).find((d) => d.startsWith('pu:'))!);
    expect(vuelve.texto).toContain('GOPASS');
    expect(s.datos.estado.borrados.has(501)).toBe(false);
  });
  it('sin pendientes: «Todo al día» y el menú fijo con el contador en cero', async () => {
    const s = sesion();
    const [r] = await s.texto('🧾 Pendientes');
    expect(r.texto).toContain('Todo al día');
    expect(r.teclado![1][2]).toBe('🧾 Pendientes');
  });
});

describe('Últimos y detalle de un movimiento', () => {
  it('los 5 últimos son botones; tocar uno abre Categoría / Cuenta como gasto / Deshacer o Borrar', async () => {
    const s = sesion();
    await s.texto('uber 9000');
    const [l] = await s.cb('m:ult');
    expect(l.botones!.length).toBe(6);
    expect(l.botones![0][0].texto).toMatch(/^🚕 \$9\.000 · uber$/);
    const id = s.ultimo().id;
    const [d] = await s.cb(`mv:${id}`);
    expect(d.texto).toContain('Cuenta como gasto del mes');
    expect(d.botones![0].map((b) => b.callback_data)).toEqual([`cat:${id}`, `cn:${id}`]);
    expect(d.botones![1][0].texto).toBe('↩ Deshacer');   // lo creó el bot: hay acción para deshacer
    // alternar «cuenta como gasto»
    const [c] = await s.cb(`cn:${id}`);
    expect(c.texto).toContain('No cuenta como gasto del mes');
    expect(c.answer_callback).toEqual({ texto: 'Ya no cuenta como gasto' });
    expect(s.ultimo().computa).toBe(false);
    // un movimiento del banco (sin acción) ofrece Borrar
    const banco = s.datos.estado.movimientos.find((m) => m.origen === 'aviso')!;
    expect((await s.cb(`mv:${banco.id}`))[0].botones![1][0].texto).toBe('🗑 Borrar');
    expect((await s.cb('mv:99999'))[0].answer_callback).toEqual({ texto: 'Ese movimiento ya no existe', alerta: true });
  });
  it('Ver movimientos desde Hoy lista los de hoy', async () => {
    const s = sesion();
    const [l] = await s.cb('m:mov');
    expect(l.texto).toContain('Movimientos de hoy');
    expect(l.botones![0][0].texto).toContain('TIENDA HOY');
  });
});

describe('otros accesos del panel «Más»', () => {
  it('Pausar avisos: 24 h / 2 días / 1 semana, y reactivar', async () => {
    const s = sesion();
    const [p] = await s.cb('m:pausa');
    expect(datosDe(p)).toEqual(['pz:24', 'pz:48', 'pz:168', 'm:pzoff', 'm:mas']);
    await s.cb('pz:48');
    expect(s.datos.estado.config.pausa_hasta).toBe('2026-10-17T17:00:00Z');
    const [r] = await s.cb('m:pzoff');
    expect(s.datos.estado.config.pausa_hasta).toBeNull();
    expect(r.answer_callback).toEqual({ texto: 'Alertas reactivadas' });
  });
  it('Suscripciones con Volver, Panel y Ayuda sin slash', async () => {
    const s = sesion({ recurrentes: [recurrente({ id: 2, nombre: 'HBO', comercio_norm: 'hbo', estado: 'detectada' })] });
    const [su] = await s.cb('m:subs');
    expect(datosDe(su)).toEqual(['sc:2', 'sd:2', 'm:mas']);
    expect((await s.cb('m:panel'))[0].texto).toContain('Solo abre en tu PC');
    const [a] = await s.cb('m:ayuda');
    expect(a.texto).toContain('«café 8000»');
    expect(a.botones).toBeDefined();
  });
  it('/ayuda manda también el menú fijo (mensaje nuevo, sin botones en línea)', async () => {
    const s = sesion();
    const [a] = await s.texto('/ayuda');
    expect(a.teclado).toBeDefined();
    expect(a.botones).toBeUndefined();
  });
});

describe('contrato de respuesta', () => {
  it('en un texto nunca viene editar_message_id ni answer_callback; en un callback siempre hay answer_callback', async () => {
    const s = sesion();
    for (const t of ['💰 Hoy', 'uber 5000', 'hola', '/ayuda', '80000']) {
      for (const r of await s.texto(t)) { expect(r.editar_message_id).toBeUndefined(); expect(r.answer_callback).toBeUndefined(); }
    }
    for (const d of ['m:hoy', 'cat:1', 'ok', 'k:zz:1', 'm:mas']) {
      for (const r of await s.cb(d)) expect(r.answer_callback).toBeDefined();
    }
  });
  it('los comandos con slash siguen funcionando como alias ocultos', async () => {
    const s = sesion();
    expect((await s.texto('/hoy'))[0].texto).toContain('<b>Hoy</b>');
    expect((await s.texto('/gasto 20k almuerzo'))[0].texto).toContain('✅ Registrado');
    expect((await s.texto('/ingreso 4M'))[0].texto).toContain('$4.000.000');
    expect((await s.texto('/puedo 80k audífonos'))[0].botones).toBeDefined();
    expect((await s.texto('/meta nueva viaje 3M'))[0].texto).toContain('$3.000.000');
  });
  it('un error inesperado en un flujo devuelve texto amable', async () => {
    const s = sesion();
    s.datos.guardarEstadoBot = () => { throw new TypeError('boom'); };
    const [r] = await s.texto('➕ Gasto');
    expect(r.texto).toContain('Algo salió mal');
  });
});
