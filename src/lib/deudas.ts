// Motor de saldos y deudas (rediseño 2026-10-09, fase F1). TODO es puro y determinista: sin reloj, base ni red.
// Montos en pesos enteros; el interés de cada mes se redondea al peso. Ningún bucle pasa de TOPE_MESES.
// Son cálculos aproximados con lo que Jero anota: no es asesoría financiera (ver NOTA_ASESORIA).
import { diasDelMes, diasEntre, mesDe, sumarMeses } from './formato';
import type {
  ComparacionPlanes, Cuenta, Deuda, EstrategiaDeudas, ISODate, PlanDeudas, Pesos, ProximoVencimiento, ResumenSaldos,
  SoloMinimo,
} from './tipos';

/** 50 años: si a ese plazo la deuda no se acaba, se reporta «no se paga» (nunca hay bucle infinito). */
export const TOPE_MESES = 600;

export const NOTA_ASESORIA =
  'Cálculos aproximados con la tasa y el pago mínimo que anotaste; no es asesoría financiera. ' +
  'Tu banco puede cobrar seguros, cuota de manejo o un mínimo que cambia cada mes.';

// ---------------------------------------------------------------------------
// Tasas
// ---------------------------------------------------------------------------

/** % efectivo anual → tasa mensual equivalente (fracción). 28 % E.A. → 0,02078. Tasa ≤ 0 → 0. */
export function tasaMensual(tasa_ea: number): number {
  if (!(tasa_ea > 0) || !Number.isFinite(tasa_ea)) return 0;
  return Math.pow(1 + tasa_ea / 100, 1 / 12) - 1;
}

/** % mes vencido (como lo muestran muchos extractos) → % efectivo anual, con 2 decimales. 2 % M.V. → 26,82 % E.A. */
export function tasaEADesdeMensual(pct_mv: number): number {
  if (!(pct_mv > 0) || !Number.isFinite(pct_mv)) return 0;
  return Math.round((Math.pow(1 + pct_mv / 100, 12) - 1) * 10_000) / 100;
}

/** Interés de un mes sobre `saldo`, redondeado al peso. */
export function interesDelMes(saldo: Pesos, r: number): Pesos {
  return saldo > 0 && r > 0 ? Math.round(saldo * r) : 0;
}

/** Cuota fija para pagar `saldo` en `meses` cuotas (sistema francés), redondeada hacia arriba al peso. */
export function cuotaParaMeses(saldo: Pesos, tasa_ea: number, meses: number): Pesos {
  if (saldo <= 0) return 0;
  const n = Math.max(1, Math.floor(meses));
  const r = tasaMensual(tasa_ea);
  if (r === 0) return Math.ceil(saldo / n);
  return Math.ceil((saldo * r) / (1 - Math.pow(1 + r, -n)));
}

// ---------------------------------------------------------------------------
// Fechas de pago
// ---------------------------------------------------------------------------

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * Próxima fecha de pago (≥ hoy) para un día del mes. Si el mes no tiene ese día (31 en abril, 30 en febrero),
 * se toma el último día del mes.
 */
export function fechaDePago(dia_pago: number, hoy: ISODate): ISODate {
  const dia = Math.min(31, Math.max(1, Math.floor(dia_pago)));
  const mes = mesDe(hoy);
  const esteMes = `${mes}-${dos(Math.min(dia, diasDelMes(mes)))}`;
  if (esteMes >= hoy) return esteMes;
  return sumarMeses(`${mes}-01`, 1, dia);
}

const viva = (d: Deuda) => d.activa && d.saldo > 0;

/** Lo que de verdad se paga de mínimo este mes: nunca más que el saldo. */
export const minimoEfectivo = (d: Deuda): Pesos => Math.max(0, Math.min(d.pago_minimo, d.saldo));

export function minimosMes(deudas: Deuda[]): Pesos {
  return deudas.filter(viva).reduce((s, d) => s + minimoEfectivo(d), 0);
}

/** Deudas vivas con día de pago, con su próxima fecha y días que faltan; ordenadas por fecha. */
export function vencimientos(deudas: Deuda[], hoy: ISODate): ProximoVencimiento[] {
  return deudas
    .filter((d) => viva(d) && d.dia_pago !== null && minimoEfectivo(d) > 0)
    .map((d) => {
      const fecha = fechaDePago(d.dia_pago as number, hoy);
      return { deuda_id: d.id, nombre: d.nombre, fecha, dias: diasEntre(hoy, fecha), pago_minimo: minimoEfectivo(d) };
    })
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : b.pago_minimo - a.pago_minimo || a.deuda_id - b.deuda_id));
}

