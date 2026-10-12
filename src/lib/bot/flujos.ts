// Conversaciones del bot: teclado numérico, categorías por botones, texto libre y veredicto de compra.
// El estado vive en la tabla `bot_estado` (una por chat, 15 min). Cada callback de un flujo lleva el «nonce» del flujo:
// si no coincide con el estado guardado, el botón es viejo y se responde «Eso ya pasó».
import { minimoEfectivo } from '../deudas';
import { categoriaPorReglas } from '../metricas';
import { aBogota, normalizarComercio, parsearMonto, recortar } from '../formato';
import { veredictoPuedo } from '../recomendar';
import { ErrorUsuario, type Boton, type Movimiento, type RespuestaBot, type TipoCuenta, type UpdateBot, type Veredicto } from '../tipos';
import { cb, irA } from './callbacks';
import {
  $, YA_PASO, categoriaIncierta, categoriasGasto, enFilas, esc, etiquetaCat, masUsadas, nonceDe, reply, toast, vista, type ContextoBot,
} from './comun';
import { tipoDeCuentaPorNombre, tipoDeDeudaPorNombre, type Entendido } from './entender';
import { pantallaMeta, pantallaMetas, pantallaPresupuestoCat, presupuestoVigente } from './pantallas';
import { aplicarTecla, tecladoCategoriasFlujo, tecladoNumerico, tecladoPregunta } from './teclados';

type Flujo = 'gasto' | 'ing_uno' | 'ingreso' | 'pres' | 'aporte' | 'sacar' | 'meta' | 'puedo' | 'num' | 'conf_ing' | 'compra' | 'futuro' | 'saldo' | 'deuda' | 'pdeuda' | 'dia_ing';
type Paso = 'monto' | 'cat' | 'nombre' | 'conf' | 'tipo' | 'dia';
interface Est {
  n: string; paso: Paso; d?: string; tit?: string; monto?: number; cat?: string; meta?: number; nombre?: string; desc?: string; espera?: number | null;
  // Cuentas y deudas por texto: tipo, id de la fila que se actualiza, mínimo, día de pago y tasa (E.A.) que dijo el usuario.
  tipo?: string; ref?: number | null; minimo?: number | null; dia?: number | null; tasa?: number | null;
}

const editarDe = (u: UpdateBot): Partial<RespuestaBot> => (u.message_id !== undefined ? { editar_message_id: u.message_id } : {});
const chatDe = (u: UpdateBot) => String(u.chat_id);

function guardar(ctx: ContextoBot, u: UpdateBot, flujo: Flujo, e: Est): void {
  ctx.datos.guardarEstadoBot(chatDe(u), { flujo, datos: { ...e } }, ctx.ahora);
}
function cargar(ctx: ContextoBot, u: UpdateBot, n: string): { flujo: Flujo; e: Est } | null {
  const st = ctx.datos.leerEstadoBot(chatDe(u), ctx.ahora);
  if (!st || st.datos.n !== n) return null;
  return { flujo: st.flujo as Flujo, e: st.datos as unknown as Est };
}
const cerrar = (ctx: ContextoBot, u: UpdateBot) => ctx.datos.borrarEstadoBot(chatDe(u));

// ---------------------------------------------------------------------------
// Teclado numérico
// ---------------------------------------------------------------------------

function pantallaTeclado(e: Est): RespuestaBot {
  return { texto: `${e.tit ?? ''}\n<b>${$(Number(e.d || 0))}</b>`, botones: tecladoNumerico(e.n) };
}

/** Abre un teclado numérico. `tit` es el título ya escapado (HTML). */
export function abrirTeclado(ctx: ContextoBot, u: UpdateBot, flujo: Flujo, tit: string, extra: Partial<Est> = {}, d = ''): RespuestaBot[] {
  const e: Est = { n: nonceDe(u.update_id), paso: 'monto', d, tit, ...extra };
  guardar(ctx, u, flujo, e);
  return [{ ...pantallaTeclado(e), ...editarDe(u), ...(u.tipo === 'callback' ? { answer_callback: {} } : {}) }];
}

export const abrirGasto = (ctx: ContextoBot, u: UpdateBot) => abrirTeclado(ctx, u, 'gasto', '➕ <b>Gasto</b>\n¿Cuánto fue?');
/** «💵 Ingreso»: plata que te entró una vez (te la dieron, te pagaron, una venta). No es el ingreso mensual de «Mi ingreso». */
export const abrirIngresoUno = (ctx: ContextoBot, u: UpdateBot) => abrirTeclado(ctx, u, 'ing_uno', '💵 <b>Ingreso</b>\n¿Cuánto te entró?');
const ORIGENES_INGRESO: Record<string, string> = { fa: 'Familia', tr: 'Trabajo', ve: 'Venta', re: 'Regalo', ot: 'Ingreso' };
export const abrirPuedo = (ctx: ContextoBot, u: UpdateBot) => abrirTeclado(ctx, u, 'puedo', '🛒 <b>¿Puedo comprar?</b>\n¿Cuánto cuesta?');
export const abrirIngreso = (ctx: ContextoBot, u: UpdateBot) => abrirTeclado(ctx, u, 'ingreso', '💵 <b>Mi ingreso al mes</b>\n¿Cuánto recibes?');

export function abrirTopePresupuesto(ctx: ContextoBot, u: UpdateBot, cat: string): RespuestaBot[] {
  const cats = ctx.datos.listarCategorias();
  const total = cat === 'total';
  const c = total ? null : cats.find((x) => x.id === cat);
  if (!total && !c) return toast(YA_PASO);
  return abrirTeclado(ctx, u, 'pres', total ? '🎯 <b>Tope total</b>\n¿Cuánto al mes?' : `${c!.emoji} <b>${esc(c!.nombre)}</b>\n¿Cuánto al mes?`, { cat });
}

