import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrirDB, aInstanteISO, enTransaccion, mantenimiento, migrar, MIGRACIONES, respaldar } from './db';

const abiertas: DatabaseSync[] = [];
const dirs: string[] = [];
function nueva(): DatabaseSync {
  const db = abrirDB(':memory:');
  abiertas.push(db);
  return db;
}
function dirTemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plata-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (abiertas.length) {
    try { abiertas.pop()!.close(); } catch { /* ya cerrada */ }
  }
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const num = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

/** Movimiento mínimo válido (todo sintético). */
function insertarMov(db: DatabaseSync, o: Record<string, string | number | null> = {}) {
  const v = {
    fecha: '2026-10-06', hora: '13:59', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 14730,
    comercio: 'TIENDA D1 TEST', comercio_norm: 'tienda d1 test', categoria_id: 'mercado', categoria_fuente: 'regla',
    computa: 1, origen: 'aviso', confianza: 'regla', ref_correo: 'mid:abcdef012345', huella: 'h-1', huella_seq: 0,
    ...o,
  };
  return db
    .prepare(
      `INSERT INTO movimientos (fecha, hora, banco, tipo, sentido, monto, comercio, comercio_norm, categoria_id,
         categoria_fuente, computa, origen, confianza, ref_correo, huella, huella_seq)
       VALUES (:fecha, :hora, :banco, :tipo, :sentido, :monto, :comercio, :comercio_norm, :categoria_id,
         :categoria_fuente, :computa, :origen, :confianza, :ref_correo, :huella, :huella_seq)`,
    )
    .run(v);
}

describe('migraciones', () => {
  it('las migraciones aplican en memoria y dejan user_version = MIGRACIONES.length', () => {
    const db = nueva();
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRACIONES.length);
    expect(MIGRACIONES.length).toBe(6);
  });

  it('migrar de nuevo no hace nada', () => {
    const db = nueva();
    expect(migrar(db)).toBe(6);
  });

  it('reabrir un archivo no vuelve a migrar ni pierde datos', () => {
    const ruta = path.join(dirTemp(), 'sub', 'plata.db');
    const a = abrirDB(ruta);
    a.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'prueba')").run();
    a.close();
    const b = abrirDB(ruta);
    abiertas.push(b);
    expect(num(b, "SELECT count(*) AS n FROM eventos WHERE tipo = 'prueba'")).toBe(1);
    expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(6);
    expect(num(b, 'SELECT count(*) AS n FROM categorias')).toBe(16);
  });

  it('rechaza una base más nueva que la app', () => {
    const db = nueva();
    db.exec('PRAGMA user_version = 99');
    expect(() => migrar(db)).toThrow(/más nueva/);
  });

  it('pragmas activos', () => {
    const db = nueva();
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect((db.prepare('PRAGMA trusted_schema').get() as { trusted_schema: number }).trusted_schema).toBe(0);
  });
});

describe('semillas', () => {
  it('16 categorías de catálogo y reglas semilla normalizadas', () => {
    const db = nueva();
    expect(num(db, 'SELECT count(*) AS n FROM categorias')).toBe(16);
    expect(num(db, "SELECT count(*) AS n FROM categorias WHERE sistema = 1")).toBe(2);
    expect(num(db, "SELECT count(*) AS n FROM categorias WHERE es_gasto = 0")).toBe(2);
    expect(num(db, "SELECT count(*) AS n FROM reglas_categoria WHERE origen = 'semilla'")).toBe(221);
    const r = db.prepare("SELECT categoria_id FROM reglas_categoria WHERE patron = 'amazon prime'").get() as { categoria_id: string };
    expect(r.categoria_id).toBe('suscripciones');
  });
});

