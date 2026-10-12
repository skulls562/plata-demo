// Pantallas del bot: cada una devuelve una RespuestaBot corta (≤ 12 líneas) con sus botones. Quien llama decide si se
// envía como mensaje nuevo o se edita el anterior (`editar_message_id`).
import { resumenDe } from '../consultas';
import { aBogota, formatearCOPCorto, formatearFechaCorta, formatearPct, rangoMes, recortar } from '../formato';
import { baseEsEstimada } from '../metricas';
import { evaluarReglas } from '../recomendar';
import type { Boton, Categoria, Movimiento, Recomendacion, RespuestaBot } from '../tipos';
import { cb, irA } from './callbacks';
import {
  $, MEDIOS, SEM, categoriasGasto, catDe, emojiCat, emojiMes, enFilas, esc, nombreCat, pendientesDe, vista,
  type ContextoBot,
} from './comun';

const CANT_ULTIMOS = 5;

// ---------------------------------------------------------------------------
// Recomendaciones
// ---------------------------------------------------------------------------

const emojiSev = (r: Recomendacion) => (r.severidad === 'alerta' ? '🚨' : r.severidad === 'aviso' ? '⚠️' : 'ℹ️');

/** Botones propios de una recomendación (suscripción detectada, lista de espera, duplicado). */
function botonesRecomendacion(r: Recomendacion): Boton[][] {
  const alcance = r.id.slice(r.regla.length + 1);
  const n = /^\d{1,12}$/.test(alcance) && Number(alcance) > 0 ? Number(alcance) : null;
  if (r.regla === 'suscripcion_detectada' && n !== null) return [[cb('✅ Sí, es mía', { accion: 'sc', rec: n }), cb('🗑 No', { accion: 'sd', rec: n })]];
  if (r.regla === 'espera_lista' && n !== null) {
    return [[cb('🛍 Lo compré', { accion: 'ec', item: n }), cb('🙅 Ya no', { accion: 'ed', item: n }), cb('⏳ 48 h más', { accion: 'e48', item: n })]];
  }
  if (r.regla === 'posible_duplicado') {
    const [a, b] = alcance.split('-').map(Number);
    if (a && b) return [[cb('Es duplicado', { accion: 'dup', mov: b }), cb('Son dos', { accion: 'ndp', a, b })]];
  }
  return [];
}

export function formatearRecomendacion(r: Recomendacion): RespuestaBot {
  const botones = botonesRecomendacion(r);
  return { texto: [`${emojiSev(r)} <b>${esc(r.titulo)}</b>`, esc(r.detalle_con_cifras)].join('\n'), ...(botones.length ? { botones } : {}) };
}

function recomendaciones(ctx: ContextoBot): Recomendacion[] {
  const { inst, m } = vista(ctx);
  return evaluarReglas(inst, m);
}

/** Una recomendación en una línea (la más importante), o ''. */
function lineaRecomendacion(recs: Recomendacion[]): string {
  const r = recs[0];
  return r ? `💡 ${esc(recortar(r.detalle_con_cifras, 110))}` : '';
}

// ---------------------------------------------------------------------------
// Hoy / Mes
// ---------------------------------------------------------------------------

export function pantallaHoy(ctx: ContextoBot): RespuestaBot {
  const { inst, m } = vista(ctx);
  const l: string[] = [`${SEM[m.semaforo]} <b>Hoy</b> · ${formatearFechaCorta(m.fecha)}`];
  if (m.libre_hoy === null) l.push(esc(m.base.aviso_modo ?? 'Aún no tengo con qué calcular.'));
  else {
    l.push(m.libre_hoy >= 0 ? `Te quedan <b>${$(m.libre_hoy)}</b> de ${$(m.limite_hoy ?? 0)}` : `Te pasaste <b>${$(-m.libre_hoy)}</b> del límite de ${$(m.limite_hoy ?? 0)}`);
  }
  l.push(`Gastado hoy: <b>${$(m.gastado_hoy)}</b>`);
  if (m.libre_hoy !== null) {
    l.push(`Mes ${emojiMes(m)}: cierras en <b>${$(m.proyeccion_fin_mes)}</b>${m.proyeccion_ratio !== null ? ` (${formatearPct(m.proyeccion_ratio)} de lo disponible)` : ''}`);
  }
  const rec = lineaRecomendacion(evaluarReglas(inst, m));
  if (rec) l.push(rec);
  return {
    texto: l.join('\n'),
    botones: [[irA('📋 Ver movimientos', 'mov'), irA('💡 ¿Qué me recomiendas?', 'rec')], [irA('📅 Mes', 'mes')]],
  };
}