export function abrirAporte(ctx: ContextoBot, u: UpdateBot, metaId: number, sacar: boolean): RespuestaBot[] {
  const x = ctx.datos.instantanea(ctx.ahora).metas.find((y) => y.id === metaId);
  if (!x) return toast('Esa meta ya no existe', true);
  return abrirTeclado(ctx, u, sacar ? 'sacar' : 'aporte', `${esc(x.emoji)} <b>${esc(x.nombre)}</b>\n${sacar ? '¿Cuánto sacas?' : '¿Cuánto aportas?'}`, { meta: metaId });
}

/** «Nueva meta»: pide el nombre por texto (lo único que hay que escribir) y luego abre el teclado. */
export function abrirNuevaMeta(ctx: ContextoBot, u: UpdateBot): RespuestaBot[] {
  const e: Est = { n: nonceDe(u.update_id), paso: 'nombre' };
  guardar(ctx, u, 'meta', e);
  return [{
    texto: '🎯 <b>Nueva meta</b>\n¿Cómo se llama? Escríbelo (ej: Viaje).',
    botones: [[cb('✖ Cancelar', { accion: 'f', n: e.n, op: 'no' })]],
    ...editarDe(u), ...(u.tipo === 'callback' ? { answer_callback: {} } : {}),
  }];
}

export function teclaPulsada(ctx: ContextoBot, u: UpdateBot, n: string, tecla: string): RespuestaBot[] {
  const s = cargar(ctx, u, n);
  if (!s || s.e.paso !== 'monto') return toast(YA_PASO);
  if (tecla === 'l') return listo(ctx, u, s.flujo, s.e);
  const nuevo = aplicarTecla(s.e.d ?? '', tecla);
  if (nuevo === null) return toast('');
  const e = { ...s.e, d: nuevo };
  guardar(ctx, u, s.flujo, e);
  return [{ ...pantallaTeclado(e), ...editarDe(u), answer_callback: {} }];
}

function listo(ctx: ContextoBot, u: UpdateBot, flujo: Flujo, e: Est): RespuestaBot[] {
  const monto = Number(e.d || 0);
  if (!monto) return toast('Pon un monto primero', true);
  const { datos, ahora } = ctx;
  const hoy = aBogota(ahora).fecha;
  const ed = editarDe(u);
  const ok = (r: RespuestaBot, t = ''): RespuestaBot[] => [{ ...r, ...ed, answer_callback: t ? { texto: t } : {} }];
  switch (flujo) {
    case 'gasto': {
      const e2: Est = { ...e, paso: 'cat', monto };
      guardar(ctx, u, 'gasto', e2);
      return ok({ texto: `➕ <b>Gasto de ${$(monto)}</b>\n¿En qué se fue?`, botones: tecladoCategoriasFlujo(e.n, datos.listarCategorias()) });
    }
    case 'ing_uno': {
      guardar(ctx, u, 'ing_uno', { ...e, paso: 'nombre', monto });
      return ok({
        texto: `💵 <b>Ingreso de ${$(monto)}</b>\n¿De dónde viene? Toca una opción o escríbelo (ej: Mamá).`,
        botones: [
          [cb('👪 Familia', { accion: 'f', n: e.n, op: 'fa' }), cb('💼 Trabajo', { accion: 'f', n: e.n, op: 'tr' })],
          [cb('🛒 Venta', { accion: 'f', n: e.n, op: 've' }), cb('🎁 Regalo', { accion: 'f', n: e.n, op: 're' })],
          [cb('💰 Otro', { accion: 'f', n: e.n, op: 'ot' }), cb('✖ Cancelar', { accion: 'f', n: e.n, op: 'no' })],
        ],
      });
    }
    case 'puedo': {
      const e2: Est = { ...e, paso: 'cat', monto };
      guardar(ctx, u, 'puedo', e2);
      return ok({
        texto: `🛒 <b>${$(monto)}</b>\n¿Qué tipo de compra es?`,
        botones: tecladoCategoriasFlujo(e.n, datos.listarCategorias(), [cb('🤷 No sé', { accion: 'c', n: e.n, cat: 'nosabe' })]),
      });
    }
    case 'ingreso': {
      datos.fijarConfig('ingreso_mensual', monto, 'bot');
      cerrar(ctx, u);
      const listoIng = ok({ texto: `✅ Tu ingreso al mes queda en <b>${$(monto)}</b>.`, botones: [[irA('💵 Mi ingreso', 'ing'), irA('↩ Más', 'mas')]] }, 'Listo');
      // Sin día de ingreso, lo pregunta aparte (omitible): con él, «Te queda» cuenta los días hasta el próximo ingreso.
      if (datos.instantanea(ahora).config.dia_ingreso == null) return [...listoIng, ...preguntarDiaIngreso(ctx, u, e.n)];
      return listoIng;
    }
    case 'pres': {
      const catId = e.cat === 'total' ? '*' : (e.cat ?? '');
      const previo = presupuestoVigente(ctx, catId);
      datos.fijarPresupuesto(previo?.mes ?? '*', catId, monto, 'bot');
      cerrar(ctx, u);
      const p = pantallaPresupuestoCat(ctx, e.cat ?? 'total');
      return p ? ok(p, 'Tope guardado') : toast(YA_PASO);
    }
    case 'aporte': case 'sacar': {
      const delta = flujo === 'sacar' ? -monto : monto;
      try { datos.aportarMeta(e.meta ?? 0, delta, hoy, 'bot'); }
      catch (err) { if (err instanceof ErrorUsuario) return toast(err.message, true); throw err; }
      cerrar(ctx, u);
      const p = pantallaMeta(ctx, e.meta ?? 0, flujo === 'sacar' ? `➖ Sacaste ${$(monto)}.` : `➕ Sumaste ${$(monto)}.`);
      return p ? ok(p, 'Listo') : toast(YA_PASO);
    }
    case 'meta': {
      datos.crearMeta({ nombre: e.nombre ?? 'Meta', objetivo: monto, fecha_objetivo: null });
      cerrar(ctx, u);
      const lista = pantallaMetas(ctx);
      return ok({ ...lista, texto: `🎯 Meta «${esc(e.nombre ?? '')}» creada: <b>${$(monto)}</b>.\n${lista.texto}` }, 'Meta creada');
    }
    default: return toast(YA_PASO);
  }
}

