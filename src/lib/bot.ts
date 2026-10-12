// Bot de Telegram (SPEC §6 + docs/BOT-UX.md): menú fijo, botones, texto libre y avisos. Todo lo variable pasa por escaparHTML.
// Los comandos con slash siguen funcionando como alias ocultos; ningún mensaje le pide al usuario que escriba uno.
import { resumenDe } from './consultas';
import {
  aBogota, formatearFechaCorta, formatearPct, normalizarComercio, normalizarTexto, parsearFechaUsuario,
  parsearMes, parsearMonto, rangoMes, recortar, sumarDias,
} from './formato';
import { responderPregunta } from './ia';
import { calcularMetricas, categoriaPorReglas, resumenPeriodo, type ResumenPeriodo } from './metricas';
import { patronAprendido } from './categorizar';
import { cobrosEntre } from './suscripciones';
import {
  ErrorConflicto, ErrorUsuario,
  type Boton, type CallbackBot, type Categoria, type ComandoBot, type Instantanea, type Mes,
  type Metricas, type Movimiento, type NombreComando, type Recomendacion, type RespuestaBot, type ResultadoAviso, type UpdateBot, type Veredicto,
} from './tipos';
import { cb, irA, parsearCallback, serializarCallback } from './bot/callbacks';
import {
  $, MEDIOS, SEM, YA_PASO, catDe, categoriaIncierta, emojiCat, emojiDia, emojiMes, errMonto, esComercioGenerico, esc, etiquetaCat, isoSinMs, masUsadas,
  nombreCat, pendientesDe, reply, rojoSegunBase, tomarMonto, toast, vacio, vista, type ContextoBot,
} from './bot/comun';
import { entender } from './bot/entender';
import {
  abrirAporte, abrirGasto, abrirIngreso, abrirIngresoUno, abrirNuevaMeta, abrirPuedo, abrirTopePresupuesto, categoriaElegida, opcionDeFlujo, teclaPulsada,
  textoEnCurso, textoLibre, veredictoCompra,
} from './bot/flujos';
import {
  colaPendientes, formatearRecomendacion, pantallaHoy, pantallaIngreso, pantallaMas, pantallaMes, pantallaMeta, pantallaMetas, pantallaMovimiento,
  pantallaCuentas, pantallaMovimientosHoy, pantallaPanel, pantallaPausa, pantallaPendiente, pantallaPresupuestoCat, pantallaPresupuestos, pantallaRecomendaciones,
  pantallaSuscripciones, pantallaUltimos, presupuestoVigente,
} from './bot/pantallas';
import { tecladoCategorias, tecladoMenu, tecladoPregunta } from './bot/teclados';

export { parsearCallback, serializarCallback, tecladoCategorias, formatearRecomendacion };
export type { ContextoBot };

const MAX_TELEGRAM = 4096;

// ---------------------------------------------------------------------------
// Parseo de comandos (alias ocultos)
// ---------------------------------------------------------------------------

const ALIAS: Record<string, NombreComando> = {
  h: 'hoy', s: 'semana', m: 'mes', u: 'ultimos', cats: 'categorias', p: 'presupuesto', i: 'ingreso', subs: 'suscripciones',
  g: 'gasto', undo: 'deshacer', q: 'pregunta', start: 'ayuda', help: 'ayuda',
};
const NOMBRES: NombreComando[] = ['hoy', 'semana', 'mes', 'ultimos', 'categorias', 'cat', 'presupuesto', 'ingreso', 'meta', 'puedo', 'quiero',
  'suscripciones', 'gasto', 'deshacer', 'pausa', 'exportar', 'pregunta', 'panel', 'ayuda', 'menu'];

export function parsearComando(texto: string): ComandoBot {
  const t = (texto ?? '').trim();
  if (!t.startsWith('/')) return { tipo: 'texto_libre', texto: t };
  const m = /^\/([^\s@]*)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(t);
  const crudo = normalizarTexto(m?.[1] ?? '').replace(/ /g, '');
  const nombre = (ALIAS[crudo] ?? crudo) as NombreComando;
  if (!NOMBRES.includes(nombre)) return { tipo: 'desconocido', nombre: crudo };
  return { tipo: 'comando', nombre, args: (m?.[2] ?? '').trim() };
}

export function textoAyuda(): string {
  return `<b>Plata</b> · tu plata, sin complicarte

Toca los botones de abajo o escríbeme normal:
• «café 8000», «8k café» o «gasté 20 mil en la tienda» → lo anoto
• «recibí 500k» o «me pagaron 2M» → lo anoto como ingreso
• «puedo comprar unos tenis de 200k» → te digo si te alcanza
• «tengo 1,2 millones en Bancolombia» o «debo 3 millones en la tarjeta, mínimo 150k, pago el 15» → los guardo
• «pagué el mínimo de la tarjeta» o «mis cuentas» → actualizo o te muestro tu plata
• Un número solo («80000») → te pregunto qué es
Los avisos del banco llegan solos; toca un botón solo si quieres cambiar algo.
Montos: 80k · 80 mil · 80.000 · 1.5M · 2 palos · 50 lucas`;
}

export function partirMensaje(html: string, max: number = MAX_TELEGRAM): string[] {
  if (html.length <= max) return [html];
  const partes: string[] = [];
  let actual = '';
  const empujar = () => { if (actual) { partes.push(actual); actual = ''; } };
  for (const linea of html.split('\n')) {
    if (linea.length > max) {
      empujar();
      for (let i = 0; i < linea.length; i += max) partes.push(linea.slice(i, i + max));
      continue;
    }
    const candidato = actual ? `${actual}\n${linea}` : linea;
    if (candidato.length > max) { empujar(); actual = linea; } else actual = candidato;
  }
  empujar();
  return partes;
}

// ---------------------------------------------------------------------------
// Mensaje de cada aviso (§6.5, rediseñado en docs/BOT-UX.md)
// ---------------------------------------------------------------------------

function lineaMovimiento(mov: Movimiento, cats: Categoria[]): string {
  return `${emojiCat(cats, mov.categoria_id)} <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}`;
}

/** Transferencia que Jero aún no marcó como gasto: es un «movimiento», no entra en el gasto del mes. */
const esMovimientoSinGasto = (mov: Movimiento) => mov.tipo === 'transferencia' && mov.sentido === 'salida' && !mov.computa;

const USADAS_DEFECTO = ['comida', 'mercado', 'transporte', 'compras', 'ocio', 'servicios'];

function mensajeTransferencia(mov: Movimiento, extra: Recomendacion[], posibleDup: { a: number; b: number } | null): RespuestaBot {
  const l2 = ['Movimiento', mov.medio ? MEDIOS[mov.medio] : null, `${formatearFechaCorta(mov.fecha)}${mov.hora ? ' ' + mov.hora : ''}`].filter(Boolean).join(' · ');
  const lineas = [`💸 <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}`, esc(l2), 'No cuenta como gasto del mes. Si sí lo fue, toca «Fue un gasto».'];
  for (const r of extra) lineas.push(`${r.severidad === 'info' ? 'ℹ️' : '⚠️'} ${esc(r.detalle_con_cifras)}`);
  if (mov.confianza === 'ia') lineas.push('🤖 Lo leí con IA: revisa monto y comercio.');
  if (!mov.verificado) lineas.push('🔓 No pude verificar el remitente.');
  const botones: Boton[][] = [[
    cb('💸 Fue un gasto', { accion: 'gas', mov: mov.id }), cb('🔁 Es mía', { accion: 'int', mov: mov.id }), cb('🙈 Ignorar', { accion: 'ign', mov: mov.id }),
  ]];
  if (posibleDup) botones.push([cb('Es duplicado', { accion: 'dup', mov: mov.id }), cb('Son dos', { accion: 'ndp', a: posibleDup.a, b: posibleDup.b })]);
  return { texto: lineas.join('\n'), botones };
}

