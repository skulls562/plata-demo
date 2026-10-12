// Métricas financieras (SPEC §3). TODO es puro: no lee reloj, base, red ni entorno.
import { fechaDePago, gastoDiarioTotal, minimoEfectivo, minimosMes, minimosPendientesMes, resumenSaldos } from './deudas';
import {
  aBogota, deBogota, diasDelMes, diasEntre, formatearCOP, formatearPct, mediana, mesAnterior, mesDe, normalizarComercio,
  rangoMes, sumarDias,
} from './formato';
import type {
  Anomalia, Banco, BaseHoy, BaseMensual, Categoria, ComponenteScore, ConfigPlata, Cuenta, Deuda, DiaCerrado, EstadoCategoria, GastoFijo,
  HoraHM, Instantanea, ISODate, MetaConAportes, Mes, Metricas, Movimiento, Pesos, Recurrente, ReglaCategoria, Semaforo,
} from './tipos';

// ---------------------------------------------------------------------------
// Utilidades compartidas con recomendar.ts
// ---------------------------------------------------------------------------

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Patrón normalizado vs comercio normalizado: ≤ 3 caracteres = token completo; más = prefijo de token (SPEC §1.4). */
export function coincidePatron(comercio_norm: string, patron: string): boolean {
  if (!patron || !comercio_norm) return false;
  const c = ` ${comercio_norm}`;
  if (patron.length <= 3) return (`${c} `).includes(` ${patron} `);
  return c.includes(` ${patron}`);
}

/** Categoría por reglas: gana el patrón más largo; en empate, aprendida/manual antes que semilla. null = nada coincide. */
export function categoriaPorReglas(comercio_norm: string, reglas: ReglaCategoria[]): string | null {
  let mejor: ReglaCategoria | null = null;
  for (const r of reglas) {
    if (!coincidePatron(comercio_norm, r.patron)) continue;
    if (!mejor || r.patron.length > mejor.patron.length || (r.patron.length === mejor.patron.length && mejor.origen === 'semilla' && r.origen !== 'semilla')) mejor = r;
  }
  return mejor?.categoria_id ?? null;
}

/** Cuánto debería llevar aportado una meta con fecha, hoy (lineal desde que se creó). null si no tiene fecha. */
export function esperadoMeta(meta: MetaConAportes, hoy: ISODate): number | null {
  if (!meta.fecha_objetivo) return null;
  const creada = aBogota(new Date(meta.creada_en)).fecha;
  const total = diasEntre(creada, meta.fecha_objetivo);
  if (total <= 0) return meta.objetivo;
  const frac = clamp(diasEntre(creada, hoy) / total, 0, 1);
  return meta.objetivo * frac;
}

/** Meta al día (SPEC §3.6): aportado ≥ 0.9 × esperado. */
export function metaAlDia(meta: MetaConAportes, hoy: ISODate): boolean {
  const esperado = esperadoMeta(meta, hoy);
  return esperado === null ? true : meta.aportado >= 0.9 * esperado;
}

const esReverso = (m: Movimiento) => m.tipo === 'reverso' && m.computa && m.fijo_id === null;
const enRango = (m: Movimiento, desde: ISODate, hasta: ISODate) => m.fecha >= desde && m.fecha <= hasta;
const esIngreso = (m: Movimiento) => m.tipo === 'ingreso' && m.computa && m.sentido === 'entrada';

// ---------------------------------------------------------------------------
// Gasto variable, fijos, comprometido
// ---------------------------------------------------------------------------

export function esGastoVariable(m: Movimiento): boolean {
  return m.sentido === 'salida' && m.computa && m.fijo_id === null;
}

/** Salidas variables − reversos, entre dos fechas (inclusive). */
export function gastoVariableNeto(movs: Movimiento[], desde: ISODate, hasta: ISODate): Pesos {
  let t = 0;
  for (const m of movs) {
    if (!enRango(m, desde, hasta)) continue;
    if (esGastoVariable(m)) t += m.monto;
    else if (esReverso(m)) t -= m.monto;
  }
  return t;
}

/** Σ max(0, pagado − monto del fijo) por fijo, solo movimientos ligados del mes. */
export function excesoFijos(movs: Movimiento[], fijos: GastoFijo[], mes: Mes): Pesos {
  const { desde, hasta } = rangoMes(mes);
  let total = 0;
  for (const f of fijos) {
    let pagado = 0;
    for (const m of movs) {
      if (m.fijo_id === f.id && m.sentido === 'salida' && m.computa && enRango(m, desde, hasta)) pagado += m.monto;
    }
    total += Math.max(0, pagado - f.monto);
  }
  return total;
}

/**
 * P: lo que ya está comprometido entre hoy y `fin` (por defecto fin de mes): suscripciones y fijos recurrentes que no son
 * un fijo configurado. Cuenta solo el próximo cobro de cada uno.
 */
