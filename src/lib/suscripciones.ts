// Detección de cobros recurrentes (SPEC §3.8). Puro: recibe `hoy`, nunca lee el reloj.
import { diasEntre, mediana, sumarDias, sumarMeses } from './formato';
import { coincidePatron } from './metricas';
import type { Categoria, ISODate, Movimiento, Pesos, Periodo, Recurrente, RecurrenteDetectado } from './tipos';

interface Banda { periodo: Periodo; min: number; max: number }
// De la más corta a la más larga: la primera que encaje gana.
const BANDAS: Banda[] = [
  { periodo: 'semanal', min: 6, max: 8 },
  { periodo: 'quincenal', min: 12, max: 18 },
  { periodo: 'mensual', min: 26, max: 35 },
  { periodo: 'bimestral', min: 55, max: 66 },
  { periodo: 'trimestral', min: 84, max: 98 },
  { periodo: 'semestral', min: 170, max: 195 },
  { periodo: 'anual', min: 350, max: 380 },
];

const FACTOR_ANUAL: Record<Periodo, number> = { semanal: 52, quincenal: 24, mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 };
const MESES_PERIODO: Partial<Record<Periodo, number>> = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
const DIAS_PERIODO: Partial<Record<Periodo, number>> = { semanal: 7, quincenal: 15 };

// Patrones de suscripciones (semillas de SPEC §1.4, ya normalizados).
const SEMILLAS_SUSCRIPCION = [
  'netflix', 'spotify', 'disney', 'hbo', 'prime video', 'amazon prime', 'youtube', 'apple com', 'icloud', 'google one',
  'google play', 'chatgpt', 'openai', 'anthropic', 'claude ai', 'crunchyroll', 'paramount', 'deezer', 'canva', 'microsoft',
  'xbox', 'playstation', 'adobe', 'notion', 'github',
];

export function costoAnual(monto: Pesos, periodo: Periodo): Pesos {
  return monto * FACTOR_ANUAL[periodo];
}

export function costoMensual(monto: Pesos, periodo: Periodo): Pesos {
  return Math.round(costoAnual(monto, periodo) / 12);
}

/** Subió de precio (§3.8-12): más de 5 % y al menos $1.000. */
export function subioDePrecio(monto_tipico: Pesos, monto_anterior: Pesos | null): boolean {
  if (monto_anterior === null || monto_anterior <= 0) return false;
  return monto_tipico > monto_anterior * 1.05 && monto_tipico - monto_anterior >= 1_000;
}

/** Primer cobro esperado ≥ `hoy`, avanzando de a un periodo desde `ultimo`. */
export function proximoCobro(ultimo: ISODate, periodo: Periodo, diaPreferido: number | null, hoy: ISODate): ISODate {
  const dias = DIAS_PERIODO[periodo];
  const meses = MESES_PERIODO[periodo] ?? 1;
  const dia = diaPreferido ?? Number(ultimo.slice(8, 10));
  const paso = (k: number) => (dias ? sumarDias(ultimo, dias * k) : sumarMeses(ultimo, meses * k, dia));
  let k = 1;
  let p = paso(k);
  while (p < hoy && k < 5000) { k++; p = paso(k); }
  return p;
}

interface Ocurrencia { fecha: ISODate; monto: Pesos; ids: number[]; ultimo: Movimiento }

function periodoDe(intervalos: number[]): Periodo | null {
  for (const b of BANDAS) {
    let huecos = 0;
    const validos: number[] = [];
    for (const iv of intervalos) {
      if (iv >= 2 * b.min && iv <= 2 * b.max) huecos++;
      else validos.push(iv);
    }
    if (huecos > 1 || validos.length === 0) continue;
    const med = mediana(validos);
    if (med < b.min || med > b.max) continue;
    const dentro = validos.filter((iv) => iv >= b.min && iv <= b.max).length;
    if (dentro / validos.length >= 0.75) return b.periodo;
  }
  return null;
}