// ---------------------------------------------------------------------------
// Categorías dentro de un flujo y opciones sueltas
// ---------------------------------------------------------------------------

export function categoriaElegida(ctx: ContextoBot, u: UpdateBot, n: string, catId: string): RespuestaBot[] {
  const s = cargar(ctx, u, n);
  if (!s || s.e.paso !== 'cat' || !s.e.monto) return toast(YA_PASO);
  const cats = ctx.datos.listarCategorias();
  if (s.flujo === 'puedo') {
    if (catId !== 'nosabe' && !categoriasGasto(cats).some((c) => c.id === catId)) return toast('Esa categoría no existe', true);
    return veredictoCompra(ctx, u, { monto: s.e.monto, desc: '', cat: catId === 'nosabe' ? undefined : catId });
  }
  if (s.flujo !== 'gasto') return toast(YA_PASO);
  const cat = categoriasGasto(cats).find((c) => c.id === catId);
  if (!cat) return toast('Esa categoría no existe', true);
  const mov = crearGasto(ctx, s.e.monto, s.e.desc ?? `Gasto ${cat.nombre.toLowerCase()}`, cat.id);
  cerrar(ctx, u);
  return [{ ...mensajeAnotado(ctx, mov), ...editarDe(u), answer_callback: { texto: 'Anotado' } }];
}

export function opcionDeFlujo(ctx: ContextoBot, u: UpdateBot, n: string, op: string): RespuestaBot[] {
  const s = cargar(ctx, u, n);
  if (!s) return toast(YA_PASO);
  const ed = editarDe(u);
  if (op === 'no') {
    cerrar(ctx, u);
    return [{ texto: '✖ Listo, no pasó nada.', ...ed, answer_callback: {} }];
  }
  switch (s.flujo) {
    case 'num': {
      const monto = s.e.monto ?? 0;
      if (op === 'g') {
        guardar(ctx, u, 'gasto', { n, paso: 'cat', monto });
        return [{ texto: `➕ <b>Gasto de ${$(monto)}</b>\n¿En qué se fue?`, botones: tecladoCategoriasFlujo(n, ctx.datos.listarCategorias()), ...ed, answer_callback: {} }];
      }
      if (op === 'p') return veredictoCompra(ctx, u, { monto, desc: '' });
      if (op === 'i') { cerrar(ctx, u); return [{ ...mensajeIngreso(ctx, crearIngreso(ctx, monto, '')), ...ed, answer_callback: { texto: 'Anotado' } }]; }
      return toast(YA_PASO);
    }
    case 'ing_uno': {
      const origen = ORIGENES_INGRESO[op];
      if (!origen || !s.e.monto) return toast(YA_PASO);
      cerrar(ctx, u);
      return [{ ...mensajeIngreso(ctx, crearIngreso(ctx, s.e.monto, origen)), ...ed, answer_callback: { texto: 'Anotado' } }];
    }
    case 'conf_ing': {
      if (op !== 'si') return toast(YA_PASO);
      cerrar(ctx, u);
      return [{ ...mensajeIngreso(ctx, crearIngreso(ctx, s.e.monto ?? 0, s.e.desc ?? '')), ...ed, answer_callback: { texto: 'Anotado' } }];
    }
    case 'compra': return opcionCompra(ctx, u, s.e, op);
    case 'futuro': return opcionFuturo(ctx, u, s.e, op);
    case 'saldo': return opcionSaldo(ctx, u, s.e, op);
    case 'deuda': return opcionDeuda(ctx, u, s.e, op);
    case 'pdeuda': return opcionPagoDeuda(ctx, u, s.e, op);
    case 'dia_ing': return opcionDiaIngreso(ctx, u, s.e, op);
    default: return toast(YA_PASO);
  }
}

// ---------------------------------------------------------------------------
// Anotar gastos e ingresos
// ---------------------------------------------------------------------------

function crearGasto(ctx: ContextoBot, monto: number, comercio: string, catId?: string): Movimiento {
  const { fecha, hora } = aBogota(ctx.ahora);
  return ctx.datos.crearMovimiento({
    fecha, hora, banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto, comercio: recortar(comercio, 120),
    ...(catId ? { categoria_id: catId } : {}), medio: 'efectivo', origen: 'manual',
  }, 'bot');
}

