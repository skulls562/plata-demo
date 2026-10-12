// Pegamento de las rutas /api/*: contexto (base, datos, reloj, IA), validación de cuerpos y los armados que
// comparten varias rutas (notificación de un aviso, estado, nota del vault). Las rutas quedan finas.
import type { DatabaseSync } from 'node:sqlite';
import { calcularMetricas } from './metricas';
import { conectarSeguridad } from './arranque';
import { resumenDe } from './consultas';
import { crearAccesoDatos } from './datos';
import { obtenerDB } from './db';
import { aBogota, formatearCOP, mesDe, rangoMes } from './formato';
import { ErrorHTTP, conAuth, obtenerEntorno, type Politica } from './http';
import { mensajeAviso } from './bot';
import { masUsadas } from './bot/comun';
import { crearClienteIA } from './ia';
import { evaluarReglas, filtrarParaPush, reglasDeMovimiento } from './recomendar';
import { presupuestosDe } from './panel';
import type { EntornoPlata } from './seguridad';
import { ErrorUsuario } from './tipos';
import type {
  AccesoDatos, Actor, Anomalia, ClienteIA, ISODate, Mes, Recomendacion, RespuestaBot, ResultadoAviso,
} from './tipos';
import type { NotaMensualExtra } from './vault';
import { notaMensual } from './vault';

export const VERSION_APP = '0.1.0';

// ---------------------------------------------------------------------------
// Dependencias de proceso (inyectables en pruebas)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __plataIA?: ClienteIA | null; __plataReloj?: (() => Date) | null };

/** Solo para pruebas (o para cambiar el cliente en caliente): null vuelve al cliente de Ollama por defecto. */
export function fijarClienteIA(ia: ClienteIA | null): void {
  g.__plataIA = ia;
}
export function fijarRelojApi(reloj: (() => Date) | null): void {
  g.__plataReloj = reloj;
}
let iaPorDefecto: { clave: string; cliente: ClienteIA } | null = null;
export function clienteIA(e: EntornoPlata): ClienteIA {
  if (g.__plataIA) return g.__plataIA;
  const clave = `${e.ollama_url}|${e.ollama_modelo}`;
  if (!iaPorDefecto || iaPorDefecto.clave !== clave) {
    iaPorDefecto = { clave, cliente: crearClienteIA({ url: e.ollama_url, modelo: e.ollama_modelo }) };
  }
  return iaPorDefecto.cliente;
}

export interface CtxApi {
  actor: Actor;
  entorno: EntornoPlata;
  params: Record<string, string>;
  db: DatabaseSync;
  datos: AccesoDatos;
  ahora: Date;
  ia: ClienteIA;
  hoy: ISODate;
}

