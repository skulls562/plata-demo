// Cuentas (saldo) y deudas: validación y escritura en un solo lugar. Las usan las rutas del panel (/api/cuentas, /api/deudas)
// y el bot de Telegram (por el puerto AccesoDatos), así las reglas no se duplican. `panel.ts` las reexporta.
import type { DatabaseSync } from 'node:sqlite';
import { aInstanteISO } from './db';
import { normalizarComercio } from './formato';
import { aCuenta, aDeuda, COLUMNAS_CUENTA, COLUMNAS_DEUDA, leerCuentasDB, leerDeudasDB, type Fila } from './repo';
import { enmascararDigitos } from './seguridad';
import { ErrorUsuario } from './tipos';
import type { Cuenta, Deuda, Pesos, TipoCuenta, TipoDeuda } from './tipos';

const invalido = (m: string): never => {
  throw new ErrorUsuario('validacion', m);
};

// ---------------------------------------------------------------------------
// Cuentas (saldo) y deudas — migración 5. Sin `acciones`: se corrigen editando.
// ---------------------------------------------------------------------------

const MAX_PESOS = 10_000_000_000;
const TIPOS_CUENTA: readonly TipoCuenta[] = ['efectivo', 'banco', 'ahorro'];
const TIPOS_DEUDA: readonly TipoDeuda[] = ['tarjeta', 'prestamo', 'otra'];

/** Nombre limpio (espacios colapsados, números largos enmascarados: nunca guardar un número de tarjeta). */
function nombreOk(v: unknown): { nombre: string; nombre_norm: string } {
  if (typeof v !== 'string') return invalido('nombre debe ser texto');
  const nombre = enmascararDigitos(v).replace(/\s+/g, ' ').trim();
  if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
  const nombre_norm = normalizarComercio(nombre) || nombre.toLowerCase();
  return { nombre, nombre_norm };
}
function pesosOk(v: unknown, campo: string): Pesos {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_PESOS) return invalido(`${campo} debe ser un entero entre 0 y ${MAX_PESOS}`);
  return v;
}
function tipoOk<T extends string>(v: unknown, lista: readonly T[], campo: string): T {
  if (typeof v !== 'string' || !(lista as readonly string[]).includes(v)) return invalido(`${campo} debe ser uno de: ${lista.join(', ')}`);
  return v as T;
}
function tasaOk(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) return invalido('tasa_ea debe ser un porcentaje efectivo anual entre 0 y 1000');
  return Math.round(v * 100) / 100;
}
function diaPagoOk(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 31) return invalido('dia_pago debe ser un entero entre 1 y 31, o null');
  return v;
}

export function listarCuentas(db: DatabaseSync): Cuenta[] {
  return leerCuentasDB(db);
}

export function obtenerCuenta(db: DatabaseSync, id: number): Cuenta | null {
  const f = db.prepare('SELECT ' + COLUMNAS_CUENTA + ' FROM cuentas WHERE id = ?').get(id) as Fila | undefined;
  return f ? aCuenta(f) : null;
}

function cuentaRepetida(db: DatabaseSync, nombre_norm: string, exceptoId: number, nombre: string): void {
  if (db.prepare('SELECT 1 AS x FROM cuentas WHERE nombre_norm = ? AND id <> ?').get(nombre_norm, exceptoId)) {
    throw new ErrorUsuario('cuenta_existente', `Ya tienes una cuenta «${nombre}»`);
  }
}

/** Valida y normaliza los datos de una cuenta nueva (lanza ErrorUsuario). Puro: lo usan la base y las pruebas del bot. */
export function validarCuenta(c: { nombre: unknown; tipo: unknown; saldo: unknown }) {
  const { nombre, nombre_norm } = nombreOk(c.nombre);
  return { nombre, nombre_norm, tipo: tipoOk(c.tipo, TIPOS_CUENTA, 'tipo'), saldo: pesosOk(c.saldo, 'saldo') };
}

export function crearCuenta(db: DatabaseSync, c: { nombre: unknown; tipo: unknown; saldo: unknown }, ahora: Date): Cuenta {
  const { nombre, nombre_norm, tipo, saldo } = validarCuenta(c);
  cuentaRepetida(db, nombre_norm, -1, nombre);
  const iso = aInstanteISO(ahora);
  const r = db.prepare('INSERT INTO cuentas (nombre, nombre_norm, tipo, saldo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nombre, nombre_norm, tipo, saldo, iso, iso);
  return obtenerCuenta(db, Number(r.lastInsertRowid))!;
}

export function editarCuenta(db: DatabaseSync, id: number, c: { nombre?: unknown; tipo?: unknown; saldo?: unknown }, ahora: Date): Cuenta {
  const actual = obtenerCuenta(db, id);
  if (!actual) throw new ErrorUsuario('no_encontrado', 'Cuenta no encontrada');
  const n = c.nombre !== undefined ? nombreOk(c.nombre) : { nombre: actual.nombre, nombre_norm: normalizarComercio(actual.nombre) || actual.nombre.toLowerCase() };
  const tipo = c.tipo !== undefined ? tipoOk(c.tipo, TIPOS_CUENTA, 'tipo') : actual.tipo;
  const saldo = c.saldo !== undefined ? pesosOk(c.saldo, 'saldo') : actual.saldo;
  if (c.nombre !== undefined) cuentaRepetida(db, n.nombre_norm, id, n.nombre);
  db.prepare('UPDATE cuentas SET nombre = ?, nombre_norm = ?, tipo = ?, saldo = ?, actualizado_en = ? WHERE id = ?')
    .run(n.nombre, n.nombre_norm, tipo, saldo, aInstanteISO(ahora), id);
  return obtenerCuenta(db, id)!;
}

export function borrarCuenta(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare('DELETE FROM cuentas WHERE id = ?').run(id).changes) > 0;
}