export function pantallaMes(ctx: ContextoBot): RespuestaBot {
  const { inst, m, cats } = vista(ctx);
  const mes = m.mes;
  const { desde, hasta } = rangoMes(mes);
  const r = resumenDe(ctx.datos, inst, desde, hasta);
  const l: string[] = [`🗓 <b>${mes}</b>`, `Día a día: <b>${$(r.gastado_variable)}</b> · Fijos: ${$(r.gastado_fijos)}`];
  if (r.ingresos > 0) l.push(`Te entraron ${$(r.ingresos)}`);
  l.push(m.libre_hoy === null ? esc(m.base.aviso_modo ?? 'Aún no tengo con qué calcular.')
    : `${SEM[m.semaforo]} Cierras en <b>${$(m.proyeccion_fin_mes)}</b>${m.proyeccion_ratio !== null ? ` (${formatearPct(m.proyeccion_ratio)} de lo disponible)` : ''}`);
  const top = r.por_categoria[0];
  if (top) l.push(`Lo que más pesa: ${emojiCat(cats, top.categoria_id)} ${esc(nombreCat(cats, top.categoria_id))} ${$(top.total)}`);
  const pasadas = m.por_categoria.filter((c) => c.estado === 'pasado');
  if (pasadas.length) l.push(`⚠️ Te pasaste en ${pasadas.slice(0, 3).map((c) => esc(nombreCat(cats, c.categoria_id))).join(', ')}`);
  const rec = lineaRecomendacion(evaluarReglas(inst, m));
  if (rec) l.push(rec);
  return {
    texto: l.join('\n'),
    botones: [[irA('📋 Ver movimientos', 'ult'), irA('💡 ¿Qué me recomiendas?', 'rec')], [irA('💰 Hoy', 'hoy')]],
  };
}