function crearIngreso(ctx: ContextoBot, monto: number, desc: string): Movimiento {
  const { fecha, hora } = aBogota(ctx.ahora);
  return ctx.datos.crearMovimiento({
    fecha, hora, banco: 'efectivo', tipo: 'ingreso', sentido: 'entrada', monto, comercio: recortar(desc || 'Ingreso', 120), medio: 'efectivo', origen: 'manual',
  }, 'bot');
}

function botonDeshacer(ctx: ContextoBot, mov: Movimiento): Boton {
  const a = ctx.datos.ultimaAccionDe(mov.id);
  return a !== null ? cb('↩ Deshacer', { accion: 'und', accion_id: a }) : cb('🙈 Ignorar', { accion: 'ign', mov: mov.id });
}

function mensajeIngreso(ctx: ContextoBot, mov: Movimiento): RespuestaBot {
  return { texto: `✅ Anotado 💰 <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}`, botones: [[botonDeshacer(ctx, mov)]] };
}

/** «✅ Anotado $25.000 · 🍔 Comida» con [↩ Deshacer] [🏷 Cambiar categoría]; si la categoría no es clara, pregunta «¿En qué se fue?». */
export function mensajeAnotado(ctx: ContextoBot, mov: Movimiento): RespuestaBot {
  const inst = ctx.datos.instantanea(ctx.ahora);
  const cats = inst.categorias;
  const generico = /^gasto /.test(normalizarComercio(mov.comercio));
  if (categoriaIncierta(mov)) {
    return {
      texto: `✅ Anotado <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}\n¿En qué se fue?`,
      botones: tecladoPregunta(mov.id, cats, masUsadas(inst, 6)),
    };
  }
  return {
    texto: `✅ Anotado <b>${$(mov.monto)}</b> · ${etiquetaCat(cats, mov.categoria_id)}${generico ? '' : '\n' + esc(mov.comercio)}`,
    botones: [[botonDeshacer(ctx, mov), cb('🏷 Cambiar categoría', { accion: 'cat', mov: mov.id })]],
  };
}

// ---------------------------------------------------------------------------
// Veredicto de compra
// ---------------------------------------------------------------------------

const MAX_RAZONES = 4;
const LIMITE_VEREDICTO = 3800;   // margen bajo los 4096 de Telegram

export function mensajeVeredicto(v: Veredicto, n: string, desc: string): RespuestaBot {
  const em = v.decision === 'si' ? '✅' : v.decision === 'espera' ? '⏳' : '🚫';
  const l = [`${em} <b>${esc(v.titulo)}</b> · ${$(v.cifras.monto)}${desc ? ' · ' + esc(desc) : ''}`];
  const cola = v.lista_espera_id !== null ? ['📝 Lo guardé en tu lista de espera.'] : [];
  // Hasta 4 razones: la primera (la decisiva) siempre entra y las demás solo mientras quepan en un mensaje de Telegram.
  let largo = l[0].length + cola.reduce((a, x) => a + x.length + 1, 0);
  v.razones.slice(0, MAX_RAZONES).forEach((r, i) => {
    const linea = `• ${esc(r)}`;
    if (i > 0 && largo + linea.length + 1 > LIMITE_VEREDICTO) return;
    l.push(i === 0 ? recortar(linea, LIMITE_VEREDICTO - largo - 1) : linea);
    largo += linea.length + 1;
  });
  l.push(...cola);
  return {
    texto: l.join('\n'),
    botones: [[cb('✅ Lo compré', { accion: 'f', n, op: 'vc' }), cb('⏳ Esperar 48 h', { accion: 'f', n, op: 've' }), cb('❌ No lo compro', { accion: 'f', n, op: 'vn' })]],
  };
}

/** Calcula el veredicto (las cifras las calcula la app) y deja la decisión en tres botones. */
export function veredictoCompra(ctx: ContextoBot, u: UpdateBot, c: { monto: number; desc: string; cat?: string }): RespuestaBot[] {
  const { inst, m } = vista(ctx);
  const v = veredictoPuedo(inst, m, { monto: c.monto, descripcion: c.desc, ahora: ctx.ahora, ...(c.cat ? { categoria_id: c.cat } : {}) });
  let espera: number | null = null;
  if (v.regla_48h) {
    const dnorm = normalizarComercio(c.desc);
    const existente = inst.lista_espera.find((i) => dnorm && normalizarComercio(i.descripcion) === dnorm);
    espera = (existente ?? ctx.datos.agregarEspera(recortar(c.desc || 'Compra', 80), c.monto, v.categoria_id, ctx.ahora)).id;
    v.lista_espera_id = espera;
  }
  const n = nonceDe(u.update_id);
  guardar(ctx, u, 'compra', { n, paso: 'conf', monto: c.monto, desc: c.desc, cat: v.categoria_id, espera });
  return [{ ...mensajeVeredicto(v, n, c.desc), ...editarDe(u), ...(u.tipo === 'callback' ? { answer_callback: {} } : {}) }];
}