function mensajeMovimiento(
  mov: Movimiento, m: Metricas, cats: Categoria[], extra: Recomendacion[], posibleDup: { a: number; b: number } | null, usadas: string[] = USADAS_DEFECTO,
): RespuestaBot {
  if (esMovimientoSinGasto(mov)) return mensajeTransferencia(mov, extra, posibleDup);
  const esIngreso = mov.tipo === 'ingreso';
  const l1 = esIngreso ? `💰 Te entraron <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}` : lineaMovimiento(mov, cats);
  const l2 = [nombreCat(cats, mov.categoria_id), mov.medio ? MEDIOS[mov.medio] : null, `${formatearFechaCorta(mov.fecha)}${mov.hora ? ' ' + mov.hora : ''}`]
    .filter(Boolean).join(' · ');
  const lineas = [l1, esc(l2)];
  if (!esIngreso) {
    if (m.base_hoy.limita === null) lineas.push('Cuéntame tu ingreso en ⚙️ Más → 💵 Mi ingreso y te digo cuánto puedes gastar.');
    else if (m.libre_hoy !== null) {
      const mes = m.proyeccion_ratio !== null ? ` · Mes ${emojiMes(m)} ${formatearPct(m.proyeccion_ratio)}` : '';
      lineas.push(m.libre_hoy >= 0
        ? `Hoy te quedan <b>${$(m.libre_hoy)}</b> ${emojiDia(m)}${mes}`
        : `Hoy te pasaste <b>${$(-m.libre_hoy)}</b> ${rojoSegunBase(m)}${mes}`);
    }
  }
  for (const r of extra) lineas.push(`${r.severidad === 'info' ? 'ℹ️' : '⚠️'} ${esc(r.detalle_con_cifras)}`);
  if (mov.confianza === 'ia') lineas.push('🤖 Lo leí con IA: revisa monto y comercio.');
  if (!mov.verificado) lineas.push(esIngreso && mov.monto >= 1_000_000 ? '🔓 Verifícalo: no pude verificar el remitente.' : '🔓 No pude verificar el remitente.');

  const botones: Boton[][] = [];
  if (esIngreso) {
    botones.push([cb('➖ No es ingreso', { accion: 'ni', mov: mov.id })]);
  } else if (categoriaIncierta(mov)) {
    lineas.push('¿En qué se fue?');
    botones.push(...tecladoPregunta(mov.id, cats, usadas));
  } else {
    botones.push([cb('🏷 Cambiar', { accion: 'cat', mov: mov.id }), cb('🙈 Ignorar', { accion: 'ign', mov: mov.id })]);
  }
  if (posibleDup) botones.push([cb('Es duplicado', { accion: 'dup', mov: mov.id }), cb('Son dos', { accion: 'ndp', a: posibleDup.a, b: posibleDup.b })]);
  return { texto: lineas.join('\n'), botones };
}

export function mensajeAviso(r: ResultadoAviso, m: Metricas, cats: Categoria[], extra: Recomendacion[], usadas?: string[]): RespuestaBot[] {
  switch (r.estado) {
    case 'creado': {
      const dup = r.anomalias.find((a) => a.tipo === 'posible_duplicado' && a.otro_id !== null);
      const par = dup ? { a: Math.min(dup.movimiento_id, dup.otro_id as number), b: Math.max(dup.movimiento_id, dup.otro_id as number) } : null;
      return [mensajeMovimiento(r.movimiento, m, cats, extra, par, usadas)];
    }
    case 'por_revisar':
      return [{ texto: `📭 No pude leer un aviso de ${esc(r.banco ?? 'tu banco')}. Queda en el panel → Por revisar.` }];
    default:
      return [];   // fusionado, duplicado, ignorado: sin mensaje
  }
}

// ---------------------------------------------------------------------------
// Formateadores de reportes (los usan los reportes programados de n8n)
// ---------------------------------------------------------------------------

const LIMITE_TOP = 3;

export function formatearHoy(m: Metricas, cats: Categoria[], movsHoy: Movimiento[] = []): string {
  const l: string[] = [];
  l.push(`${SEM[m.semaforo]} <b>Hoy</b> · ${formatearFechaCorta(m.fecha)}`);
  if (m.libre_hoy === null) l.push(esc(m.base.aviso_modo ?? 'Aún no tengo con qué calcular.'));
  else {
    l.push(m.libre_hoy >= 0 ? `Puedes gastar <b>${$(m.libre_hoy)}</b> más hoy (límite ${$(m.limite_hoy ?? 0)}).` : `Hoy te pasaste <b>${$(-m.libre_hoy)}</b> (límite ${$(m.limite_hoy ?? 0)}).`);
  }
  l.push(`Gastado hoy: <b>${$(m.gastado_hoy)}</b>`);
  const top = movsHoy.filter((x) => x.sentido === 'salida' && x.computa).sort((a, b) => b.monto - a.monto).slice(0, LIMITE_TOP);
  for (const x of top) l.push(`  ${catDe(cats, x.categoria_id)?.emoji ?? '📦'} ${$(x.monto)} · ${esc(x.comercio)}`);
  if (m.libre_hoy !== null) {
    l.push(`Mes: ${emojiMes(m)} cierras en <b>${$(m.proyeccion_fin_mes)}</b>${m.proyeccion_ratio !== null ? ` (${formatearPct(m.proyeccion_ratio)} de lo disponible)` : ''}`);
    l.push(esc(m.semaforo_razon));
  }
  l.push(m.racha.dias > 0 ? `🔥 Racha: ${m.racha.dias} ${m.racha.dias === 1 ? 'día' : 'días'} bajo el límite` : 'Racha: 0 días');
  if (m.base.aviso_modo && m.libre_hoy !== null) l.push(`<i>${esc(m.base.aviso_modo)}</i>`);
  return l.join('\n');
}

function variacion(actual: number, previo: number): string {
  if (previo <= 0) return '';
  const d = actual / previo - 1;
  return ` (${d >= 0 ? '+' : '−'}${formatearPct(Math.abs(d))} vs. la semana anterior)`;
}

export function formatearSemana(
  r: ResumenPeriodo, previo: ResumenPeriodo, m: Metricas, cats: Categoria[],
  proximos: { nombre: string; fecha: string; monto: number }[] = [],
): string {
  const l: string[] = [`📅 <b>Últimos 7 días</b> (${formatearFechaCorta(r.desde)} – ${formatearFechaCorta(r.hasta)})`];
  l.push(`Gastaste <b>${$(r.gastado_variable)}</b>${variacion(r.gastado_variable, previo.gastado_variable)}`);
  for (const c of r.por_categoria.slice(0, 5)) l.push(`  ${catDe(cats, c.categoria_id)?.emoji ?? '📦'} ${esc(nombreCat(cats, c.categoria_id))}: ${$(c.total)}`);
  if (m.hormiga.total_7d > 0) l.push(`🐜 Gastos pequeños: ${$(m.hormiga.total_7d)}`);
  if (m.nocturnas.cantidad_7d > 0) l.push(`🌙 Compras nocturnas: ${m.nocturnas.cantidad_7d} (${$(m.nocturnas.total_7d)})`);
  if (proximos.length) {
    l.push('<b>Cobros de la próxima semana</b>');
    for (const p of proximos) l.push(`  ${formatearFechaCorta(p.fecha)} · ${esc(p.nombre)} ${$(p.monto)}`);
  }
  return l.join('\n');
}

export function formatearMes(r: ResumenPeriodo, m: Metricas | null, cats: Categoria[]): string {
  const l: string[] = [`🗓 <b>${r.desde.slice(0, 7)}</b>`];
  l.push(`Día a día: <b>${$(r.gastado_variable)}</b> · Fijos: ${$(r.gastado_fijos)} · Ingresos: ${$(r.ingresos)}`);
  if (m) {
    l.push(`${SEM[m.semaforo]} Proyección: <b>${$(m.proyeccion_fin_mes)}</b>${m.proyeccion_ratio !== null ? ` (${formatearPct(m.proyeccion_ratio)} de lo disponible)` : ''}`);
    if (m.score.valor !== null) l.push(`Score: <b>${m.score.valor}</b>/100`);
    const conPres = m.por_categoria.filter((c) => c.presupuesto !== null);
    if (conPres.length) {
      l.push('<b>Presupuestos</b>');
      for (const c of conPres) l.push(`  ${catDe(cats, c.categoria_id)?.emoji ?? ''} ${esc(nombreCat(cats, c.categoria_id))}: ${$(c.gastado)} de ${$(c.presupuesto ?? 0)}${c.estado === 'pasado' ? ' ⚠️' : ''}`);
    }
  }
  const sinPres = r.por_categoria.slice(0, 5);
  if (sinPres.length) {
    l.push('<b>Por categoría</b>');
    for (const c of sinPres) l.push(`  ${catDe(cats, c.categoria_id)?.emoji ?? ''} ${esc(nombreCat(cats, c.categoria_id))}: ${$(c.total)}`);
  }
  if (r.top_comercios.length) {
    l.push('<b>Dónde más gastaste</b>');
    for (const c of r.top_comercios.slice(0, 5)) l.push(`  ${esc(c.comercio)}: ${$(c.total)} (${c.cantidad})`);
  }
  return l.join('\n');
}