describe('CHECK, triggers y llaves foráneas', () => {
  it('movimiento válido entra', () => {
    const db = nueva();
    expect(() => insertarMov(db)).not.toThrow();
  });

  it('rechaza fecha imposible 2026-02-30', () => {
    expect(() => insertarMov(nueva(), { fecha: '2026-02-30' })).toThrow();
  });

  it('rechaza monto 0 y negativo', () => {
    const db = nueva();
    expect(() => insertarMov(db, { monto: 0 })).toThrow();
    expect(() => insertarMov(db, { monto: -5 })).toThrow();
  });

  it('pago_tarjeta con computa = 1 se rechaza; con 0 entra', () => {
    const db = nueva();
    expect(() => insertarMov(db, { tipo: 'pago_tarjeta', computa: 1, categoria_id: 'interno' })).toThrow();
    expect(() => insertarMov(db, { tipo: 'pago_tarjeta', computa: 0, categoria_id: 'interno' })).not.toThrow();
  });

  it('tipo y sentido deben ser coherentes', () => {
    expect(() => insertarMov(nueva(), { tipo: 'ingreso', sentido: 'salida' })).toThrow();
  });

  it('origen manual no lleva ref_correo, y el resto sí', () => {
    const db = nueva();
    expect(() => insertarMov(db, { origen: 'manual', ref_correo: 'mid:abcdef012345' })).toThrow();
    expect(() => insertarMov(db, { origen: 'aviso', ref_correo: null })).toThrow();
    expect(() => insertarMov(db, { origen: 'manual', ref_correo: null })).not.toThrow();
  });

  it('huella + huella_seq únicos', () => {
    const db = nueva();
    insertarMov(db);
    expect(() => insertarMov(db, { ref_correo: 'mid:otro00000001' })).toThrow();
    expect(() => insertarMov(db, { ref_correo: 'mid:otro00000002', huella_seq: 1 })).not.toThrow();
  });

  it('categoría inexistente viola la llave foránea', () => {
    expect(() => insertarMov(nueva(), { categoria_id: 'noexiste' })).toThrow();
  });

  it('hora inválida se rechaza', () => {
    const db = nueva();
    expect(() => insertarMov(db, { hora: '24:00' })).toThrow();
    expect(() => insertarMov(db, { hora: '9:5' })).toThrow();
  });

  it('presupuestos: trigger de categoría y centinelas', () => {
    const db = nueva();
    const ins = db.prepare('INSERT INTO presupuestos (mes, categoria_id, monto) VALUES (?, ?, ?)');
    expect(() => ins.run('2026-10', 'comida', 400000)).not.toThrow();
    expect(() => ins.run('*', '*', 2000000)).not.toThrow();
    expect(() => ins.run('2026-10', 'ingresos', 1000)).toThrow(/categoria_invalida/);   // no es de gasto
    expect(() => ins.run('2026-10', 'fantasma', 1000)).toThrow(/categoria_invalida/);
    expect(() => ins.run('2026-10', 'comida', 5)).toThrow();                              // PK repetida
    expect(() => ins.run('2026-13', 'comida', 5)).toThrow();                              // mes inválido
    expect(() => ins.run('2026-11', 'comida', 0)).toThrow();                              // monto > 0
  });

  it('config exige JSON válido y secretos solo pin_hash', () => {
    const db = nueva();
    expect(() => db.prepare("INSERT INTO config (clave, valor) VALUES ('x', 'no es json')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO config (clave, valor) VALUES ('x', '5')").run()).not.toThrow();
    expect(() => db.prepare("INSERT INTO secretos (clave, valor) VALUES ('otra', 'v')").run()).toThrow();
  });

  it('las tablas son STRICT: un texto en columna entera falla', () => {
    const db = nueva();
    expect(() => db.prepare("INSERT INTO metas (nombre, nombre_norm, objetivo) VALUES ('a', 'a', 'mucho')").run()).toThrow();
  });
});

describe('enTransaccion', () => {
  it('confirma y devuelve el resultado', () => {
    const db = nueva();
    const r = enTransaccion(db, () => {
      db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'a')").run();
      return 42;
    });
    expect(r).toBe(42);
    expect(num(db, 'SELECT count(*) AS n FROM eventos')).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it('revierte si fn lanza', () => {
    const db = nueva();
    expect(() =>
      enTransaccion(db, () => {
        db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'a')").run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(num(db, 'SELECT count(*) AS n FROM eventos')).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it('anidada: el fallo interno revierte solo lo interno', () => {
    const db = nueva();
    enTransaccion(db, () => {
      db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'externo')").run();
      expect(() =>
        enTransaccion(db, () => {
          db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'interno')").run();
          throw new Error('x');
        }),
      ).toThrow('x');
    });
    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'externo'")).toBe(1);
    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'interno'")).toBe(0);
  });

  it('una fn asíncrona se rechaza y revierte', () => {
    const db = nueva();
    expect(() =>
      enTransaccion(db, (() => {
        db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'a')").run();
        return Promise.resolve(1);
      }) as () => unknown),
    ).toThrow(/síncrona/);
    expect(num(db, 'SELECT count(*) AS n FROM eventos')).toBe(0);
  });
});