function opcionCompra(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  const ed = editarDe(u);
  const monto = e.monto ?? 0;
  const desc = e.desc ?? '';
  const cuenta = desc ? `«${esc(desc)}» (${$(monto)})` : $(monto);
  if (op === 'vc') {
    if (e.espera) ctx.datos.actualizarEspera(e.espera, 'comprado', ctx.ahora);
    const cats = ctx.datos.listarCategorias();
    const cat = cats.find((c) => c.id === e.cat && c.es_gasto) ?? cats.find((c) => c.id === 'otros');
    const mov = crearGasto(ctx, monto, desc || `Gasto ${(cat?.nombre ?? 'compra').toLowerCase()}`, cat?.id);
    cerrar(ctx, u);
    return [{ ...mensajeAnotado(ctx, mov), ...ed, answer_callback: { texto: 'Anotado' } }];
  }
  if (op === 've') {
    if (!e.espera) ctx.datos.agregarEspera(recortar(desc || 'Compra', 80), monto, e.cat ?? 'otros', ctx.ahora);
    cerrar(ctx, u);
    return [{ texto: `⏳ Guardé ${cuenta}. Te pregunto en 48 horas.`, ...ed, answer_callback: {} }];
  }
  if (op === 'vn') {
    if (e.espera) ctx.datos.actualizarEspera(e.espera, 'descartado', ctx.ahora);
    cerrar(ctx, u);
    return [{ texto: `🙌 Bien pensado. Te ahorras ${$(monto)}.`, ...ed, answer_callback: {} }];
  }
  return toast(YA_PASO);
}

// ---------------------------------------------------------------------------
// Texto: respuesta a un flujo en curso y texto libre
// ---------------------------------------------------------------------------

/** Si hay un flujo esperando texto (nombre de meta) o un monto escrito a mano, lo atiende. null = no es para un flujo. */
export function textoEnCurso(ctx: ContextoBot, u: UpdateBot, texto: string): RespuestaBot[] | null {
  const st = ctx.datos.leerEstadoBot(chatDe(u), ctx.ahora);
  if (!st) return null;
  const e = st.datos as unknown as Est;
  const flujo = st.flujo as Flujo;
  if (flujo === 'meta' && e.paso === 'nombre') {
    const nombre = texto.trim();
    if (!nombre || nombre.length > 40) return reply('Ponle un nombre corto (hasta 40 letras).');
    if (ctx.datos.buscarMetaPorNombre(nombre)) return reply(`Ya tienes una meta «${esc(nombre)}». Dime otro nombre.`);
    const n = nonceDe(u.update_id);
    const e2: Est = { n, paso: 'monto', d: '', nombre, tit: `🎯 <b>${esc(nombre)}</b>\n¿Cuánto quieres juntar?` };
    guardar(ctx, u, 'meta', e2);
    return [pantallaTeclado(e2)];
  }
  if (flujo === 'ing_uno' && e.paso === 'nombre' && e.monto) {
    const desc = texto.trim();
    if (!desc || desc.length > 60) return reply('Dime de dónde viene, en pocas palabras (hasta 60 letras).');
    cerrar(ctx, u);
    return [mensajeIngreso(ctx, crearIngreso(ctx, e.monto, desc))];
  }
  if (e.paso === 'monto' && ['gasto', 'ing_uno', 'ingreso', 'pres', 'aporte', 'sacar', 'meta', 'puedo'].includes(flujo)) {
    const r = parsearMonto(texto.trim());
    if (!r.ok) return null;
    const e2: Est = { ...e, d: String(r.valor), n: nonceDe(u.update_id) };
    guardar(ctx, u, flujo, e2);
    return listo(ctx, u, flujo, e2);
  }
  return null;
}

/** Texto libre ya entendido: se anota solo, o pregunta con botones. */
export function textoLibre(ctx: ContextoBot, u: UpdateBot, e: Entendido): RespuestaBot[] {
  const n = nonceDe(u.update_id);
  switch (e.tipo) {
    case 'gasto': {
      if (!e.desc) {
        guardar(ctx, u, 'gasto', { n, paso: 'cat', monto: e.monto });
        return [{ texto: `➕ <b>Gasto de ${$(e.monto)}</b>\n¿En qué se fue?`, botones: tecladoCategoriasFlujo(n, ctx.datos.listarCategorias()) }];
      }
      const mov = crearGasto(ctx, e.monto, e.desc);
      return [mensajeAnotado(ctx, mov)];
    }
    case 'ingreso': {
      guardar(ctx, u, 'conf_ing', { n, paso: 'conf', monto: e.monto, desc: e.desc });
      return [{
        texto: `💰 ¿Anoto un ingreso de <b>${$(e.monto)}</b>${e.desc ? ' · ' + esc(e.desc) : ''}?`,
        botones: [[cb('✅ Sí, anotar', { accion: 'f', n, op: 'si' }), cb('✖ No', { accion: 'f', n, op: 'no' })]],
      }];
    }
    case 'puedo': return veredictoCompra(ctx, u, { monto: e.monto, desc: e.desc, cat: categoriaDeDesc(ctx, e.desc) });
    case 'futuro': {
      guardar(ctx, u, 'futuro', { n, paso: 'conf', monto: e.monto, desc: e.desc });
      return [{
        texto: `🤔 <b>${$(e.monto)}</b>${e.desc ? ' · ' + esc(e.desc) : ''}\n¿Ya lo pagaste o es una consulta?`,
        botones: [[cb('✅ Ya lo pagué', { accion: 'f', n, op: 'g' }), cb('🤔 Es una consulta', { accion: 'f', n, op: 'p' })], [cb('✖ Cancelar', { accion: 'f', n, op: 'no' })]],
      }];
    }
    case 'saldo': return abrirSaldo(ctx, u, e.monto, e.nombre);
    case 'dia_ingreso': return abrirDiaIngreso(ctx, u, e.dia);
    case 'deuda': return abrirDeuda(ctx, u, e);
    case 'pago_minimo': return abrirPagoMinimo(ctx, u, e.nombre, e.monto);
    case 'mi_ingreso': return abrirTeclado(ctx, u, 'ingreso', '💵 <b>Mi ingreso al mes</b>\n¿Lo dejo así? Toca ✔ Listo.', {}, String(e.monto));
    case 'monto': {
      guardar(ctx, u, 'num', { n, paso: 'conf', monto: e.monto });
      return [{
        texto: `¿Qué es <b>${$(e.monto)}</b>?`,
        botones: [[cb('✅ Ya lo gasté', { accion: 'f', n, op: 'g' })], [cb('🤔 ¿Puedo comprarlo?', { accion: 'f', n, op: 'p' })], [cb('💰 Es un ingreso', { accion: 'f', n, op: 'i' })]],
      }];
    }
    default: return reply('');
  }
}