/** conAuth + contexto. Convierte «no_encontrado» (ErrorUsuario) en 404, como pide §5.2. */
export function api(politica: Politica, handler: (req: Request, c: CtxApi) => Promise<Response>) {
  return conAuth(politica, async (req, c) => {
    conectarSeguridad();
    const db = obtenerDB();
    const ahora = g.__plataReloj ? g.__plataReloj() : new Date();
    const datos = crearAccesoDatos(db, () => (g.__plataReloj ? g.__plataReloj() : new Date()));
    try {
      return await handler(req, { ...c, db, datos, ahora, ia: clienteIA(c.entorno ?? obtenerEntorno()), hoy: aBogota(ahora).fecha });
    } catch (e) {
      if (e instanceof ErrorUsuario && e.codigo === 'no_encontrado') throw new ErrorHTTP(404, 'no_encontrado', e.message);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// Validación de entrada
// ---------------------------------------------------------------------------

export function validacion(mensaje: string, campo?: string): never {
  throw new ErrorHTTP(422, 'validacion', mensaje, campo ? { campo } : undefined);
}

/** El cuerpo debe ser un objeto con solo las claves permitidas. */
export function objeto(x: unknown, permitidas: readonly string[]): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) validacion('El cuerpo debe ser un objeto JSON');
  const o = x as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) validacion(`Campo no permitido: ${k.slice(0, 40)}`, k.slice(0, 40));
  return o;
}

export function idDe(valor: string | undefined): number {
  if (!valor || !/^\d{1,12}$/.test(valor)) throw new ErrorHTTP(404, 'no_encontrado', 'No encontrado');
  return Number(valor);
}

export function consulta(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function enteroConsulta(q: URLSearchParams, k: string): number | undefined {
  const v = q.get(k);
  if (v === null || v === '') return undefined;
  if (!/^\d{1,12}$/.test(v)) validacion(`${k} debe ser un entero`, k);
  return Number(v);
}

export const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export function mesConsulta(q: URLSearchParams, k: string, defecto: Mes): Mes {
  const v = q.get(k);
  if (v === null || v === '') return defecto;
  if (!RE_MES.test(v)) validacion(`${k} debe ser AAAA-MM`, k);
  return v;
}

// ---------------------------------------------------------------------------
// Notificación de un aviso (§4.2, §5.4)
// ---------------------------------------------------------------------------

const GLOBALES_DEL_AVISO = new Set(['limite_dia_superado', 'categoria_sobre_presupuesto', 'categoria_cerca_presupuesto', 'riesgo_fin_de_mes']);

/**
 * Mensaje de Telegram de un aviso nuevo: el movimiento + líneas propias (duplicado, monto raro, gasto alto, ingreso) +
 * como máximo 2 alertas globales que el movimiento acaba de disparar (con cooldown). Nunca lanza: si algo falla, [].
 * Devuelve también las anomalías completas (las de la regla de dedupe + las de metricas) para el resultado.
 */
export function armarNotificacion(c: CtxApi, r: ResultadoAviso, origen: 'aviso' | 'historial'): { notificar: RespuestaBot[]; anomalias: Anomalia[] } {
  const anomalias = r.estado === 'creado' ? [...r.anomalias] : [];
  if (origen === 'historial' || (r.estado !== 'creado' && r.estado !== 'por_revisar')) return { notificar: [], anomalias };
  try {
    const inst = c.datos.instantanea(c.ahora);
    const m = calcularMetricas(inst);
    let extra: Recomendacion[] = [];
    if (r.estado === 'creado') {
      for (const a of m.anomalias) {
        if (a.movimiento_id === r.movimiento.id && !anomalias.some((x) => x.tipo === a.tipo && x.otro_id === a.otro_id)) anomalias.push(a);
      }
      extra = reglasDeMovimiento(inst, m, r.movimiento, anomalias);
      const globales = filtrarParaPush(evaluarReglas(inst, m).filter((x) => GLOBALES_DEL_AVISO.has(x.regla)), inst.emisiones, c.ahora, inst.config)
        .enviar.slice(0, 2);
      if (globales.length) {
        c.datos.registrarEmisiones(globales, c.ahora);
        extra = [...extra, ...globales];
      }
    }
    const resultado: ResultadoAviso = r.estado === 'creado' ? { ...r, anomalias } : r;
    return { notificar: mensajeAviso(resultado, m, inst.categorias, extra, masUsadas(inst, 6)), anomalias };
  } catch {
    c.datos.registrarEvento({ nivel: 'error', tipo: 'notificacion_fallida' });
    return { notificar: [], anomalias };
  }
}

// ---------------------------------------------------------------------------
// Estado (§5.7)
// ---------------------------------------------------------------------------

const FLUJOS_VIVOS = ['ingesta', 'bot', 'reportes'] as const;
const LATIDO_CAIDO_MS = 30 * 60_000;

export async function armarEstado(c: CtxApi) {
  const n = (sql: string, ...p: (string | number)[]) => Number((c.db.prepare(sql).get(...p) as { n: number }).n);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const uv = Number((c.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const tamano = n('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()');
  const ult = (c.db.prepare('SELECT MAX(procesado_en) AS m FROM avisos_procesados').get() as { m: string | null }).m;
  const latidos: Record<string, string> = {};
  for (const l of c.db.prepare('SELECT flujo, ultimo_en FROM latidos').all() as { flujo: string; ultimo_en: string }[]) {
    latidos[String(l.flujo)] = String(l.ultimo_en);
  }
  const caidos = FLUJOS_VIVOS.filter((f) => {
    const t = latidos[f];
    return !t || c.ahora.getTime() - Date.parse(t) > LATIDO_CAIDO_MS;
  });
  const t0 = Date.now();
  let iaOk = false;
  try {
    iaOk = await c.ia.disponible();
  } catch {
    iaOk = false;
  }
  return {
    ok: true,
    version: VERSION_APP,
    db: { ok: true, user_version: uv, tamano_bytes: tamano },
    ultimo_aviso_en: ult,
    avisos_24h: n('SELECT count(*) AS n FROM avisos_procesados WHERE procesado_en >= ?', iso(new Date(c.ahora.getTime() - 86_400_000))),
    por_revisar_pendientes: n("SELECT count(*) AS n FROM por_revisar WHERE estado = 'pendiente'"),
    ia: { ok: iaOk, modelo: c.entorno.ollama_modelo, latencia_ms: Date.now() - t0 },
    latidos,
    caidos,
  };
}

// ---------------------------------------------------------------------------
// Nota mensual del vault (§7.9)
// ---------------------------------------------------------------------------

export function armarNotaMensual(c: CtxApi, mes: Mes): string {
  const inst = c.datos.instantanea(c.ahora);
  const { desde, hasta } = rangoMes(mes);
  const r = resumenDe(c.datos, inst, desde, hasta);
  const m = mes === mesDe(c.hoy) ? calcularMetricas(inst) : null;
  const ahorro = r.ingresos > 0 ? r.ingresos - r.gastado_variable - r.gastado_fijos : null;
  const gastadoPorCat = new Map(r.por_categoria.map((x) => [x.categoria_id, x.total]));
  const extra: NotaMensualExtra = {
    mes,
    generado_en: c.ahora.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    fijos: r.gastado_fijos,
    ahorro_real: ahorro,
    score: m?.score.valor ?? null,
    presupuestos: presupuestosDe(c.db, mes).items.map((p) => ({
      categoria_id: p.categoria_id, presupuesto: p.monto, gastado: gastadoPorCat.get(p.categoria_id) ?? 0,
    })),
    suscripciones: inst.recurrentes
      .filter((x) => x.activa && x.estado !== 'descartada' && x.clase === 'suscripcion')
      .map((x) => ({ nombre: x.nombre, monto: x.monto_tipico, periodo: x.periodo, costo_anual: x.costo_anual })),
    metas: inst.metas.map((x) => ({ nombre: x.nombre, objetivo: x.objetivo, aportado: x.aportado })),
    en_corto:
      `En ${mes} gastaste ${formatearCOP(r.gastado_variable)} en el día a día y ${formatearCOP(r.gastado_fijos)} en fijos; ` +
      `te entraron ${formatearCOP(r.ingresos)}.` + (ahorro !== null ? ` Ahorro real del mes: ${formatearCOP(ahorro)}.` : ''),
    categorias: inst.categorias,
  };
  return notaMensual(r, extra);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const PELIGROSAS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Celda de CSV: neutraliza fórmulas (prefijo ') y cita lo que lo necesite. */
export function celdaCSV(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (s.length > 0 && PELIGROSAS.has(s[0]) && typeof v !== 'number') s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

