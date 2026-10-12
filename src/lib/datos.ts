// Implementación real del puerto AccesoDatos sobre SQLite (SPEC §2.1, §2.2, §5.3).
// Todas las escrituras de usuario (bot/panel) quedan en `acciones` con el estado previo, para poder deshacerlas 24 h.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { huella, comercioPorDefecto } from './avisos/comun';
import { categorizar, patronAprendido } from './categorizar';
import { validarValorConfig } from './config';
import { crearCuenta, crearDeuda, editarCuenta, editarDeuda } from './cuentas-deudas';
import { aInstanteISO, enTransaccion } from './db';
import { aBogota, diasEntre, normalizarComercio, normalizarTexto, recortar, sumarDias } from './formato';
import { calcularDiasCerrados } from './metricas';
import {
  aMovimiento, COLUMNAS_MOV, insertarMovimiento, leerCategoriasDB, leerConfigDB, leerCuentasDB, leerDeudasDB, leerReglasDB, ligarFijo,
  obtenerMovimientoDB, registrarEventoDB, type Fila,
} from './repo';
import { enmascararDigitos } from './seguridad';
import { detectarRecurrentes, fusionarDeteccion } from './suscripciones';
import { ErrorConflicto, ErrorUsuario } from './tipos';
import type {
  AccesoDatos, Actor, AporteMeta, CambiosMovimiento, ConfigPlata, DescripcionDeshacer, DiaCerrado, EmisionPrevia,
  EstadoSistema, FiltroMovimientos, GastoFijo, HoraHM, Instantanea, ISODate, ItemEspera, Meta, MetaConAportes, Mes,
  Movimiento, NuevoMovimiento, PaginaMovimientos, Pesos, Recomendacion, Recurrente, TipoMovimiento,
} from './tipos';

const HORA_MS = 3_600_000;
const VENTANA_DESHACER_MS = 24 * HORA_MS;
const DIAS_INSTANTANEA = 400;
const ESTADO_BOT_MS = 15 * 60_000;
const MAX_PESOS = 10_000_000_000;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIPOS = ['compra', 'pago', 'retiro', 'transferencia', 'ingreso', 'reverso', 'pago_tarjeta', 'interno'] as const;
const BANCOS = ['bancolombia', 'wompi', 'pse', 'rappicard', 'didi', 'nequi', 'efectivo', 'otro'] as const;
const MEDIOS = ['debito', 'credito', 'cuenta', 'pse', 'efectivo', 'otro'] as const;
const ORIGENES = ['aviso', 'manual', 'historial'] as const;
const SENTIDOS = ['salida', 'entrada'] as const;

const num = (v: unknown) => Number(v);
const numONull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txtONull = (v: unknown) => (v === null || v === undefined ? null : String(v));

function invalido(msg: string): never {
  throw new ErrorUsuario('validacion', msg);
}
function noEncontrado(que: string): never {
  throw new ErrorUsuario('no_encontrado', `${que} no encontrado`);
}

function fechaReal(f: unknown, campo: string): ISODate {
  if (typeof f !== 'string' || !RE_FECHA.test(f)) invalido(`${campo} debe ser AAAA-MM-DD`);
  const [y, m, d] = f.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) invalido(`${campo} no es una fecha real`);
  return f;
}
function horaOk(h: unknown): HoraHM | null {
  if (h === null || h === undefined) return null;
  if (typeof h !== 'string' || !RE_HORA.test(h)) invalido('hora debe ser HH:MM');
  return h;
}
function montoOk(m: unknown, campo = 'monto'): Pesos {
  if (typeof m !== 'number' || !Number.isInteger(m) || m <= 0 || m > MAX_PESOS) invalido(`${campo} debe ser un entero positivo`);
  return m;
}
function enLista<T extends string>(v: unknown, lista: readonly T[], campo: string): T {
  if (typeof v !== 'string' || !(lista as readonly string[]).includes(v)) invalido(`${campo} inválido`);
  return v as T;
}
function comercioOk(s: unknown): string {
  if (typeof s !== 'string') invalido('comercio debe ser texto');
  const limpio = enmascararDigitos(s).replace(/\s+/g, ' ').trim();
  if (limpio.length < 1 || limpio.length > 120) invalido('comercio debe tener entre 1 y 120 caracteres');
  return limpio;
}
function notaOk(n: unknown): string | null {
  if (n === null || n === undefined || n === '') return null;
  if (typeof n !== 'string' || n.length > 280) invalido('nota debe tener máximo 280 caracteres');
  return n;
}

// ---------------------------------------------------------------------------
// Cursor (§5.3): base64url de ["AAAA-MM-DD","HH:MM",id]
// ---------------------------------------------------------------------------

export function codificarCursor(fecha: ISODate, hora: HoraHM | null, id: number): string {
  return Buffer.from(JSON.stringify([fecha, hora ?? '00:00', id]), 'utf8').toString('base64url');
}