describe('respaldar', () => {
  it('crea el archivo, es legible y conserva solo 14', () => {
    const db = nueva();
    db.prepare("INSERT INTO eventos (nivel, tipo) VALUES ('info', 'dato')").run();
    const dir = dirTemp();
    for (let d = 1; d <= 16; d++) {
      respaldar(db, dir, `2026-09-${String(d).padStart(2, '0')}`);
    }
    const archivos = fs.readdirSync(dir).sort();
    expect(archivos.length).toBe(14);
    expect(archivos[0]).toBe('plata-2026-09-03.db');
    // el respaldo se puede abrir y trae los datos
    const copia = abrirDB(path.join(dir, archivos[13]));
    abiertas.push(copia);
    expect(num(copia, "SELECT count(*) AS n FROM eventos WHERE tipo = 'dato'")).toBe(1);
  });

  it('el mismo día sobrescribe sin fallar', () => {
    const db = nueva();
    const dir = dirTemp();
    respaldar(db, dir, '2026-10-01');
    expect(() => respaldar(db, dir, '2026-10-01')).not.toThrow();
  });

  it('rechaza una fecha rara (no se usa en la ruta)', () => {
    expect(() => respaldar(nueva(), dirTemp(), '../../x')).toThrow();
  });
});

describe('mantenimiento', () => {
  const ahora = new Date('2026-10-15T17:00:00Z');
  const hace = (dias: number) => aInstanteISO(new Date(ahora.getTime() - dias * 86_400_000));

  it('purga según la retención de §8.1 y respeta lo reciente', () => {
    const db = nueva();
    const ev = db.prepare("INSERT INTO eventos (ts, nivel, tipo) VALUES (?, 'info', ?)");
    ev.run(hace(100), 'viejo');
    ev.run(hace(10), 'reciente');
    const bu = db.prepare('INSERT INTO bot_updates (update_id, recibido_en, respuesta) VALUES (?, ?, ?)');
    bu.run(1, hace(8), '{}');
    bu.run(2, hace(1), '{}');
    const id = db.prepare('INSERT INTO idempotencia (ruta, clave, huella_cuerpo, estado_http, respuesta, creado_en) VALUES (?, ?, ?, 200, ?, ?)');
    id.run('/api/x', 'clave-vieja-1', 'h', '{}', aInstanteISO(new Date(ahora.getTime() - 25 * 3_600_000)));
    id.run('/api/x', 'clave-nueva-1', 'h', '{}', aInstanteISO(new Date(ahora.getTime() - 2 * 3_600_000)));
    const pr = db.prepare(
      `INSERT INTO por_revisar (ref_correo, remitente_dominio, asunto, texto, fecha_correo, motivo, estado, creado_en, resuelto_en)
       VALUES (?, 'ayn.test.com', 'asunto', 'texto', ?, 'formato_desconocido', ?, ?, ?)`,
    );
    pr.run('mid:rev-vieja-1', hace(300), 'resuelto', hace(300), hace(200));
    pr.run('mid:rev-pend-01', hace(300), 'pendiente', hace(300), null);
    pr.run('mid:rev-nueva-1', hace(20), 'descartado', hace(20), hace(10));
    // un aviso del libro apunta a la fila vieja: no debe romper la purga
    const idViejo = (db.prepare("SELECT id FROM por_revisar WHERE ref_correo = 'mid:rev-vieja-1'").get() as { id: number }).id;
    db.prepare("INSERT INTO avisos_procesados (ref_correo, estado, por_revisar_id) VALUES ('mid:rev-vieja-1', 'por_revisar', ?)").run(idViejo);
    const se = db.prepare('INSERT INTO sesiones (id_hash, creada_en, expira_en, ultima_actividad_en) VALUES (?, ?, ?, ?)');
    se.run('a'.repeat(64), hace(40), hace(10), hace(11));
    se.run('b'.repeat(64), hace(1), aInstanteISO(new Date(ahora.getTime() + 86_400_000 * 29)), hace(0.5));

    mantenimiento(db, ahora);

    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'viejo'")).toBe(0);
    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'reciente'")).toBe(1);
    expect(num(db, 'SELECT count(*) AS n FROM bot_updates')).toBe(1);
    expect(num(db, 'SELECT count(*) AS n FROM idempotencia')).toBe(1);
    expect(num(db, 'SELECT count(*) AS n FROM por_revisar')).toBe(2);
    expect(num(db, "SELECT count(*) AS n FROM por_revisar WHERE estado = 'pendiente'")).toBe(1);
    expect(num(db, 'SELECT count(*) AS n FROM sesiones')).toBe(1);
    expect(num(db, 'SELECT count(*) AS n FROM avisos_procesados WHERE por_revisar_id IS NOT NULL')).toBe(0);
  });

  it('corre una sola vez al día', () => {
    const db = nueva();
    mantenimiento(db, ahora);
    db.prepare("INSERT INTO eventos (ts, nivel, tipo) VALUES (?, 'info', 'viejo')").run(hace(100));
    mantenimiento(db, new Date(ahora.getTime() + 3_600_000));
    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'viejo'")).toBe(1);   // no volvió a purgar
    mantenimiento(db, new Date(ahora.getTime() + 22 * 3_600_000));
    expect(num(db, "SELECT count(*) AS n FROM eventos WHERE tipo = 'viejo'")).toBe(0);
  });
});

