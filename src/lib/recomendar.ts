// Motor de recomendaciones (SPEC §4). Puro: el reloj llega por `inst.ahora` / `ahora`.
import {
  aBogota, diasEntre, formatearCOP, formatearFechaCorta, formatearPct, normalizarComercio, recortar, sumarDias,
} from './formato';
import {
  colchonDias, compararPlanes, cuotaParaMeses, mesesLegible, minimosPendientesMes, simularSoloMinimo, tasaLegible, vencimientos,
} from './deudas';
import { baseEsEstimada, categoriaPorReglas, esNocturna, esperadoMeta } from './metricas';
import { costoAnual, subioDePrecio } from './suscripciones';
import type {
  Anomalia, ConfigPlata, ConsultaPuedo, EmisionPrevia, Instantanea, ISODate, MetaConAportes, Metricas, Movimiento,
  Recomendacion, ReglaId, Severidad, Veredicto,
} from './tipos';

// ---------------------------------------------------------------------------
// Catálogo cerrado (SPEC §4.1)
// ---------------------------------------------------------------------------

export interface DefRegla {
  id: ReglaId; codigo: string; severidad: Severidad; prioridad: number;
  push: boolean;                        // false = no sale sola (va dentro del aviso o del reporte)
  cooldown_h: number;                   // Infinity = una sola vez por clave
  reemite_si_cambia: number | null;     // fracción de cambio de valor_ref que fuerza reenvío
}

const INF = Number.POSITIVE_INFINITY;
const d = (id: ReglaId, codigo: string, severidad: Severidad, prioridad: number, push: boolean, cooldown_h: number, reemite_si_cambia: number | null): DefRegla =>
  ({ id, codigo, severidad, prioridad, push, cooldown_h, reemite_si_cambia });

export const REGLAS: ReadonlyArray<DefRegla> = [
  d('pin_bloqueado', 'R24', 'alerta', 1, true, 24, null),
  d('fijos_superan_ingreso', 'R25', 'alerta', 5, true, 168, null),
  d('vencimiento_deuda', 'R27', 'aviso', 8, true, 24, null),
  d('minimos_vs_ingreso', 'R26', 'aviso', 14, true, 168, 0.10),
  d('colchon_bajo', 'R30', 'aviso', 16, true, 168, null),
  d('solo_minimo', 'R29', 'aviso', 18, true, 720, null),
  d('plan_deudas', 'R28', 'info', 62, false, 720, null),
  d('riesgo_fin_de_mes', 'R04', 'alerta', 10, true, 24, 0.10),
  d('sin_avisos', 'R21', 'aviso', 12, true, 24, null),
  d('categoria_sobre_presupuesto', 'R05', 'alerta', 15, true, 720, null),
  d('posible_duplicado', 'R10', 'alerta', 20, false, INF, null),
  d('monto_inusual', 'R11', 'aviso', 22, false, INF, null),
  d('limite_dia_superado', 'R02', 'aviso', 25, true, 24, null),
  d('categoria_cerca_presupuesto', 'R06', 'aviso', 30, true, 720, null),
  d('ritmo_mayor_mes_pasado', 'R07', 'aviso', 35, true, 168, 0.15),
  d('meta_atrasada', 'R16', 'aviso', 40, true, 168, null),
  d('gasto_hormiga', 'R08', 'aviso', 45, true, 168, null),
  d('compras_nocturnas', 'R09', 'aviso', 50, true, 168, null),
  d('espera_lista', 'R23', 'info', 52, true, INF, null),
  d('suscripcion_subio', 'R14', 'aviso', 55, true, INF, null),
  d('suscripcion_manana', 'R13', 'info', 58, false, INF, null),
  d('gasto_alto', 'R12', 'info', 60, false, INF, null),
  d('suscripcion_detectada', 'R15', 'info', 65, true, INF, null),
  d('por_revisar_pendientes', 'R20', 'aviso', 70, true, 24, null),
  d('ingreso_recibido', 'R22', 'info', 75, false, INF, null),
  d('buen_ritmo', 'R19', 'info', 80, true, 168, null),
  d('meta_cumplida', 'R17', 'info', 82, true, INF, null),
  d('racha_hito', 'R18', 'info', 85, true, INF, null),
  d('limite_dia_cerca', 'R03', 'info', 90, false, 24, null),
  d('sin_ingreso_configurado', 'R01', 'info', 95, true, 168, null),
];

const DEF = new Map(REGLAS.map((r) => [r.id, r]));
const RANGO_SEV: Record<Severidad, number> = { info: 1, aviso: 2, alerta: 3 };

