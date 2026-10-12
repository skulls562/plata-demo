// Migración 5 y acceso a datos de cuentas y deudas (base en memoria; datos sintéticos).
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { abrirDB, migrar, MIGRACIONES } from './db';
import { crearAccesoDatos } from './datos';
import {
  archivarDeuda, borrarCuenta, crearCuenta, crearDeuda, editarCuenta, editarDeuda, listarCuentas, listarDeudas, obtenerDeuda,
} from './panel';
import { ErrorUsuario } from './tipos';

const AHORA = new Date('2026-10-15T17:00:00Z');
const abiertas: DatabaseSync[] = [];
const nueva = () => { const db = abrirDB(':memory:'); abiertas.push(db); return db; };
afterEach(() => { while (abiertas.length) abiertas.pop()!.close(); });

const codigo = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return e instanceof ErrorUsuario ? e.codigo : 'otro:' + String(e); }
  return 'sin_error';
};
const tarjeta = { nombre: 'Visa', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28.456, pago_minimo: 120_000, dia_pago: 31 };

describe('migración 5', () => {
  it('sube una base v4 con datos sin tocarlos y crea las tablas', () => {
    const db = new DatabaseSync(':memory:');
    abiertas.push(db);
    for (let i = 0; i < 4; i++) db.exec(MIGRACIONES[i]);
    db.exec('PRAGMA user_version = 4');
    db.prepare("INSERT INTO metas (nombre, nombre_norm, objetivo) VALUES ('Viaje', 'viaje', 1000)").run();
    expect(migrar(db)).toBe(6);
    expect(Number((db.prepare('SELECT count(*) AS n FROM metas').get() as { n: number }).n)).toBe(1);
    expect(Number((db.prepare('SELECT count(*) AS n FROM cuentas').get() as { n: number }).n)).toBe(0);
    expect(Number((db.prepare('SELECT count(*) AS n FROM deudas').get() as { n: number }).n)).toBe(0);
  });

  it('los CHECK de la base protegen aunque se salten la validación', () => {
    const db = nueva();
    const insC = (saldo: number, tipo = 'banco') => () => db.prepare("INSERT INTO cuentas (nombre, nombre_norm, tipo, saldo) VALUES ('X', 'x', ?, ?)").run(tipo, saldo);
    expect(insC(-1)).toThrow();
    expect(insC(10, 'cripto')).toThrow();
    const insD = (o: { saldo?: number; tasa?: number; min?: number; dia?: number | null }) => () => db
      .prepare("INSERT INTO deudas (nombre, nombre_norm, tipo, saldo, tasa_ea, pago_minimo, dia_pago) VALUES ('D', 'd', 'otra', ?, ?, ?, ?)")
      .run(o.saldo ?? 1, o.tasa ?? 1, o.min ?? 1, o.dia ?? null);
    expect(insD({ saldo: -5 })).toThrow();
    expect(insD({ tasa: 1001 })).toThrow();
    expect(insD({ min: -1 })).toThrow();
    expect(insD({ dia: 32 })).toThrow();
    expect(insD({ dia: 0 })).toThrow();
    expect(insD({ dia: 31 })).not.toThrow();
  });
});