// ---------------------------------------------------------------------------
// Plan a futuro: «voy a gastar 450 mil en un hotel» → ¿ya lo pagaste o es una consulta?
// ---------------------------------------------------------------------------

const categoriaDeDesc = (ctx: ContextoBot, desc: string): string | undefined =>
  categoriaPorReglas(normalizarComercio(desc), ctx.datos.instantanea(ctx.ahora).reglas) ?? undefined;

function opcionFuturo(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  const monto = e.monto ?? 0;
  const desc = e.desc ?? '';
  const ed = editarDe(u);
  if (op === 'p') return veredictoCompra(ctx, u, { monto, desc, cat: categoriaDeDesc(ctx, desc) });
  if (op !== 'g') return toast(YA_PASO);
  if (!desc) {
    guardar(ctx, u, 'gasto', { n: e.n, paso: 'cat', monto });
    return [{ texto: `➕ <b>Gasto de ${$(monto)}</b>\n¿En qué se fue?`, botones: tecladoCategoriasFlujo(e.n, ctx.datos.listarCategorias()), ...ed, answer_callback: {} }];
  }
  const mov = crearGasto(ctx, monto, desc);
  cerrar(ctx, u);
  return [{ ...mensajeAnotado(ctx, mov), ...ed, answer_callback: { texto: 'Anotado' } }];
}

// ---------------------------------------------------------------------------
// Control por texto: cuentas, deudas y pago del mínimo. Cada cambio se confirma con botones y usa las mismas validaciones
// que el panel (puerto AccesoDatos → src/lib/cuentas-deudas.ts).
// ---------------------------------------------------------------------------

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const botonesSiNo = (n: string): Boton[][] => [[cb('✅ Sí', { accion: 'f', n, op: 'si' }), cb('✖ No', { accion: 'f', n, op: 'no' })]];
const irCuentas = (): Boton[][] => [[irA('🏦 Mis cuentas', 'cuentas')]];

/** Busca por nombre: igual, o uno contenido en el otro (≥ 3 letras). Con varios parecidos, solo si hay uno. */
function buscarPorNombre<T extends { nombre: string }>(items: T[], nombre: string): T | null {
  const q = normalizarComercio(nombre);
  if (!q) return null;
  const igual = items.find((x) => normalizarComercio(x.nombre) === q);
  if (igual) return igual;
  const parecidos = items.filter((x) => {
    const t = normalizarComercio(x.nombre);
    return q.length >= 3 && t.length >= 3 && (t.includes(q) || q.includes(t));
  });
  return parecidos.length === 1 ? parecidos[0] : null;
}

/** Una pantalla: mensaje nuevo si vino de un texto, edición si vino de un botón. */
const pantallaFlujo = (u: UpdateBot, r: RespuestaBot, toastCb = ''): RespuestaBot[] => [
  { ...r, ...editarDe(u), ...(u.tipo === 'callback' ? { answer_callback: toastCb ? { texto: toastCb } : {} } : {}) },
];

// ----- «tengo 1,2 millones en Bancolombia» -----

/** Crea o actualiza una cuenta. Si el nombre no dice el tipo, pregunta efectivo / banco / ahorro. */
export function abrirSaldo(ctx: ContextoBot, u: UpdateBot, monto: number, nombre: string): RespuestaBot[] {
  const n = nonceDe(u.update_id);
  const e: Est = { n, paso: 'conf', monto, nombre };
  if (nombre) {
    const ex = buscarPorNombre(ctx.datos.instantanea(ctx.ahora).cuentas, nombre);
    if (ex) return pantallaSaldo(ctx, u, { ...e, nombre: ex.nombre, ref: ex.id, tipo: ex.tipo });
    const tipo = tipoDeCuentaPorNombre(nombre);
    if (tipo) return pantallaSaldo(ctx, u, { ...e, tipo });
  }
  guardar(ctx, u, 'saldo', { ...e, paso: 'tipo' });
  return pantallaFlujo(u, {
    texto: `🏦 <b>${$(monto)}</b>${nombre ? ' en ' + esc(nombre) : ''}\n¿Qué tipo de cuenta es?`,
    botones: [
      [cb('💵 Efectivo', { accion: 'f', n, op: 'te' }), cb('🏦 Banco', { accion: 'f', n, op: 'tb' }), cb('🐖 Ahorro', { accion: 'f', n, op: 'ta' })],
      [cb('✖ Cancelar', { accion: 'f', n, op: 'no' })],
    ],
  });
}

function pantallaSaldo(ctx: ContextoBot, u: UpdateBot, e: Est): RespuestaBot[] {
  guardar(ctx, u, 'saldo', { ...e, paso: 'conf' });
  const monto = e.monto ?? 0;
  const ex = e.ref ? ctx.datos.instantanea(ctx.ahora).cuentas.find((c) => c.id === e.ref) : undefined;
  const texto = ex
    ? `🏦 ¿Actualizo <b>${esc(ex.nombre)}</b>?\n${$(ex.saldo)} → <b>${$(monto)}</b>`
    : `🏦 ¿Anoto la cuenta <b>${esc(e.nombre ?? '')}</b> (${e.tipo}) con <b>${$(monto)}</b>?${e.tipo === 'ahorro' ? '\nEl ahorro no cuenta para gastar hoy.' : ''}`;
  return pantallaFlujo(u, { texto, botones: botonesSiNo(e.n) });
}