export function comprometidoPendiente(recurrentes: Recurrente[], fijos: GastoFijo[], hoy: ISODate, fin: ISODate = rangoMes(mesDe(hoy)).hasta): Pesos {
  const patrones = fijos.filter((f) => f.activo && f.patron).map((f) => f.patron as string);
  let p = 0;
  for (const r of recurrentes) {
    if (r.estado === 'descartada' || !r.activa) continue;
    if (r.clase !== 'suscripcion' && r.clase !== 'fijo') continue;
    if (!r.proximo_cobro || r.proximo_cobro < hoy || r.proximo_cobro > fin) continue;
    if (r.ultimo_cobro >= r.proximo_cobro) continue;
    if (patrones.some((pt) => coincidePatron(r.comercio_norm, pt))) continue;
    p += r.monto_tipico;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Base mensual (cadena de degradación §3.1)
// ---------------------------------------------------------------------------

/** Meses (de los 3 anteriores) con ≥ 10 movimientos vivos; en orden cronológico. */
function mesesReferencia(movs: Movimiento[], mesActual: Mes): Mes[] {
  const cuenta = new Map<Mes, number>();
  for (const m of movs) cuenta.set(mesDe(m.fecha), (cuenta.get(mesDe(m.fecha)) ?? 0) + 1);
  const res: Mes[] = [];
  let mes = mesActual;
  for (let k = 0; k < 3; k++) {
    mes = mesAnterior(mes);
    if ((cuenta.get(mes) ?? 0) >= 10) res.unshift(mes);
  }
  return res;
}

function presupuestoTotal(inst: Instantanea, mes: Mes): Pesos | null {
  const p = inst.presupuestos.find((x) => x.categoria_id === '*' && x.mes === mes)
    ?? inst.presupuestos.find((x) => x.categoria_id === '*' && x.mes === '*');
  return p ? p.monto : null;
}

function presupuestoCategoria(inst: Instantanea, mes: Mes, cat: string): Pesos | null {
  const p = inst.presupuestos.find((x) => x.categoria_id === cat && x.mes === mes)
    ?? inst.presupuestos.find((x) => x.categoria_id === cat && x.mes === '*');
  return p ? p.monto : null;
}

export function resolverBaseMensual(inst: Instantanea, hoy: ISODate): BaseMensual {
  const mes = mesDe(hoy);
  const { desde: ini } = rangoMes(mes);
  const refs = mesesReferencia(inst.movimientos, mes);
  const F = inst.fijos.filter((f) => f.activo).reduce((s, f) => s + f.monto, 0);
  const recib = inst.movimientos.filter((m) => esIngreso(m) && enRango(m, ini, hoy)).reduce((s, m) => s + m.monto, 0);
  const Iconf = inst.config.ingreso_mensual && inst.config.ingreso_mensual > 0 ? inst.config.ingreso_mensual : null;

  let Iest: number | null = null;
  if (refs.length >= 1) {
    const sumas = refs.map((r) => {
      const { desde, hasta } = rangoMes(r);
      return inst.movimientos.filter((m) => esIngreso(m) && enRango(m, desde, hasta)).reduce((s, m) => s + m.monto, 0);
    });
    const prom = sumas.reduce((a, b) => a + b, 0) / refs.length;
    if (prom > 0) Iest = prom;
  }

  const I = Iconf !== null ? Math.max(Iconf, recib) : Iest !== null ? Math.max(Math.round(Iest), recib) : null;
  const A = I !== null ? Math.round((I * inst.config.pct_ahorro) / 100) : 0;
  const PT = presupuestoTotal(inst, mes);

  const base = (modo: BaseMensual['modo'], aviso: string | null, V: number | null): BaseMensual => ({
    modo, aviso_modo: aviso, ingreso: I, ingresos_recibidos: recib, fijos: F, ahorro: A, disponible_variable: V, meses_referencia: refs,
  });

  if (PT !== null) {
    if (I !== null) {
      const resto = I - F - A;
      const aviso = PT > resto ? `Tu presupuesto (${formatearCOP(PT)}) es mayor que lo que te deja tu ingreso (${formatearCOP(resto)}); uso ${formatearCOP(resto)}.` : null;
      return base('presupuesto_total', aviso, Math.min(PT, resto));
    }
    return base('presupuesto_total', null, PT);
  }
  if (Iconf !== null) return base('ingreso_configurado', null, I! - F - A);
  if (Iest !== null) {
    const n = refs.length;
    return base('ingreso_estimado', `Uso tu ingreso promedio de ${n} ${n === 1 ? 'mes' : 'meses'} (${formatearCOP(Math.round(Iest))}). Dime tu ingreso real (en Telegram: ⚙️ Más → 💵 Mi ingreso) para que sea exacto.`, I! - F - A);
  }
  if (refs.length >= 1) {
    const prom = refs.reduce((s, r) => {
      const { desde, hasta } = rangoMes(r);
      return s + gastoVariableNeto(inst.movimientos, desde, hasta);
    }, 0) / refs.length;
    if (prom > 0) {
      const V = Math.round(prom);
      return base('gasto_historico', `No sé tu ingreso: te comparo con tu gasto usual (${formatearCOP(V)} al mes). No es un límite real.`, V);
    }
  }
  return base('sin_datos', 'Aún no tengo con qué calcular. Dime tu ingreso (en Telegram: ⚙️ Más → 💵 Mi ingreso).', null);
}

// ---------------------------------------------------------------------------
// Plata real: saldo de las cuentas de efectivo y banco (Fase A, 2026-10-09). Contrato en tipos.ts → BaseHoy.
// ---------------------------------------------------------------------------

type GrupoLiquido = 'efectivo' | 'banco';
/** Bancos cuyo nombre puede aparecer en el nombre de una cuenta («Bancolombia ahorros», «Nequi»). */
const BANCOS_NOMBRABLES: readonly Banco[] = ['bancolombia', 'nequi', 'rappicard', 'didi'];

/** Compra o abono con tarjeta de crédito: mueve la deuda, no las cuentas. */
const esDeCredito = (m: Movimiento) => m.medio === 'credito' || m.banco === 'rappicard';
const esDeEfectivo = (m: Movimiento) => m.banco === 'efectivo' || m.medio === 'efectivo';

/**
 * Cómo mueve un movimiento la plata líquida, por grupo (+ entra, − sale). Reglas:
 * - Gasto que Plata cuenta (computa) y pago de tarjeta: sale. Ingreso que cuenta y reverso: entra.
 * - Retiro: sale del banco y entra al efectivo (aunque no compute: la plata solo cambió de bolsillo).
 * - Tarjeta de crédito (medio 'credito' o RappiCard) y movimientos entre cuentas propias ('interno'): no mueven nada.
 * El que llama ignora los grupos sin cuentas anotadas (p. ej. gastos en efectivo si no hay cuenta de efectivo).
 */
export function efectosLiquidos(m: Movimiento): { grupo: GrupoLiquido; monto: Pesos }[] {
  if (m.tipo === 'interno') return [];
  if (m.tipo === 'retiro' && m.sentido === 'salida') {
    return esDeCredito(m) ? [{ grupo: 'efectivo', monto: m.monto }] : [{ grupo: 'banco', monto: -m.monto }, { grupo: 'efectivo', monto: m.monto }];
  }
  if (esDeCredito(m)) return [];
  const grupo: GrupoLiquido = esDeEfectivo(m) ? 'efectivo' : 'banco';
  if (esIngreso(m) || (m.tipo === 'reverso' && m.computa)) return [{ grupo, monto: m.monto }];
  if (m.sentido === 'salida' && (m.computa || m.tipo === 'pago_tarjeta')) return [{ grupo, monto: -m.monto }];
  return [];
}

const instanteMs = (iso: string) => new Date(iso).getTime();

/**
 * Cuenta cuyo saldo anotado debería incluir (o no) este movimiento. Los movimientos no dicen de qué cuenta salen:
 * con una sola cuenta del grupo es esa; si hay varias, la que lleva el nombre del banco del movimiento; si no, entre
 * las que no llevan el nombre de OTRO banco, la de actualización más vieja (conservador: puede restar de más, nunca de menos).
 */
function cuentaDe(m: Movimiento, grupo: GrupoLiquido, liquidas: Cuenta[]): Cuenta | null {
  const del = liquidas.filter((c) => c.tipo === grupo);
  if (del.length <= 1) return del[0] ?? null;
  let candidatas = del;
  if (grupo === 'banco') {
    const nombre = (c: Cuenta) => normalizarComercio(c.nombre);
    if (BANCOS_NOMBRABLES.includes(m.banco)) {
      const suya = del.filter((c) => nombre(c).includes(m.banco));
      if (suya.length === 1) return suya[0];
    }
    const neutras = del.filter((c) => !BANCOS_NOMBRABLES.some((b) => b !== m.banco && nombre(c).includes(b)));
    if (neutras.length > 0) candidatas = neutras;
  }
  return candidatas.reduce((a, b) => (instanteMs(b.actualizado_en) < instanteMs(a.actualizado_en) ? b : a));
}

/**
 * ¿Pasó el movimiento DESPUÉS de que se anotó el saldo de la cuenta? Con hora: instante Bogotá contra el instante UTC de
 * `actualizado_en`. Sin hora: por fecha (Bogotá); el mismo día decide `creado_en` (cuándo se registró en Plata).
 */
export function esPosteriorA(m: Pick<Movimiento, 'fecha' | 'hora' | 'creado_en'>, actualizado_en: string): boolean {
  const corte = instanteMs(actualizado_en);
  if (Number.isNaN(corte)) return false;
  if (m.hora) return deBogota(m.fecha, m.hora).getTime() > corte;
  const fechaCorte = aBogota(new Date(corte)).fecha;
  if (m.fecha !== fechaCorte) return m.fecha > fechaCorte;
  return instanteMs(m.creado_en) > corte;
}

/** Mes siguiente ('2026-12' → '2027-01'). */
const mesSiguiente = (mes: Mes): Mes => mesDe(sumarDias(rangoMes(mes).hasta, 1));

/**
 * Gastos fijos configurados que faltan por pagar de hoy a `hasta` (por defecto, fin de mes). El día 31 cae el último del mes.
 * Se recorre cada mes que toca la ventana: un fijo con día cuenta si ese día cae en [hoy, hasta]; uno sin día puede vencer
 * cualquier día, así que se reserva en cada mes que toca la ventana (conservador). Lo ya pagado solo se descuenta en el mes
 * de hoy (los meses siguientes aún no tienen pagos).
 */
export function fijosPendientes(movs: Movimiento[], fijos: GastoFijo[], hoy: ISODate, hasta: ISODate = rangoMes(mesDe(hoy)).hasta): Pesos {
  const mesHoy = mesDe(hoy);
  let total = 0;
  for (const f of fijos) {
    if (!f.activo) continue;
    for (let mes = mesHoy; mes <= mesDe(hasta); mes = mesSiguiente(mes)) {
      if (f.dia_mes !== null) {
        const fecha = `${mes}-${String(Math.min(f.dia_mes, diasDelMes(mes))).padStart(2, '0')}`;
        if (fecha < hoy || fecha > hasta) continue;
      }
      let pagado = 0;
      if (mes === mesHoy) {
        const { desde } = rangoMes(mes);
        for (const m of movs) if (m.fijo_id === f.id && m.sentido === 'salida' && m.computa && enRango(m, desde, hoy)) pagado += m.monto;
      }
      total += Math.max(0, f.monto - pagado);
    }
  }
  return total;
}

/**
 * Mínimos de deudas vivas con día de pago que vencen de hoy (incluido) a `hasta` (incluido). Si la ventana alcanza dos
 * vencimientos de la misma deuda, cuenta los dos, sin pasar del saldo. Con `hasta` = fin de mes da lo mismo que
 * `minimosPendientesMes` (deudas.ts).
 */
export function minimosPendientesHasta(deudas: Deuda[], hoy: ISODate, hasta: ISODate): Pesos {
  let total = 0;
  for (const d of deudas) {
    if (!d.activa || d.saldo <= 0 || d.dia_pago === null) continue;
    const minimo = minimoEfectivo(d);
    if (minimo <= 0) continue;
    let veces = 0;
    for (let f = fechaDePago(d.dia_pago, hoy); f <= hasta; f = fechaDePago(d.dia_pago, sumarDias(f, 1))) veces++;
    total += Math.min(d.saldo, veces * minimo);
  }
  return total;
}

/** Días antes del día de ingreso en que un ingreso registrado ya cuenta como el de ese día (pago adelantado por festivos). */
export const VENTANA_INGRESO_ADELANTADO = 7;

/**
 * Fecha del próximo ingreso para un ingreso que entra una vez al mes el día `dia` (regla completa en tipos.ts → BaseHoy).
 * p = primer día de ingreso ≥ hoy; si ya hay un ingreso registrado entre p − 7 y hoy, el de p ya llegó → el siguiente.
 */
export function proximoIngreso(dia: number, hoy: ISODate, movs: Movimiento[]): ISODate {
  const p = fechaDePago(dia, hoy);
  const desde = sumarDias(p, -VENTANA_INGRESO_ADELANTADO);
  const llego = hoy >= desde && movs.some((m) => esIngreso(m) && m.fecha >= desde && m.fecha <= hoy);
  return llego ? fechaDePago(dia, sumarDias(p, 1)) : p;
}

/**
 * Límite por la plata real de las cuentas. null si no hay ninguna cuenta de efectivo o banco.
 * `hasta` = fecha del próximo ingreso (con dia_ingreso): divide entre los días hasta esa fecha y solo reserva lo que vence
 * antes. Sin `hasta`, todo es hasta fin de mes (dr) como siempre.
 */
function saldoReal(inst: Instantanea, hoy: ISODate, dr: number, base: BaseMensual, P: Pesos, hasta: ISODate | null) {
  const liquidas = (inst.cuentas ?? []).filter((c) => c.tipo === 'efectivo' || c.tipo === 'banco');
  if (liquidas.length === 0) return null;
  const grupos = new Set(liquidas.map((c) => c.tipo));
  const saldo_anotado = liquidas.reduce((s, c) => s + Math.max(0, c.saldo), 0);

  let ajuste = 0;
  let gastoHoyCuentas = 0;
  for (const m of inst.movimientos) {
    const cuentaGastoHoy = m.fecha === hoy && (esGastoVariable(m) || esReverso(m));
    for (const e of efectosLiquidos(m)) {
      if (!grupos.has(e.grupo)) continue;
      const c = cuentaDe(m, e.grupo, liquidas);
      if (c && esPosteriorA(m, c.actualizado_en)) ajuste += e.monto;
      if (cuentaGastoHoy) gastoHoyCuentas -= e.monto;
    }
  }
  const saldo_liquido = saldo_anotado + ajuste;
  const saldo_inicio_hoy = saldo_liquido + gastoHoyCuentas;

  const minimos_pendientes = hasta === null
    ? minimosPendientesMes(inst.deudas ?? [], hoy)
    : minimosPendientesHasta(inst.deudas ?? [], hoy, hasta);
  const comprometido = hasta === null
    ? P + fijosPendientes(inst.movimientos, inst.fijos, hoy)
    : comprometidoPendiente(inst.recurrentes, inst.fijos, hoy, hasta) + fijosPendientes(inst.movimientos, inst.fijos, hoy, hasta);
  const { desde } = rangoMes(mesDe(hoy));
  const aportes = inst.metas.reduce((s, mt) => s + mt.aportes.filter((a) => a.fecha >= desde && a.fecha <= hoy).reduce((x, a) => x + a.monto, 0), 0);
  const ahorro_pendiente = Math.max(0, Math.round((base.ingresos_recibidos * inst.config.pct_ahorro) / 100) - aportes);
  const disponible_saldo = saldo_inicio_hoy - minimos_pendientes - comprometido - ahorro_pendiente;
  const dias_hasta_ingreso = hasta === null ? null : diasEntre(hoy, hasta) + 1;
  const limite_saldo = disponible_saldo <= 0 ? 0 : Math.floor(disponible_saldo / (dias_hasta_ingreso ?? dr));

  let viejo: { dias: number; nombre: string } | null = null;
  for (const c of liquidas) {
    const t = instanteMs(c.actualizado_en);
    if (Number.isNaN(t)) continue;
    const dias = Math.max(0, diasEntre(aBogota(new Date(t)).fecha, hoy));
    if (!viejo || dias > viejo.dias) viejo = { dias, nombre: c.nombre };
  }
  return {
    saldo_anotado, saldo_liquido, saldo_inicio_hoy, minimos_pendientes, comprometido, ahorro_pendiente,
    disponible_saldo, limite_saldo, saldo_antiguo_dias: viejo?.dias ?? null, saldo_antiguo_cuenta: viejo?.nombre ?? null,
    hasta, dias_hasta_ingreso,
  };
}

// ---------------------------------------------------------------------------
// Ritmo y proyección (§3.3)
// ---------------------------------------------------------------------------

export function umbralAtipico(movs: Movimiento[], hoy: ISODate, cfg: ConfigPlata): Pesos {
  const desde = sumarDias(hoy, -90);
  const montos = movs.filter((m) => esGastoVariable(m) && enRango(m, desde, hoy)).map((m) => m.monto);
  if (montos.length < 10) return cfg.umbral_gasto_alto;
  return Math.max(cfg.umbral_gasto_alto, 3 * mediana(montos));
}

/** GN: gasto variable de un rango sin atípicos y sin movimientos ligados a un recurrente. */
function gastoNormal(movs: Movimiento[], desde: ISODate, hasta: ISODate, atipico: Pesos): Pesos {
  let t = 0;
  for (const m of movs) {
    if (!enRango(m, desde, hasta)) continue;
    if (esGastoVariable(m)) {
      if (m.monto > atipico || m.recurrente_id !== null) continue;
      t += m.monto;
    } else if (esReverso(m)) t -= m.monto;
  }
  return t;
}

export function calcularRitmo(inst: Instantanea, hoy: ISODate, base: BaseMensual): { ritmo: number; ritmo_mes: number | null; ritmo_reciente: number | null; ritmo_base: number } {
  const mes = mesDe(hoy);
  const D = diasDelMes(mes);
  const d = Number(hoy.slice(8, 10));
  const n = d - 1;
  const atipico = umbralAtipico(inst.movimientos, hoy, inst.config);
  const ayer = sumarDias(hoy, -1);

  const ritmo_mes = n >= 1 ? gastoNormal(inst.movimientos, `${mes}-01`, ayer, atipico) / n : null;

  let primera: ISODate | null = null;
  for (const m of inst.movimientos) if (primera === null || m.fecha < primera) primera = m.fecha;
  let c = 0;
  if (primera !== null) for (let k = 1; k <= 7; k++) if (sumarDias(hoy, -k) >= primera) c++;
  const ritmo_reciente = c > 0 ? gastoNormal(inst.movimientos, sumarDias(hoy, -7), ayer, atipico) / c : null;

  let ritmo_hist: number | null = null;
  if (base.meses_referencia.length > 0) {
    const xs = base.meses_referencia.map((r) => {
      const { desde, hasta } = rangoMes(r);
      return gastoNormal(inst.movimientos, desde, hasta, atipico) / diasDelMes(r);
    });
    ritmo_hist = xs.reduce((a, b) => a + b, 0) / xs.length;
  }
  const V = base.disponible_variable;
  const ritmo_base = ritmo_hist ?? (V !== null && V > 0 ? V / D : 0);
  const rec = ritmo_reciente ?? ritmo_mes;

  let ritmo: number;
  if (n === 0) ritmo = ritmo_base;
  else if (n < 7) ritmo = (n / 7) * (0.6 * (ritmo_mes ?? 0) + 0.4 * (rec ?? 0)) + (1 - n / 7) * ritmo_base;
  else ritmo = 0.5 * (ritmo_mes ?? 0) + 0.3 * (rec ?? 0) + 0.2 * ritmo_base;
  return { ritmo, ritmo_mes, ritmo_reciente, ritmo_base };
}

// ---------------------------------------------------------------------------
// Semáforo (§3.4)
// ---------------------------------------------------------------------------

const ORDEN_SEM: Record<'verde' | 'amarillo' | 'rojo', number> = { verde: 0, amarillo: 1, rojo: 2 };

/** La base de cálculo es una suposición de Plata, no algo que Jero configuró (ni ingreso ni presupuesto). */
export const baseEsEstimada = (b: Pick<BaseMensual, 'modo'>): boolean => b.modo === 'ingreso_estimado' || b.modo === 'gasto_historico';

/**
 * Entrada del semáforo. `base_hoy` y `ratio_de` son opcionales: sin ellos (o sin cuentas) se comporta como antes.
 * Con cuentas líquidas, el saldo es dato real: no se disfraza de «estimando», y si no alcanza para lo que falta pagar es rojo.
 */
export interface EntradaSemaforo {
  base: BaseMensual; limite_hoy: Pesos | null; gastado_hoy: Pesos; proyeccion_ratio: number | null;
  base_hoy?: Pick<BaseHoy, 'limita' | 'hay_cuentas' | 'disponible_saldo'> & Partial<Pick<BaseHoy, 'hasta'>>;
  ratio_de?: 'ingreso' | 'saldo';
}

export function calcularSemaforo(m: EntradaSemaforo, cfg: ConfigPlata): { semaforo: Semaforo; razon: string } {
  const r = semaforoCrudo(m, cfg);
  // No alarmar con datos supuestos: un rojo sobre una base estimada se muestra como «estimando».
  const estimada = m.base_hoy ? m.base_hoy.limita === 'estimado' : baseEsEstimada(m.base);
  return r.semaforo === 'rojo' && estimada ? { semaforo: 'estimando', razon: r.razon } : r;
}

function semaforoCrudo(m: EntradaSemaforo, cfg: ConfigPlata): { semaforo: Semaforo; razon: string } {
  const conSaldo = m.base_hoy?.hay_cuentas === true;
  if (m.base.modo === 'sin_datos' && !conSaldo) return { semaforo: 'gris', razon: 'Aún no hay con qué calcular' };
  const s = cfg.semaforo;
  const V = m.base.disponible_variable;
  const referencia = m.ratio_de === 'saldo' ? null : m.base.modo === 'gasto_historico' ? 'frente a tu gasto usual' : 'de lo que tienes para el mes';
  // Con cuentas, una base estimada no cuenta (manda el saldo); una configurada sí.
  const ingresoCuenta = m.base.modo !== 'sin_datos' && (!conSaldo || !baseEsEstimada(m.base));
  const plazo = m.base_hoy?.hasta ? 'antes de tu próximo ingreso' : 'antes de fin de mes';

  if (conSaldo && (m.base_hoy!.disponible_saldo ?? 0) <= 0) {
    return {
      semaforo: 'rojo',
      razon: m.base_hoy!.hasta
        ? 'La plata de tus cuentas no alcanza para lo que falta pagar antes de tu próximo ingreso'
        : 'La plata de tus cuentas no alcanza para lo que falta pagar este mes',
    };
  }
  if (ingresoCuenta && V !== null && V <= 0) return { semaforo: 'rojo', razon: 'Tus fijos y tu ahorro se comen el ingreso' };

  let dia: { nivel: 'verde' | 'amarillo' | 'rojo'; razon: string } | null = null;
  if (m.limite_hoy !== null) {
    if (m.limite_hoy === 0) dia = { nivel: 'rojo', razon: 'Hoy no te queda margen para gastar' };
    else {
      const r = m.gastado_hoy / m.limite_hoy;
      const nivel = r <= s.dia_amarillo ? 'verde' : r <= s.dia_rojo ? 'amarillo' : 'rojo';
      dia = { nivel, razon: `Hoy llevas ${formatearPct(r)} de tu límite` };
    }
  }
  let mes: { nivel: 'verde' | 'amarillo' | 'rojo'; razon: string } | null = null;
  if (m.proyeccion_ratio !== null) {
    const r = m.proyeccion_ratio;
    const nivel = r <= s.mes_amarillo ? 'verde' : r <= s.mes_rojo ? 'amarillo' : 'rojo';
    mes = {
      nivel,
      razon: referencia === null
        ? `A este ritmo gastarías ${formatearPct(r)} de la plata de tus cuentas ${plazo}`
        : `A este ritmo cierras el mes en ${formatearPct(r)} ${referencia}`,
    };
  }
  if (!dia && !mes) return { semaforo: 'gris', razon: 'Aún no hay con qué calcular' };
  if (!dia) return { semaforo: mes!.nivel, razon: mes!.razon };
  if (!mes) return { semaforo: dia.nivel, razon: dia.razon };
  // El peor manda; si empatan, la razón del mes.
  return ORDEN_SEM[dia.nivel] > ORDEN_SEM[mes.nivel]
    ? { semaforo: dia.nivel, razon: dia.razon }
    : { semaforo: mes.nivel, razon: mes.razon };
}

// ---------------------------------------------------------------------------
// Hormiga, nocturnas, anomalías (§3.9)
// ---------------------------------------------------------------------------

const esCompraOPago = (m: Movimiento) => m.tipo === 'compra' || m.tipo === 'pago';

export function calcularHormiga(inst: Instantanea, hoy: ISODate, gastado_mes: Pesos): Metricas['hormiga'] {
  const mes = mesDe(hoy);
  const D = diasDelMes(mes);
  const d = Number(hoy.slice(8, 10));
  const umbral = inst.config.umbral_hormiga;
  const catHormiga = new Set(inst.categorias.filter((c) => c.cuenta_hormiga).map((c) => c.id));
  const esHormiga = (m: Movimiento) => esGastoVariable(m) && esCompraOPago(m) && m.monto <= umbral && catHormiga.has(m.categoria_id);
  const lista = inst.movimientos.filter(esHormiga);

  const delMes = lista.filter((m) => enRango(m, `${mes}-01`, hoy));
  const total = delMes.reduce((s, m) => s + m.monto, 0);
  const porComercio = new Map<string, { comercio: string; total: Pesos; cantidad: number }>();
  for (const m of delMes) {
    const e = porComercio.get(m.comercio_norm) ?? { comercio: m.comercio, total: 0, cantidad: 0 };
    e.total += m.monto; e.cantidad += 1;
    porComercio.set(m.comercio_norm, e);
  }
  const top = [...porComercio.values()].sort((a, b) => b.total - a.total || b.cantidad - a.cantidad).slice(0, 3);
  const proyeccion_mes = Math.round((total / d) * D);

  const total_7d = lista.filter((m) => enRango(m, sumarDias(hoy, -6), hoy)).reduce((s, m) => s + m.monto, 0);
  const previas = lista.filter((m) => enRango(m, sumarDias(hoy, -34), sumarDias(hoy, -7))).reduce((s, m) => s + m.monto, 0);
  return {
    cantidad: delMes.length, total,
    pct_variable: gastado_mes > 0 ? total / gastado_mes : 0,
    top, proyeccion_mes, proyeccion_anual: proyeccion_mes * 12,
    total_7d, promedio_semanal_previo: Math.round(previas / 4),
  };
}

/** Rango nocturno que puede cruzar la medianoche. Sin hora no cuenta. */
export function esNocturna(hora: HoraHM | null, rango: { desde: HoraHM; hasta: HoraHM }): boolean {
  if (!hora) return false;
  if (rango.desde <= rango.hasta) return hora >= rango.desde && hora < rango.hasta;
  return hora >= rango.desde || hora < rango.hasta;
}

export function calcularNocturnas(inst: Instantanea, hoy: ISODate): Metricas['nocturnas'] {
  const noct = inst.movimientos.filter((m) => esGastoVariable(m) && esCompraOPago(m) && esNocturna(m.hora, inst.config.nocturno));
  const rango = (desde: ISODate) => noct.filter((m) => enRango(m, desde, hoy));
  const s7 = rango(sumarDias(hoy, -6));
  const mes = rango(`${mesDe(hoy)}-01`);
  return {
    cantidad_7d: s7.length, total_7d: s7.reduce((s, m) => s + m.monto, 0),
    cantidad_mes: mes.length, total_mes: mes.reduce((s, m) => s + m.monto, 0),
    cantidad_30d: rango(sumarDias(hoy, -29)).length,
  };
}

/**
 * Comercios genéricos: nombran un medio de pago, no un lugar (cada «Transferencia a cuenta» es a alguien distinto), así que
 * «monto raro» no tiene sentido contra su historial.
 */
const COMERCIOS_GENERICOS = new Set(
  ['Transferencia a cuenta', 'Transferencia', 'Pago por QR', 'Pago QR', 'Llave Bre-B', 'Llave', 'Pago', 'Compra', 'Retiro', 'Traslado', 'Otros', 'Sin nombre']
    .map((c) => normalizarComercio(c)),
);
export function esComercioGenerico(m: Pick<Movimiento, 'tipo' | 'comercio_norm'>): boolean {
  const c = m.comercio_norm;
  return m.tipo === 'transferencia' || !c || COMERCIOS_GENERICOS.has(c) || c.startsWith('transferencia ') || c.startsWith('llave ');
}

const minutosEntre = (a: Movimiento, b: Movimiento) =>
  Math.abs(deBogota(a.fecha, a.hora).getTime() - deBogota(b.fecha, b.hora).getTime()) / 60_000;

/**
 * Posible duplicado y monto inusual para los movimientos `objetivo`, mirando todo `movs`.
 * (El «gasto alto» depende de «hoy»; lo evalúa recomendar.ts.)
 */
export function detectarAnomalias(movs: Movimiento[], objetivo: Movimiento[], cfg: ConfigPlata, silenciadas: Set<string>): Anomalia[] {
  const res: Anomalia[] = [];
  const vistas = new Set<string>();
  const gastos = movs.filter((m) => m.sentido === 'salida' && m.computa);

  for (const o of objetivo) {
    if (!(o.sentido === 'salida' && o.computa)) continue;

    if (o.hora) {
      for (const x of gastos) {
        if (x.id === o.id || !x.hora || x.monto !== o.monto || x.comercio_norm !== o.comercio_norm) continue;
        const min = minutosEntre(o, x);
        if (min >= cfg.minutos_duplicado) continue;
        const a = Math.min(o.id, x.id);
        const b = Math.max(o.id, x.id);
        const clave = `posible_duplicado:${a}-${b}`;
        if (silenciadas.has(clave) || vistas.has(clave)) continue;
        vistas.add(clave);
        res.push({
          tipo: 'posible_duplicado', movimiento_id: b, otro_id: a,
          detalle: `${o.comercio}: dos cobros de ${formatearCOP(o.monto)} con ${Math.round(min)} min de diferencia`,
          cifras: { monto: o.monto, minutos: Math.round(min) },
        });
      }
    }

    if (esGastoVariable(o) && !esComercioGenerico(o) && !silenciadas.has(`monto_inusual:${o.id}`)) {
      const desde = sumarDias(o.fecha, -180);
      const previos = gastos.filter((x) =>
        x.id !== o.id && x.comercio_norm === o.comercio_norm && x.fecha >= desde &&
        (x.fecha < o.fecha || (x.fecha === o.fecha && x.id < o.id)));
      if (previos.length >= 3) {
        const med = mediana(previos.map((x) => x.monto));
        if (o.monto > 3 * med && o.monto - med >= 20_000) {
          res.push({
            tipo: 'monto_inusual', movimiento_id: o.id, otro_id: null,
            detalle: `${o.comercio}: ${formatearCOP(o.monto)} contra ${formatearCOP(Math.round(med))} usual`,
            cifras: { monto: o.monto, mediana: Math.round(med), veces: Math.round((o.monto / med) * 10) / 10 },
          });
        }
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Núcleo: límite del día, G, proyección. Lo comparten calcularMetricas y calcularDiasCerrados.
// ---------------------------------------------------------------------------

interface Nucleo {
  mes: Mes; D: number; d: number; dr: number;
  base: BaseMensual; G: Pesos; G_hoy: Pesos; G_antes: Pesos; P: Pesos;
  limite_hoy: Pesos | null; libre_hoy: Pesos | null; restante_mes: Pesos | null;
  base_hoy: BaseHoy;
}

/**
 * `conSaldo = false` (días cerrados): solo la base por ingreso, porque el saldo de días pasados no se puede reconstruir.
 * Con cuentas líquidas manda el menor de los dos límites (ver BaseHoy en tipos.ts); sin cuentas, igual que antes.
 */
function nucleo(inst: Instantanea, hoy: ISODate, P: Pesos, conSaldo = true): Nucleo {
  const mes = mesDe(hoy);
  const D = diasDelMes(mes);
  const d = Number(hoy.slice(8, 10));
  const dr = D - d + 1;
  const base = resolverBaseMensual(inst, hoy);
  const exceso = excesoFijos(inst.movimientos, inst.fijos, mes);
  const G_hoy = gastoVariableNeto(inst.movimientos, hoy, hoy);
  const G = gastoVariableNeto(inst.movimientos, `${mes}-01`, hoy) + exceso;
  const G_antes = G - G_hoy;
  const V = base.disponible_variable;
  const limite_ingreso = V === null ? null : Math.max(0, Math.floor((V - G_antes - P) / dr));
  const restante_ingreso = V === null ? null : V - G - P;

  let limite_hoy = limite_ingreso;
  let restante_mes = restante_ingreso;
  let limita: BaseHoy['limita'] = limite_ingreso === null ? null : baseEsEstimada(base) ? 'estimado' : 'ingreso';
  const diaIngreso = inst.config.dia_ingreso ?? null;
  const sr = conSaldo
    ? saldoReal(inst, hoy, dr, base, P, diaIngreso === null ? null : proximoIngreso(diaIngreso, hoy, inst.movimientos))
    : null;
  if (sr) {
    const restante_saldo = sr.disponible_saldo - G_hoy;
    // Una base estimada (ingreso promedio o gasto histórico) no compite con plata real: manda el saldo.
    if (limite_ingreso !== null && restante_ingreso !== null && !baseEsEstimada(base)) {
      limite_hoy = Math.min(limite_ingreso, sr.limite_saldo);
      restante_mes = Math.min(restante_ingreso, restante_saldo);
      limita = limite_ingreso < sr.limite_saldo ? 'ingreso' : 'saldo';
    } else {
      limite_hoy = sr.limite_saldo;
      restante_mes = restante_saldo;
      limita = 'saldo';
    }
  }
  const base_hoy: BaseHoy = {
    limita, hay_cuentas: sr !== null,
    saldo_anotado: sr?.saldo_anotado ?? 0, saldo_liquido: sr?.saldo_liquido ?? 0, saldo_inicio_hoy: sr?.saldo_inicio_hoy ?? 0,
    minimos_pendientes: sr?.minimos_pendientes ?? 0, comprometido: sr?.comprometido ?? 0, ahorro_pendiente: sr?.ahorro_pendiente ?? 0,
    disponible_saldo: sr?.disponible_saldo ?? null, limite_ingreso, limite_saldo: sr?.limite_saldo ?? null, dias_restantes: dr,
    saldo_antiguo_dias: sr?.saldo_antiguo_dias ?? null, saldo_antiguo_cuenta: sr?.saldo_antiguo_cuenta ?? null,
    hasta: sr?.hasta ?? null, dias_hasta_ingreso: sr?.dias_hasta_ingreso ?? null,
  };
  return {
    mes, D, d, dr, base, G, G_hoy, G_antes, P, limite_hoy,
    libre_hoy: limite_hoy === null ? null : limite_hoy - G_hoy,
    restante_mes, base_hoy,
  };
}

// ---------------------------------------------------------------------------
// Días cerrados y racha (§3.7)
// ---------------------------------------------------------------------------

export function calcularDiasCerrados(inst: Instantanea, desde: ISODate, hasta: ISODate): DiaCerrado[] {
  const res: DiaCerrado[] = [];
  const ordenados = [...inst.movimientos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (let x = desde; x <= hasta; x = sumarDias(x, 1)) {
    const movs = ordenados.filter((m) => m.fecha <= x);
    const sub: Instantanea = { ...inst, ahora: deBogota(x, '12:00'), movimientos: movs };
    const n = nucleo(sub, x, 0, false); // P = 0 y sin saldo: no se pueden reconstruir
    const gastado = Math.max(0, n.G_hoy);
    const bajo = n.limite_hoy === null ? null : n.limite_hoy > 0 ? gastado <= n.limite_hoy : gastado === 0;
    res.push({ fecha: x, limite: n.limite_hoy, gastado, bajo_limite: bajo, modo: n.base.modo });
  }
  return res;
}

export function calcularRacha(dias: DiaCerrado[], hoy: ISODate, libre_hoy: Pesos | null): Metricas['racha'] {
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  let racha = 0;
  for (let f = sumarDias(hoy, -1); porFecha.get(f)?.bajo_limite === true; f = sumarDias(f, -1)) racha++;

  let record = 0;
  let actual = 0;
  let previa: ISODate | null = null;
  for (const d of [...dias].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    if (d.bajo_limite === true) {
      actual = previa !== null && diasEntre(previa, d.fecha) === 1 ? actual + 1 : 1;
      record = Math.max(record, actual);
    } else actual = 0;
    previa = d.fecha;
  }
  return { dias: racha, record: Math.max(record, racha), hoy_bajo_limite: libre_hoy === null ? null : libre_hoy >= 0 };
}

// ---------------------------------------------------------------------------
// Score (§3.6)
// ---------------------------------------------------------------------------

export function calcularScore(inst: Instantanea, parcial: Omit<Metricas, 'score'>): Metricas['score'] {
  const cfg = inst.config;
  const hoy = parcial.fecha;
  const comp: ComponenteScore[] = [];
  const add = (id: string, nombre: string, peso: number, puntos: number | null, detalle: string) =>
    comp.push({ id, nombre, peso, puntos, detalle });

  // ritmo (30)
  if (parcial.proyeccion_ratio === null) add('ritmo', 'Ritmo del mes', 30, null, 'Sin base de cálculo');
  else add('ritmo', 'Ritmo del mes', 30, 30 * clamp((1.2 - parcial.proyeccion_ratio) / 0.3, 0, 1), `Proyección al ${formatearPct(parcial.proyeccion_ratio)} de lo disponible`);

  // ahorro real del mes pasado (20)
  {
    const { desde, hasta } = rangoMes(mesAnterior(parcial.mes));
    const delMes = inst.movimientos.filter((m) => enRango(m, desde, hasta));
    const ingresos = delMes.filter(esIngreso).reduce((s, m) => s + m.monto, 0);
    if (ingresos <= 0) add('ahorro', 'Ahorro del mes pasado', 20, null, 'Sin ingresos el mes pasado');
    else {
      const gastos = delMes.reduce((s, m) => s + (m.sentido === 'salida' && m.computa ? m.monto : m.tipo === 'reverso' && m.computa ? -m.monto : 0), 0);
      const tasa = (ingresos - gastos) / ingresos;
      const obj = Math.max(cfg.pct_ahorro, 5) / 100;
      add('ahorro', 'Ahorro del mes pasado', 20, 20 * clamp(tasa / obj, 0, 1), `Ahorraste ${formatearPct(tasa)} de tus ingresos`);
    }
  }

  // presupuestos por categoría (15)
  {
    const conPres = parcial.por_categoria.filter((c) => c.presupuesto !== null);
    if (conPres.length === 0) add('presupuestos', 'Categorías a tiempo', 15, null, 'Sin presupuestos por categoría');
    else {
      const tope = Math.min(1, (parcial.dia / parcial.dias_mes) * 1.1);
      const ok = conPres.filter((c) => c.gastado <= (c.presupuesto as number) * tope).length;
      add('presupuestos', 'Categorías a tiempo', 15, (15 * ok) / conPres.length, `${ok} de ${conPres.length} categorías van a tiempo`);
    }
  }

  // hormiga (10)
  {
    const p = parcial.gastado_mes > 0 ? parcial.hormiga.total / parcial.gastado_mes : 0;
    add('hormiga', 'Gasto hormiga', 10, parcial.gastado_mes <= 0 ? 10 : 10 * clamp((0.2 - p) / 0.15, 0, 1), `Los gastos pequeños son el ${formatearPct(p)} de tu gasto`);
  }

  // disciplina (10)
  {
    const cerrados = [...inst.dias].filter((d) => d.fecha < hoy && d.bajo_limite !== null).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 14);
    if (cerrados.length < 3) add('disciplina', 'Días bajo el límite', 10, null, 'Aún hay pocos días cerrados');
    else {
      const f = cerrados.filter((d) => d.bajo_limite === true).length / cerrados.length;
      add('disciplina', 'Días bajo el límite', 10, 10 * f, `${Math.round(f * cerrados.length)} de ${cerrados.length} días bajo el límite`);
    }
  }

  // metas (10)
  {
    const conFecha = inst.metas.filter((m) => m.estado === 'activa' && m.fecha_objetivo);
    if (conFecha.length === 0) add('metas', 'Metas al día', 10, null, 'Sin metas con fecha');
    else {
      const alDia = conFecha.filter((m) => metaAlDia(m, hoy)).length;
      add('metas', 'Metas al día', 10, (10 * alDia) / conFecha.length, `${alDia} de ${conFecha.length} metas al día`);
    }
  }

  // nocturnas (5)
  {
    const k = parcial.nocturnas.cantidad_30d;
    add('nocturnas', 'Compras nocturnas', 5, 5 * clamp((6 - k) / 6, 0, 1), `${k} compras nocturnas en 30 días`);
  }

  const ritmo = comp.find((c) => c.id === 'ritmo')!;
  if (ritmo.puntos === null) return { valor: null, nivel: null, componentes: comp };
  const presentes = comp.filter((c) => c.puntos !== null);
  const pesos = presentes.reduce((s, c) => s + c.peso, 0);
  const puntos = presentes.reduce((s, c) => s + (c.puntos as number), 0);
  const valor = Math.round((100 * puntos) / pesos);
  const nivel = valor >= 80 ? 'solida' : valor >= 60 ? 'bien' : valor >= 40 ? 'apretada' : 'riesgo';
  return { valor, nivel, componentes: comp };
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

function estadoCategorias(inst: Instantanea, mes: Mes, hoy: ISODate): EstadoCategoria[] {
  const res: EstadoCategoria[] = [];
  const ini = `${mes}-01`;
  const cats: Categoria[] = inst.categorias.filter((c) => c.es_gasto).sort((a, b) => a.orden - b.orden);
  for (const c of cats) {
    let gastado = 0;
    for (const m of inst.movimientos) {
      if (m.categoria_id !== c.id || !enRango(m, ini, hoy)) continue;
      if (esGastoVariable(m)) gastado += m.monto;
      else if (esReverso(m)) gastado -= m.monto;
    }
    const presupuesto = presupuestoCategoria(inst, mes, c.id);
    if (gastado === 0 && presupuesto === null) continue;
    let estado: EstadoCategoria['estado'] = 'sin_presupuesto';
    let pct: number | null = null;
    if (presupuesto !== null) {
      pct = gastado / presupuesto;
      estado = gastado > presupuesto ? 'pasado' : gastado >= 0.8 * presupuesto ? 'cerca' : 'ok';
    }
    res.push({ categoria_id: c.id, gastado, presupuesto, pct, estado });
  }
  return res;
}

export function calcularMetricas(inst: Instantanea): Metricas {
  const { fecha: hoy, hora } = aBogota(inst.ahora);
  const P = comprometidoPendiente(inst.recurrentes, inst.fijos, hoy);
  const n = nucleo(inst, hoy, P);
  const V = n.base.disponible_variable;

  const r = calcularRitmo(inst, hoy, n.base);
  const atipico = umbralAtipico(inst.movimientos, hoy, inst.config);
  const GN_hoy = gastoNormal(inst.movimientos, hoy, hoy, atipico);
  const proyeccion = Math.round(n.G + r.ritmo * (n.D - n.d) + Math.max(0, r.ritmo - GN_hoy) + P);
  // Ratio del mes. Por ingreso: proyección ÷ Vmes. Por saldo: lo que se proyecta gastar de hoy a fin de mes (o hasta el
  // próximo ingreso, con dia_ingreso) ÷ disponible_saldo (lo comprometido ya está restado ahí). Con cuentas manda el peor
  // de los dos; si la base es estimada, solo el de saldo.
  const bh = n.base_hoy;
  let ratio = V !== null && V > 0 ? proyeccion / V : null;
  let ratio_de: 'ingreso' | 'saldo' = 'ingreso';
  if (bh.hay_cuentas) {
    const ds = bh.disponible_saldo as number;
    const gastoPorVenir = bh.dias_hasta_ingreso === null
      ? proyeccion - n.G_antes - P
      : Math.round(n.G_hoy + r.ritmo * (bh.dias_hasta_ingreso - 1) + Math.max(0, r.ritmo - GN_hoy));
    const ratio_saldo = ds > 0 ? gastoPorVenir / ds : null;
    const ingresoCuenta = bh.limite_ingreso !== null && !baseEsEstimada(n.base);
    if (!ingresoCuenta || (ratio_saldo !== null && (ratio === null || ratio_saldo > ratio))) {
      ratio = ratio_saldo;
      ratio_de = 'saldo';
    }
  }
  const sem = calcularSemaforo({ base: n.base, limite_hoy: n.limite_hoy, gastado_hoy: n.G_hoy, proyeccion_ratio: ratio, base_hoy: bh, ratio_de }, inst.config);

  const hormiga = calcularHormiga(inst, hoy, n.G);
  const nocturnas = calcularNocturnas(inst, hoy);
  const racha = calcularRacha(inst.dias, hoy, n.libre_hoy);

  // Mes pasado a la misma fecha
  const mesPas = mesAnterior(n.mes);
  const hayMesPasado = inst.movimientos.some((m) => mesDe(m.fecha) === mesPas);
  let mes_pasado: Metricas['mes_pasado'] = null;
  if (hayMesPasado) {
    const diaTope = Math.min(n.d, diasDelMes(mesPas));
    const prev = gastoVariableNeto(inst.movimientos, `${mesPas}-01`, `${mesPas}-${String(diaTope).padStart(2, '0')}`);
    mes_pasado = { gastado_a_la_fecha: prev, diferencia: n.G - prev, ratio: prev > 0 ? n.G / prev : null };
  }

  const silenciadas = new Set(
    inst.emisiones.filter((e) => e.silenciada_hasta && new Date(e.silenciada_hasta).getTime() > inst.ahora.getTime()).map((e) => e.clave),
  );
  const objetivo = inst.movimientos.filter((m) => m.fecha >= sumarDias(hoy, -6) && m.fecha <= hoy);
  const anomalias = detectarAnomalias(inst.movimientos, objetivo, inst.config, silenciadas);

  // Saldos y deudas: colchón con el gasto diario completo (día a día + fijos + mínimos).
  const cuentas = inst.cuentas ?? [];
  const deudas = inst.deudas ?? [];
  const ritmo_diario = Math.round(r.ritmo);
  const saldos = resumenSaldos(cuentas, deudas, hoy, gastoDiarioTotal(ritmo_diario, n.base.fijos, minimosMes(deudas), n.D));

  const parcial: Omit<Metricas, 'score'> = {
    fecha: hoy, hora, mes: n.mes, dias_mes: n.D, dia: n.d, dias_restantes: n.dr,
    base: n.base, base_hoy: n.base_hoy,
    gastado_mes: n.G, gastado_hoy: n.G_hoy, comprometido_pendiente: P,
    limite_hoy: n.limite_hoy, libre_hoy: n.libre_hoy, restante_mes: n.restante_mes,
    ritmo_diario, proyeccion_fin_mes: proyeccion, proyeccion_ratio: ratio,
    semaforo: sem.semaforo, semaforo_razon: sem.razon,
    por_categoria: estadoCategorias(inst, n.mes, hoy),
    hormiga, nocturnas, racha, mes_pasado, anomalias, saldos,
  };
  return { ...parcial, score: calcularScore(inst, parcial) };
}

// ---------------------------------------------------------------------------
// Resumen de un periodo
// ---------------------------------------------------------------------------

export interface ResumenPeriodo {
  desde: ISODate; hasta: ISODate; gastado_variable: Pesos; gastado_fijos: Pesos; ingresos: Pesos;
  por_categoria: { categoria_id: string; total: Pesos; cantidad: number }[];
  top_comercios: { comercio: string; total: Pesos; cantidad: number }[];   // transferencias/ingresos agregados sin nombre propio
  mayor_gasto: Movimiento | null; cantidad: number;
}

/**
 * Totales de un periodo. `por_categoria` y `top_comercios` incluyen también los gastos ligados a fijos
 * (la suma de categorías = variable + fijos), con los reversos restando. Las transferencias se agregan
 * como «Transferencias enviadas» para no exponer nombres de personas.
 */
export function resumenPeriodo(inst: Instantanea, desde: ISODate, hasta: ISODate): ResumenPeriodo {
  const cats = new Map<string, { categoria_id: string; total: Pesos; cantidad: number }>();
  const comercios = new Map<string, { comercio: string; total: Pesos; cantidad: number }>();
  let gastado_variable = 0;
  let gastado_fijos = 0;
  let ingresos = 0;
  let cantidad = 0;
  let mayor: Movimiento | null = null;

  for (const m of inst.movimientos) {
    if (!enRango(m, desde, hasta)) continue;
    if (esIngreso(m)) { ingresos += m.monto; continue; }
    const gasto = m.sentido === 'salida' && m.computa;
    const reverso = m.tipo === 'reverso' && m.computa;
    if (!gasto && !reverso) continue;
    const signo = gasto ? 1 : -1;
    if (gasto) {
      if (m.fijo_id !== null) gastado_fijos += m.monto; else gastado_variable += m.monto;
      cantidad++;
      if (!mayor || m.monto > mayor.monto) mayor = m;
    } else if (m.fijo_id === null) gastado_variable -= m.monto;

    const c = cats.get(m.categoria_id) ?? { categoria_id: m.categoria_id, total: 0, cantidad: 0 };
    c.total += signo * m.monto; c.cantidad += gasto ? 1 : 0;
    cats.set(m.categoria_id, c);

    const clave = m.tipo === 'transferencia' ? 'transferencias' : m.comercio_norm || normalizarComercio(m.comercio);
    const nombre = m.tipo === 'transferencia' ? 'Transferencias enviadas' : m.comercio;
    const k = comercios.get(clave) ?? { comercio: nombre, total: 0, cantidad: 0 };
    k.total += signo * m.monto; k.cantidad += gasto ? 1 : 0;
    comercios.set(clave, k);
  }
  return {
    desde, hasta, gastado_variable, gastado_fijos, ingresos,
    por_categoria: [...cats.values()].sort((a, b) => b.total - a.total),
    top_comercios: [...comercios.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    mayor_gasto: mayor, cantidad,
  };
}