export function formatearVeredicto(v: Veredicto): RespuestaBot {
  const em = v.decision === 'si' ? '✅' : v.decision === 'espera' ? '⏳' : '🚫';
  const l = [`${em} <b>${esc(v.titulo)}</b> · ${$(v.cifras.monto)}`, ...v.razones.map((x) => `• ${esc(x)}`)];
  if (v.lista_espera_id !== null) l.push('📝 Lo guardé en tu lista de espera.');
  return { texto: l.join('\n') };
}

// ---------------------------------------------------------------------------
// Reportes (§5.6)
// ---------------------------------------------------------------------------

const partes = (html: string): RespuestaBot[] => partirMensaje(html).map((texto) => ({ texto }));

export function reporteCierre(inst: Instantanea, m: Metricas): RespuestaBot[] {
  const cats = inst.categorias;
  const l: string[] = [`🌙 <b>Cierre del ${formatearFechaCorta(m.fecha)}</b>`];
  if (m.gastado_hoy <= 0) l.push('Hoy no gastaste nada 👏');
  else if (m.limite_hoy === null) l.push(`Gastaste <b>${$(m.gastado_hoy)}</b>.`);
  else if (m.gastado_hoy > m.limite_hoy) l.push(`Gastaste <b>${$(m.gastado_hoy)}</b> de ${$(m.limite_hoy)} (te pasaste ${$(m.gastado_hoy - m.limite_hoy)}).`);
  else l.push(`Gastaste <b>${$(m.gastado_hoy)}</b> de ${$(m.limite_hoy)}; te sobraron ${$(m.limite_hoy - m.gastado_hoy)}.`);
  const top = inst.movimientos.filter((x) => x.fecha === m.fecha && x.sentido === 'salida' && x.computa).sort((a, b) => b.monto - a.monto).slice(0, LIMITE_TOP);
  for (const x of top) l.push(`  ${catDe(cats, x.categoria_id)?.emoji ?? '📦'} ${$(x.monto)} · ${esc(x.comercio)}`);
  if (m.libre_hoy !== null) l.push(`${SEM[m.semaforo]} Mes: cierras en <b>${$(m.proyeccion_fin_mes)}</b>${m.proyeccion_ratio !== null ? ` (${formatearPct(m.proyeccion_ratio)})` : ''}`);
  l.push(`🔥 Racha: ${m.racha.dias} ${m.racha.dias === 1 ? 'día' : 'días'}`);
  return partes(l.join('\n'));
}

export function reporteSemanal(inst: Instantanea, m: Metricas): RespuestaBot[] {
  const hoy = m.fecha;
  const r = resumenPeriodo(inst, sumarDias(hoy, -6), hoy);
  const previo = resumenPeriodo(inst, sumarDias(hoy, -13), sumarDias(hoy, -7));
  const prox = cobrosEntre(inst.recurrentes, hoy, sumarDias(hoy, 7)).map((c) => ({ nombre: c.recurrente.nombre, fecha: c.fecha, monto: c.recurrente.monto_tipico }));
  return partes(formatearSemana(r, previo, m, inst.categorias, prox));
}

export function reporteMensual(inst: Instantanea, mes: Mes): RespuestaBot[] {
  const { desde, hasta } = rangoMes(mes);
  const actual = calcularMetricas(inst);
  return partes(formatearMes(resumenPeriodo(inst, desde, hasta), actual.mes === mes ? actual : null, inst.categorias));
}

export function reporteSuscripciones(inst: Instantanea): RespuestaBot[] {
  const hoy = aBogota(inst.ahora).fecha;
  const manana = sumarDias(hoy, 1);
  const cobros = cobrosEntre(inst.recurrentes, manana, manana);
  if (!cobros.length) return [];
  const l = ['📱 <b>Mañana te cobran</b>', ...cobros.map((c) => `  ${esc(c.recurrente.nombre)} · ${$(c.recurrente.monto_tipico)} (${c.recurrente.periodo})`)];
  return partes(l.join('\n'));
}

// ---------------------------------------------------------------------------
// manejarUpdate
// ---------------------------------------------------------------------------