describe('aInstanteISO', () => {
  it('quita los milisegundos', () => {
    expect(aInstanteISO(new Date('2026-10-06T18:59:00.123Z'))).toBe('2026-10-06T18:59:00Z');
  });
});

describe('migración 2 (calidad de datos)', () => {
  it('migrar una base en versión 1 agrega categorías y reglas sin tocar las manuales ni aprendidas', () => {
    const db = new DatabaseSync(':memory:');
    abiertas.push(db);
    db.exec(MIGRACIONES[0]);
    db.exec('PRAGMA user_version = 1');
    db.prepare("INSERT INTO reglas_categoria (patron, categoria_id, origen) VALUES ('gopass', 'ocio', 'manual')").run();
    expect(migrar(db)).toBe(6);
    const r = db.prepare("SELECT categoria_id, origen FROM reglas_categoria WHERE patron = 'gopass'").get() as { categoria_id: string; origen: string };
    expect(r).toMatchObject({ categoria_id: 'ocio', origen: 'manual' });
    expect(num(db, "SELECT count(*) AS n FROM categorias WHERE id IN ('transferencias','deudas','efectivo') AND es_gasto = 1")).toBe(3);
    expect(num(db, "SELECT count(*) AS n FROM reglas_categoria WHERE patron = 'eds' AND origen = 'semilla'")).toBe(1);
  });
});

describe('migración 3 (las transferencias dejan de ser gasto por defecto)', () => {
  const baseV2 = () => {
    const db = new DatabaseSync(':memory:');
    abiertas.push(db);
    db.exec(MIGRACIONES[0]);
    db.exec(MIGRACIONES[1]);
    db.exec('PRAGMA user_version = 2');
    return db;
  };
  const computa = (db: DatabaseSync, ref: string) => num(db, `SELECT computa AS n FROM movimientos WHERE ref_correo = '${ref}'`);

  it('pasa a computa = 0 las transferencias no manuales; respeta retiros, compras, ingresos, las puestas a mano y las ligadas a un fijo', () => {
    const db = baseV2();
    const mov = (ref: string, o: Record<string, string | number | null>) =>
      insertarMov(db, { ref_correo: ref, huella: 'h-' + ref, comercio: 'X ' + ref, comercio_norm: 'x ' + ref, ...o });
    mov('mid:t-regla', { tipo: 'transferencia', categoria_id: 'transferencias', categoria_fuente: 'defecto' });
    mov('mid:t-regla2', { tipo: 'transferencia', categoria_id: 'mercado', categoria_fuente: 'aprendida' });
    mov('mid:t-manual', { tipo: 'transferencia', categoria_id: 'ocio', categoria_fuente: 'manual' });
    mov('mid:retiro', { tipo: 'retiro', categoria_id: 'efectivo', categoria_fuente: 'defecto' });
    mov('mid:compra', { tipo: 'compra' });
    mov('mid:ingreso', { tipo: 'ingreso', sentido: 'entrada', categoria_id: 'ingresos' });
    db.prepare("INSERT INTO gastos_fijos (nombre, nombre_norm, monto, dia_mes) VALUES ('Arriendo', 'arriendo', 14730, 5)").run();
    mov('mid:t-fijo', { tipo: 'transferencia', categoria_id: 'transferencias', categoria_fuente: 'defecto' });
    db.prepare("UPDATE movimientos SET fijo_id = (SELECT id FROM gastos_fijos LIMIT 1) WHERE ref_correo = 'mid:t-fijo'").run();

    expect(migrar(db)).toBe(6);
    expect(computa(db, 'mid:t-regla')).toBe(0);
    expect(computa(db, 'mid:t-regla2')).toBe(0);
    expect(computa(db, 'mid:t-manual')).toBe(1);
    expect(computa(db, 'mid:t-fijo')).toBe(1);
    expect(computa(db, 'mid:retiro')).toBe(1);
    expect(computa(db, 'mid:compra')).toBe(1);
    expect(computa(db, 'mid:ingreso')).toBe(1);
    expect(migrar(db)).toBe(6);   // idempotente
  });
});

