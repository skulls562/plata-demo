// Acceso SQL compartido entre datos.ts y avisos/procesar.ts (mapeadores, lecturas pequeñas, inserción de movimientos).
// Solo sentencias preparadas con parámetros. Las columnas dinámicas salen de listas fijas, nunca del usuario.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { mezclarConfig } from './config';
import { coincide } from './categorizar';
import { sanitizarDetalle } from './seguridad';
import type {
  Banco, Categoria, ConfigPlata, Confianza, Cuenta, Deuda, FuenteCategoria, Medio, Movimiento, NuevoEvento, OrigenMovimiento,
  ReglaCategoria, Sentido, TipoCuenta, TipoDeuda, TipoMovimiento,
} from './tipos';

/** Instante actual del reloj del sistema en formato de la base (solo como último recurso). */
function ahoraISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type Fila = Record<string, unknown>;

export const COLUMNAS_MOV =
  'id, fecha, hora, banco, tipo, sentido, monto, comercio, comercio_norm, categoria_id, categoria_fuente, computa, ' +
  'fijo_id, recurrente_id, medio, origen, confianza, verificado, ref_correo, nota, creado_en, actualizado_en, version';

const num = (v: unknown): number => Number(v);
const numONull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txtONull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Fila de `cuentas` → Cuenta. */
export function aCuenta(f: Fila): Cuenta {
  return {
    id: num(f.id), nombre: String(f.nombre), tipo: String(f.tipo) as TipoCuenta, saldo: num(f.saldo),
    creado_en: String(f.creado_en), actualizado_en: String(f.actualizado_en),
  };
}

/** Fila de `deudas` → Deuda (0/1 → boolean). */
export function aDeuda(f: Fila): Deuda {
  return {
    id: num(f.id), nombre: String(f.nombre), tipo: String(f.tipo) as TipoDeuda, saldo: num(f.saldo),
    tasa_ea: num(f.tasa_ea), pago_minimo: num(f.pago_minimo), dia_pago: numONull(f.dia_pago), activa: num(f.activa) === 1,
    creado_en: String(f.creado_en), actualizado_en: String(f.actualizado_en),
  };
}

export const COLUMNAS_CUENTA = 'id, nombre, tipo, saldo, creado_en, actualizado_en';
export const COLUMNAS_DEUDA = 'id, nombre, tipo, saldo, tasa_ea, pago_minimo, dia_pago, activa, creado_en, actualizado_en';

export function leerCuentasDB(db: DatabaseSync): Cuenta[] {
  return (db.prepare('SELECT ' + COLUMNAS_CUENTA + ' FROM cuentas ORDER BY id').all() as Fila[]).map(aCuenta);
}

export function leerDeudasDB(db: DatabaseSync, incluirInactivas = false): Deuda[] {
  const sql = 'SELECT ' + COLUMNAS_DEUDA + ' FROM deudas' + (incluirInactivas ? '' : ' WHERE activa = 1') + ' ORDER BY activa DESC, id';
  return (db.prepare(sql).all() as Fila[]).map(aDeuda);
}

/** Fila de `movimientos` → Movimiento (objeto plano, 0/1 → boolean). */
export function aMovimiento(f: Fila): Movimiento {
  return {
    id: num(f.id),
    fecha: String(f.fecha),
    hora: txtONull(f.hora),
    banco: String(f.banco) as Banco,
    tipo: String(f.tipo) as TipoMovimiento,
    sentido: String(f.sentido) as Sentido,
    monto: num(f.monto),
    comercio: String(f.comercio),
    comercio_norm: String(f.comercio_norm),
    categoria_id: String(f.categoria_id),
    categoria_fuente: String(f.categoria_fuente) as FuenteCategoria,
    computa: num(f.computa) === 1,
    fijo_id: numONull(f.fijo_id),
    recurrente_id: numONull(f.recurrente_id),
    medio: txtONull(f.medio) as Medio | null,
    origen: String(f.origen) as OrigenMovimiento,
    confianza: String(f.confianza) as Confianza,
    verificado: num(f.verificado) === 1,
    ref_correo: txtONull(f.ref_correo),
    nota: txtONull(f.nota),
    creado_en: String(f.creado_en),
    actualizado_en: String(f.actualizado_en),
    version: num(f.version),
  };
}

export function obtenerMovimientoDB(db: DatabaseSync, id: number): Movimiento | null {
  const f = db.prepare('SELECT ' + COLUMNAS_MOV + ' FROM movimientos WHERE id = ? AND borrado_en IS NULL').get(id) as Fila | undefined;
  return f ? aMovimiento(f) : null;
}