function opcionSaldo(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  const monto = e.monto ?? 0;
  if (e.paso === 'tipo' && (op === 'te' || op === 'tb' || op === 'ta')) {
    const tipo: TipoCuenta = op === 'te' ? 'efectivo' : op === 'tb' ? 'banco' : 'ahorro';
    const nombre = e.nombre || cap(tipo);
    const ex = buscarPorNombre(ctx.datos.instantanea(ctx.ahora).cuentas, nombre);
    return pantallaSaldo(ctx, u, { ...e, nombre: ex?.nombre ?? nombre, tipo: ex?.tipo ?? tipo, ref: ex?.id ?? null });
  }
  if (e.paso !== 'conf' || op !== 'si') return toast(YA_PASO);
  const cuenta = e.ref
    ? ctx.datos.editarCuenta(e.ref, { saldo: monto }, ctx.ahora)
    : ctx.datos.crearCuenta({ nombre: e.nombre ?? '', tipo: (e.tipo ?? 'banco') as TipoCuenta, saldo: monto }, ctx.ahora);
  cerrar(ctx, u);
  return pantallaFlujo(u, { texto: `✅ <b>${esc(cuenta.nombre)}</b> queda en <b>${$(cuenta.saldo)}</b>.`, botones: irCuentas() }, 'Guardado');
}

// ----- «debo 3 millones en la tarjeta, mínimo 150k, pago el 15» -----

export function abrirDeuda(ctx: ContextoBot, u: UpdateBot, d: Extract<Entendido, { tipo: 'deuda' }>): RespuestaBot[] {
  const n = nonceDe(u.update_id);
  const ex = buscarPorNombre(ctx.datos.instantanea(ctx.ahora).deudas, d.nombre);
  const e: Est = {
    n, paso: 'conf', monto: d.monto, nombre: ex?.nombre ?? d.nombre, tipo: ex?.tipo ?? tipoDeDeudaPorNombre(d.nombre),
    ref: ex?.id ?? null, minimo: d.minimo ?? null, dia: d.dia ?? null, tasa: d.tasa ?? null,
  };
  guardar(ctx, u, 'deuda', e);
  const l: string[] = [];
  if (ex) {
    l.push(`💳 ¿Actualizo <b>${esc(ex.nombre)}</b>?`, `Debes: ${$(ex.saldo)} → <b>${$(d.monto)}</b>`);
    if (d.minimo !== undefined) l.push(`Mínimo: ${$(ex.pago_minimo)} → <b>${$(d.minimo)}</b>`);
    if (d.dia !== undefined) l.push(`Día de pago: ${ex.dia_pago ?? 'sin día'} → <b>${d.dia}</b>`);
    if (d.tasa !== undefined) l.push(`Tasa: ${ex.tasa_ea} % → <b>${d.tasa} %</b> E.A.`);
  } else {
    l.push('💳 ¿Anoto esta deuda?', `<b>${esc(e.nombre ?? '')}</b>: debes <b>${$(d.monto)}</b>`);
    l.push(`Mínimo: ${d.minimo !== undefined ? $(d.minimo) : '$0 (no me lo dijiste)'}${d.dia !== undefined ? ` · pago el día ${d.dia}` : ' · sin día de pago'}`);
    l.push(d.tasa !== undefined ? `Tasa: ${d.tasa} % E.A.` : 'No me dijiste la tasa: queda en 0 % (sin intereses). La cambias en el panel.');
  }
  return pantallaFlujo(u, { texto: l.join('\n'), botones: botonesSiNo(n) });
}

function opcionDeuda(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  if (e.paso !== 'conf' || op !== 'si') return toast(YA_PASO);
  const saldo = e.monto ?? 0;
  const deuda = e.ref
    ? ctx.datos.editarDeuda(e.ref, {
      saldo, ...(e.minimo != null ? { pago_minimo: e.minimo } : {}), ...(e.dia != null ? { dia_pago: e.dia } : {}), ...(e.tasa != null ? { tasa_ea: e.tasa } : {}),
    }, ctx.ahora)
    : ctx.datos.crearDeuda({
      nombre: e.nombre ?? '', tipo: (e.tipo ?? 'otra') as 'tarjeta' | 'prestamo' | 'otra', saldo, tasa_ea: e.tasa ?? 0, pago_minimo: e.minimo ?? 0, dia_pago: e.dia ?? null,
    }, ctx.ahora);
  cerrar(ctx, u);
  const sinTasa = !e.ref && e.tasa == null ? '\nLa tasa quedó en 0 %: cámbiala en el panel para que el costo sea real.' : '';
  return pantallaFlujo(u, {
    texto: `✅ Deuda <b>${esc(deuda.nombre)}</b>: <b>${$(deuda.saldo)}</b> · mínimo ${$(deuda.pago_minimo)}${deuda.dia_pago ? ` · día ${deuda.dia_pago}` : ''}.${sinTasa}`,
    botones: irCuentas(),
  }, 'Guardado');
}

// ----- «pagué el mínimo de la tarjeta» -----