export function pantallaRecomendaciones(ctx: ContextoBot): RespuestaBot {
  const recs = recomendaciones(ctx).slice(0, 3);
  if (!recs.length) return { texto: '💡 Por ahora no tengo nada que decirte. Vas bien.', botones: [[irA('💰 Hoy', 'hoy')]] };
  const l = ['💡 <b>Lo que yo haría</b>'];
  for (const r of recs) l.push(`${emojiSev(r)} <b>${esc(r.titulo)}</b>\n${esc(recortar(r.detalle_con_cifras, 140))}`);
  const botones = botonesRecomendacion(recs[0]);
  botones.push([irA('💰 Hoy', 'hoy')]);
  return { texto: l.join('\n'), botones };
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

const textoBotonMov = (x: Movimiento, cats: Categoria[]) =>
  `${emojiCat(cats, x.categoria_id)} ${x.sentido === 'entrada' ? '+' : ''}${$(x.monto)} · ${recortar(x.comercio, 22)}`;

function listaMovimientos(titulo: string, movs: Movimiento[], cats: Categoria[], volver: Boton): RespuestaBot {
  if (!movs.length) return { texto: 'Aún no tengo movimientos.', botones: [[volver]] };
  return {
    texto: `${titulo}\nToca uno para corregirlo.`,
    botones: [...movs.map((x) => [cb(textoBotonMov(x, cats), { accion: 'mv', mov: x.id })]), [volver]],
  };
}

export function pantallaUltimos(ctx: ContextoBot): RespuestaBot {
  return listaMovimientos('📋 <b>Últimos movimientos</b>', ctx.datos.ultimosMovimientos(CANT_ULTIMOS), ctx.datos.listarCategorias(), irA('↩ Más', 'mas'));
}

/** Movimientos de hoy; si no hay, los últimos. */
export function pantallaMovimientosHoy(ctx: ContextoBot): RespuestaBot {
  const hoy = aBogota(ctx.ahora).fecha;
  const cats = ctx.datos.listarCategorias();
  const deHoy = ctx.datos.ultimosMovimientos(30).filter((x) => x.fecha === hoy).slice(0, CANT_ULTIMOS + 1);
  if (deHoy.length) return listaMovimientos('📋 <b>Movimientos de hoy</b>', deHoy, cats, irA('↩ Hoy', 'hoy'));
  return listaMovimientos('📋 <b>Últimos movimientos</b>', ctx.datos.ultimosMovimientos(CANT_ULTIMOS), cats, irA('↩ Hoy', 'hoy'));
}

export function pantallaMovimiento(ctx: ContextoBot, mov: Movimiento): RespuestaBot {
  const cats = ctx.datos.listarCategorias();
  const l = [
    `${emojiCat(cats, mov.categoria_id)} <b>${$(mov.monto)}</b> · ${esc(mov.comercio)}`,
    esc([nombreCat(cats, mov.categoria_id), mov.medio ? MEDIOS[mov.medio] : null, `${formatearFechaCorta(mov.fecha)}${mov.hora ? ' ' + mov.hora : ''}`].filter(Boolean).join(' · ')),
  ];
  const botones: Boton[][] = [];
  const fila: Boton[] = [cb('🏷 Categoría', { accion: 'cat', mov: mov.id })];
  if (mov.sentido === 'salida') {
    l.push(mov.computa ? 'Cuenta como gasto del mes.' : 'No cuenta como gasto del mes.');
    fila.push(cb(mov.computa ? '💸 No cuenta como gasto' : '💸 Cuenta como gasto', { accion: 'cn', mov: mov.id }));
  }
  botones.push(fila);
  const accion = ctx.datos.ultimaAccionDe(mov.id);
  botones.push([accion !== null ? cb('↩ Deshacer', { accion: 'und', accion_id: accion }) : cb('🗑 Borrar', { accion: 'ign', mov: mov.id }), irA('← Últimos', 'ult')]);
  return { texto: l.join('\n'), botones };
}

// ---------------------------------------------------------------------------
// Más
// ---------------------------------------------------------------------------

export function pantallaMas(): RespuestaBot {
  return {
    texto: '⚙️ <b>Más</b>\n¿Qué necesitas?',
    botones: [
      [irA('🎯 Metas', 'metas'), irA('📋 Últimos', 'ult')],
      [irA('🔁 Suscripciones', 'subs'), irA('💵 Mi ingreso', 'ing')],
      [irA('📊 Presupuesto', 'pres'), irA('🌐 Panel', 'panel')],
      [irA('⏸ Pausar avisos', 'pausa'), irA('❓ Ayuda', 'ayuda')],
    ],
  };
}

/** Telegram rechaza botones con enlaces a localhost o a una IP: solo se ofrece «Abrir panel» con una URL de nombre público (p. ej. Tailscale). */
export function botonAbrirPanel(urlPanel: string): Boton | null {
  try {
    const u = new URL(urlPanel);
    const h = u.hostname;
    if (!/^https?:$/.test(u.protocol) || h === 'localhost' || h.endsWith('.local') || /^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.')) return null;
    return { texto: '🌐 Abrir panel', url: u.toString() };
  } catch { return null; }
}

export function pantallaPanel(ctx: ContextoBot): RespuestaBot {
  const abrir = botonAbrirPanel(ctx.urlPanel);
  return {
    texto: `🌐 <b>Panel</b>\n${esc(ctx.urlPanel)}\n${abrir ? 'Ábrelo desde tus dispositivos.' : 'Solo abre en tu PC.'}`,
    botones: [...(abrir ? [[abrir]] : []), [irA('↩ Más', 'mas')]],
  };
}

// ---------------------------------------------------------------------------
// Mis cuentas y deudas
// ---------------------------------------------------------------------------

const cuandoVence = (dias: number) => (dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`);
/** Hasta 3 filas: si hay más, muestra 2 y «… y N más» (el mensaje no pasa de 12 líneas). */
const recorta = <T,>(xs: T[]): { ver: T[]; mas: number } => (xs.length > 3 ? { ver: xs.slice(0, 2), mas: xs.length - 2 } : { ver: xs, mas: 0 });

export function pantallaCuentas(ctx: ContextoBot): RespuestaBot {
  const { inst, m } = vista(ctx);
  const s = m.saldos;
  const abrir = botonAbrirPanel(ctx.urlPanel);
  const botones: Boton[][] = [...(abrir ? [[abrir]] : []), [irA('↩ Más', 'mas')]];
  if (!inst.cuentas.length && !inst.deudas.length) {
    return {
      texto: '🏦 <b>Mis cuentas</b>\nAún no tienes cuentas ni deudas anotadas. Escríbeme «tengo 1,2 millones en Bancolombia» o «debo 3 millones en la tarjeta, mínimo 150k, pago el 15».',
      botones,
    };
  }
  const l: string[] = [];
  if (inst.cuentas.length) {
    const c = recorta(inst.cuentas);
    l.push('🏦 <b>Mis cuentas</b>', ...c.ver.map((x) => `• ${esc(x.nombre)} · ${$(x.saldo)}`));
    if (c.mas) l.push(`… y ${c.mas} más`);
    l.push(`Saldo total: <b>${$(s.saldo_total)}</b>`);
  }
  if (inst.deudas.length) {
    const d = recorta(inst.deudas);
    l.push('💳 <b>Mis deudas</b>', ...d.ver.map((x) => `• ${esc(x.nombre)} · ${$(x.saldo)} · mín. ${$(x.pago_minimo)}${x.dia_pago ? ` · día ${x.dia_pago}` : ''}`));
    if (d.mas) l.push(`… y ${d.mas} más`);
    l.push(`Deuda total: <b>${$(s.deuda_total)}</b> · mínimos del mes: ${$(s.minimos_mes)}`);
    const v = s.proximo_vencimiento;
    if (v) l.push(`Próximo pago: ${esc(v.nombre)} ${cuandoVence(v.dias)} (${formatearFechaCorta(v.fecha)}) · ${$(v.pago_minimo)}`);
  }
  return { texto: l.join('\n'), botones };
}

export function pantallaPausa(ctx: ContextoBot): RespuestaBot {
  const hasta = ctx.datos.leerConfig().pausa_hasta;
  const activa = hasta !== null && new Date(hasta).getTime() > ctx.ahora.getTime();
  const b = activa ? aBogota(new Date(hasta as string)) : null;
  const l = ['⏸ <b>Pausar avisos</b>', 'Silencio las alertas y los reportes. Los avisos de cada movimiento siguen llegando.'];
  if (b) l.push(`Ahora están en pausa hasta el ${formatearFechaCorta(b.fecha)} ${b.hora}.`);
  return {
    texto: l.join('\n'),
    botones: [
      [cb('24 horas', { accion: 'pz', horas: 24 }), cb('2 días', { accion: 'pz', horas: 48 }), cb('1 semana', { accion: 'pz', horas: 168 })],
      [irA('🔔 Reactivar', 'pzoff'), irA('↩ Más', 'mas')],
    ],
  };
}

export function pantallaSuscripciones(ctx: ContextoBot, conVolver: boolean): RespuestaBot {
  const inst = ctx.datos.instantanea(ctx.ahora);
  const recs = inst.recurrentes.filter((r) => r.activa && r.estado !== 'descartada');
  const volver: Boton[][] = conVolver ? [[irA('↩ Más', 'mas')]] : [];
  if (!recs.length) return { texto: 'No he detectado cobros que se repitan todavía.', ...(volver.length ? { botones: volver } : {}) };
  const l = ['<b>Cobros que se repiten</b>'];
  for (const r of recs.slice(0, 6)) {
    l.push(`${r.estado === 'detectada' ? '❓' : '•'} ${esc(r.nombre)} · ${$(r.monto_tipico)} ${r.periodo}${r.proximo_cobro ? ` · próximo ${formatearFechaCorta(r.proximo_cobro)}` : ''}`);
  }
  if (recs.length > 6) l.push(`… y ${recs.length - 6} más`);
  l.push(`Total: <b>${$(recs.reduce((s, r) => s + r.costo_mensual, 0))}</b> al mes (${$(recs.reduce((s, r) => s + r.costo_anual, 0))} al año)`);
  const botones: Boton[][] = recs.filter((r) => r.estado === 'detectada').slice(0, 3).map((r): Boton[] => [
    cb(`✅ ${recortar(r.nombre, 20)}`, { accion: 'sc', rec: r.id }), cb('🗑 No', { accion: 'sd', rec: r.id }),
  ]);
  botones.push(...volver);
  return { texto: l.join('\n'), ...(botones.length ? { botones } : {}) };
}

// ---------------------------------------------------------------------------
// Ingreso y ahorro
// ---------------------------------------------------------------------------

const AHORROS = [5, 10, 15, 20] as const;

export function pantallaIngreso(ctx: ContextoBot): RespuestaBot {
  const { m } = vista(ctx);
  const c = ctx.datos.leerConfig();
  const l = ['💵 <b>Mi ingreso</b>'];
  const botones: Boton[][] = [];
  if (c.ingreso_mensual) l.push(`Ingreso al mes: <b>${$(c.ingreso_mensual)}</b>`);
  else if (baseEsEstimada(m.base) && m.base.modo === 'ingreso_estimado' && m.base.ingreso) {
    l.push(`Aún no me lo has dicho. Por lo que te ha entrado, calculo <b>${$(Math.round(m.base.ingreso))}</b> al mes.`);
    botones.push([cb(`✔ Usar mi promedio ${$(Math.round(m.base.ingreso))}`, { accion: 'iu' })]);
  } else l.push('Aún no me lo has dicho. Con eso calculo cuánto puedes gastar.');
  l.push(`Ahorro: ${c.pct_ahorro} % de tu ingreso. ¿Cuánto quieres ahorrar?`);
  botones.push([irA('✏️ Cambiar', 'ingk')]);
  botones.push(AHORROS.map((p) => cb(`${c.pct_ahorro === p ? '✔ ' : ''}${p} %`, { accion: 'ah', pct: p })));
  botones.push([irA('↩ Más', 'mas')]);
  return { texto: l.join('\n'), botones };
}

// ---------------------------------------------------------------------------
// Presupuesto
// ---------------------------------------------------------------------------

/** Presupuesto vigente de una categoría ('*' = total) y el mes en que está guardado. */
export function presupuestoVigente(ctx: ContextoBot, catId: string): { monto: number; mes: string } | null {
  const mesActual = aBogota(ctx.ahora).fecha.slice(0, 7);
  const pres = ctx.datos.instantanea(ctx.ahora).presupuestos;
  const p = pres.find((x) => x.categoria_id === catId && x.mes === mesActual) ?? pres.find((x) => x.categoria_id === catId && x.mes === '*');
  return p ? { monto: p.monto, mes: p.mes } : null;
}

export function pantallaPresupuestos(ctx: ContextoBot): RespuestaBot {
  const cats = ctx.datos.listarCategorias();
  const total = presupuestoVigente(ctx, '*');
  const l = ['📊 <b>Presupuesto</b>', total ? `Tope total día a día: <b>${$(total.monto)}</b>` : 'Aún no tienes un tope total.', 'Toca una categoría para ponerle tope.'];
  const botones: Boton[][] = [[cb(`🎯 Total${total ? ' · ' + formatearCOPCorto(total.monto) : ''}`, { accion: 'bd', cat: 'total' })]];
  const cs = categoriasGasto(cats).map((c) => {
    const p = presupuestoVigente(ctx, c.id);
    return cb(`${c.emoji} ${c.nombre}${p ? ' · ' + formatearCOPCorto(p.monto) : ''}`, { accion: 'bd', cat: c.id });
  });
  botones.push(...enFilas(cs, 2), [irA('↩ Más', 'mas')]);
  return { texto: l.join('\n'), botones };
}

export function pantallaPresupuestoCat(ctx: ContextoBot, catParam: string): RespuestaBot | null {
  const { m, cats } = vista(ctx);
  const esTotal = catParam === 'total';
  const cat = esTotal ? null : catDe(cats, catParam);
  if (!esTotal && (!cat || !cat.es_gasto)) return null;
  const p = presupuestoVigente(ctx, esTotal ? '*' : catParam);
  const nombre = esTotal ? '🎯 <b>Total día a día</b>' : `${cat!.emoji} <b>${esc(cat!.nombre)}</b>`;
  const l = [nombre, p ? `Tope al mes: <b>${$(p.monto)}</b>` : 'Sin tope por ahora.'];
  const gastado = esTotal ? m.gastado_mes : m.por_categoria.find((c) => c.categoria_id === catParam)?.gastado ?? 0;
  l.push(`Llevas ${$(gastado)} este mes.`);
  const botones: Boton[][] = [
    [cb('− $50.000', { accion: 'bm', cat: catParam }), cb('+ $50.000', { accion: 'bp', cat: catParam })],
    [cb('✏️ Otro valor', { accion: 'be', cat: catParam }), ...(p ? [cb('🗑 Quitar', { accion: 'bq', cat: catParam })] : [])],
    [irA('↩ Presupuesto', 'pres')],
  ];
  return { texto: l.join('\n'), botones };
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

export function pantallaMetas(ctx: ContextoBot): RespuestaBot {
  const metas = ctx.datos.instantanea(ctx.ahora).metas;
  const l = ['🎯 <b>Metas</b>'];
  if (!metas.length) l.push('Aún no tienes metas. Crea la primera y le vas sumando.');
  for (const x of metas.slice(0, 6)) {
    l.push(`${esc(x.emoji)} ${esc(x.nombre)}: ${$(x.aportado)} de ${$(x.objetivo)} (${formatearPct(x.aportado / x.objetivo)})${x.estado === 'pausada' ? ' ⏸' : ''}`);
  }
  const botones: Boton[][] = metas.slice(0, 6).map((x) => [cb(`${x.emoji} ${recortar(x.nombre, 24)}`, { accion: 'me', meta: x.id })]);
  botones.push([irA('➕ Nueva meta', 'nmeta'), irA('↩ Más', 'mas')]);
  return { texto: l.join('\n'), botones };
}

export function pantallaMeta(ctx: ContextoBot, id: number, nota?: string): RespuestaBot | null {
  const x = ctx.datos.instantanea(ctx.ahora).metas.find((y) => y.id === id);
  if (!x) return null;
  const l = [`${esc(x.emoji)} <b>${esc(x.nombre)}</b>`, `${$(x.aportado)} de ${$(x.objetivo)} (${formatearPct(x.aportado / x.objetivo)})${x.estado === 'pausada' ? ' ⏸ en pausa' : ''}`];
  if (x.fecha_objetivo) l.push(`Para el ${formatearFechaCorta(x.fecha_objetivo)} ${x.fecha_objetivo.slice(0, 4)}`);
  if (nota) l.push(nota);
  return {
    texto: l.join('\n'),
    botones: [
      [cb('➕ Aportar', { accion: 'ma', meta: x.id }), cb('➖ Sacar', { accion: 'ms', meta: x.id })],
      [cb(x.estado === 'pausada' ? '▶️ Reanudar' : '⏸ Pausar', { accion: 'mp', meta: x.id }), irA('↩ Metas', 'metas')],
    ],
  };
}

// ---------------------------------------------------------------------------
// Pendientes
// ---------------------------------------------------------------------------

/** Pendientes ordenados del más nuevo al más viejo (por id). */
export function colaPendientes(ctx: ContextoBot): Movimiento[] {
  return pendientesDe(ctx.datos.instantanea(ctx.ahora)).sort((a, b) => b.id - a.id);
}

/** Tarjeta de un pendiente: el primero, o el siguiente al de `despuesDe` (id menor). `deshacer` ofrece revertir lo anterior. */
export function pantallaPendiente(ctx: ContextoBot, despuesDe?: number, deshacer?: { accion_id: number; mov: number }): RespuestaBot {
  const cats = ctx.datos.listarCategorias();
  const cola = colaPendientes(ctx);
  const undo: Boton[][] = deshacer ? [[cb('↩ Deshacer el anterior', { accion: 'pu', accion_id: deshacer.accion_id, mov: deshacer.mov })]] : [];
  if (!cola.length) return { texto: '🎉 <b>Todo al día.</b> No te queda nada por clasificar.', ...(undo.length ? { botones: undo } : {}) };
  const actual = despuesDe === undefined ? cola[0] : cola.find((x) => x.id < despuesDe);
  if (!actual) {
    return {
      texto: `Llegaste al final. Te quedan ${cola.length} que saltaste.`,
      botones: [[irA('🔄 Empezar de nuevo', 'pend')], ...undo],
    };
  }
  const quedan = cola.length - 1;
  const l = [
    `🧾 <b>Pendiente</b> · ${quedan > 0 ? `quedan ${quedan} más` : 'es el último'}`,
    `📦 <b>${$(actual.monto)}</b> · ${esc(actual.comercio)}`,
    esc([formatearFechaCorta(actual.fecha) + (actual.hora ? ' ' + actual.hora : ''), actual.medio ? MEDIOS[actual.medio] : null].filter(Boolean).join(' · ')),
    '¿En qué se fue?',
  ];
  const botones = enFilas(categoriasGasto(cats).map((c) => cb(`${c.emoji} ${c.nombre}`, { accion: 'pc', mov: actual.id, cat: c.id })), 3);
  botones.push([cb('⏭ Saltar', { accion: 'ps', mov: actual.id }), cb('🙈 Ignorar', { accion: 'pi', mov: actual.id })]);
  botones.push(...undo);
  return { texto: l.join('\n'), botones };
}