describe('cuentas', () => {
  it('crear, listar, editar y borrar', () => {
    const db = nueva();
    const c = crearCuenta(db, { nombre: '  Nequi   principal ', tipo: 'banco', saldo: 350_000 }, AHORA);
    expect(c).toEqual({ id: c.id, nombre: 'Nequi principal', tipo: 'banco', saldo: 350_000, creado_en: '2026-10-15T17:00:00Z', actualizado_en: '2026-10-15T17:00:00Z' });
    const e = editarCuenta(db, c.id, { saldo: 400_000 }, new Date('2026-10-16T12:00:00Z'));
    expect(e).toMatchObject({ saldo: 400_000, nombre: 'Nequi principal', actualizado_en: '2026-10-16T12:00:00Z' });
    expect(listarCuentas(db)).toHaveLength(1);
    expect(borrarCuenta(db, c.id)).toBe(true);
    expect(borrarCuenta(db, c.id)).toBe(false);
  });

  it('validación: nombre repetido, tipo, saldo negativo o con decimales, número de tarjeta enmascarado', () => {
    const db = nueva();
    crearCuenta(db, { nombre: 'Bancolombia', tipo: 'banco', saldo: 0 }, AHORA);
    expect(codigo(() => crearCuenta(db, { nombre: 'bancolombia', tipo: 'ahorro', saldo: 1 }, AHORA))).toBe('cuenta_existente');
    expect(codigo(() => crearCuenta(db, { nombre: 'Otra', tipo: 'cripto', saldo: 1 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearCuenta(db, { nombre: 'Otra', tipo: 'banco', saldo: -1 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearCuenta(db, { nombre: 'Otra', tipo: 'banco', saldo: 10.5 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearCuenta(db, { nombre: 'Otra', tipo: 'banco', saldo: '100' }, AHORA))).toBe('validacion');
    expect(codigo(() => crearCuenta(db, { nombre: '', tipo: 'banco', saldo: 1 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearCuenta(db, { nombre: 'x'.repeat(41), tipo: 'banco', saldo: 1 }, AHORA))).toBe('validacion');
    const t = crearCuenta(db, { nombre: 'Ahorro 4532123412341234', tipo: 'ahorro', saldo: 1 }, AHORA);
    expect(t.nombre).not.toContain('4532123412341234');
    expect(codigo(() => editarCuenta(db, 999, { saldo: 1 }, AHORA))).toBe('no_encontrado');
  });
});

describe('deudas', () => {
  it('crear redondea la tasa a 2 decimales y queda en la instantánea', () => {
    const db = nueva();
    const d = crearDeuda(db, tarjeta, AHORA);
    expect(d).toMatchObject({ nombre: 'Visa', tipo: 'tarjeta', saldo: 2_000_000, tasa_ea: 28.46, pago_minimo: 120_000, dia_pago: 31, activa: true });
    const inst = crearAccesoDatos(db, () => AHORA).instantanea(AHORA);
    expect(inst.deudas.map((x) => x.id)).toEqual([d.id]);
    expect(inst.cuentas).toEqual([]);
  });

  it('dia_pago opcional (null) y validaciones', () => {
    const db = nueva();
    expect(crearDeuda(db, { ...tarjeta, nombre: 'Sin día', dia_pago: undefined }, AHORA).dia_pago).toBeNull();
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'a', dia_pago: 0 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'b', dia_pago: 32 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'c', dia_pago: 15.5 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'd', tasa_ea: -1 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'e', tasa_ea: 1001 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'f', tasa_ea: Number.NaN }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'g', pago_minimo: -1 }, AHORA))).toBe('validacion');
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'h', tipo: 'hipoteca' }, AHORA))).toBe('validacion');
    expect(crearDeuda(db, { ...tarjeta, nombre: 'Cero', tasa_ea: 0, pago_minimo: 0, saldo: 0 }, AHORA).tasa_ea).toBe(0);
  });

  it('nombre único solo entre activas; archivar y reactivar', () => {
    const db = nueva();
    const a = crearDeuda(db, tarjeta, AHORA);
    expect(codigo(() => crearDeuda(db, { ...tarjeta, nombre: 'VISA' }, AHORA))).toBe('deuda_existente');
    expect(archivarDeuda(db, a.id, AHORA)).toBe(true);
    expect(archivarDeuda(db, a.id, AHORA)).toBe(false);
    const b = crearDeuda(db, tarjeta, AHORA);                     // mismo nombre, la otra está archivada
    expect(listarDeudas(db).map((x) => x.id)).toEqual([b.id]);
    expect(listarDeudas(db, true).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(codigo(() => editarDeuda(db, a.id, { activa: true }, AHORA))).toBe('deuda_existente');
    expect(codigo(() => editarDeuda(db, a.id, { activa: 'si' }, AHORA))).toBe('validacion');
    expect(editarDeuda(db, a.id, { activa: true, nombre: 'Visa vieja' }, AHORA)).toMatchObject({ activa: true, nombre: 'Visa vieja' });
    const inst = crearAccesoDatos(db, () => AHORA).instantanea(AHORA);
    expect(inst.deudas).toHaveLength(2);
  });

  it('editar campos sueltos conserva el resto; quitar el día con null', () => {
    const db = nueva();
    const d = crearDeuda(db, tarjeta, AHORA);
    const e = editarDeuda(db, d.id, { saldo: 1_500_000, dia_pago: null }, AHORA);
    expect(e).toMatchObject({ saldo: 1_500_000, dia_pago: null, tasa_ea: 28.46, pago_minimo: 120_000, nombre: 'Visa' });
    expect(obtenerDeuda(db, 999)).toBeNull();
    expect(codigo(() => editarDeuda(db, 999, { saldo: 1 }, AHORA))).toBe('no_encontrado');
  });
});