export function abrirPagoMinimo(ctx: ContextoBot, u: UpdateBot, nombre: string, montoDicho?: number): RespuestaBot[] {
  const deudas = ctx.datos.instantanea(ctx.ahora).deudas.filter((d) => d.saldo > 0);
  if (!deudas.length) return reply('No tienes deudas con saldo. Anótala así: «debo 3 millones en la tarjeta, mínimo 150k, pago el 15».');
  const d = nombre ? buscarPorNombre(deudas, nombre) : deudas.length === 1 ? deudas[0] : null;
  if (!d) {
    const lista = deudas.slice(0, 5).map((x) => esc(x.nombre)).join(', ');
    return reply(nombre
      ? `No encuentro una deuda «${esc(nombre)}». Tus deudas: ${lista}.`
      : `¿De cuál? Tus deudas: ${lista}. Dime, por ejemplo, «pagué el mínimo de ${esc(deudas[0].nombre)}».`);
  }
  const pago = Math.min(montoDicho ?? minimoEfectivo(d), d.saldo);
  if (pago <= 0) return reply(`«${esc(d.nombre)}» no tiene un mínimo anotado. Dime el valor: «pagué el mínimo de ${esc(d.nombre)} 150k».`);
  const n = nonceDe(u.update_id);
  guardar(ctx, u, 'pdeuda', { n, paso: 'conf', monto: pago, ref: d.id, nombre: d.nombre });
  return pantallaFlujo(u, {
    texto: `💳 ¿Anoto un pago de <b>${$(pago)}</b> a <b>${esc(d.nombre)}</b>?\nSu saldo baja de ${$(d.saldo)} a <b>${$(d.saldo - pago)}</b>.`,
    botones: botonesSiNo(n),
  });
}

function opcionPagoDeuda(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  if (e.paso !== 'conf' || op !== 'si') return toast(YA_PASO);
  const d = ctx.datos.instantanea(ctx.ahora).deudas.find((x) => x.id === e.ref);
  if (!d) { cerrar(ctx, u); return toast('Esa deuda ya no existe', true); }
  const act = ctx.datos.editarDeuda(d.id, { saldo: Math.max(0, d.saldo - (e.monto ?? 0)) }, ctx.ahora);
  cerrar(ctx, u);
  return pantallaFlujo(u, {
    texto: `✅ Pago anotado. <b>${esc(act.nombre)}</b> queda en <b>${$(act.saldo)}</b>.${act.saldo === 0 ? ' 🎉 Quedó en cero.' : ''}\nNo toqué tus cuentas: si salió de una, dime su saldo nuevo.`,
    botones: irCuentas(),
  }, 'Guardado');
}

// ----- «me entra el 20» y la pregunta tras «mi ingreso es 3 millones»: día del mes en que entra el ingreso (config.dia_ingreso) -----

const textoDiaIngreso = (dia: number) =>
  `el día <b>${dia}</b> de cada mes${dia >= 29 ? ' (en los meses que no llegan a ese día, cuento el último)' : ''}`;

/** Texto libre: «me entra el 20». Pide confirmación con botones. */
export function abrirDiaIngreso(ctx: ContextoBot, u: UpdateBot, dia: number): RespuestaBot[] {
  const n = nonceDe(u.update_id);
  const actual = ctx.datos.instantanea(ctx.ahora).config.dia_ingreso;
  if (actual === dia) return reply(`Ya lo tengo así: te entra ${textoDiaIngreso(dia)}.`);
  guardar(ctx, u, 'dia_ing', { n, paso: 'conf', dia });
  return pantallaFlujo(u, {
    texto: `📆 ¿Anoto que tu ingreso te entra ${textoDiaIngreso(dia)}?${actual ? `\nAntes: día ${actual}.` : ''}\nCon esto «Te queda» cuenta los días hasta ese día, no hasta fin de mes.`,
    botones: botonesSiNo(n),
  });
}

/** Tras guardar el ingreso: ¿qué día del mes te entra? Días 1-31 en botones y una salida para omitir. */
function preguntarDiaIngreso(ctx: ContextoBot, u: UpdateBot, n: string): RespuestaBot[] {
  guardar(ctx, u, 'dia_ing', { n, paso: 'dia' });
  const dias = Array.from({ length: 31 }, (_, i) => cb(String(i + 1), { accion: 'f', n, op: `d${i + 1}` }));
  return [{
    texto: '📆 ¿Qué día del mes te entra? Así calculo cuánto puedes gastar hasta tu próximo ingreso. Si es irregular, omite.',
    botones: [...enFilas(dias, 7), [cb('Omitir', { accion: 'f', n, op: 'dx' })]],
  }];
}

function opcionDiaIngreso(ctx: ContextoBot, u: UpdateBot, e: Est, op: string): RespuestaBot[] {
  if (e.paso === 'dia' && op === 'dx') {
    cerrar(ctx, u);
    return pantallaFlujo(u, { texto: 'Listo, sin día fijo. Cuando quieras me dices «me entra el 20».' });
  }
  const dia = e.paso === 'dia' ? /^d(\d{1,2})$/.exec(op)?.[1] : e.paso === 'conf' && op === 'si' ? String(e.dia ?? '') : undefined;
  const d = Number(dia);
  if (!dia || !Number.isInteger(d) || d < 1 || d > 31) return toast(YA_PASO);
  ctx.datos.fijarConfig('dia_ingreso', d, 'bot');
  cerrar(ctx, u);
  return pantallaFlujo(u, { texto: `✅ Anotado: tu ingreso te entra ${textoDiaIngreso(d)}.`, botones: [[irA('🏠 Hoy', 'hoy'), irA('↩ Más', 'mas')]] }, 'Guardado');
}