/**
 * Mínimos que todavía faltan este mes: deudas vivas con día de pago entre hoy (incluido) y el último día del mes.
 * El día 31 en un mes corto cae el último día (ver `fechaDePago`). Si el día ya pasó, se asume pagado y no cuenta;
 * las deudas sin día de pago tampoco (no se sabe cuándo vencen).
 */
export function minimosPendientesMes(deudas: Deuda[], hoy: ISODate): Pesos {
  const mes = mesDe(hoy);
  const fin = `${mes}-${dos(diasDelMes(mes))}`;
  return vencimientos(deudas, hoy).filter((v) => v.fecha <= fin).reduce((s, v) => s + v.pago_minimo, 0);
}

export function proximoVencimiento(deudas: Deuda[], hoy: ISODate): ProximoVencimiento | null {
  return vencimientos(deudas, hoy)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pagar solo el mínimo
// ---------------------------------------------------------------------------

/**
 * Simula pagar SOLO el mínimo fijo cada mes: primero se suma el interés del mes y luego se abona el mínimo.
 * Si el mínimo no supera el interés del primer mes, la deuda nunca baja: «no se paga» sin simular.
 */
export function simularSoloMinimo(d: Deuda): SoloMinimo {
  const r = tasaMensual(d.tasa_ea);
  const i1 = interesDelMes(d.saldo, r);
  const base = { deuda_id: d.id, nombre: d.nombre, interes_primer_mes: i1 };
  if (d.saldo <= 0) return { ...base, se_paga: true, meses: 0, intereses: 0, total_pagado: 0 };
  if (d.pago_minimo <= i1 || d.pago_minimo <= 0) return { ...base, se_paga: false, meses: null, intereses: null, total_pagado: null };

  let saldo = d.saldo;
  let intereses = 0;
  let pagado = 0;
  let meses = 0;
  while (saldo > 0 && meses < TOPE_MESES) {
    const i = interesDelMes(saldo, r);
    saldo += i;
    intereses += i;
    const pago = Math.min(d.pago_minimo, saldo);
    saldo -= pago;
    pagado += pago;
    meses++;
  }
  if (saldo > 0) return { ...base, se_paga: false, meses: null, intereses: null, total_pagado: null };
  return { ...base, se_paga: true, meses, intereses, total_pagado: pagado };
}

// ---------------------------------------------------------------------------
// Plan avalancha / bola de nieve
// ---------------------------------------------------------------------------

/** Orden de ataque: avalancha = mayor tasa primero; bola de nieve = menor saldo primero. Empates por id. */
export function ordenarDeudas(deudas: Deuda[], estrategia: EstrategiaDeudas): Deuda[] {
  return [...deudas].sort((a, b) =>
    estrategia === 'avalancha'
      ? b.tasa_ea - a.tasa_ea || a.saldo - b.saldo || a.id - b.id
      : a.saldo - b.saldo || b.tasa_ea - a.tasa_ea || a.id - b.id);
}

/**
 * Cada mes: 1) interés a todas, 2) mínimo a todas, 3) lo que sobre del pago mensual va a la primera viva del orden.
 * El pago mensual es fijo: cuando una deuda se acaba, su mínimo pasa a la siguiente («efecto bola de nieve»).
 * `pago_mensual` menor que la suma de mínimos se sube a esa suma.
 */
export function simularPlan(deudas: Deuda[], pago_mensual: Pesos | null, estrategia: EstrategiaDeudas): PlanDeudas {
  const orden = ordenarDeudas(deudas.filter(viva), estrategia);
  const minimos = orden.reduce((s, d) => s + minimoEfectivo(d), 0);
  const pago = Math.max(minimos, Math.max(0, Math.floor(pago_mensual ?? 0)));
  const estado = orden.map((d) => ({ d, saldo: d.saldo, r: tasaMensual(d.tasa_ea), mes_pagada: null as number | null }));
  const resultadoOrden = () => estado.map((e) => ({ deuda_id: e.d.id, nombre: e.d.nombre, mes_pagada: e.mes_pagada }));

  if (estado.length === 0) return { estrategia, pago_mensual: pago, se_paga: true, meses: 0, intereses: 0, orden: [] };

  let intereses = 0;
  for (let mes = 1; mes <= TOPE_MESES; mes++) {
    for (const e of estado) {
      const i = interesDelMes(e.saldo, e.r);
      e.saldo += i;
      intereses += i;
    }
    let disponible = pago;
    for (const e of estado) {
      if (e.saldo <= 0 || disponible <= 0) continue;
      const p = Math.min(e.d.pago_minimo, e.saldo, disponible);
      e.saldo -= p;
      disponible -= p;
    }
    for (const e of estado) {
      if (disponible <= 0) break;
      if (e.saldo <= 0) continue;
      const p = Math.min(e.saldo, disponible);
      e.saldo -= p;
      disponible -= p;
    }
    for (const e of estado) if (e.saldo <= 0 && e.mes_pagada === null) e.mes_pagada = mes;
    if (estado.every((e) => e.saldo <= 0)) {
      return { estrategia, pago_mensual: pago, se_paga: true, meses: mes, intereses, orden: resultadoOrden() };
    }
  }
  return { estrategia, pago_mensual: pago, se_paga: false, meses: null, intereses: null, orden: resultadoOrden() };
}

export function compararPlanes(deudas: Deuda[], pago_mensual: Pesos | null): ComparacionPlanes {
  const avalancha = simularPlan(deudas, pago_mensual, 'avalancha');
  const bola_nieve = simularPlan(deudas, pago_mensual, 'bola_nieve');
  const ambas = avalancha.intereses !== null && bola_nieve.intereses !== null;
  let recomendada: EstrategiaDeudas = 'avalancha';
  if (ambas) recomendada = (bola_nieve.intereses as number) < (avalancha.intereses as number) ? 'bola_nieve' : 'avalancha';
  else if (!avalancha.se_paga && bola_nieve.se_paga) recomendada = 'bola_nieve';
  return {
    avalancha, bola_nieve, recomendada,
    ahorro_intereses: ambas ? (bola_nieve.intereses as number) - (avalancha.intereses as number) : null,
  };
}

// ---------------------------------------------------------------------------
// Resumen para el panel
// ---------------------------------------------------------------------------

/** Gasto diario total: ritmo del día a día + (fijos + mínimos de deudas) repartidos en los días del mes. */
export function gastoDiarioTotal(ritmo_diario: Pesos, fijos_mes: Pesos, minimos_mes: Pesos, dias_mes: number): Pesos {
  const d = Math.max(1, dias_mes);
  return Math.max(0, Math.round(Math.max(0, ritmo_diario) + (Math.max(0, fijos_mes) + Math.max(0, minimos_mes)) / d));
}

/** Días que alcanza la plata de las cuentas si no entrara nada más. null sin gasto (no se divide por 0). */
export function colchonDias(saldo_liquido: Pesos, gasto_diario: Pesos): number | null {
  if (!(gasto_diario > 0)) return null;
  return Math.max(0, Math.floor(saldo_liquido / gasto_diario));
}

export function resumenSaldos(cuentas: Cuenta[], deudas: Deuda[], hoy: ISODate, gasto_diario: Pesos): ResumenSaldos {
  const activas = deudas.filter((d) => d.activa);
  const saldo_total = cuentas.reduce((s, c) => s + Math.max(0, c.saldo), 0);
  const deuda_total = activas.reduce((s, d) => s + Math.max(0, d.saldo), 0);
  const hay_cuentas = cuentas.length > 0;
  return {
    hay_cuentas,
    hay_deudas: activas.some((d) => d.saldo > 0),
    saldo_total,
    deuda_total,
    patrimonio_neto: saldo_total - deuda_total,
    minimos_mes: minimosMes(activas),
    proximo_vencimiento: proximoVencimiento(activas, hoy),
    gasto_diario,
    colchon_dias: hay_cuentas ? colchonDias(saldo_total, gasto_diario) : null,
  };
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** 1 → '1 mes'; 14 → '1 año y 2 meses'; 24 → '2 años'. */
export function mesesLegible(n: number): string {
  const a = Math.floor(n / 12);
  const m = n % 12;
  const tm = m === 1 ? '1 mes' : `${m} meses`;
  if (a === 0) return tm;
  const ta = a === 1 ? '1 año' : `${a} años`;
  return m === 0 ? ta : `${ta} y ${tm}`;
}

/** 28.5 → '28,5 %'. */
export function tasaLegible(tasa_ea: number): string {
  const r = Math.round(tasa_ea * 100) / 100;
  return `${String(r).replace('.', ',')} %`;
}