describe('migración 4 (estado de conversación del bot)', () => {
  it('crea bot_estado sobre una base en versión 3 sin tocar lo demás', () => {
    const db = new DatabaseSync(':memory:');
    abiertas.push(db);
    for (let i = 0; i < 3; i++) db.exec(MIGRACIONES[i]);
    db.exec('PRAGMA user_version = 3');
    expect(migrar(db)).toBe(6);
    db.prepare("INSERT INTO bot_estado (chat_id, flujo, datos, expira_en) VALUES ('123456789', 'gasto', '{\"n\":\"a\"}', '2026-10-15T17:15:00Z')").run();
    expect(num(db, 'SELECT count(*) AS n FROM bot_estado')).toBe(1);
    expect(() => db.prepare("INSERT INTO bot_estado (chat_id, flujo, datos, expira_en) VALUES ('2', 'x', 'no es json', 'z')").run()).toThrow();
    expect(num(db, 'SELECT count(*) AS n FROM categorias')).toBe(16);
  });
});

describe('migración 6 (categoría viajes)', () => {
  const baseV5 = () => {
    const db = new DatabaseSync(':memory:');
    abiertas.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    for (let i = 0; i < 5; i++) db.exec(MIGRACIONES[i]);
    db.exec('PRAGMA user_version = 5');
    return db;
  };
  const reglaDe = (db: DatabaseSync, patron: string) =>
    db.prepare('SELECT categoria_id, origen FROM reglas_categoria WHERE patron = ?').get(patron) as { categoria_id: string; origen: string } | undefined;

  it('crea viajes (no esencial, no hormiga), pasa las semillas airbnb/despegar y agrega las reglas nuevas', () => {
    const db = baseV5();
    insertarMov(db, { ref_correo: 'mid:airbnb', huella: 'h-airbnb', comercio: 'AIRBNB', comercio_norm: 'airbnb', categoria_id: 'ocio' });
    expect(migrar(db)).toBe(6);
    expect(db.prepare("SELECT nombre, esencial, cuenta_hormiga, es_gasto, sistema FROM categorias WHERE id = 'viajes'").get())
      .toMatchObject({ nombre: 'Viajes', esencial: 0, cuenta_hormiga: 0, es_gasto: 1, sistema: 0 });
    expect(reglaDe(db, 'airbnb')).toEqual({ categoria_id: 'viajes', origen: 'semilla' });
    expect(reglaDe(db, 'despegar')).toEqual({ categoria_id: 'viajes', origen: 'semilla' });
    for (const p of ['hotel', 'hospedaje', 'vuelo', 'reserva', 'tiquete aereo', 'pasaje aereo']) expect(reglaDe(db, p)?.categoria_id).toBe('viajes');
    expect(reglaDe(db, 'tiquete')).toBeUndefined();   // el tiquete del metro sigue siendo transporte
    expect(reglaDe(db, 'pasaje')).toBeUndefined();
    // no recategoriza movimientos viejos
    expect(db.prepare("SELECT categoria_id FROM movimientos WHERE ref_correo = 'mid:airbnb'").get()).toMatchObject({ categoria_id: 'ocio' });
    expect(migrar(db)).toBe(6);   // idempotente
  });

  it('respeta lo que Jero ya decidió: reglas manuales/aprendidas y una categoría viajes previa', () => {
    const db = baseV5();
    db.prepare("UPDATE reglas_categoria SET origen = 'manual' WHERE patron = 'airbnb'").run();
    db.prepare("INSERT INTO reglas_categoria (patron, categoria_id, origen) VALUES ('hotel', 'ocio', 'aprendida')").run();
    db.prepare("INSERT INTO categorias (id, nombre, emoji, esencial) VALUES ('viajes', 'Paseos', '🧳', 1)").run();
    expect(migrar(db)).toBe(6);
    expect(reglaDe(db, 'airbnb')).toEqual({ categoria_id: 'ocio', origen: 'manual' });
    expect(reglaDe(db, 'hotel')).toEqual({ categoria_id: 'ocio', origen: 'aprendida' });
    expect(db.prepare("SELECT nombre, esencial FROM categorias WHERE id = 'viajes'").get()).toMatchObject({ nombre: 'Paseos', esencial: 1 });
    expect(num(db, "SELECT count(*) AS n FROM categorias WHERE id = 'viajes'")).toBe(1);
  });
});