export function listarDeudas(db: DatabaseSync, incluirInactivas = false): Deuda[] {
  return leerDeudasDB(db, incluirInactivas);
}

export function obtenerDeuda(db: DatabaseSync, id: number): Deuda | null {
  const f = db.prepare('SELECT ' + COLUMNAS_DEUDA + ' FROM deudas WHERE id = ?').get(id) as Fila | undefined;
  return f ? aDeuda(f) : null;
}

function deudaRepetida(db: DatabaseSync, nombre_norm: string, exceptoId: number, nombre: string): void {
  if (db.prepare('SELECT 1 AS x FROM deudas WHERE nombre_norm = ? AND activa = 1 AND id <> ?').get(nombre_norm, exceptoId)) {
    throw new ErrorUsuario('deuda_existente', `Ya tienes una deuda «${nombre}»`);
  }
}

export interface DatosDeuda { nombre: unknown; tipo: unknown; saldo: unknown; tasa_ea: unknown; pago_minimo: unknown; dia_pago?: unknown }

/** Valida y normaliza los datos de una deuda nueva (lanza ErrorUsuario). Puro: lo usan la base y las pruebas del bot. */
export function validarDeuda(d: DatosDeuda) {
  const { nombre, nombre_norm } = nombreOk(d.nombre);
  return {
    nombre, nombre_norm, tipo: tipoOk(d.tipo, TIPOS_DEUDA, 'tipo'), saldo: pesosOk(d.saldo, 'saldo'), tasa: tasaOk(d.tasa_ea),
    minimo: pesosOk(d.pago_minimo, 'pago_minimo'), dia: diaPagoOk(d.dia_pago ?? null),
  };
}

export function crearDeuda(db: DatabaseSync, d: DatosDeuda, ahora: Date): Deuda {
  const { nombre, nombre_norm, tipo, saldo, tasa, minimo, dia } = validarDeuda(d);
  deudaRepetida(db, nombre_norm, -1, nombre);
  const iso = aInstanteISO(ahora);
  const r = db.prepare(
    `INSERT INTO deudas (nombre, nombre_norm, tipo, saldo, tasa_ea, pago_minimo, dia_pago, activa, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(nombre, nombre_norm, tipo, saldo, tasa, minimo, dia, iso, iso);
  return obtenerDeuda(db, Number(r.lastInsertRowid))!;
}

export function editarDeuda(db: DatabaseSync, id: number, c: Partial<DatosDeuda> & { activa?: unknown }, ahora: Date): Deuda {
  const actual = obtenerDeuda(db, id);
  if (!actual) throw new ErrorUsuario('no_encontrado', 'Deuda no encontrada');
  const n = c.nombre !== undefined ? nombreOk(c.nombre) : { nombre: actual.nombre, nombre_norm: normalizarComercio(actual.nombre) || actual.nombre.toLowerCase() };
  const tipo = c.tipo !== undefined ? tipoOk(c.tipo, TIPOS_DEUDA, 'tipo') : actual.tipo;
  const saldo = c.saldo !== undefined ? pesosOk(c.saldo, 'saldo') : actual.saldo;
  const tasa = c.tasa_ea !== undefined ? tasaOk(c.tasa_ea) : actual.tasa_ea;
  const minimo = c.pago_minimo !== undefined ? pesosOk(c.pago_minimo, 'pago_minimo') : actual.pago_minimo;
  const dia = c.dia_pago !== undefined ? diaPagoOk(c.dia_pago) : actual.dia_pago;
  if (c.activa !== undefined && typeof c.activa !== 'boolean') invalido('activa debe ser true o false');
  const activa = c.activa !== undefined ? (c.activa as boolean) : actual.activa;
  if (activa) deudaRepetida(db, n.nombre_norm, id, n.nombre);
  db.prepare(
    `UPDATE deudas SET nombre = ?, nombre_norm = ?, tipo = ?, saldo = ?, tasa_ea = ?, pago_minimo = ?, dia_pago = ?, activa = ?,
       actualizado_en = ? WHERE id = ?`,
  ).run(n.nombre, n.nombre_norm, tipo, saldo, tasa, minimo, dia, activa ? 1 : 0, aInstanteISO(ahora), id);
  return obtenerDeuda(db, id)!;
}

/** «Borrar» una deuda la archiva (activa = 0): sale de los cálculos y se puede reactivar con PATCH { activa: true }. */
export function archivarDeuda(db: DatabaseSync, id: number, ahora: Date): boolean {
  return Number(db.prepare('UPDATE deudas SET activa = 0, actualizado_en = ? WHERE id = ? AND activa = 1').run(aInstanteISO(ahora), id).changes) > 0;
}
