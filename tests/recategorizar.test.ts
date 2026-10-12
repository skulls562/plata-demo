// Pruebas de scripts/recategorizar.ts con una base en memoria y datos 100 % sintéticos.
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { abrirDB } from '../src/lib/db';
import { aplicarPlan, leerArgs, planificar } from '../scripts/recategorizar.ts';

const abiertas: DatabaseSync[] = [];
afterEach(() => { while (abiertas.length) { try { abiertas.pop()!.close(); } catch { /* ya cerrada */ } } });

let n = 0;
function mov(db: DatabaseSync, o: Record<string, string | number | null>) {
  const v = {
    fecha: '2026-10-06', hora: '13:59', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 10000,
    comercio: 'X', comercio_norm: 'x', categoria_id: 'otros', categoria_fuente: 'defecto', computa: 1,
    origen: 'historial', confianza: 'regla', ref_correo: 'mid:sintetico' + String(++n).padStart(4, '0'), huella: 'h' + n, huella_seq: 0, ...o,
  };
  db.prepare(
    `INSERT INTO movimientos (fecha, hora, banco, tipo, sentido, monto, comercio, comercio_norm, categoria_id, categoria_fuente,
       computa, origen, confianza, ref_correo, huella, huella_seq)
     VALUES (:fecha, :hora, :banco, :tipo, :sentido, :monto, :comercio, :comercio_norm, :categoria_id, :categoria_fuente,
       :computa, :origen, :confianza, :ref_correo, :huella, :huella_seq)`,
  ).run(v);
}
const cat = (db: DatabaseSync, comercio_norm: string) =>
  (db.prepare('SELECT categoria_id c, categoria_fuente f FROM movimientos WHERE comercio_norm = ?').get(comercio_norm) as { c: string; f: string });

function base(): DatabaseSync {
  const db = abrirDB(':memory:');
  abiertas.push(db);
  mov(db, { comercio_norm: 'gopass' });
  mov(db, { comercio_norm: 'comercio inventado' });
  mov(db, { comercio_norm: 'eds prueba', categoria_id: 'ocio', categoria_fuente: 'manual' });
  mov(db, { comercio_norm: 'persona prueba', tipo: 'transferencia' });
  mov(db, { comercio_norm: 'upb1', tipo: 'retiro' });
  mov(db, { comercio_norm: 'gopass ia', categoria_id: 'ocio', categoria_fuente: 'ia' });
  mov(db, { comercio_norm: 'comercio ia', categoria_id: 'compras', categoria_fuente: 'ia' });
  return db;
}

describe('recategorizar', () => {
  it('planifica sin escribir', () => {
    const db = base();
    const plan = planificar(db);
    expect(plan.total).toBe(7);
    expect(plan.antes.otros).toBe(4);
    expect(plan.despues.otros).toBe(1);
    expect(cat(db, 'gopass').c).toBe('otros');   // el plan no escribe
  });

  it('aplica: reglas nuevas, defaults por tipo; respeta manual y no degrada la IA', () => {
    const db = base();
    aplicarPlan(db, planificar(db));
    expect(cat(db, 'gopass')).toEqual({ c: 'transporte', f: 'regla' });
    expect(cat(db, 'comercio inventado').c).toBe('otros');
    expect(cat(db, 'eds prueba')).toEqual({ c: 'ocio', f: 'manual' });
    expect(cat(db, 'persona prueba').c).toBe('transferencias');
    expect(cat(db, 'upb1').c).toBe('efectivo');
    expect(cat(db, 'gopass ia').c).toBe('transporte');   // una regla sí le gana a la IA
    expect(cat(db, 'comercio ia').c).toBe('compras');     // sin regla, la IA se queda
  });

  it('es idempotente y no toca borrados', () => {
    const db = base();
    db.prepare("UPDATE movimientos SET borrado_en = '2026-10-07T00:00:00Z' WHERE comercio_norm = 'gopass'").run();
    aplicarPlan(db, planificar(db));
    expect(planificar(db).cambios).toEqual([]);
    expect(cat(db, 'gopass').c).toBe('otros');
  });

  it('argumentos: dry-run por defecto', () => {
    expect(leerArgs([]).aplicar).toBe(false);
    expect(leerArgs(['--dry-run']).aplicar).toBe(false);
    expect(leerArgs(['--aplicar', '--db', 'x.db'])).toEqual({ aplicar: true, db: 'x.db' });
    expect(() => leerArgs(['--borrar'])).toThrow(/Uso/);
  });
});