function buscarCategoria(entrada: string, cats: Categoria[]): { ok: true; categoria: Categoria } | { ok: false; opciones: Categoria[] } {
  const activas = cats.filter((c) => c.activa);
  const t = normalizarTexto(entrada.replace(/^#/, ''));
  const exacta = activas.find((c) => c.id === t || normalizarTexto(c.nombre) === t || c.emoji === entrada.trim());
  if (exacta) return { ok: true, categoria: exacta };
  if (t.length >= 3) {
    const pref = activas.filter((c) => c.id.startsWith(t) || normalizarTexto(c.nombre).startsWith(t));
    if (pref.length === 1) return { ok: true, categoria: pref[0] };
    if (pref.length > 1) return { ok: false, opciones: pref };
  }
  return { ok: false, opciones: activas.filter((c) => c.es_gasto && !c.sistema) };
}

const idDe = (s: string): number | null => { const m = /^#?(\d{1,12})$/.exec(s.trim()); return m ? Number(m[1]) : null; };

/** Deja cada respuesta como la espera n8n: en un texto no se edita ni se contesta un callback; en un callback siempre se contesta. */
function normalizar(u: UpdateBot, rs: RespuestaBot[]): RespuestaBot[] {
  return rs.map((r) => {
    const x: RespuestaBot = { ...r };
    if (u.tipo === 'callback') { if (!x.answer_callback) x.answer_callback = {}; }
    else { delete x.answer_callback; delete x.editar_message_id; delete x.borrar_message_id; }
    if ((x.botones && x.botones.length) || x.editar_message_id !== undefined) { delete x.teclado; delete x.quitar_teclado; }
    if (x.teclado) delete x.quitar_teclado;
    return x;
  });
}

export async function manejarUpdate(u: UpdateBot, ctx: ContextoBot): Promise<RespuestaBot[]> {
  try {
    const rs = u.tipo === 'callback' ? await manejarCallback(u, ctx) : await manejarTexto(u, ctx);
    return normalizar(u, rs);
  } catch (e) {
    if (e instanceof ErrorUsuario) return normalizar(u, reply(esc(e.message)));
    if (e instanceof ErrorConflicto) return normalizar(u, reply('Ese movimiento cambió mientras lo editabas. Inténtalo de nuevo.'));
    try { ctx.datos.registrarEvento({ nivel: 'error', tipo: 'bot_error', detalle: e instanceof Error ? e.name : 'desconocido' }); } catch { /* sin bitácora */ }
    return normalizar(u, reply('Algo salió mal de mi lado. Inténtalo de nuevo en un momento.'));
  }
}

const menuFijo = (ctx: ContextoBot) => tecladoMenu(pendientesDe(ctx.datos.instantanea(ctx.ahora)).length);

/** Una pantalla como mensaje nuevo (texto) o editando el mensaje del botón (callback). */
const pantalla = (u: UpdateBot, p: RespuestaBot): RespuestaBot[] => [{ ...p, ...(u.message_id !== undefined ? { editar_message_id: u.message_id } : {}) }];

/** Destinos de navegación: los usan los botones (editan) y las etiquetas del menú fijo (mensaje nuevo). */
function irADestino(dest: string, u: UpdateBot, ctx: ContextoBot): RespuestaBot[] {
  switch (dest) {
    case 'hoy': return pantalla(u, pantallaHoy(ctx));
    case 'mes': return pantalla(u, pantallaMes(ctx));
    case 'mas': return pantalla(u, pantallaMas());
    case 'ult': return pantalla(u, pantallaUltimos(ctx));
    case 'mov': return pantalla(u, pantallaMovimientosHoy(ctx));
    case 'rec': return pantalla(u, pantallaRecomendaciones(ctx));
    case 'metas': return pantalla(u, pantallaMetas(ctx));
    case 'subs': return pantalla(u, pantallaSuscripciones(ctx, u.tipo === 'callback'));
    case 'ing': return pantalla(u, pantallaIngreso(ctx));
    case 'ingk': return abrirIngreso(ctx, u);
    case 'pres': return pantalla(u, pantallaPresupuestos(ctx));
    case 'panel': return pantalla(u, pantallaPanel(ctx));
    case 'cuentas': return pantalla(u, pantallaCuentas(ctx));
    case 'pausa': return pantalla(u, pantallaPausa(ctx));
    case 'pzoff': {
      ctx.datos.fijarConfig('pausa_hasta', null, 'bot');
      return [{ ...pantallaPausa(ctx), ...(u.message_id !== undefined ? { editar_message_id: u.message_id } : {}), answer_callback: { texto: 'Alertas reactivadas' } }];
    }
    case 'ayuda': return pantalla(u, u.tipo === 'callback' ? { texto: textoAyuda(), botones: [[irA('↩ Más', 'mas')]] } : { texto: textoAyuda(), teclado: menuFijo(ctx) });
    case 'pend': {
      const p = pantallaPendiente(ctx);
      return pantalla(u, colaPendientes(ctx).length === 0 && u.tipo === 'texto' ? { ...p, teclado: menuFijo(ctx) } : p);
    }
    case 'gasto': return abrirGasto(ctx, u);
    case 'ing1': return abrirIngresoUno(ctx, u);
    case 'puedo': return abrirPuedo(ctx, u);
    case 'nmeta': return abrirNuevaMeta(ctx, u);
    case 'menu': return reply('👇 Aquí tienes el menú.', { teclado: menuFijo(ctx) });
    default: return toast(YA_PASO);
  }
}

async function manejarTexto(u: UpdateBot, ctx: ContextoBot): Promise<RespuestaBot[]> {
  const texto = (u.texto ?? '').trim();
  if (!texto) return reply('Toca un botón o escríbeme algo como «café 8000».', { teclado: menuFijo(ctx) });
  if (texto.startsWith('/')) {
    ctx.datos.borrarEstadoBot(String(u.chat_id));
    return manejarComandoOculto(u, ctx, texto);
  }

  const ent = entender(texto);
  if (ent.tipo === 'menu') {
    ctx.datos.borrarEstadoBot(String(u.chat_id));
    if (ent.dest === 'deshacer') return comandoDeshacer(ctx);
    return irADestino(ent.dest, u, ctx);
  }
  const enCurso = textoEnCurso(ctx, u, texto);
  if (enCurso) return enCurso;

  switch (ent.tipo) {
    case 'pregunta': return preguntar(texto, ctx);
    case 'nada': return reply('No te entendí. Toca un botón o escríbeme algo como «café 8000» o «puedo comprar unos tenis de 200k».', { teclado: menuFijo(ctx) });
    default: return textoLibre(ctx, u, ent);
  }
}

function comandoDeshacer(ctx: ContextoBot): RespuestaBot[] {
  const d = ctx.datos.deshacerUltima('bot', ctx.ahora);
  return reply(d ? `↩ Deshecho: ${esc(d.descripcion)}` : 'No hay nada para deshacer en las últimas 24 horas.');
}

async function manejarComandoOculto(u: UpdateBot, ctx: ContextoBot, texto: string): Promise<RespuestaBot[]> {
  const { datos, ahora } = ctx;
  const cmd = parsearComando(texto);
  const hoy = aBogota(ahora).fecha;
  if (cmd.tipo === 'desconocido') return reply('Ese comando no lo conozco. Usa los botones de abajo o escríbeme normal.', { teclado: menuFijo(ctx) });
  if (cmd.tipo === 'texto_libre') return reply('Toca un botón o escríbeme algo como «café 8000».', { teclado: menuFijo(ctx) });

  const args = cmd.args;
  const tokens = args ? args.split(/\s+/) : [];

  switch (cmd.nombre) {
    case 'ayuda': return irADestino('ayuda', u, ctx);
    case 'menu': return irADestino('menu', u, ctx);
    case 'panel': return irADestino('panel', u, ctx);
    case 'pregunta':
      if (!args) return reply('¿Qué quieres saber? Ej: ¿cuánto gasté en Rappi en septiembre?');
      {
        const ent = entender(args);   // «¿puedo gastar 450 mil en un hotel?» → veredicto con botones, no texto suelto
        if (ent.tipo === 'puedo') return textoLibre(ctx, u, ent);
      }
      return preguntar(args, ctx);

    case 'hoy': return irADestino('hoy', u, ctx);
    case 'semana': {
      const { inst, m } = vista(ctx);
      return reporteSemanal(inst, m);
    }
    case 'mes':
    case 'exportar': {
      if (cmd.nombre === 'mes' && !args) return irADestino('mes', u, ctx);
      const mes = args ? parsearMes(args, hoy) : parsearMes('actual', hoy);
      if (!mes) return reply(`No entendí el mes «${esc(args)}». Prueba con 2026-09 o «pasado».`);
      const { inst, m, cats } = vista(ctx);
      const { desde, hasta } = rangoMes(mes);
      const t = formatearMes(resumenDe(datos, inst, desde, hasta), m.mes === mes ? m : null, cats)
        + (cmd.nombre === 'exportar' ? `\n\nDescarga el detalle en tu PC: ${esc(ctx.urlPanel)}/movimientos?exportar=${mes}` : '');
      return partes(t);
    }
    case 'ultimos': {
      if (!args) return irADestino('ult', u, ctx);
      const n = Number(args);
      if (!Number.isInteger(n) || n < 1 || n > 20) return reply('Dame un número entre 1 y 20.');
      const cats = datos.listarCategorias();
      const movs = datos.ultimosMovimientos(n);
      if (!movs.length) return reply('Aún no tengo movimientos.');
      return partes(movs.map((x) => `#${x.id} ${catDe(cats, x.categoria_id)?.emoji ?? '📦'} ${x.sentido === 'entrada' ? '+' : ''}${$(x.monto)} · ${esc(recortar(x.comercio, 40))} · ${formatearFechaCorta(x.fecha)}${x.sentido === 'salida' && !x.computa ? ' · no cuenta' : ''}`).join('\n'));
    }
    case 'categorias': {
      const { m, cats } = vista(ctx);
      const gastado = new Map(m.por_categoria.map((c) => [c.categoria_id, c.gastado]));
      return partes(['<b>Categorías</b> (gastado este mes)', ...cats.filter((c) => c.activa).map((c) => `${c.emoji} ${esc(c.nombre)} <code>${esc(c.id)}</code>${c.es_gasto ? ` · ${$(gastado.get(c.id) ?? 0)}` : ''}`)].join('\n'));
    }
    case 'cat': return comandoCat(tokens, ctx);
    case 'presupuesto': return tokens.length ? comandoPresupuesto(tokens, ctx) : irADestino('pres', u, ctx);
    case 'ingreso': return tokens.length ? comandoIngreso(args, tokens, ctx) : irADestino('ing', u, ctx);
    case 'meta': return args ? comandoMeta(args, ctx) : irADestino('metas', u, ctx);
    case 'puedo': return comandoPuedo(tokens, u, ctx);
    case 'quiero': return comandoQuiero(tokens, ctx);
    case 'suscripciones': return irADestino('subs', u, ctx);
    case 'gasto': return tokens.length ? comandoGasto(tokens, ctx) : abrirGasto(ctx, u);
    case 'deshacer': return comandoDeshacer(ctx);
    case 'pausa': {
      if (args.toLowerCase() === 'off') { datos.fijarConfig('pausa_hasta', null, 'bot'); return reply('🔔 Alertas y reportes reactivados.'); }
      let h = 24;
      if (args) { h = Number(args); if (!Number.isInteger(h) || h < 1 || h > 168) return reply('Entre 1 y 168 horas.'); }
      const hasta = new Date(ahora.getTime() + h * 3_600_000);
      datos.fijarConfig('pausa_hasta', isoSinMs(hasta), 'bot');
      const b = aBogota(hasta);
      return reply(`🔕 Alertas y reportes en pausa hasta el ${formatearFechaCorta(b.fecha)} ${b.hora}. Los avisos de cada movimiento siguen llegando.`);
    }
  }
}

async function preguntar(texto: string, ctx: ContextoBot): Promise<RespuestaBot[]> {
  const r = await responderPregunta(texto, ctx.datos, ctx.ia, ctx.ahora);
  return partes(esc(r.texto));
}

// ----- /cat -----
function comandoCat(tokens: string[], ctx: ContextoBot): RespuestaBot[] {
  const { datos } = ctx;
  const cats = datos.listarCategorias();
  let id: number | null = null;
  let catTxt = '';
  if (tokens.length && idDe(tokens[0]) !== null) { id = idDe(tokens[0]); catTxt = tokens.slice(1).join(' '); }
  else catTxt = tokens.join(' ');
  const mov = id !== null ? datos.obtenerMovimiento(id) : datos.ultimosMovimientos(1)[0] ?? null;
  if (!mov) return reply(id !== null ? `No encontré el movimiento #${id}.` : 'Aún no tengo movimientos.');
  if (!catTxt) {
    return reply(`${lineaMovimiento(mov, cats)}\nElige la categoría:`, { botones: tecladoCategorias(mov.id, cats) });
  }
  const r = buscarCategoria(catTxt, cats);
  if (!r.ok) return reply(`¿Cuál categoría? Opciones: ${r.opciones.map((c) => `${c.emoji} ${esc(c.nombre)}`).join(', ')}`);
  const res = datos.recategorizar(mov.id, r.categoria.id, 'bot');
  return reply(textoRecategorizado(res.movimiento, r.categoria, res.aplicados_a));
}

function textoRecategorizado(mov: Movimiento, cat: Categoria, otros: number): string {
  return `${cat.emoji} Listo: <b>${$(mov.monto)}</b> en ${esc(mov.comercio)} ahora es <b>${esc(cat.nombre)}</b>.\n`
    + `Aprendí la regla: lo próximo de ese comercio irá a ${esc(cat.nombre)}${otros > 0 ? ` (cambié ${otros} más)` : ''}.`;
}

// ----- presupuesto (con argumentos) -----
function comandoPresupuesto(tokens: string[], ctx: ContextoBot): RespuestaBot[] {
  const { datos, ahora } = ctx;
  const mesActual = aBogota(ahora).fecha.slice(0, 7);
  const cats = datos.listarCategorias();
  if (tokens.length < 2) return reply('Dime la categoría y el monto, o usa ⚙️ Más → 📊 Presupuesto.');
  const objetivo = tokens[0].toLowerCase();
  let catId: string;
  let nombre: string;
  if (objetivo === 'total') { catId = '*'; nombre = 'el total'; }
  else {
    const r = buscarCategoria(objetivo, cats.filter((c) => c.es_gasto));
    if (!r.ok) return reply(`¿Cuál categoría? Opciones: total, ${r.opciones.map((c) => esc(c.nombre)).join(', ')}`);
    catId = r.categoria.id; nombre = r.categoria.nombre;
  }
  const siempre = tokens[tokens.length - 1].toLowerCase() === 'siempre';
  const resto = siempre ? tokens.slice(1, -1) : tokens.slice(1);
  let monto: number | null;
  if (resto.join('') === '0') monto = null;
  else {
    const t = tomarMonto(resto);
    if (!t.res.ok) return reply(errMonto(t.res, t.texto));
    monto = t.res.valor;
  }
  datos.fijarPresupuesto(siempre ? '*' : mesActual, catId, monto, 'bot');
  const cuando = siempre ? 'todos los meses' : 'este mes';
  if (monto === null) return reply(`Quité el presupuesto de ${esc(nombre)} (${cuando}).`);
  return reply(`✅ Presupuesto de ${esc(nombre)}: <b>${$(monto)}</b> (${cuando}).` + (catId === '*' ? '\nTotal es lo máximo para el día a día, sin contar fijos.' : ''));
}

// ----- ingreso (con argumentos) -----
function comandoIngreso(args: string, tokens: string[], ctx: ContextoBot): RespuestaBot[] {
  const { datos } = ctx;
  const sub = tokens[0].toLowerCase();
  if (sub === 'ahorro') {
    const n = Number((tokens[1] ?? '').replace('%', '').replace(',', '.'));
    if (!tokens[1] || !Number.isFinite(n) || n < 0 || n > 80) return reply('El ahorro va de 0 % a 80 %.');
    datos.fijarConfig('pct_ahorro', n, 'bot');
    return reply(`✅ Ahorro: <b>${n}%</b> de tu ingreso.`);
  }
  if (sub === 'fijo') {
    let rest = tokens.slice(1);
    let dia: number | null = null;
    const m = /^(.*?)\s+d[ií]a\s+(\d{1,2})$/i.exec(rest.join(' '));
    if (m) { dia = Number(m[2]); rest = m[1].split(/\s+/); if (dia < 1 || dia > 31) return reply('El día va de 1 a 31.'); }
    if (rest.length < 2) return reply('Dime el nombre y el monto. Ej: arriendo 1.2M día 5');
    // el monto son las últimas 1–2 palabras
    let monto = parsearMonto(rest.slice(-2).join(' '));
    let nombreTokens = rest.slice(0, -2);
    if (!monto.ok || !/^(k|mil|lucas|luca|m|mm|millon|millón|millones|palo|palos)$/i.test(rest[rest.length - 1])) { monto = parsearMonto(rest[rest.length - 1]); nombreTokens = rest.slice(0, -1); }
    if (!monto.ok) return reply(errMonto(monto, rest[rest.length - 1]));
    const nombre = nombreTokens.join(' ').trim();
    const patron = normalizarComercio(nombre);
    if (!nombre || nombre.length > 40 || patron.length < 2) return reply('El nombre del fijo va de 2 a 40 caracteres. Ej: arriendo 1.2M día 5');
    const f = datos.guardarFijo({ nombre, monto: monto.valor, dia_mes: dia, patron }, 'bot');
    return reply(`✅ Fijo «${esc(f.nombre)}»: <b>${$(f.monto)}</b>${f.dia_mes ? ` (día ${f.dia_mes})` : ''}.`);
  }
  if (sub === 'quitarfijo') {
    const nombre = args.slice(tokens[0].length).trim();
    if (!nombre) return reply('¿Cuál fijo quito? Dime el nombre.');
    return reply(datos.quitarFijo(nombre, 'bot') ? `Quité el fijo «${esc(nombre)}».` : `No tengo un fijo llamado «${esc(nombre)}».`);
  }
  const t = tomarMonto(tokens);
  if (!t.res.ok || t.resto.length) return reply(t.res.ok ? 'Dime solo el monto. Ej: 4M' : errMonto(t.res, t.texto));
  datos.fijarConfig('ingreso_mensual', t.res.valor, 'bot');
  return reply(`✅ Ingreso mensual: <b>${$(t.res.valor)}</b>.`);
}

// ----- meta (con argumentos) -----
function comandoMeta(args: string, ctx: ContextoBot): RespuestaBot[] {
  const { datos, ahora } = ctx;
  const hoy = aBogota(ahora).fecha;
  const nueva = /^nueva\s+(.+?)\s+(\S+(?:\s+(?:k|mil|lucas|luca|m|mm|millon|millón|millones|palo|palos))?)(?:\s+para\s+(\S+))?$/i.exec(args);
  if (/^nueva\b/i.test(args)) {
    if (!nueva) return reply('Para crear una meta toca ⚙️ Más → 🎯 Metas → ➕ Nueva meta.');
    const nombre = nueva[1].trim();
    if (nombre.length > 40) return reply('El nombre de la meta va hasta 40 caracteres.');
    const monto = parsearMonto(nueva[2]);
    if (!monto.ok) return reply(errMonto(monto, nueva[2]));
    let fecha: string | null = null;
    if (nueva[3]) {
      const f = /^(\d{4})-(\d{2})$/.test(nueva[3]) ? rangoMes(nueva[3]).hasta : nueva[3];
      fecha = parsearFechaFutura(f);
      if (!fecha || fecha <= hoy) return reply('La fecha debe ser futura.');
    }
    if (datos.buscarMetaPorNombre(nombre)) return reply(`Ya tienes una meta «${esc(nombre)}».`);
    const meta = datos.crearMeta({ nombre, objetivo: monto.valor, fecha_objetivo: fecha });
    return reply(`🎯 Meta «${esc(meta.nombre)}»: <b>${$(meta.objetivo)}</b>${fecha ? ` para el ${formatearFechaCorta(fecha)} ${fecha.slice(0, 4)}` : ''}.`);
  }
  const ap = /^(.+?)\s+([+-])\s*(\S+(?:\s+(?:k|mil|lucas|luca|m|mm|millon|millón|millones|palo|palos))?)$/i.exec(args);
  if (ap) {
    const meta = datos.buscarMetaPorNombre(ap[1].trim());
    if (!meta) return reply(`No encontré la meta «${esc(ap[1].trim())}».`);
    const monto = parsearMonto(ap[3]);
    if (!monto.ok) return reply(errMonto(monto, ap[3]));
    const delta = ap[2] === '-' ? -monto.valor : monto.valor;
    if (meta.aportado + delta < 0) return reply(`No puedes sacar más de lo que llevas (${$(meta.aportado)}).`);
    const nuevo = meta.aportado + delta;
    datos.aportarMeta(meta.id, delta, hoy, 'bot');
    return reply(`${delta > 0 ? '➕' : '➖'} ${esc(meta.nombre)}: <b>${$(nuevo)}</b> de ${$(meta.objetivo)} (${formatearPct(nuevo / meta.objetivo)}).` + (nuevo >= meta.objetivo ? '\n🎉 ¡Meta cumplida!' : ''));
  }
  const est = /^(.+?)\s+(pausar|reanudar|cancelar)$/i.exec(args);
  if (est) {
    const meta = datos.buscarMetaPorNombre(est[1].trim());
    if (!meta) return reply(`No encontré la meta «${esc(est[1].trim())}».`);
    const accion = est[2].toLowerCase();
    datos.cambiarEstadoMeta(meta.id, accion === 'pausar' ? 'pausada' : accion === 'reanudar' ? 'activa' : 'cancelada');
    return reply(`Meta «${esc(meta.nombre)}»: ${accion === 'pausar' ? 'en pausa ⏸' : accion === 'reanudar' ? 'reactivada ▶️' : 'cancelada'}.`);
  }
  return reply('Toca ⚙️ Más → 🎯 Metas para verlas y sumarles.');
}

function parsearFechaFutura(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

// ----- ¿puedo? y lista de espera -----
function comandoPuedo(tokens: string[], u: UpdateBot, ctx: ContextoBot): RespuestaBot[] {
  if (!tokens.length) return abrirPuedo(ctx, u);
  const t = tomarMonto(tokens);
  if (!t.res.ok) return reply(errMonto(t.res, t.texto));
  return veredictoCompra(ctx, u, { monto: t.res.valor, desc: t.resto.join(' ') });
}

function comandoQuiero(tokens: string[], ctx: ContextoBot): RespuestaBot[] {
  const { datos, ahora } = ctx;
  if (!tokens.length) {
    const lista = datos.instantanea(ahora).lista_espera;
    if (!lista.length) return reply('Tu lista de espera está vacía. Cuando algo grande te tiente, dímelo y lo guardo 48 horas.');
    return partes(['<b>Lista de espera</b>', ...lista.map((i) => {
      const h = Math.max(0, Math.ceil((new Date(i.disponible_en).getTime() - ahora.getTime()) / 3_600_000));
      return `#${i.id} ${esc(i.descripcion)} · ${$(i.monto)} · ${h > 0 ? `faltan ${h} h` : 'ya pasó el tiempo'}`;
    })].join('\n'));
  }
  const t = tomarMonto(tokens);
  const desc = t.resto.join(' ').trim();
  if (!t.res.ok) return reply('Dime qué y cuánto. Ej: 300k chaqueta');
  if (!desc) return reply('Dime qué y cuánto. Ej: 300k chaqueta');
  const inst = datos.instantanea(ahora);
  const dnorm = normalizarComercio(desc);
  if (inst.lista_espera.some((i) => normalizarComercio(i.descripcion) === dnorm)) return reply(`«${esc(desc)}» ya está en tu lista de espera.`);
  const cat = categoriaPorReglas(dnorm, inst.reglas) ?? 'otros';
  const item = datos.agregarEspera(recortar(desc, 80), t.res.valor, cat, ahora);
  const b = aBogota(new Date(item.disponible_en));
  return reply(`📝 Guardé «${esc(item.descripcion)}» (${$(item.monto)}). Te pregunto el ${formatearFechaCorta(b.fecha)} ${b.hora}.`);
}

// ----- gasto con argumentos -----
const RE_FECHA = /^(hoy|ayer|anteayer|\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?|\d{4}-\d{2}-\d{2})$/i;

function comandoGasto(tokens: string[], ctx: ContextoBot): RespuestaBot[] {
  const { datos, ahora } = ctx;
  const hoy = aBogota(ahora).fecha;
  const ingreso = tokens[0].startsWith('+');
  const t = tomarMonto([tokens[0].replace(/^\+/, ''), ...tokens.slice(1)]);
  if (!t.res.ok) return reply(errMonto(t.res, t.texto));
  let resto = t.resto;
  let fecha = hoy;
  const ult = resto[resto.length - 1];
  if (ult && RE_FECHA.test(ult)) {
    const sinAnio = /^\d{1,2}[/-]\d{1,2}$/.test(ult);
    const f = parsearFechaUsuario(ult, hoy);
    // «25/12» sin año que aún no llega es futura (el parser la llevaría al año pasado: aquí no).
    const futura = sinAnio && f !== null && f.slice(0, 4) !== hoy.slice(0, 4);
    if (!f || futura) return reply('No registro gastos con fecha futura (ni de hace más de 400 días).');
    fecha = f; resto = resto.slice(0, -1);
  }
  const cats = datos.listarCategorias();
  let catId: string | undefined;
  const iCat = resto.findIndex((x) => x.startsWith('#') && x.length > 1);
  if (iCat >= 0) {
    const r = buscarCategoria(resto[iCat], cats);
    if (!r.ok) return reply(`¿Cuál categoría? Opciones: ${r.opciones.map((c) => `${c.emoji} ${esc(c.nombre)}`).join(', ')}`);
    catId = r.categoria.id; resto = resto.filter((_, i) => i !== iCat);
  }
  const desc = resto.join(' ').trim();
  if (!desc) return reply('Falta la descripción. Ej: 20k almuerzo');
  const mov = datos.crearMovimiento({
    fecha, hora: fecha === hoy ? aBogota(ahora).hora : null, banco: 'efectivo', tipo: ingreso ? 'ingreso' : 'compra',
    sentido: ingreso ? 'entrada' : 'salida', monto: t.res.valor, comercio: recortar(desc, 120),
    ...(catId ? { categoria_id: catId } : {}), medio: 'efectivo', origen: 'manual',
  }, 'bot');
  const { inst, m, cats: cs } = vista(ctx);
  const msg = mensajeMovimiento(mov, m, cs, [], null, masUsadas(inst, 6));
  return [{ ...msg, texto: `✅ Registrado\n${msg.texto}` }];
}

// ---------------------------------------------------------------------------
// Callbacks (§6.5 + docs/BOT-UX.md)
// ---------------------------------------------------------------------------

type Aprendizaje = 'auto' | 'preguntar' | 'ya' | 'no';

/** ¿Qué hacer con la regla al elegir una categoría? Específico y repetido → aprende; específico y nuevo → pregunta; genérico → nada. */
function decidirAprendizaje(inst: Instantanea, mov: Movimiento, catId: string): Aprendizaje {
  if (!mov.computa || mov.sentido !== 'salida' || esComercioGenerico(mov.comercio_norm) || patronAprendido(mov.comercio_norm) === null) return 'no';
  if (categoriaPorReglas(mov.comercio_norm, inst.reglas) === catId) return 'ya';
  const antes = inst.movimientos.some((x) => x.id !== mov.id && x.comercio_norm === mov.comercio_norm && x.categoria_id === catId && x.categoria_fuente === 'manual');
  return antes ? 'auto' : 'preguntar';
}

async function manejarCallback(u: UpdateBot, ctx: ContextoBot): Promise<RespuestaBot[]> {
  const { datos, ahora } = ctx;
  const cbk = parsearCallback(u.callback_data ?? '');
  const editar: Partial<RespuestaBot> = u.message_id !== undefined ? { editar_message_id: u.message_id } : {};
  if (!cbk) { datos.registrarEvento({ nivel: 'aviso', tipo: 'callback_invalido' }); return vacio(); }
  if (cbk.accion === 'ok') return vacio();

  const redibujar = (mov: Movimiento, extraLinea?: string, answer?: string, botonesExtra?: Boton[][]): RespuestaBot[] => {
    const { inst, m, cats } = vista(ctx);
    const msg = mensajeMovimiento(mov, m, cats, [], null, masUsadas(inst, 6));
    const texto = extraLinea ? `${msg.texto}\n${extraLinea}` : msg.texto;
    return [{ ...msg, texto, ...(botonesExtra ? { botones: [...(msg.botones ?? []), ...botonesExtra] } : {}), ...editar, answer_callback: answer ? { texto: answer } : {} }];
  };
  const deshacerFila = (mov: Movimiento): Boton[][] => {
    const a = datos.ultimaAccionDe(mov.id);
    return a !== null ? [[cb('↩ Deshacer', { accion: 'und', accion_id: a })]] : [];
  };
  const noExiste = () => toast('Ese movimiento ya no existe', true);
  const conVersion = (id: number, cambios: Omit<Parameters<typeof datos.editarMovimiento>[1], 'version'>): Movimiento | null => {
    for (let intento = 0; intento < 2; intento++) {
      const actual = datos.obtenerMovimiento(id);
      if (!actual) return null;
      try { return datos.editarMovimiento(id, { ...cambios, version: actual.version }, 'bot'); }
      catch (e) { if (!(e instanceof ErrorConflicto) || intento === 1) throw e; }
    }
    return null;
  };
  const aprendio = (mov: Movimiento, cat: Categoria, otros: number) =>
    `🧠 Aprendí: ${esc(mov.comercio)} → ${cat.emoji} ${esc(cat.nombre)}${otros > 0 ? ` (cambié ${otros} más)` : ''}`;

  switch (cbk.accion) {
    case 'm': return irADestino(cbk.dest, u, ctx);
    case 'k': return teclaPulsada(ctx, u, cbk.n, cbk.tecla);
    case 'c': return categoriaElegida(ctx, u, cbk.n, cbk.cat);
    case 'f': return opcionDeFlujo(ctx, u, cbk.n, cbk.op);

    case 'cat': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov) return noExiste();
      const cats = datos.listarCategorias();
      return [{ texto: `${lineaMovimiento(mov, cats)}\n¿En qué se fue?`, botones: tecladoCategorias(mov.id, cats), ...editar, answer_callback: {} }];
    }
    case 'vol': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      return mov ? redibujar(mov) : noExiste();
    }
    case 'cs': {
      const cats = datos.listarCategorias();
      const cat = cats.find((c) => c.id === cbk.cat && c.activa);
      if (!cat) return toast('Esa categoría no existe', true);
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov) return noExiste();
      const decision = decidirAprendizaje(datos.instantanea(ahora), mov, cat.id);
      if (decision === 'auto') {
        const r = datos.recategorizar(cbk.mov, cat.id, 'bot');
        return redibujar(r.movimiento, aprendio(mov, cat, r.aplicados_a), 'Categoría cambiada');
      }
      const r = datos.recategorizar(cbk.mov, cat.id, 'bot', { aprender: false });
      if (decision === 'preguntar') {
        const msg = mensajeMovimiento(r.movimiento, vista(ctx).m, cats, [], null);
        return [{
          texto: `${msg.texto.split('\n').slice(0, 3).join('\n')}\n¿Recordar «${esc(mov.comercio)}» → ${cat.emoji} ${esc(cat.nombre)}?`,
          botones: [[cb('✅ Sí, siempre', { accion: 'rm', mov: mov.id, cat: cat.id }), cb('Solo esta vez', { accion: 'vol', mov: mov.id })]],
          ...editar, answer_callback: { texto: 'Categoría cambiada' },
        }];
      }
      return redibujar(r.movimiento, undefined, 'Categoría cambiada');
    }
    case 'rm': {
      const cat = datos.listarCategorias().find((c) => c.id === cbk.cat && c.activa);
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!cat) return toast('Esa categoría no existe', true);
      if (!mov) return noExiste();
      const r = datos.recategorizar(cbk.mov, cat.id, 'bot');
      return redibujar(r.movimiento, aprendio(mov, cat, r.aplicados_a), 'Aprendido');
    }
    case 'ni': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov) return noExiste();
      return [{
        texto: `💰 <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}\nSi no es un ingreso, ¿qué fue?`,
        botones: [[cb('🔁 Es mía', { accion: 'int', mov: mov.id }), cb('↩ Fue un reembolso', { accion: 'rev', mov: mov.id })], [cb('🙈 Ignorar', { accion: 'ign', mov: mov.id }), cb('↩ Volver', { accion: 'vol', mov: mov.id })]],
        ...editar, answer_callback: {},
      }];
    }
    case 'ing': {
      const mov = conVersion(cbk.mov, { tipo: 'ingreso', sentido: 'entrada', categoria_id: 'ingresos' });
      return mov ? redibujar(mov, undefined, 'Marcado como ingreso', deshacerFila(mov)) : noExiste();
    }
    case 'gas': {
      // Marca la transferencia como gasto (computa = 1); editarMovimiento re-categoriza y registra la acción, así que se puede deshacer.
      const antes = datos.obtenerMovimiento(cbk.mov);
      if (!antes) return noExiste();
      const mov = antes.computa ? antes : conVersion(cbk.mov, { computa: true });
      return mov ? redibujar(mov, antes.computa ? undefined : '💸 Lo conté como gasto.', 'Contada como gasto', antes.computa ? undefined : deshacerFila(mov)) : noExiste();
    }
    case 'int': {
      const mov = conVersion(cbk.mov, { tipo: 'interno', computa: false, categoria_id: 'interno' });
      return mov ? redibujar(mov, '🔁 Movimiento entre tus cuentas: no cuenta en tus gastos.', 'Marcado como interno', deshacerFila(mov)) : noExiste();
    }
    case 'rev': {
      const antes = datos.obtenerMovimiento(cbk.mov);
      if (!antes) return noExiste();
      const inst = datos.instantanea(ahora);
      const cat = categoriaPorReglas(antes.comercio_norm, inst.reglas) ?? 'otros';
      const mov = conVersion(cbk.mov, { tipo: 'reverso', sentido: 'entrada', categoria_id: cat });
      return mov ? redibujar(mov, '↩ Reembolso: resta de tus gastos.', 'Marcado como reembolso', deshacerFila(mov)) : noExiste();
    }
    case 'ign': case 'dup': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov) return noExiste();
      const cats = datos.listarCategorias();
      const { accion_id } = datos.borrarMovimiento(cbk.mov, 'bot');
      return [{
        texto: `<s>${lineaMovimiento(mov, cats)}</s>\n${cbk.accion === 'dup' ? '🗑 Duplicado eliminado' : '🙈 Ignorado'}`,
        botones: [[cb('↩ Deshacer', { accion: 'und', accion_id })]],
        ...editar, answer_callback: {},
      }];
    }
    case 'und': {
      const d = datos.deshacer(cbk.accion_id, ahora);
      if (!d) return toast('Ya no se puede deshacer', true);
      return [{ texto: `↩ Deshecho: ${esc(d.descripcion)}`, ...editar, answer_callback: { texto: 'Deshecho' } }];
    }
    case 'ndp':
      datos.silenciar(`posible_duplicado:${Math.min(cbk.a, cbk.b)}-${Math.max(cbk.a, cbk.b)}`, '9999-12-31T00:00:00Z');
      return toast('Listo, son dos compras');
    case 'sc': case 'sd': {
      const r = datos.cambiarEstadoRecurrente(cbk.rec, cbk.accion === 'sc' ? 'confirmada' : 'descartada');
      if (!r) return toast('Ese cobro ya no existe', true);
      if (cbk.accion === 'sd') datos.silenciar(`suscripcion_detectada:${cbk.rec}`, '9999-12-31T00:00:00Z');
      return [{ texto: cbk.accion === 'sc' ? `✅ Confirmé ${esc(r.nombre)}.` : `🗑 Descarté ${esc(r.nombre)}; no te lo vuelvo a preguntar.`, ...editar, answer_callback: {} }];
    }
    case 'ec': case 'ed': case 'e48': {
      const it = datos.actualizarEspera(cbk.item, cbk.accion === 'ec' ? 'comprado' : cbk.accion === 'ed' ? 'descartado' : 'extender', ahora);
      if (!it) return toast('Ese ítem ya no está en espera', true);
      const texto = cbk.accion === 'ec' ? `🛍 Anotado: compraste «${esc(it.descripcion)}».`
        : cbk.accion === 'ed' ? `🙌 Te ahorraste ${$(it.monto)} al no comprar «${esc(it.descripcion)}».`
          : `⏳ Listo, te pregunto de nuevo por «${esc(it.descripcion)}» en 48 horas.`;
      return [{ texto, ...editar, answer_callback: {} }];
    }
    case 'pz': {
      const hasta = new Date(ahora.getTime() + cbk.horas * 3_600_000);
      datos.fijarConfig('pausa_hasta', isoSinMs(hasta), 'bot');
      const b = aBogota(hasta);
      return [{
        texto: `🔕 Alertas y reportes en pausa hasta el ${formatearFechaCorta(b.fecha)} ${b.hora}. Los avisos de cada movimiento siguen llegando.`,
        botones: [[irA('🔔 Reactivar', 'pzoff'), irA('↩ Más', 'mas')]], ...editar, answer_callback: { texto: `Pausado ${cbk.horas} h` },
      }];
    }

    // ----- movimientos -----
    case 'mv': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      return mov ? pantalla(u, pantallaMovimiento(ctx, mov)) : noExiste();
    }
    case 'cn': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov || mov.sentido !== 'salida') return noExiste();
      const nuevo = conVersion(cbk.mov, { computa: !mov.computa });
      if (!nuevo) return noExiste();
      return [{ ...pantallaMovimiento(ctx, nuevo), ...editar, answer_callback: { texto: nuevo.computa ? 'Ahora cuenta como gasto' : 'Ya no cuenta como gasto' } }];
    }

    // ----- pendientes -----
    case 'pc': {
      const cat = datos.listarCategorias().find((c) => c.id === cbk.cat && c.activa);
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!cat) return toast('Esa categoría no existe', true);
      if (!mov) return noExiste();
      const decision = decidirAprendizaje(datos.instantanea(ahora), mov, cat.id);
      const aprende = decision === 'auto' || decision === 'preguntar';   // en Pendientes se aprende directo: la idea es ponerse al día rápido
      const r = datos.recategorizar(cbk.mov, cat.id, 'bot', { aprender: aprende });
      const sig = pantallaPendiente(ctx, cbk.mov, { accion_id: datos.ultimaAccionDe(cbk.mov) ?? 0, mov: cbk.mov });
      const nota = aprende ? aprendio(mov, cat, r.aplicados_a) : `✅ ${etiquetaCat(datos.listarCategorias(), cat.id)}`;
      if (!datos.ultimaAccionDe(cbk.mov)) sig.botones = (sig.botones ?? []).filter((f) => !f.some((b) => b.callback_data?.startsWith('pu:')));
      return [{ ...sig, texto: `${nota}\n${sig.texto}`, ...editar, answer_callback: {} }];
    }
    case 'ps': return [{ ...pantallaPendiente(ctx, cbk.mov), ...editar, answer_callback: {} }];
    case 'pi': {
      const mov = datos.obtenerMovimiento(cbk.mov);
      if (!mov) return noExiste();
      const { accion_id } = datos.borrarMovimiento(cbk.mov, 'bot');
      const sig = pantallaPendiente(ctx, cbk.mov, { accion_id, mov: cbk.mov });
      return [{ ...sig, texto: `🙈 Ignorado: ${esc(recortar(mov.comercio, 30))}\n${sig.texto}`, ...editar, answer_callback: {} }];
    }
    case 'pu': {
      const d = datos.deshacer(cbk.accion_id, ahora);
      if (!d) return toast('Ya no se puede deshacer', true);
      return [{ ...pantallaPendiente(ctx, cbk.mov + 1), ...editar, answer_callback: { texto: 'Deshecho' } }];
    }

    // ----- ingreso y ahorro -----
    case 'ah': {
      datos.fijarConfig('pct_ahorro', cbk.pct, 'bot');
      return [{ ...pantallaIngreso(ctx), ...editar, answer_callback: { texto: `Ahorro ${cbk.pct} %` } }];
    }
    case 'iu': {
      const { m } = vista(ctx);
      if (m.base.modo !== 'ingreso_estimado' || !m.base.ingreso) return toast(YA_PASO);
      datos.fijarConfig('ingreso_mensual', Math.round(m.base.ingreso), 'bot');
      return [{ ...pantallaIngreso(ctx), ...editar, answer_callback: { texto: 'Ingreso guardado' } }];
    }

    // ----- presupuesto -----
    case 'bd': {
      const p = pantallaPresupuestoCat(ctx, cbk.cat);
      return p ? pantalla(u, p) : toast(YA_PASO);
    }
    case 'bm': case 'bp': {
      const total = cbk.cat === 'total';
      const catId = total ? '*' : cbk.cat;
      if (!total && !datos.listarCategorias().some((c) => c.id === cbk.cat && c.es_gasto && c.activa)) return toast(YA_PASO);
      const actual = presupuestoVigente(ctx, catId);
      const nuevo = (actual?.monto ?? 0) + (cbk.accion === 'bp' ? 50_000 : -50_000);
      datos.fijarPresupuesto(actual?.mes ?? '*', catId, nuevo > 0 ? nuevo : null, 'bot');
      const p = pantallaPresupuestoCat(ctx, cbk.cat);
      return p ? [{ ...p, ...editar, answer_callback: {} }] : toast(YA_PASO);
    }
    case 'be': return abrirTopePresupuesto(ctx, u, cbk.cat);
    case 'bq': {
      const catId = cbk.cat === 'total' ? '*' : cbk.cat;
      const actual = presupuestoVigente(ctx, catId);
      if (actual) datos.fijarPresupuesto(actual.mes as Mes | '*', catId, null, 'bot');
      const p = pantallaPresupuestoCat(ctx, cbk.cat);
      return p ? [{ ...p, ...editar, answer_callback: { texto: 'Tope quitado' } }] : toast(YA_PASO);
    }

    // ----- metas -----
    case 'me': {
      const p = pantallaMeta(ctx, cbk.meta);
      return p ? pantalla(u, p) : toast('Esa meta ya no existe', true);
    }
    case 'ma': case 'ms': return abrirAporte(ctx, u, cbk.meta, cbk.accion === 'ms');
    case 'mp': {
      const x = datos.instantanea(ahora).metas.find((y) => y.id === cbk.meta);
      if (!x) return toast('Esa meta ya no existe', true);
      datos.cambiarEstadoMeta(x.id, x.estado === 'pausada' ? 'activa' : 'pausada');
      const p = pantallaMeta(ctx, x.id);
      return p ? [{ ...p, ...editar, answer_callback: { texto: x.estado === 'pausada' ? 'Meta reactivada' : 'Meta en pausa' } }] : toast(YA_PASO);
    }
  }
}

// Evita advertencia de import de tipo sin uso en algunas configuraciones.
export type { Instantanea, CallbackBot };