export function leerConfigDB(db: DatabaseSync): ConfigPlata {
  const filas = db.prepare('SELECT clave, valor FROM config').all() as { clave: string; valor: string }[];
  return mezclarConfig(filas.map((f) => ({ clave: String(f.clave), valor: String(f.valor) })));
}

export function aCategoria(f: Fila): Categoria {
  return {
    id: String(f.id), nombre: String(f.nombre), emoji: String(f.emoji),
    es_gasto: num(f.es_gasto) === 1, esencial: num(f.esencial) === 1, cuenta_hormiga: num(f.cuenta_hormiga) === 1,
    orden: num(f.orden), sistema: num(f.sistema) === 1, activa: num(f.activa) === 1,
  };
}

export function leerCategoriasDB(db: DatabaseSync): Categoria[] {
  return (db.prepare('SELECT * FROM categorias ORDER BY orden, id').all() as Fila[]).map(aCategoria);
}

export function aRegla(f: Fila): ReglaCategoria {
  return {
    id: num(f.id), patron: String(f.patron), categoria_id: String(f.categoria_id),
    origen: String(f.origen) as ReglaCategoria['origen'], aciertos: num(f.aciertos),
  };
}

export function leerReglasDB(db: DatabaseSync): ReglaCategoria[] {
  return (db.prepare('SELECT id, patron, categoria_id, origen, aciertos FROM reglas_categoria ORDER BY id').all() as Fila[]).map(aRegla);
}

/** Bitácora sin datos sensibles (enmascara dígitos y recorta). */
export function registrarEventoDB(db: DatabaseSync, e: NuevoEvento): void {
  db.prepare('INSERT INTO eventos (nivel, tipo, detalle, ref) VALUES (?, ?, ?, ?)').run(
    e.nivel,
    sanitizarDetalle(e.tipo, 40),
    e.detalle === undefined ? null : sanitizarDetalle(e.detalle, 500),
    e.ref === undefined ? null : sanitizarDetalle(e.ref, 80),
  );
}

/** Gasto fijo al que se liga un movimiento nuevo: patrón coincide y monto a ±25 % (§3.1). */
export function ligarFijo(db: DatabaseSync, comercio_norm: string, monto: number): number | null {
  const fijos = db.prepare('SELECT id, monto, patron FROM gastos_fijos WHERE activo = 1 AND patron IS NOT NULL ORDER BY id').all() as Fila[];
  for (const f of fijos) {
    const m = num(f.monto);
    if (coincide(comercio_norm, String(f.patron)) && Math.abs(monto - m) <= 0.25 * m) return num(f.id);
  }
  return null;
}

export interface FilaNuevoMovimiento {
  fecha: string; hora: string | null; banco: Banco; tipo: TipoMovimiento; sentido: Sentido; monto: number;
  comercio: string; comercio_norm: string; categoria_id: string; categoria_fuente: FuenteCategoria; computa: boolean;
  fijo_id: number | null; medio: Medio | null; origen: OrigenMovimiento; confianza: Confianza; verificado: boolean;
  ref_correo: string | null; huella: string; huella_seq: number; nota: string | null;
  /** Instante de creación (reloj inyectado); si falta, el de la base. */
  creado_en?: string;
}

/** Inserta un movimiento y devuelve su id. */
export function insertarMovimiento(db: DatabaseSync, f: FilaNuevoMovimiento): number {
  const p: Record<string, SQLInputValue> = {
    fecha: f.fecha, hora: f.hora, banco: f.banco, tipo: f.tipo, sentido: f.sentido, monto: f.monto,
    comercio: f.comercio, comercio_norm: f.comercio_norm, categoria_id: f.categoria_id, categoria_fuente: f.categoria_fuente,
    computa: f.computa ? 1 : 0, fijo_id: f.fijo_id, medio: f.medio, origen: f.origen, confianza: f.confianza,
    verificado: f.verificado ? 1 : 0, ref_correo: f.ref_correo, huella: f.huella, huella_seq: f.huella_seq, nota: f.nota,
    creado_en: f.creado_en ?? ahoraISO(),
  };
  const r = db
    .prepare(
      `INSERT INTO movimientos (fecha, hora, banco, tipo, sentido, monto, comercio, comercio_norm, categoria_id,
         categoria_fuente, computa, fijo_id, medio, origen, confianza, verificado, ref_correo, huella, huella_seq, nota, creado_en, actualizado_en)
       VALUES (:fecha, :hora, :banco, :tipo, :sentido, :monto, :comercio, :comercio_norm, :categoria_id,
         :categoria_fuente, :computa, :fijo_id, :medio, :origen, :confianza, :verificado, :ref_correo, :huella, :huella_seq, :nota, :creado_en, :creado_en)`,
    )
    .run(p);
  return Number(r.lastInsertRowid);
}