export function decodificarCursor(c: string): { fecha: ISODate; hora: string; id: number } | null {
  if (typeof c !== 'string' || c.length === 0 || c.length > 200 || !/^[A-Za-z0-9_-]+$/.test(c)) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 3) return null;
    const [fecha, hora, id] = v;
    if (typeof fecha !== 'string' || !RE_FECHA.test(fecha) || Number.isNaN(Date.parse(fecha + 'T00:00:00Z'))) return null;
    if (typeof hora !== 'string' || !RE_HORA.test(hora)) return null;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null;
    return { fecha, hora, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Acciones y deshacer
// ---------------------------------------------------------------------------

type TipoAccion =
  | 'crear_movimiento' | 'editar_movimiento' | 'recategorizar' | 'borrar_movimiento' | 'fijar_presupuesto'
  | 'fijar_config' | 'aporte_meta' | 'guardar_fijo' | 'quitar_fijo';

const COLS_SNAP =
  'id, fecha, hora, tipo, sentido, monto, comercio, comercio_norm, categoria_id, categoria_fuente, computa, fijo_id, nota, huella, borrado_en';

function snapshots(db: DatabaseSync, ids: number[]): Fila[] {
  const st = db.prepare('SELECT ' + COLS_SNAP + ' FROM movimientos WHERE id = ?');
  const res: Fila[] = [];
  for (const id of ids) {
    const f = st.get(id) as Fila | undefined;
    if (f) res.push({ ...f });
  }
  return res;
}

function restaurarMovimientos(db: DatabaseSync, snaps: Fila[], ahoraISO: string): void {
  const up = db.prepare(
    `UPDATE movimientos SET fecha = ?, hora = ?, tipo = ?, sentido = ?, monto = ?, comercio = ?, comercio_norm = ?,
       categoria_id = ?, categoria_fuente = ?, computa = ?, fijo_id = ?, nota = ?, huella = ?, huella_seq = ?, borrado_en = ?,
       version = version + 1, actualizado_en = ? WHERE id = ?`,
  );
  for (const s of snaps) {
    const id = num(s.id);
    const h = String(s.huella);
    up.run(
      String(s.fecha), txtONull(s.hora), String(s.tipo), String(s.sentido), num(s.monto), String(s.comercio), String(s.comercio_norm),
      String(s.categoria_id), String(s.categoria_fuente), num(s.computa), numONull(s.fijo_id), txtONull(s.nota), h,
      siguienteSeq(db, h, id), txtONull(s.borrado_en), ahoraISO, id,
    );
  }
}

function siguienteSeq(db: DatabaseSync, h: string, exceptoId: number | null): number {
  const f = db
    .prepare('SELECT COALESCE(MAX(huella_seq), -1) + 1 AS s FROM movimientos WHERE huella = ? AND id <> ?')
    .get(h, exceptoId ?? -1) as Fila;
  return num(f.s);
}

function deshacerAccion(db: DatabaseSync, fila: Fila, ahora: Date): void {
  const antes = JSON.parse(String(fila.antes)) as Record<string, unknown>;
  const iso = aInstanteISO(ahora);
  const tipo = String(fila.tipo) as TipoAccion;
  switch (tipo) {
    case 'crear_movimiento':
      db.prepare('UPDATE movimientos SET borrado_en = ?, version = version + 1, actualizado_en = ? WHERE id = ?')
        .run(iso, iso, num(antes.id));
      break;
    case 'editar_movimiento':
    case 'borrar_movimiento':
      restaurarMovimientos(db, antes.movimientos as Fila[], iso);
      break;
    case 'recategorizar': {
      restaurarMovimientos(db, antes.movimientos as Fila[], iso);
      const r = antes.regla as { id: number; previa: { categoria_id: string; origen: string; aciertos: number } | null } | null;
      if (r) {
        if (r.previa === null) db.prepare('DELETE FROM reglas_categoria WHERE id = ?').run(r.id);
        else {
          db.prepare('UPDATE reglas_categoria SET categoria_id = ?, origen = ?, aciertos = ?, actualizada_en = ? WHERE id = ?')
            .run(r.previa.categoria_id, r.previa.origen, r.previa.aciertos, iso, r.id);
        }
      }
      break;
    }
    case 'fijar_presupuesto': {
      const mes = String(antes.mes);
      const cat = String(antes.categoria_id);
      if (antes.monto === null) db.prepare('DELETE FROM presupuestos WHERE mes = ? AND categoria_id = ?').run(mes, cat);
      else {
        db.prepare(
          `INSERT INTO presupuestos (mes, categoria_id, monto, actualizado_en) VALUES (?, ?, ?, ?)
           ON CONFLICT(mes, categoria_id) DO UPDATE SET monto = excluded.monto, actualizado_en = excluded.actualizado_en`,
        ).run(mes, cat, num(antes.monto), iso);
      }
      break;
    }
    case 'fijar_config': {
      const clave = String(antes.clave);
      if (antes.existia === false) db.prepare('DELETE FROM config WHERE clave = ?').run(clave);
      else {
        db.prepare(
          `INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)
           ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
        ).run(clave, String(antes.valor), iso);
      }
      break;
    }
    case 'aporte_meta':
      db.prepare('DELETE FROM aportes_meta WHERE id = ?').run(num(antes.aporte_id));
      break;
    case 'guardar_fijo': {
      const previo = antes.previo as Fila | null;
      if (previo === null) db.prepare('DELETE FROM gastos_fijos WHERE id = ?').run(num(antes.id));
      else {
        db.prepare(
          'UPDATE gastos_fijos SET nombre = ?, monto = ?, dia_mes = ?, patron = ?, categoria_id = ?, activo = ? WHERE id = ?',
        ).run(String(previo.nombre), num(previo.monto), numONull(previo.dia_mes), txtONull(previo.patron), String(previo.categoria_id), num(previo.activo), num(previo.id));
      }
      break;
    }
    case 'quitar_fijo':
      db.prepare('UPDATE gastos_fijos SET activo = 1 WHERE id = ?').run(num(antes.id));
      break;
  }
}

// ---------------------------------------------------------------------------
// Lectura de la instantánea
// ---------------------------------------------------------------------------

function aRecurrente(f: Fila, ids: number[]): Recurrente {
  const anual = num(f.costo_anual);
  return {
    id: num(f.id), comercio_norm: String(f.comercio_norm), nombre: String(f.nombre), categoria_id: String(f.categoria_id),
    clase: String(f.clase) as Recurrente['clase'], periodo: String(f.periodo) as Recurrente['periodo'],
    monto_tipico: num(f.monto_tipico), monto_anterior: numONull(f.monto_anterior), ocurrencias: num(f.ocurrencias),
    primer_cobro: String(f.primer_cobro), ultimo_cobro: String(f.ultimo_cobro), proximo_cobro: txtONull(f.proximo_cobro),
    activa: num(f.activa) === 1, costo_mensual: Math.round(anual / 12), costo_anual: anual, movimiento_ids: ids,
    estado: String(f.estado) as Recurrente['estado'],
  };
}

export function leerRecurrentes(db: DatabaseSync): Recurrente[] {
  const filas = db.prepare('SELECT * FROM recurrentes ORDER BY id').all() as Fila[];
  const porRec = new Map<number, number[]>();
  const enlaces = db
    .prepare('SELECT id, recurrente_id FROM movimientos WHERE recurrente_id IS NOT NULL AND borrado_en IS NULL ORDER BY id')
    .all() as Fila[];
  for (const e of enlaces) {
    const k = num(e.recurrente_id);
    if (!porRec.has(k)) porRec.set(k, []);
    porRec.get(k)!.push(num(e.id));
  }
  return filas.map((f) => aRecurrente(f, porRec.get(num(f.id)) ?? []));
}

export function aMeta(f: Fila): Meta {
  return {
    id: num(f.id), nombre: String(f.nombre), emoji: String(f.emoji), objetivo: num(f.objetivo),
    fecha_objetivo: txtONull(f.fecha_objetivo), estado: String(f.estado) as Meta['estado'], prioridad: num(f.prioridad),
    creada_en: String(f.creada_en),
  };
}

function aAporte(f: Fila): AporteMeta {
  return { id: num(f.id), meta_id: num(f.meta_id), fecha: String(f.fecha), monto: num(f.monto), nota: txtONull(f.nota) };
}

export function metaConAportes(db: DatabaseSync, f: Fila): MetaConAportes {
  const aportes = (db.prepare('SELECT * FROM aportes_meta WHERE meta_id = ? ORDER BY fecha, id').all(num(f.id)) as Fila[]).map(aAporte);
  return { ...aMeta(f), aportes, aportado: aportes.reduce((s, a) => s + a.monto, 0) };
}

export function aEspera(f: Fila): ItemEspera {
  return {
    id: num(f.id), descripcion: String(f.descripcion), monto: num(f.monto), categoria_id: String(f.categoria_id),
    creado_en: String(f.creado_en), disponible_en: String(f.disponible_en), estado: String(f.estado) as ItemEspera['estado'],
    recordado_en: txtONull(f.recordado_en),
  };
}

function aFijo(f: Fila): GastoFijo {
  return {
    id: num(f.id), nombre: String(f.nombre), monto: num(f.monto), dia_mes: numONull(f.dia_mes), patron: txtONull(f.patron),
    categoria_id: String(f.categoria_id), activo: num(f.activo) === 1,
  };
}

function leerSistema(db: DatabaseSync, ahora: Date): EstadoSistema {
  const iso = aInstanteISO(ahora);
  const desde90 = aInstanteISO(new Date(ahora.getTime() - 90 * 24 * HORA_MS));
  const ult = db.prepare('SELECT MAX(procesado_en) AS m FROM avisos_procesados').get() as Fila;
  const ventana = db.prepare('SELECT count(*) AS n, MIN(procesado_en) AS primero FROM avisos_procesados WHERE procesado_en >= ?').get(desde90) as Fila;
  let promedio = 0;
  if (num(ventana.n) > 0 && ventana.primero) {
    const dias = Math.min(90, Math.max(1, diasEntre(String(ventana.primero).slice(0, 10), iso.slice(0, 10)) + 1));
    promedio = num(ventana.n) / dias;
  }
  const rev = db.prepare("SELECT count(*) AS n, MIN(creado_en) AS viejo FROM por_revisar WHERE estado = 'pendiente'").get() as Fila;
  const latidos: EstadoSistema['latidos'] = {};
  for (const l of db.prepare('SELECT flujo, ultimo_en FROM latidos').all() as Fila[]) {
    latidos[String(l.flujo) as keyof EstadoSistema['latidos']] = String(l.ultimo_en);
  }
  const lim = db.prepare("SELECT bloqueado_hasta FROM limites WHERE clave = 'pin'").get() as Fila | undefined;
  const bloq = lim?.bloqueado_hasta ? String(lim.bloqueado_hasta) : null;
  return {
    ultimo_aviso_en: txtONull(ult.m), avisos_promedio_diario_90d: promedio, por_revisar_pendientes: num(rev.n),
    por_revisar_mas_viejo_en: txtONull(rev.viejo), latidos, pin_bloqueado_hasta: bloq && bloq > iso ? bloq : null,
  };
}

function leerInstantanea(db: DatabaseSync, ahora: Date): Instantanea {
  const hoy = aBogota(ahora).fecha;
  const desde = sumarDias(hoy, -DIAS_INSTANTANEA);
  const config: ConfigPlata = leerConfigDB(db);
  const movimientos = (
    db
      .prepare(
        'SELECT ' + COLUMNAS_MOV +
          ' FROM movimientos WHERE borrado_en IS NULL AND fecha >= ? AND fecha <= ? ORDER BY fecha, COALESCE(hora, \'00:00\'), id',
      )
      .all(desde, hoy) as Fila[]
  ).map(aMovimiento);
  const dias: DiaCerrado[] = (db.prepare('SELECT * FROM dias WHERE fecha >= ? ORDER BY fecha').all(desde) as Fila[]).map((d) => ({
    fecha: String(d.fecha), limite: numONull(d.limite), gastado: num(d.gastado),
    bajo_limite: d.bajo_limite === null ? null : num(d.bajo_limite) === 1, modo: String(d.modo) as DiaCerrado['modo'],
  }));
  const emisiones: EmisionPrevia[] = (db.prepare('SELECT * FROM emisiones').all() as Fila[]).map((e) => ({
    clave: String(e.clave), regla: String(e.regla) as EmisionPrevia['regla'], severidad: String(e.severidad) as EmisionPrevia['severidad'],
    valor_ref: e.valor_ref === null ? null : num(e.valor_ref), primera_en: String(e.primera_en), ultima_en: String(e.ultima_en),
    veces: num(e.veces), silenciada_hasta: txtONull(e.silenciada_hasta),
  }));
  return {
    ahora, config, categorias: leerCategoriasDB(db), reglas: leerReglasDB(db), movimientos,
    presupuestos: (db.prepare('SELECT mes, categoria_id, monto FROM presupuestos ORDER BY mes, categoria_id').all() as Fila[]).map((p) => ({
      mes: String(p.mes), categoria_id: String(p.categoria_id), monto: num(p.monto),
    })),
    fijos: (db.prepare('SELECT * FROM gastos_fijos WHERE activo = 1 ORDER BY id').all() as Fila[]).map(aFijo),
    recurrentes: leerRecurrentes(db),
    metas: (db.prepare("SELECT * FROM metas WHERE estado IN ('activa','pausada') ORDER BY prioridad, id").all() as Fila[]).map((m) => metaConAportes(db, m)),
    lista_espera: (db.prepare("SELECT * FROM lista_espera WHERE estado = 'esperando' ORDER BY id").all() as Fila[]).map(aEspera),
    dias, emisiones, sistema: leerSistema(db, ahora),
    cuentas: leerCuentasDB(db),
    deudas: leerDeudasDB(db),
  };
}

// ---------------------------------------------------------------------------
// Funciones exportadas fuera del puerto
// ---------------------------------------------------------------------------

/** Cierra (guarda la foto de) los días sin foto desde el primer movimiento hasta ayer. No recalcula los ya guardados. */
export function cerrarDiasPendientes(db: DatabaseSync, ahora: Date): void {
  const hoy = aBogota(ahora).fecha;
  const ayer = sumarDias(hoy, -1);
  const primero = (db.prepare('SELECT MIN(fecha) AS f FROM movimientos WHERE borrado_en IS NULL').get() as Fila).f;
  if (!primero) return;
  let desde = String(primero);
  const limite = sumarDias(hoy, -DIAS_INSTANTANEA);
  if (desde < limite) desde = limite;
  if (desde > ayer) return;

  const existentes = new Set(
    (db.prepare('SELECT fecha FROM dias WHERE fecha >= ? AND fecha <= ?').all(desde, ayer) as Fila[]).map((d) => String(d.fecha)),
  );
  let primeraFalta: ISODate | null = null;
  for (let x = desde; x <= ayer; x = sumarDias(x, 1)) {
    if (!existentes.has(x)) { primeraFalta = x; break; }
  }
  if (!primeraFalta) return;

  const inst = leerInstantanea(db, ahora);
  const calculados = calcularDiasCerrados(inst, primeraFalta, ayer);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO dias (fecha, limite, gastado, bajo_limite, modo, calculado_en) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const iso = aInstanteISO(ahora);
  enTransaccion(db, () => {
    for (const d of calculados) {
      ins.run(d.fecha, d.limite, Math.max(0, d.gastado), d.bajo_limite === null ? null : d.bajo_limite ? 1 : 0, d.modo, iso);
    }
  });
}

/** Detecta recurrentes y los guarda respetando el estado que Jero ya decidió; liga `recurrente_id` en los movimientos. */
export function refrescarRecurrentes(db: DatabaseSync, hoy: ISODate): void {
  const desde = sumarDias(hoy, -DIAS_INSTANTANEA);
  const movs = (
    db.prepare('SELECT ' + COLUMNAS_MOV + ' FROM movimientos WHERE borrado_en IS NULL AND fecha >= ? AND fecha <= ? ORDER BY fecha, id')
      .all(desde, hoy) as Fila[]
  ).map(aMovimiento);
  const cats = leerCategoriasDB(db);
  const detectados = detectarRecurrentes(movs, hoy, cats);
  const previos = leerRecurrentes(db);
  const { upserts, inactivar } = fusionarDeteccion(previos, detectados);
  const iso = aInstanteISO(new Date());

  enTransaccion(db, () => {
    const up = db.prepare(
      `INSERT INTO recurrentes (comercio_norm, nombre, categoria_id, clase, periodo, monto_tipico, monto_anterior, ocurrencias,
         primer_cobro, ultimo_cobro, proximo_cobro, activa, estado, costo_anual, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(comercio_norm) DO UPDATE SET nombre = excluded.nombre, categoria_id = excluded.categoria_id,
         clase = excluded.clase, periodo = excluded.periodo, monto_tipico = excluded.monto_tipico,
         monto_anterior = excluded.monto_anterior, ocurrencias = excluded.ocurrencias, primer_cobro = excluded.primer_cobro,
         ultimo_cobro = excluded.ultimo_cobro, proximo_cobro = excluded.proximo_cobro, activa = excluded.activa,
         costo_anual = excluded.costo_anual, actualizado_en = excluded.actualizado_en`,
    );
    db.prepare('UPDATE movimientos SET recurrente_id = NULL WHERE recurrente_id IS NOT NULL').run();
    const buscar = db.prepare('SELECT id FROM recurrentes WHERE comercio_norm = ?');
    const ligar = db.prepare('UPDATE movimientos SET recurrente_id = ? WHERE id = ?');
    for (const r of upserts) {
      up.run(
        r.comercio_norm, recortar(r.nombre, 120), r.categoria_id, r.clase, r.periodo, r.monto_tipico, r.monto_anterior, r.ocurrencias,
        r.primer_cobro, r.ultimo_cobro, r.proximo_cobro, r.activa ? 1 : 0, r.estado, r.costo_anual, iso,
      );
      const id = num((buscar.get(r.comercio_norm) as Fila).id);
      for (const mid of r.movimiento_ids) ligar.run(id, mid);
    }
    const off = db.prepare('UPDATE recurrentes SET activa = 0, actualizado_en = ? WHERE comercio_norm = ?');
    for (const n of inactivar) off.run(iso, n);
  });
}

export function registrarLatido(
  db: DatabaseSync, flujo: 'ingesta' | 'bot' | 'reportes' | 'historial', ahora: Date,
): void {
  db.prepare(
    `INSERT INTO latidos (flujo, ultimo_en) VALUES (?, ?)
     ON CONFLICT(flujo) DO UPDATE SET ultimo_en = excluded.ultimo_en`,
  ).run(flujo, aInstanteISO(ahora));
}

// ---------------------------------------------------------------------------
// Puerto AccesoDatos
// ---------------------------------------------------------------------------

export function crearAccesoDatos(db: DatabaseSync, reloj: () => Date = () => new Date()): AccesoDatos {
  const ahoraISO = () => aInstanteISO(reloj());

  function accion(actor: Actor, tipo: TipoAccion, entidad_id: number | null, antes: unknown, descripcion: string): number {
    const r = db
      .prepare('INSERT INTO acciones (ts, actor, tipo, entidad_id, antes, descripcion) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ahoraISO(), actor, tipo, entidad_id, JSON.stringify(antes), recortar(descripcion, 200));
    return Number(r.lastInsertRowid);
  }

  function categoriaExiste(id: unknown, soloGasto = false): string {
    if (typeof id !== 'string') invalido('categoria_id inválida');
    const c = db.prepare('SELECT es_gasto, activa FROM categorias WHERE id = ?').get(id) as Fila | undefined;
    if (!c || num(c.activa) !== 1) invalido('La categoría no existe');
    if (soloGasto && num(c.es_gasto) !== 1) invalido('La categoría no es de gasto');
    return id;
  }

  function cargar(id: number): Movimiento {
    const m = obtenerMovimientoDB(db, id);
    if (!m) noEncontrado('Movimiento');
    return m;
  }

  function coherencia(tipo: TipoMovimiento, sentido: string): void {
    if ((tipo === 'ingreso' || tipo === 'reverso') && sentido !== 'entrada') invalido('Un ingreso o reverso es una entrada');
    if (['compra', 'pago', 'retiro', 'transferencia', 'pago_tarjeta'].includes(tipo) && sentido !== 'salida') {
      invalido('Ese tipo de movimiento es una salida');
    }
  }

  function descripcionAccion(r: Fila): DescripcionDeshacer {
    return { accion_id: num(r.id), descripcion: String(r.descripcion) };
  }

  function ejecutarDeshacer(fila: Fila | undefined, ahora: Date): DescripcionDeshacer | null {
    if (!fila) return null;
    return enTransaccion(db, () => {
      deshacerAccion(db, fila, ahora);
      db.prepare('UPDATE acciones SET deshecha_en = ? WHERE id = ?').run(aInstanteISO(ahora), num(fila.id));
      return descripcionAccion(fila);
    });
  }

  const acceso: AccesoDatos = {
    instantanea(ahora) {
      cerrarDiasPendientes(db, ahora);
      return leerInstantanea(db, ahora);
    },

    ultimosMovimientos(n) {
      const lim = Math.max(1, Math.min(200, Math.floor(n) || 1));
      return (
        db.prepare(
          'SELECT ' + COLUMNAS_MOV + " FROM movimientos WHERE borrado_en IS NULL ORDER BY fecha DESC, COALESCE(hora, '00:00') DESC, id DESC LIMIT ?",
        ).all(lim) as Fila[]
      ).map(aMovimiento);
    },

    obtenerMovimiento: (id) => obtenerMovimientoDB(db, id),

    buscarMovimientos(f: FiltroMovimientos): PaginaMovimientos {
      const conds = ['borrado_en IS NULL'];
      const p: Record<string, SQLInputValue> = {};
      if (f.desde) { conds.push('fecha >= :desde'); p.desde = fechaReal(f.desde, 'desde'); }
      if (f.hasta) { conds.push('fecha <= :hasta'); p.hasta = fechaReal(f.hasta, 'hasta'); }
      if (f.categoria_id) { conds.push('categoria_id = :categoria_id'); p.categoria_id = String(f.categoria_id); }
      if (f.banco) { conds.push('banco = :banco'); p.banco = enLista(f.banco, BANCOS, 'banco'); }
      if (f.tipo) { conds.push('tipo = :tipo'); p.tipo = enLista(f.tipo, TIPOS, 'tipo'); }
      if (f.sentido) { conds.push('sentido = :sentido'); p.sentido = enLista(f.sentido, SENTIDOS, 'sentido'); }
      if (f.origen) { conds.push('origen = :origen'); p.origen = enLista(f.origen, ORIGENES, 'origen'); }
      if (f.q) {
        const q = normalizarTexto(f.q).slice(0, 60);
        if (q) {
          conds.push("comercio_norm LIKE :q ESCAPE '\\'");
          p.q = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
        }
      }
      if (f.min !== undefined) { conds.push('monto >= :min'); p.min = Math.floor(Number(f.min)); }
      if (f.max !== undefined) { conds.push('monto <= :max'); p.max = Math.floor(Number(f.max)); }
      if (f.cursor) {
        const c = decodificarCursor(f.cursor);
        if (!c) invalido('cursor inválido');
        conds.push("(fecha, COALESCE(hora, '00:00'), id) < (:cf, :ch, :ci)");
        p.cf = c.fecha; p.ch = c.hora; p.ci = c.id;
      }
      const limite = Math.max(1, Math.min(200, Math.floor(f.limite ?? 50) || 50));
      p.limite = limite + 1;
      // Las condiciones salen de una lista fija de fragmentos; los valores van siempre como parámetros.
      const sql =
        'SELECT ' + COLUMNAS_MOV + ' FROM movimientos WHERE ' + conds.join(' AND ') +
        " ORDER BY fecha DESC, COALESCE(hora, '00:00') DESC, id DESC LIMIT :limite";
      const filas = (db.prepare(sql).all(p) as Fila[]).map(aMovimiento);
      const hayMas = filas.length > limite;
      const items = hayMas ? filas.slice(0, limite) : filas;
      const ult = items[items.length - 1];
      return { items, siguiente_cursor: hayMas && ult ? codificarCursor(ult.fecha, ult.hora, ult.id) : null };
    },

    crearMovimiento(nuevo: NuevoMovimiento, actor) {
      return enTransaccion(db, () => {
        const fecha = fechaReal(nuevo.fecha, 'fecha');
        const hora = horaOk(nuevo.hora);
        const banco = enLista(nuevo.banco, BANCOS, 'banco');
        const tipo = enLista(nuevo.tipo, TIPOS, 'tipo');
        const sentido = enLista(nuevo.sentido, SENTIDOS, 'sentido');
        const origen = enLista(nuevo.origen, ORIGENES, 'origen');
        coherencia(tipo, sentido);
        const monto = montoOk(nuevo.monto);
        const comercio = comercioOk(nuevo.comercio);
        const nota = notaOk(nuevo.nota);
        const medio = nuevo.medio === null || nuevo.medio === undefined ? null : enLista(nuevo.medio, MEDIOS, 'medio');
        // Una transferencia que no escribió Jero a mano no es gasto hasta que él la marque; lo manual siempre cuenta.
        const computaPorDefecto = !(tipo === 'transferencia' && origen !== 'manual');
        const computa = tipo === 'pago_tarjeta' || tipo === 'interno' ? false : nuevo.computa !== undefined ? nuevo.computa !== false : computaPorDefecto;
        const comercio_norm = normalizarComercio(comercio);

        let categoria_id: string;
        let fuente: 'manual' | 'regla' | 'aprendida' | 'defecto';
        if (nuevo.categoria_id) {
          categoria_id = categoriaExiste(nuevo.categoria_id);
          fuente = 'manual';
        } else {
          const c = categorizar(comercio_norm, tipo, computa, leerReglasDB(db));
          categoria_id = c.categoria_id;
          fuente = c.fuente as typeof fuente;
        }
        const h = huella({ fecha, hora, monto, banco }, comercio_norm);
        const manual = origen === 'manual';
        const id = insertarMovimiento(db, {
          fecha, hora, banco, tipo, sentido, monto, comercio: comercio || comercioPorDefecto(tipo), comercio_norm, categoria_id,
          categoria_fuente: fuente, computa, fijo_id: computa && sentido === 'salida' ? ligarFijo(db, comercio_norm, monto) : null,
          medio, origen, confianza: manual ? 'manual' : 'regla', verificado: manual,
          ref_correo: manual ? null : 'api:' + randomUUID(), huella: h, huella_seq: siguienteSeq(db, h, null), nota,
          creado_en: ahoraISO(),
        });
        accion(actor, 'crear_movimiento', id, { id }, `Registraste ${comercio}`);
        return cargar(id);
      });
    },

    editarMovimiento(id, cambios: CambiosMovimiento, actor) {
      return enTransaccion(db, () => {
        const actual = cargar(id);
        if (cambios.version !== actual.version) throw new ErrorConflicto(actual.version);
        const antes = snapshots(db, [id]);

        const tipo = cambios.tipo !== undefined ? enLista(cambios.tipo, TIPOS, 'tipo') : actual.tipo;
        let sentido = cambios.sentido !== undefined ? enLista(cambios.sentido, SENTIDOS, 'sentido') : actual.sentido;
        if (cambios.tipo !== undefined && cambios.sentido === undefined && tipo !== 'interno') {
          sentido = tipo === 'ingreso' || tipo === 'reverso' ? 'entrada' : 'salida';
        }
        coherencia(tipo, sentido);
        const fecha = cambios.fecha !== undefined ? fechaReal(cambios.fecha, 'fecha') : actual.fecha;
        const hora = cambios.hora !== undefined ? horaOk(cambios.hora) : actual.hora;
        const monto = cambios.monto !== undefined ? montoOk(cambios.monto) : actual.monto;
        const comercio = cambios.comercio !== undefined ? comercioOk(cambios.comercio) : actual.comercio;
        const nota = cambios.nota !== undefined ? notaOk(cambios.nota) : actual.nota;
        let computa = cambios.computa !== undefined ? Boolean(cambios.computa) : actual.computa;
        if (tipo === 'pago_tarjeta' || tipo === 'interno') computa = false;
        let categoria_id = actual.categoria_id;
        let fuente = actual.categoria_fuente;
        if (cambios.categoria_id !== undefined) {
          categoria_id = categoriaExiste(cambios.categoria_id);
          fuente = 'manual';
        }
        // Al marcar una transferencia como gasto: se vuelve a categorizar (si la categoría no es manual) y a ligar con un fijo.
        const pasaAContar = computa && !actual.computa && sentido === 'salida';
        if (pasaAContar && cambios.categoria_id === undefined && fuente !== 'manual') {
          const c = categorizar(normalizarComercio(comercio), tipo, true, leerReglasDB(db));
          categoria_id = c.categoria_id;
          fuente = c.fuente;
        }
        let fijo_id = actual.fijo_id;
        if (pasaAContar && fijo_id === null && cambios.fijo_id === undefined) fijo_id = ligarFijo(db, normalizarComercio(comercio), monto);
        if (cambios.fijo_id !== undefined) {
          if (cambios.fijo_id !== null && !db.prepare('SELECT 1 AS x FROM gastos_fijos WHERE id = ?').get(cambios.fijo_id)) {
            invalido('El gasto fijo no existe');
          }
          fijo_id = cambios.fijo_id;
        }
        const comercio_norm = normalizarComercio(comercio);
        const h = huella({ fecha, hora, monto, banco: actual.banco }, comercio_norm);
        db.prepare(
          `UPDATE movimientos SET fecha = ?, hora = ?, tipo = ?, sentido = ?, monto = ?, comercio = ?, comercio_norm = ?,
             categoria_id = ?, categoria_fuente = ?, computa = ?, fijo_id = ?, nota = ?, huella = ?, huella_seq = ?,
             version = version + 1, actualizado_en = ? WHERE id = ?`,
        ).run(fecha, hora, tipo, sentido, monto, comercio, comercio_norm, categoria_id, fuente, computa ? 1 : 0, fijo_id, nota, h,
          siguienteSeq(db, h, id), ahoraISO(), id);
        accion(actor, 'editar_movimiento', id, { movimientos: antes }, `Editaste ${actual.comercio}`);
        return cargar(id);
      });
    },

    recategorizar(id, categoria_id, actor, opciones) {
      const aprender = opciones?.aprender !== false;
      return enTransaccion(db, () => {
        const actual = cargar(id);
        categoriaExiste(categoria_id);
        const otros = !aprender ? [] : (
          db.prepare(
            `SELECT id FROM movimientos WHERE borrado_en IS NULL AND id <> ? AND comercio_norm = ? AND computa = ?
               AND categoria_fuente <> 'manual' AND categoria_id <> ?`,
          ).all(id, actual.comercio_norm, actual.computa ? 1 : 0, categoria_id) as Fila[]
        ).map((f) => num(f.id));
        const antes = snapshots(db, [id, ...otros]);
        const iso = ahoraISO();

        // Regla aprendida (si el comercio da un patrón útil).
        let regla: { id: number; previa: { categoria_id: string; origen: string; aciertos: number } | null } | null = null;
        const patron = aprender && actual.computa ? patronAprendido(actual.comercio_norm) : null;
        if (patron) {
          const ex = db.prepare('SELECT id, categoria_id, origen, aciertos FROM reglas_categoria WHERE patron = ?').get(patron) as Fila | undefined;
          if (ex) {
            regla = { id: num(ex.id), previa: { categoria_id: String(ex.categoria_id), origen: String(ex.origen), aciertos: num(ex.aciertos) } };
            db.prepare("UPDATE reglas_categoria SET categoria_id = ?, origen = 'aprendida', aciertos = aciertos + 1, actualizada_en = ? WHERE id = ?")
              .run(categoria_id, iso, num(ex.id));
          } else {
            const r = db.prepare("INSERT INTO reglas_categoria (patron, categoria_id, origen, creada_en, actualizada_en) VALUES (?, ?, 'aprendida', ?, ?)")
              .run(patron, categoria_id, iso, iso);
            regla = { id: Number(r.lastInsertRowid), previa: null };
          }
        }
        const upOtro = db.prepare(
          "UPDATE movimientos SET categoria_id = ?, categoria_fuente = 'aprendida', version = version + 1, actualizado_en = ? WHERE id = ?",
        );
        for (const o of otros) upOtro.run(categoria_id, iso, o);
        db.prepare("UPDATE movimientos SET categoria_id = ?, categoria_fuente = 'manual', version = version + 1, actualizado_en = ? WHERE id = ?")
          .run(categoria_id, iso, id);
        accion(actor, 'recategorizar', id, { movimientos: antes, regla }, `Cambiaste la categoría de ${actual.comercio}`);
        return { movimiento: cargar(id), aplicados_a: otros.length };
      });
    },

    borrarMovimiento(id, actor) {
      return enTransaccion(db, () => {
        const actual = cargar(id);
        const antes = snapshots(db, [id]);
        const iso = ahoraISO();
        db.prepare('UPDATE movimientos SET borrado_en = ?, version = version + 1, actualizado_en = ? WHERE id = ?').run(iso, iso, id);
        return { accion_id: accion(actor, 'borrar_movimiento', id, { movimientos: antes }, `Ignoraste ${actual.comercio}`) };
      });
    },

    ultimaAccionDe(movimiento_id) {
      const f = db.prepare(
        "SELECT id FROM acciones WHERE entidad_id = ? AND deshecha_en IS NULL AND tipo IN ('crear_movimiento','editar_movimiento','recategorizar','borrar_movimiento') ORDER BY id DESC LIMIT 1",
      ).get(movimiento_id) as Fila | undefined;
      return f ? num(f.id) : null;
    },

    leerEstadoBot(chat_id, ahora) {
      const f = db.prepare('SELECT flujo, datos FROM bot_estado WHERE chat_id = ? AND expira_en > ?').get(chat_id, aInstanteISO(ahora)) as Fila | undefined;
      if (!f) return null;
      try {
        const datos = JSON.parse(String(f.datos)) as unknown;
        return datos && typeof datos === 'object' && !Array.isArray(datos) ? { flujo: String(f.flujo), datos: datos as Record<string, unknown> } : null;
      } catch { return null; }
    },

    guardarEstadoBot(chat_id, estado, ahora) {
      db.prepare(
        `INSERT INTO bot_estado (chat_id, flujo, datos, expira_en) VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET flujo = excluded.flujo, datos = excluded.datos, expira_en = excluded.expira_en`,
      ).run(chat_id.slice(0, 24), estado.flujo.slice(0, 24), JSON.stringify(estado.datos), aInstanteISO(new Date(ahora.getTime() + ESTADO_BOT_MS)));
    },

    borrarEstadoBot(chat_id) {
      db.prepare('DELETE FROM bot_estado WHERE chat_id = ?').run(chat_id);
    },

    deshacerUltima(_actor, ahora) {
      void _actor;
      const limite = aInstanteISO(new Date(ahora.getTime() - VENTANA_DESHACER_MS));
      const fila = db
        .prepare('SELECT * FROM acciones WHERE deshecha_en IS NULL AND ts >= ? ORDER BY id DESC LIMIT 1')
        .get(limite) as Fila | undefined;
      return ejecutarDeshacer(fila, ahora);
    },

    deshacer(accion_id, ahora) {
      const limite = aInstanteISO(new Date(ahora.getTime() - VENTANA_DESHACER_MS));
      const fila = db.prepare('SELECT * FROM acciones WHERE id = ? AND deshecha_en IS NULL AND ts >= ?').get(accion_id, limite) as Fila | undefined;
      return ejecutarDeshacer(fila, ahora);
    },

    listarCategorias: () => leerCategoriasDB(db),

    fijarPresupuesto(mes: Mes | '*', categoria_id, monto, actor) {
      enTransaccion(db, () => {
        if (mes !== '*') {
          if (typeof mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) invalido('mes debe ser AAAA-MM o *');
        }
        if (categoria_id !== '*') categoriaExiste(categoria_id, true);
        if (monto !== null && (typeof monto !== 'number' || !Number.isInteger(monto) || monto <= 0 || monto > MAX_PESOS)) {
          invalido('monto debe ser un entero positivo o null');
        }
        const prev = db.prepare('SELECT monto FROM presupuestos WHERE mes = ? AND categoria_id = ?').get(mes, categoria_id) as Fila | undefined;
        if (monto === null) db.prepare('DELETE FROM presupuestos WHERE mes = ? AND categoria_id = ?').run(mes, categoria_id);
        else {
          db.prepare(
            `INSERT INTO presupuestos (mes, categoria_id, monto, actualizado_en) VALUES (?, ?, ?, ?)
             ON CONFLICT(mes, categoria_id) DO UPDATE SET monto = excluded.monto, actualizado_en = excluded.actualizado_en`,
          ).run(mes, categoria_id, monto, ahoraISO());
        }
        accion(actor, 'fijar_presupuesto', null, { mes, categoria_id, monto: prev ? num(prev.monto) : null },
          monto === null ? `Quitaste un presupuesto` : `Fijaste un presupuesto`);
      });
    },

    leerConfig: () => leerConfigDB(db),

    fijarConfig(clave, valor, actor) {
      enTransaccion(db, () => {
        const v = validarValorConfig(clave, valor);
        const prev = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave) as Fila | undefined;
        db.prepare(
          `INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)
           ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
        ).run(clave, JSON.stringify(v), ahoraISO());
        accion(actor, 'fijar_config', null, { clave, existia: !!prev, valor: prev ? String(prev.valor) : null }, `Cambiaste ${clave}`);
      });
    },

    listarFijos: () => (db.prepare('SELECT * FROM gastos_fijos WHERE activo = 1 ORDER BY id').all() as Fila[]).map(aFijo),

    guardarFijo(f, actor) {
      return enTransaccion(db, () => {
        if (typeof f.nombre !== 'string') invalido('nombre debe ser texto');
        const nombre = f.nombre.replace(/\s+/g, ' ').trim();
        if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
        const nombre_norm = normalizarComercio(nombre);
        if (!nombre_norm) invalido('nombre debe tener letras');
        if (typeof f.monto !== 'number' || !Number.isInteger(f.monto) || f.monto <= 0 || f.monto > 1_000_000_000) invalido('monto inválido');
        if (f.dia_mes !== null && (!Number.isInteger(f.dia_mes) || f.dia_mes < 1 || f.dia_mes > 31)) invalido('día del mes inválido');
        let patron: string | null = null;
        if (f.patron !== null && f.patron !== undefined) {
          patron = normalizarComercio(f.patron);
          if (patron.length < 2 || patron.length > 60) invalido('patrón inválido');
        }
        const categoria_id = categoriaExiste(f.categoria_id ?? 'servicios');
        const previo = db.prepare('SELECT * FROM gastos_fijos WHERE nombre_norm = ?').get(nombre_norm) as Fila | undefined;
        let id: number;
        if (previo) {
          id = num(previo.id);
          db.prepare('UPDATE gastos_fijos SET nombre = ?, monto = ?, dia_mes = ?, patron = ?, categoria_id = ?, activo = 1 WHERE id = ?')
            .run(nombre, f.monto, f.dia_mes, patron, categoria_id, id);
        } else {
          id = Number(
            db.prepare('INSERT INTO gastos_fijos (nombre, nombre_norm, monto, dia_mes, patron, categoria_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(nombre, nombre_norm, f.monto, f.dia_mes, patron, categoria_id, ahoraISO()).lastInsertRowid,
          );
        }
        accion(actor, 'guardar_fijo', id, { id, previo: previo ? { ...previo } : null }, `Guardaste el fijo ${nombre}`);
        return aFijo(db.prepare('SELECT * FROM gastos_fijos WHERE id = ?').get(id) as Fila);
      });
    },

    quitarFijo(nombre, actor) {
      return enTransaccion(db, () => {
        const f = db.prepare('SELECT * FROM gastos_fijos WHERE nombre_norm = ? AND activo = 1').get(normalizarComercio(nombre)) as Fila | undefined;
        if (!f) return false;
        db.prepare('UPDATE gastos_fijos SET activo = 0 WHERE id = ?').run(num(f.id));
        accion(actor, 'quitar_fijo', num(f.id), { id: num(f.id) }, `Quitaste el fijo ${String(f.nombre)}`);
        return true;
      });
    },

    crearMeta(m) {
      return enTransaccion(db, () => {
        if (typeof m.nombre !== 'string') invalido('nombre debe ser texto');
        const nombre = m.nombre.replace(/\s+/g, ' ').trim();
        if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
        const nombre_norm = normalizarComercio(nombre);
        const objetivo = montoOk(m.objetivo, 'objetivo');
        const fecha = m.fecha_objetivo === null || m.fecha_objetivo === undefined ? null : fechaReal(m.fecha_objetivo, 'fecha_objetivo');
        const emoji = m.emoji && m.emoji.length <= 8 ? m.emoji : '🎯';
        if (db.prepare("SELECT 1 AS x FROM metas WHERE nombre_norm = ? AND estado IN ('activa','pausada')").get(nombre_norm)) {
          throw new ErrorUsuario('meta_existente', `Ya tienes una meta «${nombre}»`);
        }
        const id = Number(
          db.prepare('INSERT INTO metas (nombre, nombre_norm, emoji, objetivo, fecha_objetivo, creada_en) VALUES (?, ?, ?, ?, ?, ?)')
            .run(nombre, nombre_norm, emoji, objetivo, fecha, ahoraISO()).lastInsertRowid,
        );
        return aMeta(db.prepare('SELECT * FROM metas WHERE id = ?').get(id) as Fila);
      });
    },

    buscarMetaPorNombre(nombre) {
      const f = db
        .prepare("SELECT * FROM metas WHERE nombre_norm = ? AND estado IN ('activa','pausada')")
        .get(normalizarComercio(nombre)) as Fila | undefined;
      return f ? metaConAportes(db, f) : null;
    },

    aportarMeta(meta_id, monto, fecha, actor) {
      return enTransaccion(db, () => {
        const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(meta_id) as Fila | undefined;
        if (!meta) noEncontrado('Meta');
        fechaReal(fecha, 'fecha');
        if (typeof monto !== 'number' || !Number.isInteger(monto) || monto === 0 || Math.abs(monto) > MAX_PESOS) invalido('monto inválido');
        const saldo = num((db.prepare('SELECT COALESCE(SUM(monto), 0) AS s FROM aportes_meta WHERE meta_id = ?').get(meta_id) as Fila).s);
        if (saldo + monto < 0) throw new ErrorUsuario('saldo_negativo', 'No puedes sacar más de lo que llevas');
        const id = Number(
          db.prepare('INSERT INTO aportes_meta (meta_id, fecha, monto, creado_en) VALUES (?, ?, ?, ?)').run(meta_id, fecha, monto, ahoraISO()).lastInsertRowid,
        );
        accion(actor, 'aporte_meta', id, { aporte_id: id }, `${monto > 0 ? 'Aportaste a' : 'Sacaste de'} ${String(meta.nombre)}`);
        return aAporte(db.prepare('SELECT * FROM aportes_meta WHERE id = ?').get(id) as Fila);
      });
    },

    cambiarEstadoMeta(meta_id, estado) {
      return enTransaccion(db, () => {
        if (!['activa', 'pausada', 'cumplida', 'cancelada'].includes(estado)) invalido('estado inválido');
        const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(meta_id) as Fila | undefined;
        if (!meta) noEncontrado('Meta');
        if ((estado === 'activa' || estado === 'pausada') && !['activa', 'pausada'].includes(String(meta.estado))) {
          if (db.prepare("SELECT 1 AS x FROM metas WHERE nombre_norm = ? AND estado IN ('activa','pausada') AND id <> ?").get(String(meta.nombre_norm), meta_id)) {
            throw new ErrorUsuario('meta_existente', `Ya tienes una meta «${String(meta.nombre)}»`);
          }
        }
        db.prepare('UPDATE metas SET estado = ?, cumplida_en = ? WHERE id = ?').run(estado, estado === 'cumplida' ? ahoraISO() : null, meta_id);
        return aMeta(db.prepare('SELECT * FROM metas WHERE id = ?').get(meta_id) as Fila);
      });
    },

    agregarEspera(descripcion, monto, categoria_id, ahora) {
      return enTransaccion(db, () => {
        if (typeof descripcion !== 'string') invalido('descripción debe ser texto');
        const desc = descripcion.replace(/\s+/g, ' ').trim();
        if (desc.length < 1 || desc.length > 80) invalido('descripción debe tener entre 1 y 80 caracteres');
        montoOk(monto);
        categoriaExiste(categoria_id);
        const norm = normalizarComercio(desc);
        const ya = db.prepare("SELECT * FROM lista_espera WHERE descripcion_norm = ? AND estado = 'esperando'").get(norm) as Fila | undefined;
        if (ya) return aEspera(ya);
        const horas = leerConfigDB(db).horas_espera_impulso;
        const id = Number(
          db.prepare('INSERT INTO lista_espera (descripcion, descripcion_norm, monto, categoria_id, creado_en, disponible_en) VALUES (?, ?, ?, ?, ?, ?)')
            .run(desc, norm, monto, categoria_id, aInstanteISO(ahora), aInstanteISO(new Date(ahora.getTime() + horas * HORA_MS))).lastInsertRowid,
        );
        return aEspera(db.prepare('SELECT * FROM lista_espera WHERE id = ?').get(id) as Fila);
      });
    },

    actualizarEspera(id, accionEspera, ahora) {
      return enTransaccion(db, () => {
        const it = db.prepare("SELECT * FROM lista_espera WHERE id = ? AND estado = 'esperando'").get(id) as Fila | undefined;
        if (!it) return null;
        const iso = aInstanteISO(ahora);
        if (accionEspera === 'comprado' || accionEspera === 'descartado') {
          db.prepare('UPDATE lista_espera SET estado = ?, cerrado_en = ? WHERE id = ?').run(accionEspera, iso, id);
        } else if (accionEspera === 'extender') {
          const nueva = aInstanteISO(new Date(new Date(String(it.disponible_en)).getTime() + 48 * HORA_MS));
          db.prepare('UPDATE lista_espera SET disponible_en = ?, recordado_en = NULL WHERE id = ?').run(nueva, id);
        } else invalido('acción inválida');
        return aEspera(db.prepare('SELECT * FROM lista_espera WHERE id = ?').get(id) as Fila);
      });
    },

    marcarEsperaRecordada(ids, ahora) {
      const st = db.prepare('UPDATE lista_espera SET recordado_en = ? WHERE id = ?');
      enTransaccion(db, () => { for (const id of ids) st.run(aInstanteISO(ahora), id); });
    },

    cambiarEstadoRecurrente(id, estado) {
      if (estado !== 'confirmada' && estado !== 'descartada') invalido('estado inválido');
      const r = db.prepare('UPDATE recurrentes SET estado = ?, actualizado_en = ? WHERE id = ?').run(estado, ahoraISO(), id);
      if (Number(r.changes) === 0) return null;
      return leerRecurrentes(db).find((x) => x.id === id) ?? null;
    },

    registrarEmisiones(recs: Recomendacion[], ahora) {
      const iso = aInstanteISO(ahora);
      const st = db.prepare(
        `INSERT INTO emisiones (clave, regla, severidad, valor_ref, primera_en, ultima_en, veces)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(clave) DO UPDATE SET severidad = excluded.severidad, valor_ref = excluded.valor_ref,
           ultima_en = excluded.ultima_en, veces = veces + 1`,
      );
      enTransaccion(db, () => { for (const r of recs) st.run(r.id, r.regla, r.severidad, r.valor_ref, iso, iso); });
    },

    silenciar(clave, hasta) {
      const iso = ahoraISO();
      db.prepare(
        `INSERT INTO emisiones (clave, regla, severidad, primera_en, ultima_en, silenciada_hasta)
         VALUES (?, ?, 'info', ?, ?, ?)
         ON CONFLICT(clave) DO UPDATE SET silenciada_hasta = excluded.silenciada_hasta`,
      ).run(clave.slice(0, 120), clave.split(':')[0].slice(0, 60), iso, iso, hasta);
    },

    registrarEvento: (e) => registrarEventoDB(db, e),
    crearCuenta: (c, ahora) => crearCuenta(db, c, ahora),
    editarCuenta: (id, c, ahora) => editarCuenta(db, id, c, ahora),
    crearDeuda: (d, ahora) => crearDeuda(db, d, ahora),
    editarDeuda: (id, c, ahora) => editarDeuda(db, id, c, ahora),
  };
  return acceso;
}