export function ordenarRecomendaciones(recs: Recomendacion[]): Recomendacion[] {
  return [...recs].sort((a, b) =>
    RANGO_SEV[b.severidad] - RANGO_SEV[a.severidad] || a.prioridad - b.prioridad || b.valor_ref - a.valor_ref);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const $ = formatearCOP;

/** 'AAAA-Www' (semana ISO). */
export function semanaISO(fecha: ISODate): string {
  const [y, m, dd] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = Date.UTC(t.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((t.getTime() - inicio) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/** '22:00' → '10 p. m.'; '05:30' → '5:30 a. m.'. */
export function horaLegible(hm: string): string {
  const [h, mi] = hm.split(':').map(Number);
  const suf = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mi === 0 ? `${h12} ${suf}` : `${h12}:${String(mi).padStart(2, '0')} ${suf}`;
}

const CADA: Record<string, string> = { semanal: 'semana', quincenal: 'quincena', mensual: 'mes', bimestral: '2 meses', trimestral: '3 meses', semestral: '6 meses', anual: 'año' };
const nombreCat = (inst: Instantanea, id: string) => inst.categorias.find((c) => c.id === id)?.nombre ?? id;
const decimalCo = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

function rec(
  regla: ReglaId, alcance: string,
  p: { titulo: string; detalle: string; cifras: Record<string, number>; valor_ref: number; severidad?: Severidad; accion?: Recomendacion['accion'] },
): Recomendacion {
  const def = DEF.get(regla)!;
  return {
    id: `${regla}:${alcance}`, regla, severidad: p.severidad ?? def.severidad, prioridad: def.prioridad,
    titulo: recortar(p.titulo, 60), detalle_con_cifras: p.detalle, cifras: p.cifras,
    ...(p.accion ? { accion: p.accion } : {}), push: def.push, valor_ref: p.valor_ref,
  };
}

const esGastoDeHoy = (mov: Movimiento, hoy: ISODate) => mov.fecha === hoy && mov.sentido === 'salida' && mov.computa;

// ---------------------------------------------------------------------------
// Reglas de un movimiento (R10, R11, R12, R22)
// ---------------------------------------------------------------------------

function reglaDuplicado(a: Anomalia, movs: Movimiento[]): Recomendacion {
  const comercio = movs.find((x) => x.id === a.movimiento_id)?.comercio ?? 'ese comercio';
  const otro = a.otro_id ?? a.movimiento_id;
  const [x, y] = [Math.min(a.movimiento_id, otro), Math.max(a.movimiento_id, otro)];
  return rec('posible_duplicado', `${x}-${y}`, {
    titulo: '¿Cobro duplicado?',
    detalle: `${comercio}: dos cobros de ${$(a.cifras.monto)} con ${a.cifras.minutos} min de diferencia.`,
    cifras: { ...a.cifras, mov_a: x, mov_b: y }, valor_ref: a.cifras.monto,
    accion: { texto: 'Revisar', callback_data: `dup:${y}` },
  });
}

function reglaInusual(a: Anomalia, movs: Movimiento[]): Recomendacion {
  const comercio = movs.find((x) => x.id === a.movimiento_id)?.comercio ?? 'ese comercio';
  return rec('monto_inusual', String(a.movimiento_id), {
    titulo: `Monto raro en ${comercio}`,
    detalle: `Pagaste ${$(a.cifras.monto)}; normalmente pagas ${$(a.cifras.mediana)} ahí (${decimalCo(a.cifras.veces)} veces más).`,
    cifras: a.cifras, valor_ref: a.cifras.monto,
  });
}

function reglaGastoAlto(inst: Instantanea, m: Metricas, mov: Movimiento): Recomendacion | null {
  if (!esGastoDeHoy(mov, m.fecha) || mov.origen === 'historial' || mov.monto < inst.config.umbral_gasto_alto) return null;
  const antes = m.restante_mes === null ? null : m.restante_mes + mov.monto;
  const detalle = antes !== null && antes > 0
    ? `${$(mov.monto)} en ${mov.comercio}: es el ${formatearPct(mov.monto / antes)} de lo que te queda del mes.`
    : antes !== null ? `${$(mov.monto)} en ${mov.comercio}: ya no te queda margen este mes.` : `${$(mov.monto)} en ${mov.comercio}.`;
  return rec('gasto_alto', String(mov.id), {
    titulo: 'Gasto alto', detalle, cifras: { monto: mov.monto, ...(antes !== null ? { restante_antes: antes } : {}) }, valor_ref: mov.monto,
  });
}

function reglaIngreso(inst: Instantanea, m: Metricas, mov: Movimiento): Recomendacion | null {
  if (mov.tipo !== 'ingreso' || !mov.computa || mov.fecha !== m.fecha || mov.origen === 'historial' || mov.monto < 100_000) return null;
  const ahorro = Math.round((mov.monto * inst.config.pct_ahorro) / 100);
  const sospechoso = !mov.verificado && mov.monto >= 1_000_000;
  const detalle = sospechoso
    ? `Te entraron ${$(mov.monto)}, pero no pude verificar el remitente. Revísalo antes de contar con esa plata.`
    : `Te entraron ${$(mov.monto)}. Si separas ya tu ahorro (${$(ahorro)}, el ${inst.config.pct_ahorro}%), queda hecho.`;
  return rec('ingreso_recibido', String(mov.id), {
    titulo: 'Te entró plata', detalle, cifras: { monto: mov.monto, ahorro, pct_ahorro: inst.config.pct_ahorro }, valor_ref: mov.monto,
  });
}

/** Líneas extra para el mensaje de un aviso nuevo. */
export function reglasDeMovimiento(inst: Instantanea, m: Metricas, mov: Movimiento, anomalias: Anomalia[]): Recomendacion[] {
  const res: Recomendacion[] = [];
  const movs = inst.movimientos.some((x) => x.id === mov.id) ? inst.movimientos : [...inst.movimientos, mov];
  for (const a of anomalias) {
    if (a.tipo === 'posible_duplicado' && (a.movimiento_id === mov.id || a.otro_id === mov.id)) res.push(reglaDuplicado(a, movs));
    else if (a.tipo === 'monto_inusual' && a.movimiento_id === mov.id) res.push(reglaInusual(a, movs));
  }
  const alto = reglaGastoAlto(inst, m, mov);
  if (alto) res.push(alto);
  const ing = reglaIngreso(inst, m, mov);
  if (ing) res.push(ing);
  return ordenarRecomendaciones(res);
}

// ---------------------------------------------------------------------------
// Evaluación global
// ---------------------------------------------------------------------------

function aportes90(meta: MetaConAportes, hoy: ISODate): number {
  const desde = sumarDias(hoy, -90);
  return meta.aportes.filter((a) => a.fecha >= desde && a.fecha <= hoy).reduce((s, a) => s + a.monto, 0);
}

function metaPrincipal(inst: Instantanea): MetaConAportes | null {
  const activas = inst.metas.filter((x) => x.estado === 'activa').sort((a, b) => a.prioridad - b.prioridad || a.id - b.id);
  return activas[0] ?? null;
}

/** R07 vigente (también lo usa el veredicto). */
function ritmoMayorQueMesPasado(m: Metricas): { G: number; Gp: number } | null {
  const mp = m.mes_pasado;
  if (!mp || mp.gastado_a_la_fecha <= 0 || m.dia < 5) return null;
  const G = m.gastado_mes;
  const Gp = mp.gastado_a_la_fecha;
  return G > 1.2 * Gp && G - Gp >= 100_000 ? { G, Gp } : null;
}

/** Con una base estimada no se alarma: la severidad máxima baja un nivel, salvo lo que no depende de la estimación. */
const SIN_DEGRADAR: ReadonlySet<ReglaId> = new Set<ReglaId>(['pin_bloqueado', 'posible_duplicado', 'vencimiento_deuda', 'solo_minimo']);
function degradarSiEstimada(recs: Recomendacion[], m: Metricas): Recomendacion[] {
  if (!baseEsEstimada(m.base)) return recs;
  return recs.map((r) => (r.severidad === 'alerta' && !SIN_DEGRADAR.has(r.regla) ? { ...r, severidad: 'aviso' as const } : r));
}

export function evaluarReglas(inst: Instantanea, m: Metricas): Recomendacion[] {
  const res: Recomendacion[] = [];
  const cfg = inst.config;
  const ahora = inst.ahora;
  const hoy = m.fecha;
  const V = m.base.disponible_variable;
  const dr = m.dias_restantes;
  const P = m.comprometido_pendiente;

  // R24 pin_bloqueado: solo el bloqueo largo (los de minutos no ameritan alerta).
  {
    const h = inst.sistema.pin_bloqueado_hasta;
    if (h) {
      const falta = new Date(h).getTime() - ahora.getTime();
      if (falta > 3_600_000) {
        const b = aBogota(new Date(h));
        res.push(rec('pin_bloqueado', hoy, {
          titulo: 'Alguien intentó entrar al panel',
          detalle: `Hubo 20 intentos de PIN fallidos; bloqueé el panel hasta ${formatearFechaCorta(b.fecha)} ${b.hora}. Si no fuiste tú, revisa tu PC.`,
          cifras: { n: 20 }, valor_ref: 1,
        }));
      }
    }
  }

  // R25 fijos_superan_ingreso
  if (V !== null && V <= 0 && m.base.ingreso !== null && m.base.modo !== 'gasto_historico') {
    const FA = m.base.fijos + m.base.ahorro;
    res.push(rec('fijos_superan_ingreso', m.mes, {
      titulo: 'Tus fijos se comen el ingreso',
      detalle: `Fijos ${$(m.base.fijos)} + ahorro ${$(m.base.ahorro)} = ${$(FA)}, y tu ingreso es ${$(m.base.ingreso)}. No queda nada para el día a día.`,
      cifras: { fijos: m.base.fijos, ahorro: m.base.ahorro, fijos_ahorro: FA, ingreso: m.base.ingreso }, valor_ref: FA - m.base.ingreso,
    }));
  }

  // R04 riesgo_fin_de_mes
  if (m.proyeccion_ratio !== null && V !== null && m.proyeccion_ratio > cfg.semaforo.mes_rojo && m.dia >= 5) {
    const exceso = m.proyeccion_fin_mes - V;
    const objetivo = Math.max(0, Math.floor((m.restante_mes ?? 0) / dr));
    res.push(rec('riesgo_fin_de_mes', m.mes, {
      titulo: 'No llegas a fin de mes a este ritmo',
      detalle: `Gastas ${$(m.ritmo_diario)}/día; así cierras el mes en ${$(m.proyeccion_fin_mes)}, ${$(exceso)} más de lo que tienes (${$(V)}). Para llegar, baja a ${$(objetivo)}/día los próximos ${dr} días.`,
      cifras: { ritmo: m.ritmo_diario, proyeccion: m.proyeccion_fin_mes, exceso, disponible: V, ritmo_objetivo: objetivo, dias: dr },
      valor_ref: m.proyeccion_ratio,
    }));
  }

  // R21 sin_avisos
  if (inst.sistema.ultimo_aviso_en && inst.sistema.avisos_promedio_diario_90d >= 1) {
    const horas = (ahora.getTime() - new Date(inst.sistema.ultimo_aviso_en).getTime()) / 3_600_000;
    if (horas > 72) {
      const h = Math.floor(horas);
      const prom = inst.sistema.avisos_promedio_diario_90d;
      res.push(rec('sin_avisos', hoy, {
        titulo: `Hace ${h} horas no llega ningún aviso`,
        detalle: `Normalmente te llegan ${decimalCo(prom)} al día. ¿Están prendidos n8n y el PC?`,
        cifras: { horas: h, promedio: prom }, valor_ref: h,
      }));
    }
  }

  // R05 / R06 presupuestos por categoría
  for (const c of m.por_categoria) {
    if (c.presupuesto === null || c.pct === null) continue;
    const nombre = nombreCat(inst, c.categoria_id);
    if (c.estado === 'pasado') {
      res.push(rec('categoria_sobre_presupuesto', `${c.categoria_id}:${m.mes}`, {
        titulo: `Te pasaste en ${nombre}`,
        detalle: `Llevas ${$(c.gastado)} de ${$(c.presupuesto)} (${formatearPct(c.pct)}). Quedan ${dr} días del mes.`,
        cifras: { gastado: c.gastado, presupuesto: c.presupuesto, pct: Math.round(c.pct * 100), dias: dr }, valor_ref: c.pct,
      }));
    } else if (c.estado === 'cerca' && m.dia / m.dias_mes < 0.8) {
      res.push(rec('categoria_cerca_presupuesto', `${c.categoria_id}:${m.mes}`, {
        titulo: `${nombre} va rápido`,
        detalle: `Ya usaste ${formatearPct(c.pct)} del presupuesto (${$(c.gastado)} de ${$(c.presupuesto)}) y vamos en el día ${m.dia} de ${m.dias_mes}.`,
        cifras: { gastado: c.gastado, presupuesto: c.presupuesto, pct: Math.round(c.pct * 100), dia: m.dia, dias_mes: m.dias_mes }, valor_ref: c.pct,
      }));
    }
  }

  // R10 / R11 desde las anomalías de 7 días
  for (const a of m.anomalias) {
    if (a.tipo === 'posible_duplicado') res.push(reglaDuplicado(a, inst.movimientos));
    else if (a.tipo === 'monto_inusual') res.push(reglaInusual(a, inst.movimientos));
  }

  // R02 limite_dia_superado
  if (m.limite_hoy !== null && m.limite_hoy > 0 && m.gastado_hoy > m.limite_hoy) {
    const exceso = m.gastado_hoy - m.limite_hoy;
    const manana = dr > 1 && V !== null ? Math.max(0, Math.floor((V - m.gastado_mes - P) / (dr - 1))) : null;
    res.push(rec('limite_dia_superado', hoy, {
      titulo: `Hoy te pasaste ${$(exceso)}`,
      detalle: `Llevas ${$(m.gastado_hoy)} y tu límite era ${$(m.limite_hoy)}.` + (manana !== null ? ` Mañana tu límite queda en ${$(manana)}.` : ''),
      cifras: { gastado_hoy: m.gastado_hoy, limite: m.limite_hoy, exceso, ...(manana !== null ? { limite_manana: manana } : {}) },
      valor_ref: exceso, severidad: m.gastado_hoy > 2 * m.limite_hoy ? 'alerta' : 'aviso',
    }));
  }

  // R07 ritmo_mayor_mes_pasado
  {
    const r7 = ritmoMayorQueMesPasado(m);
    if (r7) {
      res.push(rec('ritmo_mayor_mes_pasado', m.mes, {
        titulo: 'Vas más rápido que el mes pasado',
        detalle: `A esta fecha llevas ${$(r7.G)}; el mes pasado llevabas ${$(r7.Gp)} (${formatearPct(r7.G / r7.Gp - 1)} más).`,
        cifras: { gastado: r7.G, mes_pasado: r7.Gp, diferencia: r7.G - r7.Gp }, valor_ref: r7.G,
      }));
    }
  }

  // R16 meta_atrasada / R17 meta_cumplida
  for (const meta of inst.metas) {
    if (meta.estado !== 'activa') continue;
    if (meta.aportado >= meta.objetivo) {
      res.push(rec('meta_cumplida', String(meta.id), {
        titulo: `¡Cumpliste ${recortar(meta.nombre, 40)}!`,
        detalle: `Juntaste ${$(meta.aportado)} de ${$(meta.objetivo)}.`,
        cifras: { aportado: meta.aportado, objetivo: meta.objetivo }, valor_ref: meta.aportado,
      }));
      continue;
    }
    const esperado = esperadoMeta(meta, hoy);
    if (esperado !== null && meta.fecha_objetivo && meta.aportado < 0.9 * esperado) {
      const meses = Math.max(1, Math.ceil(Math.max(0, diasEntre(hoy, meta.fecha_objetivo)) / 30));
      const req = Math.ceil((meta.objetivo - meta.aportado) / meses);
      const actual = Math.round(aportes90(meta, hoy) / 3);
      res.push(rec('meta_atrasada', String(meta.id), {
        titulo: `${recortar(meta.nombre, 30)} se está atrasando`,
        detalle: `Llevas ${$(meta.aportado)} de ${$(meta.objetivo)}. Para llegar el ${formatearFechaCorta(meta.fecha_objetivo)} necesitas ${$(req)}/mes; vas a ${$(actual)}/mes.`,
        cifras: { aportado: meta.aportado, objetivo: meta.objetivo, requerido_mes: req, actual_mes: actual }, valor_ref: Math.round(esperado - meta.aportado),
      }));
    }
  }

  // R08 gasto_hormiga
  {
    const h = m.hormiga;
    const porPct = h.pct_variable >= 0.15 && h.cantidad >= 10;
    const porSemana = h.total_7d > 1.3 * h.promedio_semanal_previo && h.total_7d >= 50_000;
    if (porPct || porSemana) {
      res.push(rec('gasto_hormiga', semanaISO(hoy), {
        titulo: 'Los gastos pequeños suman',
        detalle: `${h.cantidad} gastos de menos de ${$(cfg.umbral_hormiga)} suman ${$(h.total)} este mes (${formatearPct(h.pct_variable)} de tu gasto).`
          + (h.top.length ? ` Más frecuentes: ${h.top.map((t) => t.comercio).join(', ')}.` : '') + ` A este ritmo son ${$(h.proyeccion_anual)} al año.`,
        cifras: { cantidad: h.cantidad, total: h.total, pct: Math.round(h.pct_variable * 100), anual: h.proyeccion_anual, total_7d: h.total_7d }, valor_ref: h.total,
      }));
    }
  }

  // R09 compras_nocturnas
  if (m.nocturnas.cantidad_7d >= 3) {
    res.push(rec('compras_nocturnas', semanaISO(hoy), {
      titulo: 'Compras de noche',
      detalle: `Esta semana hiciste ${m.nocturnas.cantidad_7d} compras entre las ${horaLegible(cfg.nocturno.desde)} y las ${horaLegible(cfg.nocturno.hasta)} por ${$(m.nocturnas.total_7d)}.`,
      cifras: { cantidad: m.nocturnas.cantidad_7d, total: m.nocturnas.total_7d }, valor_ref: m.nocturnas.cantidad_7d,
    }));
  }

  // R23 espera_lista
  for (const it of inst.lista_espera) {
    if (it.estado !== 'esperando' || it.recordado_en !== null || new Date(it.disponible_en).getTime() > ahora.getTime()) continue;
    const libre = m.libre_hoy !== null && m.libre_hoy > 0 ? `Hoy puedes gastar ${$(m.libre_hoy)}.` : 'Hoy ya no te queda margen.';
    res.push(rec('espera_lista', String(it.id), {
      titulo: `Pasaron ${cfg.horas_espera_impulso} h`,
      detalle: `¿Todavía quieres «${it.descripcion}» (${$(it.monto)})? ${libre}`,
      cifras: { item: it.id, monto: it.monto, ...(m.libre_hoy !== null ? { libre_hoy: m.libre_hoy } : {}) }, valor_ref: it.monto,
    }));
  }

  // R14 / R13 / R15 recurrentes
  const manana = sumarDias(hoy, 1);
  for (const r of inst.recurrentes) {
    if (r.estado === 'descartada' || !r.activa) continue;
    if (subioDePrecio(r.monto_tipico, r.monto_anterior)) {
      const antes = r.monto_anterior as number;
      res.push(rec('suscripcion_subio', `${r.id}:${r.monto_tipico}`, {
        titulo: `${recortar(r.nombre, 40)} subió de precio`,
        detalle: `Pasó de ${$(antes)} a ${$(r.monto_tipico)} (${formatearPct(r.monto_tipico / antes - 1)}); son ${$(costoAnual(r.monto_tipico, r.periodo))} al año.`,
        cifras: { antes, ahora: r.monto_tipico, anual: costoAnual(r.monto_tipico, r.periodo) }, valor_ref: r.monto_tipico - antes,
      }));
    }
    if (r.proximo_cobro === manana) {
      res.push(rec('suscripcion_manana', `${r.id}:${manana}`, {
        titulo: `Mañana te cobran ${recortar(r.nombre, 40)}`,
        detalle: `${$(r.monto_tipico)} (${r.periodo}).`, cifras: { monto: r.monto_tipico }, valor_ref: r.monto_tipico,
      }));
    }
    if (r.clase === 'suscripcion' && r.estado === 'detectada') {
      res.push(rec('suscripcion_detectada', String(r.id), {
        titulo: `${recortar(r.nombre, 36)} se repite cada ${CADA[r.periodo]}`,
        detalle: `Te cobran ${$(r.monto_tipico)} cada ${CADA[r.periodo]}, que son ${$(costoAnual(r.monto_tipico, r.periodo))} al año. ¿Es una suscripción tuya?`,
        cifras: { monto: r.monto_tipico, anual: costoAnual(r.monto_tipico, r.periodo) }, valor_ref: r.monto_tipico,
        accion: { texto: 'Confirmarla o descartarla', ruta_panel: '/suscripciones' },
      }));
    }
  }

  // R12 / R22 de los movimientos de hoy
  for (const mov of inst.movimientos) {
    if (mov.fecha !== hoy) continue;
    const alto = reglaGastoAlto(inst, m, mov);
    if (alto) res.push(alto);
    const ing = reglaIngreso(inst, m, mov);
    if (ing) res.push(ing);
  }

  // R20 por_revisar_pendientes
  {
    const s = inst.sistema;
    if (s.por_revisar_pendientes > 0 && s.por_revisar_mas_viejo_en && ahora.getTime() - new Date(s.por_revisar_mas_viejo_en).getTime() > 24 * 3_600_000) {
      res.push(rec('por_revisar_pendientes', hoy, {
        titulo: `Hay ${s.por_revisar_pendientes} avisos sin leer`,
        detalle: `No alcancé a leer ${s.por_revisar_pendientes} avisos del banco. Están en Sistema, bajo «Avisos por revisar», para que los anotes a mano o los reintentes.`,
        cifras: { n: s.por_revisar_pendientes }, valor_ref: s.por_revisar_pendientes,
        accion: { texto: 'Ver los avisos', ruta_panel: '/sistema' },
      }));
    }
  }

  // R19 buen_ritmo
  if (m.proyeccion_ratio !== null && V !== null && m.proyeccion_ratio <= 0.85 && m.dia >= 10
    && (m.base.modo === 'presupuesto_total' || m.base.modo === 'ingreso_configurado' || m.base.modo === 'ingreso_estimado')) {
    const sobra = V - m.proyeccion_fin_mes;
    const sugerido = Math.floor((0.5 * sobra) / 10_000) * 10_000;
    const meta = metaPrincipal(inst);
    const cola = sugerido > 0 ? (meta ? ` Podrías mandar ${$(sugerido)} a ${meta.nombre}.` : ` Podrías guardar ${$(sugerido)}.`) : '';
    res.push(rec('buen_ritmo', m.mes, {
      titulo: 'Vas bien este mes',
      detalle: `A este ritmo te sobran ${$(sobra)}.${cola}`,
      cifras: { sobra, sugerido }, valor_ref: m.proyeccion_ratio,
    }));
  }

  // R18 racha_hito
  if ([3, 7, 14, 30, 60, 90].includes(m.racha.dias)) {
    res.push(rec('racha_hito', `${m.racha.dias}:${sumarDias(hoy, -m.racha.dias)}`, {
      titulo: `${m.racha.dias} días seguidos bajo el límite`,
      detalle: `Tu récord es ${m.racha.record}.`, cifras: { dias: m.racha.dias, record: m.racha.record }, valor_ref: m.racha.dias,
    }));
  }

  // R03 limite_dia_cerca
  if (m.limite_hoy !== null && m.limite_hoy > 0) {
    const r = m.gastado_hoy / m.limite_hoy;
    if (r >= 0.8 && r <= 1) {
      res.push(rec('limite_dia_cerca', hoy, {
        titulo: 'Casi llegas al límite de hoy',
        detalle: `Llevas ${$(m.gastado_hoy)} de ${$(m.limite_hoy)}; te quedan ${$(m.limite_hoy - m.gastado_hoy)}.`,
        cifras: { gastado_hoy: m.gastado_hoy, limite: m.limite_hoy }, valor_ref: r,
      }));
    }
  }

  // R01 sin_ingreso_configurado
  if (m.base.modo === 'ingreso_estimado' || m.base.modo === 'gasto_historico' || m.base.modo === 'sin_datos') {
    res.push(rec('sin_ingreso_configurado', semanaISO(hoy), {
      titulo: 'Configura tu ingreso',
      detalle: m.base.aviso_modo ?? 'Dime tu ingreso para calcular cuánto puedes gastar (en Telegram: ⚙️ Más → 💵 Mi ingreso).',
      cifras: {}, valor_ref: 1, accion: { texto: 'Configurar ingreso', comando: '/ingreso', ruta_panel: '/#configurar' },
    }));
  }

  res.push(...reglasDeudas(inst, m));

  return ordenarRecomendaciones(degradarSiEstimada(res, m));
}

// ---------------------------------------------------------------------------
// Saldos y deudas (R26–R30). El «por qué» siempre con cifras; no es asesoría financiera.
// ---------------------------------------------------------------------------

const VER_DEUDAS = { texto: 'Ver deudas y saldos', ruta_panel: '/deudas' } as const;

export function reglasDeudas(inst: Instantanea, m: Metricas): Recomendacion[] {
  const res: Recomendacion[] = [];
  const s = m.saldos;
  if (!s) return res;
  const hoy = m.fecha;
  const vivas = (inst.deudas ?? []).filter((x) => x.activa && x.saldo > 0);

  // R27 vencimiento_deuda: avisa desde 3 días antes de cada fecha de pago.
  for (const v of vencimientos(vivas, hoy)) {
    if (v.dias > 3) break;
    const noAlcanza = s.hay_cuentas && s.saldo_total < v.pago_minimo;
    const cuando = v.dias === 0 ? 'hoy' : v.dias === 1 ? 'mañana' : `el ${formatearFechaCorta(v.fecha)}, en ${v.dias} días`;
    const titulo = v.dias === 0 ? `Hoy vence ${recortar(v.nombre, 40)}`
      : v.dias === 1 ? `Mañana vence ${recortar(v.nombre, 36)}` : `${recortar(v.nombre, 30)} vence el ${formatearFechaCorta(v.fecha)}`;
    const cuentas = !s.hay_cuentas ? ''
      : noAlcanza ? ` Ojo: en tus cuentas tienes ${$(s.saldo_total)}, no te alcanza para el mínimo.`
      : ` En tus cuentas tienes ${$(s.saldo_total)}.`;
    res.push(rec('vencimiento_deuda', `${v.deuda_id}:${v.fecha}`, {
      titulo,
      detalle: `El pago mínimo de ${v.nombre} es ${$(v.pago_minimo)} y vence ${cuando}. Pagar tarde suma intereses de mora y puede dañar tu historial de crédito.${cuentas}`,
      cifras: { pago_minimo: v.pago_minimo, dias: v.dias, ...(s.hay_cuentas ? { saldo_cuentas: s.saldo_total } : {}) },
      valor_ref: v.pago_minimo, severidad: v.dias === 0 || noAlcanza ? 'alerta' : 'aviso', accion: VER_DEUDAS,
    }));
  }

  // R26 minimos_vs_ingreso: los mínimos frente al ingreso y a lo que queda después de fijos y ahorro.
  const I = m.base.ingreso;
  if (s.minimos_mes > 0 && I !== null && I > 0) {
    const pct = s.minimos_mes / I;
    const libre = I - m.base.fijos - m.base.ahorro;
    if (pct >= 0.2 || libre <= s.minimos_mes) {
      const cola = libre > 0
        ? ` Después de fijos (${$(m.base.fijos)}) y ahorro (${$(m.base.ahorro)}) te quedan ${$(libre)}; los mínimos se llevan el ${formatearPct(s.minimos_mes / libre)}.`
        : ` Después de fijos y ahorro no te queda nada para cubrirlos.`;
      res.push(rec('minimos_vs_ingreso', m.mes, {
        titulo: libre <= s.minimos_mes ? 'Los mínimos no te caben' : 'Tus deudas se llevan mucho del ingreso',
        detalle: `Tus pagos mínimos suman ${$(s.minimos_mes)} al mes: el ${formatearPct(pct)} de tu ingreso (${$(I)}).${cola} Por encima del 20 % las deudas empiezan a apretar; mejor no sacar crédito nuevo.`,
        cifras: { minimos: s.minimos_mes, ingreso: I, pct: Math.round(pct * 100), libre },
        valor_ref: pct, severidad: pct >= 0.35 || libre <= s.minimos_mes ? 'alerta' : 'aviso', accion: VER_DEUDAS,
      }));
    }
  }

  // R30 colchon_bajo: cuántos días alcanza lo que hay en las cuentas si no entrara más plata.
  if (s.hay_cuentas && s.colchon_dias !== null && s.colchon_dias < 30) {
    const n = s.colchon_dias;
    res.push(rec('colchon_bajo', semanaISO(hoy), {
      titulo: n === 1 ? 'Tu plata alcanza para 1 día' : `Tu plata alcanza para ${n} días`,
      detalle: `Tienes ${$(s.saldo_total)} en tus cuentas y gastas unos ${$(s.gasto_diario)} al día (día a día, fijos y mínimos de deudas): si no te entrara más plata, te alcanza para ${n} ${n === 1 ? 'día' : 'días'}. Lo ideal es tener al menos un mes de colchón.`,
      cifras: { saldo: s.saldo_total, gasto_diario: s.gasto_diario, dias: n },
      valor_ref: n, severidad: n < 10 ? 'alerta' : 'aviso', accion: VER_DEUDAS,
    }));
  }

  // R29 solo_minimo: cuánto tarda y cuánto cuesta pagar solo el mínimo (o si nunca se paga).
  for (const deuda of vivas) {
    if (!(deuda.tasa_ea > 0)) continue;
    const sm = simularSoloMinimo(deuda);
    const nombre = recortar(deuda.nombre, 30);
    if (!sm.se_paga) {
      const nuncaBaja = deuda.pago_minimo <= sm.interes_primer_mes;
      const en12 = cuotaParaMeses(deuda.saldo, deuda.tasa_ea, 12);
      res.push(rec('solo_minimo', String(deuda.id), {
        titulo: `Con el mínimo nunca pagas ${nombre}`,
        detalle: (nuncaBaja
          ? `Los intereses de un mes (${$(sm.interes_primer_mes)}, a ${tasaLegible(deuda.tasa_ea)} E.A.) son iguales o mayores que tu mínimo (${$(deuda.pago_minimo)}): la deuda de ${$(deuda.saldo)} no baja.`
          : `Con ${$(deuda.pago_minimo)} al mes tardarías más de 50 años en pagar ${$(deuda.saldo)}.`)
          + ` Para salir en 12 meses necesitas unos ${$(en12)} al mes.`,
        cifras: { saldo: deuda.saldo, pago_minimo: deuda.pago_minimo, interes_mes: sm.interes_primer_mes, tasa_ea: deuda.tasa_ea, cuota_12m: en12 },
        valor_ref: deuda.saldo, severidad: 'alerta', accion: VER_DEUDAS,
      }));
    } else if (sm.meses !== null && sm.intereses !== null && sm.meses >= 12) {
      const en12 = cuotaParaMeses(deuda.saldo, deuda.tasa_ea, 12);
      const otra = sm.meses > 12 ? ` Con unos ${$(en12)} al mes sales en 12 meses.` : '';
      res.push(rec('solo_minimo', String(deuda.id), {
        titulo: `${nombre}: el mínimo sale caro`,
        detalle: `Solo pagando el mínimo (${$(deuda.pago_minimo)}) tardas ${sm.meses} meses (${mesesLegible(sm.meses)}) y pagas ${$(sm.intereses)} de intereses sobre una deuda de ${$(deuda.saldo)}, a ${tasaLegible(deuda.tasa_ea)} E.A.${otra}`,
        cifras: { saldo: deuda.saldo, pago_minimo: deuda.pago_minimo, meses: sm.meses, intereses: sm.intereses, tasa_ea: deuda.tasa_ea, cuota_12m: en12 },
        valor_ref: sm.intereses,
        severidad: sm.intereses >= deuda.saldo * 0.5 ? 'alerta' : 'aviso', accion: VER_DEUDAS,
      }));
    }
  }

  // R28 plan_deudas: qué deuda atacar primero, con meses e intereses de las dos estrategias.
  const pagoCfg = inst.config.pago_deudas_mensual;
  if (vivas.length >= 2 || (vivas.length === 1 && pagoCfg !== null)) {
    const cmp = compararPlanes(vivas, pagoCfg);
    const elegida = inst.config.estrategia_deudas;
    const plan = cmp[elegida];
    const otra = elegida === 'avalancha' ? cmp.bola_nieve : cmp.avalancha;
    const primera = plan.orden[0];
    const deudaPrimera = vivas.find((x) => x.id === primera?.deuda_id);
    if (!plan.se_paga || plan.meses === null || plan.intereses === null) {
      const cara = [...vivas].sort((a, b) => b.tasa_ea - a.tasa_ea || a.id - b.id)[0];
      res.push(rec('plan_deudas', `${elegida}:${plan.pago_mensual}`, {
        titulo: 'Con este pago no sales de deudas',
        detalle: `Repartiendo ${$(plan.pago_mensual)} al mes, los intereses crecen más rápido de lo que pagas. Sube lo que destinas a deudas o renegocia ${cara.nombre} (${tasaLegible(cara.tasa_ea)} E.A.).`,
        cifras: { pago_mensual: plan.pago_mensual, deuda_total: s.deuda_total },
        valor_ref: plan.pago_mensual, severidad: 'aviso', accion: VER_DEUDAS,
      }));
    } else if (deudaPrimera) {
      const porque = elegida === 'avalancha'
        ? `Es la de mayor tasa (${tasaLegible(deudaPrimera.tasa_ea)} E.A.): cada peso extra ahí ahorra más intereses.`
        : `Es la más pequeña (${$(deudaPrimera.saldo)}): sales rápido de ella y ese pago pasa a la siguiente.`;
      const nombreOtra = elegida === 'avalancha' ? 'bola de nieve (la más pequeña primero)' : 'avalancha (la de mayor tasa primero)';
      const comparacion = otra.se_paga && otra.meses !== null && otra.intereses !== null
        ? ` Con ${nombreOtra} serían ${otra.meses} meses y ${$(otra.intereses)} de intereses`
          + (otra.intereses === plan.intereses ? ' (lo mismo).' : ` (${$(Math.abs(otra.intereses - plan.intereses))} ${otra.intereses > plan.intereses ? 'más' : 'menos'}).`)
        : '';
      res.push(rec('plan_deudas', `${elegida}:${plan.pago_mensual}`, {
        titulo: `Paga primero ${recortar(deudaPrimera.nombre, 40)}`,
        detalle: `${porque} Con ${$(plan.pago_mensual)} al mes (los mínimos y lo que sobre a ${deudaPrimera.nombre}) sales de deudas en ${plan.meses} meses (${mesesLegible(plan.meses)}) y pagas ${$(plan.intereses)} de intereses.${comparacion}`,
        cifras: {
          pago_mensual: plan.pago_mensual, meses: plan.meses, intereses: plan.intereses,
          ...(otra.meses !== null && otra.intereses !== null ? { meses_otra: otra.meses, intereses_otra: otra.intereses } : {}),
        },
        valor_ref: plan.intereses, accion: VER_DEUDAS,
      }));
    }
  }

  return res;
}

// ---------------------------------------------------------------------------
// Cooldown y límite de pushes (§4.2)
// ---------------------------------------------------------------------------

/** R05 sube de nivel al cruzar 120 % y 150 % del presupuesto. */
const nivelPresupuesto = (ratio: number) => (ratio >= 1.5 ? 2 : ratio >= 1.2 ? 1 : 0);

function debeReemitir(r: Recomendacion, e: EmisionPrevia, ahora: Date): boolean {
  const def = DEF.get(r.regla)!;
  const horas = (ahora.getTime() - new Date(e.ultima_en).getTime()) / 3_600_000;
  if (horas >= def.cooldown_h) return true;
  if (RANGO_SEV[r.severidad] > RANGO_SEV[e.severidad]) return true;
  if (e.valor_ref !== null) {
    if (def.reemite_si_cambia !== null && Math.abs(r.valor_ref - e.valor_ref) / Math.max(1, Math.abs(e.valor_ref)) >= def.reemite_si_cambia) return true;
    if (r.regla === 'categoria_sobre_presupuesto' && nivelPresupuesto(r.valor_ref) > nivelPresupuesto(e.valor_ref)) return true;
  }
  return false;
}

export function filtrarParaPush(
  recs: Recomendacion[], emisiones: EmisionPrevia[], ahora: Date, cfg: ConfigPlata,
): { enviar: Recomendacion[]; suprimidas: { id: string; motivo: string }[] } {
  const enviar: Recomendacion[] = [];
  const suprimidas: { id: string; motivo: string }[] = [];
  const pausa = cfg.pausa_hasta !== null && new Date(cfg.pausa_hasta).getTime() > ahora.getTime();
  const hora = aBogota(ahora).hora;
  const enHorario = hora >= cfg.horario_push.desde && hora <= cfg.horario_push.hasta;
  const previas = new Map(emisiones.map((e) => [e.clave, e]));

  for (const r of ordenarRecomendaciones(recs)) {
    const no = (motivo: string) => suprimidas.push({ id: r.id, motivo });
    if (!r.push) { no('sin_push'); continue; }
    const esPin = r.regla === 'pin_bloqueado';
    if (!esPin && pausa) { no('pausa'); continue; }
    if (!esPin && !enHorario) { no('fuera_de_horario'); continue; }
    const e = previas.get(r.id);
    if (e?.silenciada_hasta && new Date(e.silenciada_hasta).getTime() > ahora.getTime()) { no('silenciada'); continue; }
    if (e && !debeReemitir(r, e, ahora)) { no('cooldown'); continue; }
    if (enviar.length >= cfg.max_push_por_evaluacion) { no('limite_por_evaluacion'); continue; }
    enviar.push(r);
  }
  return { enviar, suprimidas };
}

// ---------------------------------------------------------------------------
// Veredicto «¿puedo?» (§4.3)
// ---------------------------------------------------------------------------

export function veredictoPuedo(inst: Instantanea, m: Metricas, c: ConsultaPuedo): Veredicto {
  const cfg = inst.config;
  const M = c.monto;
  const norm = normalizarComercio(c.descripcion);
  const catId = c.categoria_id ?? categoriaPorReglas(norm, inst.reglas) ?? 'otros';
  const cat = inst.categorias.find((x) => x.id === catId);
  const esencial = cat?.esencial ?? false;
  const nombre = cat?.nombre ?? catId;
  const { fecha: hoy, hora } = aBogota(c.ahora);

  const L = m.libre_hoy;
  const R = m.restante_mes;
  const base = m.limite_hoy;
  const dr = m.dias_restantes;
  const bh = m.base_hoy;

  // Horizonte (2026-10-09). Con dia_ingreso, la plata de las cuentas solo tiene que durar hasta el próximo ingreso
  // (`bh.hasta`, `bh.dias_hasta_ingreso` días contando hoy), igual que limite_saldo; el ingreso/presupuesto mensual sigue
  // repartido en los dr días del mes. Sin dia_ingreso (dhi = null) todo queda exactamente como antes.
  const dhi = bh.dias_hasta_ingreso;
  const hastaIng = dhi !== null ? bh.hasta : null;
  const alIngreso = hastaIng !== null ? `hasta tu próximo ingreso el ${formatearFechaCorta(hastaIng)}` : '';
  let nuevo = base !== null ? Math.floor(base - M / dr) : null;
  let diasNuevo = dr;
  let nuevoPorSaldo = false;            // el límite tras la compra lo pone el saldo hasta el próximo ingreso
  if (hastaIng !== null && dhi !== null && bh.limite_saldo !== null) {
    // Cada límite absorbe la compra en su propio horizonte; manda el menor (como en `nucleo`).
    const trasSaldo = bh.limite_saldo - M / dhi;
    const compite = bh.limite_ingreso !== null && !baseEsEstimada(m.base);
    const trasIngreso = compite ? (bh.limite_ingreso as number) - M / dr : Number.POSITIVE_INFINITY;
    nuevoPorSaldo = trasSaldo <= trasIngreso;
    nuevo = Math.floor(Math.min(trasSaldo, trasIngreso));
    diasNuevo = nuevoPorSaldo ? dhi : dr;
  }
  // R = min(lo del mes, lo del saldo): si manda el saldo, R es lo que queda hasta el próximo ingreso, no hasta fin de mes.
  const rSaldo = bh.disponible_saldo !== null ? bh.disponible_saldo - m.gastado_hoy : null;
  const rPorSaldo = hastaIng !== null && R !== null && rSaldo !== null && R === rSaldo;
  const ec = m.por_categoria.find((x) => x.categoria_id === catId);
  const pres = ec?.presupuesto ?? null;
  const Bc = pres !== null ? pres - (ec?.gastado ?? 0) : null;

  const impulso = !esencial && M >= cfg.umbral_impulso;
  const nocturno = !esencial && esNocturna(hora, cfg.nocturno);
  const esperado = inst.lista_espera.some((it) => it.estado === 'esperando'
    && (normalizarComercio(it.descripcion) === norm || Math.abs(it.monto - M) <= 0.1 * M)
    && new Date(it.disponible_en).getTime() <= c.ahora.getTime());

  // Retraso en la meta principal
  const meta = metaPrincipal(inst);
  const ritmoMeta = meta ? aportes90(meta, hoy) / 90 : 0;
  const retraso = meta && ritmoMeta > 0 ? Math.ceil(M / ritmoMeta) : null;

  // Plata real y deudas (Fase B). Todo sale de las métricas: aquí solo se resta el monto.
  const S = bh.hay_cuentas ? bh.saldo_liquido : null;                 // efectivo + banco ahora
  const S_tras = S !== null ? S - M : null;
  // Con dia_ingreso, base_hoy ya trae solo los mínimos que vencen de hoy a `hasta` (los de después los paga el ingreso nuevo).
  const Mp = bh.hay_cuentas ? bh.minimos_pendientes : minimosPendientesMes(inst.deudas, hoy);
  const porPagar = hastaIng !== null ? `por pagar ${alIngreso}` : 'por pagar';
  const falta = S_tras !== null ? Math.max(0, Mp - S_tras) : null;
  const pv = m.saldos.proximo_vencimiento;
  const gd = m.saldos.gasto_diario;
  const colchon = S !== null ? colchonDias(Math.max(0, S), gd) : null;
  const colchonTras = S_tras !== null ? colchonDias(Math.max(0, S_tras), gd) : null;

  const cifras: Veredicto['cifras'] = {
    monto: M, libre_hoy: L, restante_mes: R, limite_hoy: base, nuevo_limite: nuevo,
    presupuesto_cat: pres, restante_cat: Bc, dias_restantes: dr, retraso_meta_dias: retraso,
    saldo_total: S, saldo_tras: S_tras, minimos_pendientes: Mp, falta_minimos: falta,
    proximo_minimo: pv?.pago_minimo ?? null, proximo_minimo_dias: pv?.dias ?? null,
    colchon_dias: colchon, colchon_dias_tras: colchonTras,
    dias_nuevo_limite: diasNuevo, hasta_ingreso: hastaIng,
  };

  let decision: Veredicto['decision'];
  let paso: string;
  let razon: string;
  let regla_48h = false;

  const sinMargen = Math.max(0, L ?? 0);
  if (bh.limita === null) {
    decision = 'espera'; paso = 'p0';
    razon = 'Aún no sé cuánto tienes para gastar. Dime tu ingreso (⚙️ Más → 💵 Mi ingreso), tu tope (⚙️ Más → 📊 Presupuesto) o cuánta plata tienes en tus cuentas.';
  } else if (S !== null && S_tras !== null && falta !== null && falta > 0) {
    // La plata real no alcanza para la compra y los mínimos que faltan: nunca «sí».
    decision = esencial ? 'espera' : 'no'; paso = 'p1s';
    if (S_tras < 0) {
      razon = `No tienes esa plata en tus cuentas: hay ${$(Math.max(0, S))} y esto cuesta ${$(M)}${Mp > 0 ? `, y aún te faltan ${$(Mp)} de mínimos ${porPagar}` : ''}.`;
    } else if (S < Mp) {
      razon = `Tus cuentas (${$(Math.max(0, S))}) ya no alcanzan para los mínimos que te faltan ${porPagar} (${$(Mp)}); con esta compra te faltarían ${$(falta)}.`;
    } else {
      razon = `Te dejaría sin con qué pagar tus deudas: en tus cuentas quedarían ${$(S_tras)} y te faltan ${$(Mp)} de mínimos ${porPagar} (te faltarían ${$(falta)}).`;
    }
    if (esencial) razon += Mp > 0 ? ' Si es imprescindible, asegura primero el pago de los mínimos.' : ' Si es imprescindible, mira de dónde sale antes de pagarlo.';
  } else if (R !== null && R - M < 0 && !esencial) {
    decision = 'no'; paso = 'p1';
    razon = `No te alcanza: te quedan ${$(R)} ${rPorSaldo ? alIngreso : 'para el resto del mes'} y esto cuesta ${$(M)}.`;
  } else if (R !== null && R - M < 0 && esencial) {
    decision = 'espera'; paso = 'p1e';
    razon = `${rPorSaldo ? `No te alcanza ${alIngreso}` : 'No te alcanza en el mes'} (${$(R)} libres).${m.base.ahorro > 0 ? ` Si es imprescindible, sale de tu ahorro (${$(m.base.ahorro)}).` : ' Si es imprescindible, mira de dónde sale.'}`;
  } else if (!esencial && m.semaforo === 'rojo' && M > sinMargen) {
    decision = 'no'; paso = 'p2';
    razon = `Vas en rojo este mes (${m.semaforo_razon}). Hoy solo te quedan ${$(sinMargen)}.`;
  } else if (!esencial && Bc !== null && pres !== null && M > Bc + 0.2 * pres) {
    decision = 'no'; paso = 'p3';
    razon = `Te pasarías ${$(M - Bc)} del presupuesto de ${nombre} (te quedan ${$(Math.max(0, Bc))} de ${$(pres)}).`;
  } else if (impulso && !esperado) {
    decision = 'espera'; paso = 'p4'; regla_48h = true;
    const disp = aBogota(new Date(c.ahora.getTime() + cfg.horas_espera_impulso * 3_600_000));
    razon = `Es una compra grande y no esencial: espérala ${cfg.horas_espera_impulso} horas. Te pregunto el ${formatearFechaCorta(disp.fecha)}.`;
  } else if (nocturno && M >= cfg.umbral_hormiga) {
    decision = 'espera'; paso = 'p5';
    razon = `Son las ${hora}. Si mañana todavía lo quieres, cómpralo.`;
  } else if (!esencial && Bc !== null && M > Bc) {
    decision = 'espera'; paso = 'p6';
    razon = `Cabe en el mes, pero te pasa del presupuesto de ${nombre} por ${$(M - Bc)}.`;
  } else if (M <= sinMargen) {
    decision = 'si'; paso = 'p7';
    razon = `Cabe en lo de hoy: te quedarían ${$((L ?? 0) - M)} para hoy.`;
  } else if (R !== null && base !== null && nuevo !== null && M <= R && nuevo >= 0.8 * base) {
    decision = 'si'; paso = 'p8';
    razon = `${nuevoPorSaldo ? `Cabe ${alIngreso}` : 'Cabe en el mes'}: tu límite diario bajaría de ${$(base)} a ${$(nuevo)} los próximos ${diasNuevo} días.`;
  } else if (R !== null && base !== null && nuevo !== null && M <= R && nuevo >= 0.5 * base) {
    decision = 'espera'; paso = 'p9';
    razon = `Cabe, pero aprieta: tu límite diario bajaría de ${$(base)} a ${$(nuevo)} (${$(base - nuevo)} menos).`;
  } else {
    decision = 'no'; paso = 'p10';
    razon = `${nuevoPorSaldo ? `Te dejaría muy justo ${alIngreso}` : 'Te dejaría el mes muy justo'}: tu límite diario quedaría en ${$(Math.max(0, nuevo ?? 0))}.`;
  }

  // Razones extra, de la más decisiva a la más informativa (máximo 4 en total; el bot puede mostrar menos).
  const razones = [razon];
  // «Ya lo pensaste» solo explica por qué no se pidió esperar: sobra si la plata o el presupuesto ya dijeron que no.
  const antesDe48h = ['p0', 'p1s', 'p1', 'p1e', 'p2', 'p3'].includes(paso);
  if (esperado && impulso && !antesDe48h) razones.push(`Ya lo pensaste ${cfg.horas_espera_impulso} horas.`);
  if (S !== null && S_tras !== null && paso !== 'p1s') {
    const dias = colchonTras !== null ? `, unos ${colchonTras} ${colchonTras === 1 ? 'día' : 'días'} de gastos` : '';
    razones.push(`En tus cuentas quedarían ${$(S_tras)} de ${$(Math.max(0, S))}${dias}.`);
  }
  if (pv) {
    const cuando = pv.dias === 0 ? 'Hoy' : pv.dias === 1 ? 'Mañana' : `El ${formatearFechaCorta(pv.fecha)}`;
    let t = `${cuando} vence el mínimo de ${pv.nombre}: ${$(pv.pago_minimo)}`;
    // ¿El vencimiento cae dentro del horizonte de Mp? Sin dia_ingreso, el mes; con dia_ingreso, de hoy a `hasta`.
    const pvDentro = hastaIng === null ? pv.fecha.slice(0, 7) === m.mes : pv.fecha <= hastaIng;
    if (pvDentro && Mp > pv.pago_minimo) t += ` (en total te faltan ${$(Mp)} de mínimos${hastaIng !== null ? ` ${alIngreso}` : ''})`;
    if (S_tras !== null && paso !== 'p1s') {
      // Uno dentro del horizonte ya está en Mp (y p1s garantiza S_tras ≥ Mp). Uno fuera: si el saldo no lo cubre, sin
      // dia_ingreso se avisa; con dia_ingreso vence después del ingreso nuevo, que es el que lo paga (no es falta).
      const cubre = pvDentro || S_tras - Mp >= pv.pago_minimo;
      t += cubre ? '; te alcanza para pagarlo'
        : hastaIng !== null ? `; vence después de tu próximo ingreso el ${formatearFechaCorta(hastaIng)}, así que sale de esa plata`
        : '; con lo que te quedaría no alcanzas a pagarlo si no te entra plata antes';
    }
    razones.push(t + '.');
  }
  if (pres !== null && Bc !== null && paso !== 'p3' && paso !== 'p6') {
    razones.push(Bc >= 0 ? `Te quedan ${$(Bc)} de ${$(pres)} en ${nombre}.` : `Ya te pasaste del presupuesto de ${nombre} por ${$(-Bc)}.`);
  }
  if (meta && retraso !== null) razones.push(`Te aleja ${retraso} días de ${meta.nombre}.`);
  const r7 = ritmoMayorQueMesPasado(m);
  if (r7) razones.push(`Vas más rápido que el mes pasado: ${$(r7.G)} contra ${$(r7.Gp)} a esta fecha.`);
  if (bh.limita === 'estimado') razones.push('Lo calculo con un estimado: dime tu ingreso o cuánto tienes en tus cuentas para afinarlo.');

  return {
    decision,
    titulo: decision === 'si' ? 'Sí, cabe' : decision === 'espera' ? 'Espera' : 'Mejor no',
    razones: razones.slice(0, 4),
    regla_decisiva: paso,
    cifras, categoria_id: catId, esencial, regla_48h, lista_espera_id: null,
  };
}