export function detectarRecurrentes(movs: Movimiento[], hoy: ISODate, cats: Categoria[]): RecurrenteDetectado[] {
  const desde = sumarDias(hoy, -400);
  const idsCat = new Set(cats.map((c) => c.id));
  const grupos = new Map<string, Movimiento[]>();
  for (const m of movs) {
    if (m.sentido !== 'salida' || !m.computa || !m.comercio_norm) continue;
    if (m.fecha < desde || m.fecha > hoy) continue;
    const g = grupos.get(m.comercio_norm) ?? [];
    g.push(m);
    grupos.set(m.comercio_norm, g);
  }

  const res: RecurrenteDetectado[] = [];
  for (const [comercio_norm, lista] of grupos) {
    // Cobros del mismo día = una sola ocurrencia.
    const porDia = new Map<ISODate, Ocurrencia>();
    for (const m of [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)) {
      const o = porDia.get(m.fecha);
      if (o) { o.monto += m.monto; o.ids.push(m.id); o.ultimo = m; }
      else porDia.set(m.fecha, { fecha: m.fecha, monto: m.monto, ids: [m.id], ultimo: m });
    }
    const ocs = [...porDia.values()];
    if (ocs.length < 2) continue;
    const ult = ocs[ocs.length - 1];
    const categoria = idsCat.has(ult.ultimo.categoria_id) ? ult.ultimo.categoria_id : 'otros';
    const esSusc = categoria === 'suscripciones' || SEMILLAS_SUSCRIPCION.some((p) => coincidePatron(comercio_norm, p));

    const intervalos: number[] = [];
    for (let i = 1; i < ocs.length; i++) intervalos.push(diasEntre(ocs[i - 1].fecha, ocs[i].fecha));

    if (ocs.length < 3) {
      const anual = ocs.length === 2 && intervalos[0] >= 350 && intervalos[0] <= 380 && categoria === 'suscripciones';
      if (!anual) continue;
    }
    const periodo = periodoDe(intervalos);
    if (!periodo) continue;

    // Monto
    const montos = ocs.map((o) => o.monto);
    const M = mediana(montos);
    const tol = Math.max(0.15 * M, 3_000);
    const dentro = montos.filter((x) => Math.abs(x - M) <= tol).length;
    if (dentro / montos.length < 0.75) continue;
    const monto_tipico = Math.round(Math.abs(ult.monto - M) <= tol ? ult.monto : M);
    const previos = montos.slice(0, -1);
    const monto_anterior = previos.length ? Math.round(mediana(previos)) : null;

    // Actividad y próximo cobro
    const banda = BANDAS.find((b) => b.periodo === periodo)!;
    const activa = diasEntre(ult.fecha, hoy) <= banda.max + (banda.max - banda.min);
    const dia = Math.max(...ocs.slice(-3).map((o) => Number(o.fecha.slice(8, 10))));
    const proximo = activa ? proximoCobro(ult.fecha, periodo, dia, hoy) : null;

    const clase: RecurrenteDetectado['clase'] = esSusc ? 'suscripcion' : periodo === 'semanal' || periodo === 'quincenal' ? 'habito' : 'fijo';
    res.push({
      comercio_norm, nombre: ult.ultimo.comercio, categoria_id: categoria, clase, periodo,
      monto_tipico, monto_anterior, ocurrencias: ocs.length,
      primer_cobro: ocs[0].fecha, ultimo_cobro: ult.fecha, proximo_cobro: proximo,
      activa, costo_mensual: costoMensual(monto_tipico, periodo), costo_anual: costoAnual(monto_tipico, periodo),
      movimiento_ids: ocs.flatMap((o) => o.ids),
    });
  }
  return res.sort((a, b) => b.costo_anual - a.costo_anual || a.comercio_norm.localeCompare(b.comercio_norm));
}

/** Cobros futuros esperados dentro de [desde, hasta] de recurrentes activos no descartados. Orden por fecha. */
export function cobrosEntre(recs: Recurrente[], desde: ISODate, hasta: ISODate): { recurrente: Recurrente; fecha: ISODate }[] {
  const res: { recurrente: Recurrente; fecha: ISODate }[] = [];
  for (const r of recs) {
    if (r.estado === 'descartada' || !r.activa || !r.proximo_cobro) continue;
    const dias = DIAS_PERIODO[r.periodo];
    const meses = MESES_PERIODO[r.periodo] ?? 1;
    const dia = Math.max(Number(r.proximo_cobro.slice(8, 10)), Number(r.ultimo_cobro.slice(8, 10)));
    for (let k = 0; k < 400; k++) {
      const fecha = k === 0 ? r.proximo_cobro : dias ? sumarDias(r.proximo_cobro, dias * k) : sumarMeses(r.proximo_cobro, meses * k, dia);
      if (fecha > hasta) break;
      if (fecha >= desde) res.push({ recurrente: r, fecha });
    }
  }
  return res.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.recurrente.id - b.recurrente.id);
}

/** Mezcla la detección nueva con lo persistido: conserva `estado`; lo que ya no aparece se inactiva (sin borrar). */
export function fusionarDeteccion(
  previos: Recurrente[],
  nuevos: RecurrenteDetectado[],
): { upserts: (RecurrenteDetectado & { estado: Recurrente['estado'] })[]; inactivar: string[] } {
  const porNorm = new Map(previos.map((p) => [p.comercio_norm, p]));
  const upserts = nuevos.map((n) => ({ ...n, estado: porNorm.get(n.comercio_norm)?.estado ?? ('detectada' as const) }));
  const vistos = new Set(nuevos.map((n) => n.comercio_norm));
  const inactivar = previos.filter((p) => p.activa && !vistos.has(p.comercio_norm)).map((p) => p.comercio_norm);
  return { upserts, inactivar };
}
