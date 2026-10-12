import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { codificarCursor, cerrarDiasPendientes, crearAccesoDatos, decodificarCursor, refrescarRecurrentes, registrarLatido } from './datos';
import { abrirDB } from './db';
import { ErrorConflicto, ErrorUsuario } from './tipos';
import type { AccesoDatos, NuevoMovimiento, Recomendacion } from './tipos';

const AHORA = new Date('2026-10-15T17:00:00Z');   // 2026-10-15 12:00 Bogotá
let reloj = AHORA;

const abiertas: DatabaseSync[] = [];
function nueva(): { db: DatabaseSync; d: AccesoDatos } {
  reloj = AHORA;
  const db = abrirDB(':memory:');
  abiertas.push(db);
  return { db, d: crearAccesoDatos(db, () => reloj) };
}
afterEach(() => { while (abiertas.length) abiertas.pop()!.close(); });

const n = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

const gasto = (o: Partial<NuevoMovimiento> = {}): NuevoMovimiento => ({
  fecha: '2026-10-10', hora: '12:00', banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto: 20000, comercio: 'Tienda D1 prueba',
  origen: 'manual', ...o,
});

describe('cursor', () => {
  it('ida y vuelta, y hora nula = 00:00', () => {
    const c = codificarCursor('2026-10-06', '13:59', 1532);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual(['2026-10-06', '13:59', 1532]);
    expect(decodificarCursor(c)).toEqual({ fecha: '2026-10-06', hora: '13:59', id: 1532 });
    expect(decodificarCursor(codificarCursor('2026-10-06', null, 7))).toEqual({ fecha: '2026-10-06', hora: '00:00', id: 7 });
  });
  it('rechaza lo mal formado', () => {
    const b = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    for (const c of ['', '!!!', 'abc', b([1, 2, 3]), b(['2026-10-06', '13:59']), b(['2026-13-45', '13:59', 1]), b(['2026-10-06', '25:00', 1]),
      b(['2026-10-06', '13:59', -1]), b(['2026-10-06', '13:59', 1.5]), b({}), 'a'.repeat(300)]) {
      expect(decodificarCursor(c), c).toBeNull();
    }
  });
});

describe('movimientos: crear, leer y buscar', () => {
  it('crea un gasto manual categorizado por regla y registra la acción', () => {
    const { db, d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    expect(m).toMatchObject({
      id: 1, categoria_id: 'mercado', categoria_fuente: 'regla', computa: true, origen: 'manual', confianza: 'manual',
      ref_correo: null, version: 1, verificado: true, comercio_norm: 'tienda d1 prueba',
    });
    expect(n(db, 'SELECT count(*) AS n FROM acciones')).toBe(1);
    expect(d.obtenerMovimiento(1)).toEqual(m);
    expect(d.obtenerMovimiento(99)).toBeNull();
  });

  it('con categoría explícita queda como manual; pago_tarjeta nunca computa', () => {
    const { d } = nueva();
    expect(d.crearMovimiento(gasto({ categoria_id: 'ocio' }), 'panel')).toMatchObject({ categoria_id: 'ocio', categoria_fuente: 'manual' });
    expect(d.crearMovimiento(gasto({ tipo: 'pago_tarjeta', comercio: 'RappiCard' }), 'panel')).toMatchObject({ computa: false, categoria_id: 'interno' });
  });

  it('un ingreso manual va a la categoría ingresos', () => {
    const { d } = nueva();
    expect(d.crearMovimiento(gasto({ tipo: 'ingreso', sentido: 'entrada', comercio: 'Sueldo' }), 'bot')).toMatchObject({ categoria_id: 'ingresos' });
  });

  it('valida la entrada con ErrorUsuario', () => {
    const { d } = nueva();
    const malos: Partial<NuevoMovimiento>[] = [
      { fecha: '2026-02-30' }, { fecha: 'ayer' }, { hora: '25:00' }, { monto: 0 }, { monto: 1.5 }, { monto: 2e10 }, { comercio: '' },
      { comercio: 'x'.repeat(121) }, { tipo: 'ingreso' }, { sentido: 'entrada' }, { banco: 'zzz' as never }, { categoria_id: 'noexiste' },
      { medio: 'zzz' as never }, { nota: 'x'.repeat(281) },
    ];
    for (const m of malos) expect(() => d.crearMovimiento(gasto(m), 'bot'), JSON.stringify(m)).toThrow(ErrorUsuario);
  });

  it('enmascara dígitos largos del comercio', () => {
    const { d } = nueva();
    expect(d.crearMovimiento(gasto({ comercio: 'Convenio 123456789' }), 'bot').comercio).toBe('Convenio [num]');
  });

  it('ultimosMovimientos y paginación por cursor (orden fecha, hora, id descendente)', () => {
    const { d } = nueva();
    for (let i = 0; i < 7; i++) d.crearMovimiento(gasto({ fecha: `2026-10-0${i + 1}`, hora: i % 2 ? '10:00' : null, comercio: `Comercio ${i}` }), 'bot');
    d.crearMovimiento(gasto({ fecha: '2026-10-03', hora: null, comercio: 'Empate A' }), 'bot');
    d.crearMovimiento(gasto({ fecha: '2026-10-03', hora: null, comercio: 'Empate B' }), 'bot');
    expect(d.ultimosMovimientos(2).map((m) => m.fecha)).toEqual(['2026-10-07', '2026-10-06']);

    const todos: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const p = d.buscarMovimientos({ limite: 4, cursor });
      todos.push(...p.items.map((m) => m.comercio));
      if (!p.siguiente_cursor) break;
      cursor = p.siguiente_cursor;
    }

    expect(todos).toHaveLength(9);
    expect(new Set(todos).size).toBe(9);
    // orden total: fechas no crecientes
    const fechas = d.buscarMovimientos({ limite: 200 }).items.map((m) => m.fecha);
    expect([...fechas].sort().reverse()).toEqual(fechas);
    // empate sin hora: gana el id mayor primero
    const del3 = d.buscarMovimientos({ desde: '2026-10-03', hasta: '2026-10-03' }).items.map((m) => m.comercio);
    expect(del3).toEqual(['Empate B', 'Empate A', 'Comercio 2']);
  });

  it('la página exacta no deja cursor colgando', () => {
    const { d } = nueva();
    d.crearMovimiento(gasto(), 'bot');
    d.crearMovimiento(gasto({ comercio: 'Otro' }), 'bot');
    expect(d.buscarMovimientos({ limite: 2 }).siguiente_cursor).toBeNull();
    expect(d.buscarMovimientos({ limite: 1 }).siguiente_cursor).not.toBeNull();
  });

  it('filtros', () => {
    const { d } = nueva();
    d.crearMovimiento(gasto({ comercio: 'Rappi 100%', monto: 30000 }), 'bot');
    d.crearMovimiento(gasto({ comercio: 'Rappi centro', monto: 80000, fecha: '2026-09-20' }), 'bot');
    d.crearMovimiento(gasto({ comercio: 'Sueldo', tipo: 'ingreso', sentido: 'entrada', monto: 900000 }), 'bot');
    expect(d.buscarMovimientos({ q: 'rappi' }).items).toHaveLength(2);
    expect(d.buscarMovimientos({ q: 'RAPPI' }).items).toHaveLength(2);
    expect(d.buscarMovimientos({ q: '%' }).items).toHaveLength(3);    // se normaliza: no actúa como comodín
    expect(d.buscarMovimientos({ q: 'r_ppi' }).items).toHaveLength(0);
    expect(d.buscarMovimientos({ desde: '2026-10-01' }).items).toHaveLength(2);
    expect(d.buscarMovimientos({ hasta: '2026-09-30' }).items).toHaveLength(1);
    expect(d.buscarMovimientos({ sentido: 'entrada' }).items).toHaveLength(1);
    expect(d.buscarMovimientos({ tipo: 'ingreso' }).items).toHaveLength(1);
    expect(d.buscarMovimientos({ min: 50000 }).items).toHaveLength(2);
    expect(d.buscarMovimientos({ max: 50000 }).items).toHaveLength(1);
    expect(d.buscarMovimientos({ categoria_id: 'ingresos' }).items).toHaveLength(1);
    expect(d.buscarMovimientos({ banco: 'efectivo', origen: 'manual' }).items).toHaveLength(3);
    expect(d.buscarMovimientos({ banco: 'wompi' }).items).toHaveLength(0);
  });

  it('entradas hostiles no rompen ni inyectan', () => {
    const { d } = nueva();
    d.crearMovimiento(gasto(), 'bot');
    expect(() => d.buscarMovimientos({ cursor: 'basura' })).toThrow(ErrorUsuario);
    expect(() => d.buscarMovimientos({ banco: "x' OR 1=1 --" as never })).toThrow(ErrorUsuario);
    expect(() => d.buscarMovimientos({ desde: "2026-01-01' OR '1'='1" })).toThrow(ErrorUsuario);
    expect(d.buscarMovimientos({ categoria_id: "mercado' OR 1=1 --" }).items).toHaveLength(0);
    expect(d.buscarMovimientos({ q: "'; DROP TABLE movimientos; --" }).items).toHaveLength(0);
    expect(d.buscarMovimientos({}).items).toHaveLength(1);
    expect(d.buscarMovimientos({ limite: 9999 }).items).toHaveLength(1);
  });
});

describe('editar, recategorizar, borrar y deshacer', () => {
  it('editar exige la versión (concurrencia optimista)', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    const e = d.editarMovimiento(m.id, { version: 1, monto: 25000, nota: 'con propina' }, 'panel');
    expect(e).toMatchObject({ monto: 25000, nota: 'con propina', version: 2 });
    try {
      d.editarMovimiento(m.id, { version: 1, monto: 1 }, 'bot');
      throw new Error('debía fallar');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorConflicto);
      expect((err as ErrorConflicto).version_actual).toBe(2);
    }
    expect(() => d.editarMovimiento(999, { version: 1 }, 'bot')).toThrow(ErrorUsuario);
  });

  it('editar tipo ajusta el sentido; categoría pasa a manual; valida', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    const e = d.editarMovimiento(m.id, { version: 1, tipo: 'ingreso', categoria_id: 'ingresos' }, 'bot');
    expect(e).toMatchObject({ tipo: 'ingreso', sentido: 'entrada', categoria_fuente: 'manual' });
    const i = d.editarMovimiento(m.id, { version: 2, tipo: 'interno' }, 'bot');
    expect(i.computa).toBe(false);
    expect(() => d.editarMovimiento(m.id, { version: 3, monto: -5 }, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.editarMovimiento(m.id, { version: 3, categoria_id: 'zzz' }, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.editarMovimiento(m.id, { version: 3, fijo_id: 999 }, 'bot')).toThrow(ErrorUsuario);
  });

  it('una transferencia que no es manual nace sin contar; un gasto manual o un retiro siempre cuentan', () => {
    const { d } = nueva();
    const t = d.crearMovimiento(gasto({ tipo: 'transferencia', comercio: 'Juan Perez', origen: 'aviso' }), 'bot');
    expect(t).toMatchObject({ tipo: 'transferencia', computa: false, categoria_id: 'transferencias' });
    expect(d.crearMovimiento(gasto({ tipo: 'transferencia', comercio: 'Juan Perez', origen: 'aviso', computa: true, fecha: '2026-10-09' }), 'bot').computa).toBe(true);
    expect(d.crearMovimiento(gasto({ tipo: 'transferencia', comercio: 'Pago a mano', fecha: '2026-10-08' }), 'panel').computa).toBe(true);   // manual
    expect(d.crearMovimiento(gasto({ tipo: 'retiro', origen: 'aviso', comercio: 'Cajero X', fecha: '2026-10-07' }), 'bot').computa).toBe(true);
  });

  it('marcar una transferencia como gasto (computa) se puede deshacer', () => {
    const { d } = nueva();
    const t = d.crearMovimiento(gasto({ tipo: 'transferencia', comercio: 'Juan Perez', origen: 'aviso' }), 'bot');
    const e = d.editarMovimiento(t.id, { version: t.version, computa: true }, 'bot');
    expect(e).toMatchObject({ computa: true, categoria_id: 'transferencias' });
    expect(d.deshacerUltima('bot', AHORA)).not.toBeNull();
    expect(d.obtenerMovimiento(t.id)?.computa).toBe(false);
  });

  it('deshacer una edición restaura todo', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    d.editarMovimiento(m.id, { version: 1, monto: 99999, comercio: 'Otro lugar', fecha: '2026-10-01' }, 'bot');
    const r = d.deshacerUltima('bot', AHORA);
    expect(r?.descripcion).toBe('Editaste Tienda D1 prueba');
    expect(d.obtenerMovimiento(m.id)).toMatchObject({ monto: 20000, comercio: 'Tienda D1 prueba', fecha: '2026-10-10', version: 3 });
  });

  it('recategorizar aprende la regla y cambia los anteriores del mismo comercio (excepto los puestos a mano)', () => {
    const { db, d } = nueva();
    const a = d.crearMovimiento(gasto({ comercio: 'Kiosco Pepe', fecha: '2026-10-01' }), 'bot');
    const b = d.crearMovimiento(gasto({ comercio: 'Kiosco Pepe', fecha: '2026-10-02' }), 'bot');
    const c = d.crearMovimiento(gasto({ comercio: 'Kiosco Pepe', fecha: '2026-10-03', categoria_id: 'ocio' }), 'bot');   // manual
    const r = d.recategorizar(b.id, 'comida', 'bot');
    expect(r.aplicados_a).toBe(1);
    expect(r.movimiento).toMatchObject({ categoria_id: 'comida', categoria_fuente: 'manual' });
    expect(d.obtenerMovimiento(a.id)).toMatchObject({ categoria_id: 'comida', categoria_fuente: 'aprendida' });
    expect(d.obtenerMovimiento(c.id)).toMatchObject({ categoria_id: 'ocio' });
    expect(db.prepare("SELECT categoria_id, origen FROM reglas_categoria WHERE patron = 'kiosco pepe'").get()).toMatchObject({ categoria_id: 'comida', origen: 'aprendida' });
    // lo próximo de ese comercio ya cae en comida
    expect(d.crearMovimiento(gasto({ comercio: 'KIOSCO PEPE sede 2' }), 'bot')).toMatchObject({ categoria_id: 'comida', categoria_fuente: 'aprendida' });
  });

  it('recategorizar sobre una semilla la reemplaza; deshacer devuelve todo', () => {
    const { db, d } = nueva();
    const a = d.crearMovimiento(gasto({ comercio: 'rappi' }), 'bot');
    expect(a.categoria_id).toBe('comida');
    d.recategorizar(a.id, 'ocio', 'panel');
    expect(db.prepare("SELECT categoria_id, origen FROM reglas_categoria WHERE patron = 'rappi'").get()).toMatchObject({ categoria_id: 'ocio', origen: 'aprendida' });
    d.deshacerUltima('panel', AHORA);
    expect(db.prepare("SELECT categoria_id, origen FROM reglas_categoria WHERE patron = 'rappi'").get()).toMatchObject({ categoria_id: 'comida', origen: 'semilla' });
    expect(d.obtenerMovimiento(a.id)).toMatchObject({ categoria_id: 'comida', categoria_fuente: 'regla' });
  });

  it('deshacer recategorizar con regla nueva la elimina', () => {
    const { db, d } = nueva();
    const a = d.crearMovimiento(gasto({ comercio: 'Sitio unico' }), 'bot');
    d.recategorizar(a.id, 'ocio', 'bot');
    expect(n(db, "SELECT count(*) AS n FROM reglas_categoria WHERE patron = 'sitio unico'")).toBe(1);
    d.deshacerUltima('bot', AHORA);
    expect(n(db, "SELECT count(*) AS n FROM reglas_categoria WHERE patron = 'sitio unico'")).toBe(0);
  });

  it('borrar es lógico y se deshace; lo borrado no aparece', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    const { accion_id } = d.borrarMovimiento(m.id, 'bot');
    expect(d.obtenerMovimiento(m.id)).toBeNull();
    expect(d.buscarMovimientos({}).items).toHaveLength(0);
    expect(() => d.borrarMovimiento(m.id, 'bot')).toThrow(ErrorUsuario);
    expect(d.deshacer(accion_id, AHORA)).toMatchObject({ accion_id, descripcion: 'Ignoraste Tienda D1 prueba' });
    expect(d.obtenerMovimiento(m.id)).toMatchObject({ id: m.id });
    expect(d.deshacer(accion_id, AHORA)).toBeNull();   // ya deshecha
  });

  it('deshacer una creación la borra; deshacerUltima toma la más reciente viva', () => {
    const { d } = nueva();
    const a = d.crearMovimiento(gasto({ comercio: 'Uno' }), 'bot');
    const b = d.crearMovimiento(gasto({ comercio: 'Dos' }), 'bot');
    expect(d.deshacerUltima('bot', AHORA)?.descripcion).toBe('Registraste Dos');
    expect(d.obtenerMovimiento(b.id)).toBeNull();
    expect(d.deshacerUltima('bot', AHORA)?.descripcion).toBe('Registraste Uno');
    expect(d.obtenerMovimiento(a.id)).toBeNull();
    expect(d.deshacerUltima('bot', AHORA)).toBeNull();
  });

  it('ventana de 24 horas', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    const en25h = new Date(AHORA.getTime() + 25 * 3_600_000);
    expect(d.deshacerUltima('bot', en25h)).toBeNull();
    expect(d.deshacer(1, en25h)).toBeNull();
    expect(d.obtenerMovimiento(m.id)).not.toBeNull();
    expect(d.deshacerUltima('bot', new Date(AHORA.getTime() + 23 * 3_600_000))).not.toBeNull();
  });

  it('un error dentro de la operación no deja medias escrituras', () => {
    const { db, d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    expect(() => d.editarMovimiento(m.id, { version: 1, monto: 5, categoria_id: 'zzz' }, 'bot')).toThrow();
    expect(d.obtenerMovimiento(m.id)).toMatchObject({ monto: 20000, version: 1 });
    expect(n(db, 'SELECT count(*) AS n FROM acciones')).toBe(1);
  });
});

describe('configuración, presupuestos, fijos', () => {
  it('config: valores por defecto, fijar, validar y deshacer', () => {
    const { d } = nueva();
    expect(d.leerConfig().pct_ahorro).toBe(10);
    d.fijarConfig('ingreso_mensual', 4_000_000, 'bot');
    d.fijarConfig('pct_ahorro', 15, 'panel');
    expect(d.leerConfig()).toMatchObject({ ingreso_mensual: 4000000, pct_ahorro: 15 });
    expect(() => d.fijarConfig('pct_ahorro', 99, 'bot')).toThrow(ErrorUsuario);
    d.deshacerUltima('panel', AHORA);
    expect(d.leerConfig().pct_ahorro).toBe(10);
    d.fijarConfig('nocturno', { desde: '23:00', hasta: '04:00' }, 'bot');
    expect(d.leerConfig().nocturno).toEqual({ desde: '23:00', hasta: '04:00' });
  });

  it('presupuestos: mes, siempre, quitar, validación y deshacer', () => {
    const { db, d } = nueva();
    d.fijarPresupuesto('2026-10', 'comida', 400000, 'bot');
    d.fijarPresupuesto('*', '*', 2_000_000, 'bot');
    expect(d.instantanea(AHORA).presupuestos).toEqual([
      { mes: '*', categoria_id: '*', monto: 2000000 }, { mes: '2026-10', categoria_id: 'comida', monto: 400000 },
    ]);
    d.fijarPresupuesto('2026-10', 'comida', 500000, 'bot');
    expect(n(db, "SELECT monto AS n FROM presupuestos WHERE categoria_id = 'comida'")).toBe(500000);
    d.deshacerUltima('bot', AHORA);
    expect(n(db, "SELECT monto AS n FROM presupuestos WHERE categoria_id = 'comida'")).toBe(400000);
    d.fijarPresupuesto('2026-10', 'comida', null, 'bot');
    expect(n(db, "SELECT count(*) AS n FROM presupuestos WHERE categoria_id = 'comida'")).toBe(0);
    d.deshacerUltima('bot', AHORA);
    expect(n(db, "SELECT count(*) AS n FROM presupuestos WHERE categoria_id = 'comida'")).toBe(1);
    expect(() => d.fijarPresupuesto('2026-13', 'comida', 1000, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.fijarPresupuesto('2026-10', 'ingresos', 1000, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.fijarPresupuesto('2026-10', 'comida', 0, 'bot')).toThrow(ErrorUsuario);
  });

  it('fijos: guardar, actualizar por nombre, quitar y deshacer', () => {
    const { d } = nueva();
    const f = d.guardarFijo({ nombre: 'Arriendo', monto: 1_200_000, dia_mes: 5, patron: 'arriendo' }, 'bot');
    expect(f).toMatchObject({ nombre: 'Arriendo', monto: 1200000, dia_mes: 5, patron: 'arriendo', categoria_id: 'servicios', activo: true });
    const f2 = d.guardarFijo({ nombre: 'ARRIENDO', monto: 1_300_000, dia_mes: null, patron: null }, 'bot');
    expect(f2.id).toBe(f.id);
    expect(d.listarFijos()).toHaveLength(1);
    d.deshacerUltima('bot', AHORA);
    expect(d.listarFijos()[0]).toMatchObject({ monto: 1200000, dia_mes: 5 });
    expect(d.quitarFijo('arriendo', 'bot')).toBe(true);
    expect(d.listarFijos()).toHaveLength(0);
    expect(d.quitarFijo('arriendo', 'bot')).toBe(false);
    d.deshacerUltima('bot', AHORA);
    expect(d.listarFijos()).toHaveLength(1);
    d.deshacerUltima('bot', AHORA);
    d.deshacerUltima('bot', AHORA);
    expect(d.listarFijos()).toHaveLength(0);   // se deshizo hasta la creación
    expect(() => d.guardarFijo({ nombre: '', monto: 5, dia_mes: null, patron: null }, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.guardarFijo({ nombre: 'x', monto: 0, dia_mes: null, patron: null }, 'bot')).toThrow(ErrorUsuario);
    expect(() => d.guardarFijo({ nombre: 'x', monto: 5, dia_mes: 40, patron: null }, 'bot')).toThrow(ErrorUsuario);
  });

  it('un movimiento nuevo se liga al fijo cuyo patrón coincide (±25 %)', () => {
    const { d } = nueva();
    const f = d.guardarFijo({ nombre: 'Internet', monto: 100000, dia_mes: 3, patron: 'internet casa' }, 'bot');
    expect(d.crearMovimiento(gasto({ comercio: 'Internet Casa', monto: 110000 }), 'bot').fijo_id).toBe(f.id);
    expect(d.crearMovimiento(gasto({ comercio: 'Internet Casa', monto: 200000 }), 'bot').fijo_id).toBeNull();
  });
});

describe('metas', () => {
  it('crear, aportar, retirar, saldo y estado', () => {
    const { d } = nueva();
    const m = d.crearMeta({ nombre: 'Viaje', objetivo: 3_000_000, fecha_objetivo: '2027-06-30' });
    expect(m).toMatchObject({ nombre: 'Viaje', emoji: '🎯', estado: 'activa', objetivo: 3000000 });
    expect(() => d.crearMeta({ nombre: 'viaje', objetivo: 1000, fecha_objetivo: null })).toThrow(/Ya tienes/);
    d.aportarMeta(m.id, 200000, '2026-10-06', 'bot');
    d.aportarMeta(m.id, 100000, '2026-10-07', 'bot');
    expect(d.buscarMetaPorNombre('VIAJE')).toMatchObject({ aportado: 300000, aportes: [{ monto: 200000 }, { monto: 100000 }] });
    d.aportarMeta(m.id, -50000, '2026-10-08', 'bot');
    expect(d.buscarMetaPorNombre('viaje')?.aportado).toBe(250000);
    try {
      d.aportarMeta(m.id, -300000, '2026-10-09', 'bot');
      throw new Error('debía fallar');
    } catch (e) {
      expect((e as ErrorUsuario).codigo).toBe('saldo_negativo');
    }
    expect(() => d.aportarMeta(m.id, 0, '2026-10-09', 'bot')).toThrow(ErrorUsuario);
    expect(() => d.aportarMeta(99, 10, '2026-10-09', 'bot')).toThrow(ErrorUsuario);
    d.deshacerUltima('bot', AHORA);   // deshace el retiro de 50k
    expect(d.buscarMetaPorNombre('viaje')?.aportado).toBe(300000);
    expect(d.cambiarEstadoMeta(m.id, 'pausada').estado).toBe('pausada');
    expect(d.instantanea(AHORA).metas).toHaveLength(1);
    expect(d.cambiarEstadoMeta(m.id, 'cancelada').estado).toBe('cancelada');
    expect(d.buscarMetaPorNombre('viaje')).toBeNull();
    expect(d.instantanea(AHORA).metas).toHaveLength(0);
    expect(() => d.cambiarEstadoMeta(99, 'activa')).toThrow(ErrorUsuario);
    // ya se puede crear otra con el mismo nombre
    expect(d.crearMeta({ nombre: 'Viaje', objetivo: 1000, fecha_objetivo: null }).id).not.toBe(m.id);
  });
});

describe('lista de espera', () => {
  it('48 h, no duplica, extender, comprar, descartar y recordar', () => {
    const { d } = nueva();
    const it1 = d.agregarEspera('Audífonos', 80000, 'compras', AHORA);
    expect(it1).toMatchObject({ estado: 'esperando', disponible_en: '2026-10-17T17:00:00Z', recordado_en: null });
    expect(d.agregarEspera('audifonos', 80000, 'compras', AHORA).id).toBe(it1.id);
    d.marcarEsperaRecordada([it1.id], AHORA);
    expect(d.instantanea(AHORA).lista_espera[0].recordado_en).toBe('2026-10-15T17:00:00Z');
    const ext = d.actualizarEspera(it1.id, 'extender', AHORA)!;
    expect(ext).toMatchObject({ disponible_en: '2026-10-19T17:00:00Z', recordado_en: null });
    expect(d.actualizarEspera(it1.id, 'descartado', AHORA)?.estado).toBe('descartado');
    expect(d.actualizarEspera(it1.id, 'comprado', AHORA)).toBeNull();
    expect(d.instantanea(AHORA).lista_espera).toHaveLength(0);
    const it2 = d.agregarEspera('Chaqueta', 300000, 'compras', AHORA);
    expect(d.actualizarEspera(it2.id, 'comprado', AHORA)?.estado).toBe('comprado');
    expect(() => d.agregarEspera('', 5, 'compras', AHORA)).toThrow(ErrorUsuario);
    expect(() => d.agregarEspera('x', 5, 'zzz', AHORA)).toThrow(ErrorUsuario);
  });

  it('respeta horas_espera_impulso de la config', () => {
    const { d } = nueva();
    d.fijarConfig('horas_espera_impulso', 24, 'bot');
    expect(d.agregarEspera('Cosa', 10000, 'otros', AHORA).disponible_en).toBe('2026-10-16T17:00:00Z');
  });
});

describe('emisiones, eventos y latidos', () => {
  const rec = (id: string, valor: number, sev: Recomendacion['severidad'] = 'aviso'): Recomendacion => ({
    id, regla: id.split(':')[0] as Recomendacion['regla'], severidad: sev, prioridad: 1, titulo: 't', detalle_con_cifras: 'd', cifras: {}, push: true, valor_ref: valor,
  });

  it('registrarEmisiones acumula veces y conserva la silenciada', () => {
    const { d } = nueva();
    d.registrarEmisiones([rec('riesgo_fin_de_mes:2026-10', 1.1)], AHORA);
    d.silenciar('riesgo_fin_de_mes:2026-10', '2026-11-01T00:00:00Z');
    d.registrarEmisiones([rec('riesgo_fin_de_mes:2026-10', 1.3, 'alerta')], new Date('2026-10-16T17:00:00Z'));
    const e = d.instantanea(AHORA).emisiones;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      clave: 'riesgo_fin_de_mes:2026-10', regla: 'riesgo_fin_de_mes', severidad: 'alerta', valor_ref: 1.3, veces: 2,
      primera_en: '2026-10-15T17:00:00Z', ultima_en: '2026-10-16T17:00:00Z', silenciada_hasta: '2026-11-01T00:00:00Z',
    });
  });

  it('silenciar una clave nueva la crea', () => {
    const { d } = nueva();
    d.silenciar('posible_duplicado:1-2', '9999-12-31T00:00:00Z');
    expect(d.instantanea(AHORA).emisiones[0]).toMatchObject({ clave: 'posible_duplicado:1-2', silenciada_hasta: '9999-12-31T00:00:00Z' });
  });

  it('registrarEvento enmascara dígitos', () => {
    const { db, d } = nueva();
    d.registrarEvento({ nivel: 'info', tipo: 'prueba', detalle: 'tarjeta 4111111111111111', ref: 'x' });
    expect((db.prepare('SELECT detalle FROM eventos').get() as { detalle: string }).detalle).not.toMatch(/\d{4}/);
  });

  it('latidos van al estado del sistema', () => {
    const { db, d } = nueva();
    registrarLatido(db, 'bot', AHORA);
    registrarLatido(db, 'bot', new Date('2026-10-15T17:05:00Z'));
    registrarLatido(db, 'ingesta', AHORA);
    expect(d.instantanea(AHORA).sistema.latidos).toEqual({ bot: '2026-10-15T17:05:00Z', ingesta: '2026-10-15T17:00:00Z' });
  });
});

describe('instantánea', () => {
  it('base vacía: estructura completa y vacía', () => {
    const { d } = nueva();
    const i = d.instantanea(AHORA);
    expect(i.ahora).toBe(AHORA);
    expect(i.categorias).toHaveLength(16);
    expect(i.reglas.length).toBe(221);
    expect(i.movimientos).toEqual([]);
    expect(i.config.pct_ahorro).toBe(10);
    expect(i.sistema).toEqual({
      ultimo_aviso_en: null, avisos_promedio_diario_90d: 0, por_revisar_pendientes: 0, por_revisar_mas_viejo_en: null, latidos: {}, pin_bloqueado_hasta: null,
    });
  });

  it('solo movimientos vivos de los últimos 400 días hasta hoy', () => {
    const { d } = nueva();
    d.crearMovimiento(gasto({ fecha: '2026-10-15' }), 'bot');
    d.crearMovimiento(gasto({ fecha: '2026-10-16', comercio: 'Futuro' }), 'bot');
    d.crearMovimiento(gasto({ fecha: '2025-01-01', comercio: 'Viejo' }), 'bot');
    const b = d.crearMovimiento(gasto({ fecha: '2026-10-14', comercio: 'Borrado' }), 'bot');
    d.borrarMovimiento(b.id, 'bot');
    expect(d.instantanea(AHORA).movimientos.map((m) => m.fecha)).toEqual(['2026-10-15']);
    expect(d.instantanea(AHORA).movimientos[0].computa).toBe(true);   // booleanos reales
  });

  it('estado del sistema: avisos, por revisar y bloqueo del PIN', () => {
    const { db, d } = nueva();
    const ins = db.prepare("INSERT INTO avisos_procesados (ref_correo, estado, procesado_en) VALUES (?, 'ignorado', ?)");
    ins.run('mid:aaaaaaaa01', '2026-10-13T10:00:00Z');
    ins.run('mid:aaaaaaaa02', '2026-10-14T10:00:00Z');
    ins.run('mid:aaaaaaaa03', '2026-10-14T11:00:00Z');
    ins.run('mid:aaaaaaaa04', '2026-10-15T10:00:00Z');
    db.prepare(
      `INSERT INTO por_revisar (ref_correo, remitente_dominio, asunto, texto, fecha_correo, motivo, creado_en)
       VALUES ('mid:rev000001', 'x.test', 'a', 't', '2026-10-14T00:00:00Z', 'formato_desconocido', '2026-10-14T00:00:00Z')`,
    ).run();
    db.prepare("INSERT INTO limites (clave, ventana_desde, ventana_24h_desde, bloqueado_hasta) VALUES ('pin', 'a', 'b', '2026-10-15T18:00:00Z')").run();
    const s = d.instantanea(AHORA).sistema;
    expect(s).toMatchObject({
      ultimo_aviso_en: '2026-10-15T10:00:00Z', por_revisar_pendientes: 1, por_revisar_mas_viejo_en: '2026-10-14T00:00:00Z',
      pin_bloqueado_hasta: '2026-10-15T18:00:00Z',
    });
    expect(s.avisos_promedio_diario_90d).toBeCloseTo(4 / 3, 5);   // 4 avisos en 3 días de historia
    expect(d.instantanea(new Date('2026-10-15T19:00:00Z')).sistema.pin_bloqueado_hasta).toBeNull();
  });
});

describe('cerrarDiasPendientes', () => {
  it('guarda una foto por día cerrado y no recalcula las existentes', () => {
    const { db, d } = nueva();
    d.fijarConfig('ingreso_mensual', 3_100_000, 'bot');
    d.crearMovimiento(gasto({ fecha: '2026-10-12', monto: 30000 }), 'bot');
    d.crearMovimiento(gasto({ fecha: '2026-10-13', monto: 500000, comercio: 'Grande' }), 'bot');
    cerrarDiasPendientes(db, AHORA);
    const dias = db.prepare('SELECT * FROM dias ORDER BY fecha').all() as Record<string, unknown>[];
    expect(dias.map((x) => x.fecha)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(dias[0]).toMatchObject({ gastado: 30000, modo: 'ingreso_configurado' });
    expect(dias[1].gastado).toBe(500000);
    expect(dias[1].bajo_limite).toBe(0);
    expect(dias[2].gastado).toBe(0);
    expect(dias[2].bajo_limite).toBe(1);

    // cambiar la config no cambia lo cerrado
    d.fijarConfig('ingreso_mensual', 9_000_000, 'bot');
    const antes = JSON.stringify(dias);
    cerrarDiasPendientes(db, AHORA);
    expect(JSON.stringify(db.prepare('SELECT * FROM dias ORDER BY fecha').all())).toBe(antes);

    // al día siguiente se agrega solo el que falta
    cerrarDiasPendientes(db, new Date('2026-10-16T17:00:00Z'));
    expect(n(db, 'SELECT count(*) AS n FROM dias')).toBe(4);
  });

  it('instantanea() cierra los días y los devuelve', () => {
    const { d } = nueva();
    d.crearMovimiento(gasto({ fecha: '2026-10-13' }), 'bot');
    const i = d.instantanea(AHORA);
    expect(i.dias.map((x) => x.fecha)).toEqual(['2026-10-13', '2026-10-14']);
    expect(i.dias[0].bajo_limite).toBeNull();    // sin base de cálculo no hay límite
    expect(i.dias[0].modo).toBe('sin_datos');
  });

  it('sin movimientos no hace nada', () => {
    const { db } = nueva();
    cerrarDiasPendientes(db, AHORA);
    expect(n(db, 'SELECT count(*) AS n FROM dias')).toBe(0);
  });
});

describe('refrescarRecurrentes', () => {
  function netflix(d: AccesoDatos, meses: string[], monto = 29900) {
    for (const f of meses) d.crearMovimiento(gasto({ fecha: f, comercio: 'NETFLIX.COM', monto, banco: 'bancolombia', origen: 'aviso' }), 'sistema');
  }

  it('detecta, guarda y liga los movimientos', () => {
    const { db, d } = nueva();
    netflix(d, ['2026-07-05', '2026-08-05', '2026-09-05']);
    refrescarRecurrentes(db, '2026-10-15');
    const r = d.instantanea(AHORA).recurrentes;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      comercio_norm: 'netflix com', clase: 'suscripcion', periodo: 'mensual', monto_tipico: 29900, ocurrencias: 3, activa: true,
      estado: 'detectada', proximo_cobro: '2026-11-05', costo_anual: 358800, costo_mensual: 29900,
    });
    expect(r[0].movimiento_ids).toHaveLength(3);
    expect(d.ultimosMovimientos(5).every((m) => m.recurrente_id === r[0].id)).toBe(true);
  });

  it('respeta el estado decidido por Jero al refrescar de nuevo', () => {
    const { db, d } = nueva();
    netflix(d, ['2026-07-05', '2026-08-05', '2026-09-05']);
    refrescarRecurrentes(db, '2026-10-15');
    const id = d.instantanea(AHORA).recurrentes[0].id;
    expect(d.cambiarEstadoRecurrente(id, 'descartada')?.estado).toBe('descartada');
    netflix(d, ['2026-10-05']);
    refrescarRecurrentes(db, '2026-10-15');
    const r = d.instantanea(AHORA).recurrentes;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id, estado: 'descartada', ocurrencias: 4 });
    expect(d.cambiarEstadoRecurrente(999, 'confirmada')).toBeNull();
  });

  it('lo que deja de detectarse queda inactivo sin borrarse', () => {
    const { db, d } = nueva();
    netflix(d, ['2026-07-05', '2026-08-05', '2026-09-05']);
    refrescarRecurrentes(db, '2026-10-15');
    for (const m of d.ultimosMovimientos(10)) d.borrarMovimiento(m.id, 'bot');
    refrescarRecurrentes(db, '2026-10-15');
    const r = d.instantanea(AHORA).recurrentes;
    expect(r).toHaveLength(1);
    expect(r[0].activa).toBe(false);
  });
});

describe('bot sin comandos: estado de conversación, última acción y recategorizar sin aprender', () => {
  it('guarda, lee, reemplaza y borra el estado; vence a los 15 minutos', () => {
    const { db, d } = nueva();
    expect(d.leerEstadoBot('123456789', AHORA)).toBeNull();
    d.guardarEstadoBot('123456789', { flujo: 'gasto', datos: { n: 'a1', paso: 'monto', d: '25' } }, AHORA);
    expect(d.leerEstadoBot('123456789', AHORA)).toEqual({ flujo: 'gasto', datos: { n: 'a1', paso: 'monto', d: '25' } });
    expect(d.leerEstadoBot('999', AHORA)).toBeNull();   // una conversación por chat
    d.guardarEstadoBot('123456789', { flujo: 'puedo', datos: { n: 'b2' } }, AHORA);
    expect(n(db, 'SELECT count(*) AS n FROM bot_estado')).toBe(1);
    expect(d.leerEstadoBot('123456789', AHORA)?.flujo).toBe('puedo');
    expect(d.leerEstadoBot('123456789', new Date(AHORA.getTime() + 14 * 60_000))).not.toBeNull();
    expect(d.leerEstadoBot('123456789', new Date(AHORA.getTime() + 15 * 60_000))).toBeNull();
    d.borrarEstadoBot('123456789');
    expect(d.leerEstadoBot('123456789', AHORA)).toBeNull();
  });

  it('el estado vencido se purga con el mantenimiento', async () => {
    const { db, d } = nueva();
    d.guardarEstadoBot('1', { flujo: 'gasto', datos: {} }, AHORA);
    const { mantenimiento } = await import('./db');
    mantenimiento(db, new Date(AHORA.getTime() + 60 * 60_000));
    expect(n(db, 'SELECT count(*) AS n FROM bot_estado')).toBe(0);
  });

  it('ultimaAccionDe devuelve la última acción vigente de ese movimiento', () => {
    const { d } = nueva();
    const m = d.crearMovimiento(gasto(), 'bot');
    const a = d.ultimaAccionDe(m.id);
    expect(a).not.toBeNull();
    expect(d.ultimaAccionDe(9999)).toBeNull();
    d.recategorizar(m.id, 'ocio', 'bot');
    const b = d.ultimaAccionDe(m.id);
    expect(b).toBeGreaterThan(a as number);
    d.deshacer(b as number, reloj);
    expect(d.ultimaAccionDe(m.id)).toBe(a);
  });

  it('recategorizar con aprender:false solo cambia ese movimiento: sin regla y sin tocar los demás', () => {
    const { db, d } = nueva();
    const a = d.crearMovimiento(gasto({ comercio: 'Tienda Rara 1', categoria_id: 'otros' }), 'bot');
    const b = d.crearMovimiento(gasto({ comercio: 'Tienda Rara 1', fecha: '2026-10-09' }), 'bot');
    const reglas = n(db, 'SELECT count(*) AS n FROM reglas_categoria');
    const r = d.recategorizar(a.id, 'ocio', 'bot', { aprender: false });
    expect(r.aplicados_a).toBe(0);
    expect(r.movimiento).toMatchObject({ categoria_id: 'ocio', categoria_fuente: 'manual' });
    expect(d.obtenerMovimiento(b.id)!.categoria_id).not.toBe('ocio');
    expect(n(db, 'SELECT count(*) AS n FROM reglas_categoria')).toBe(reglas);
    // y deshacer lo revierte
    d.deshacer(d.ultimaAccionDe(a.id) as number, reloj);
    expect(d.obtenerMovimiento(a.id)!.categoria_id).toBe('otros');
    // por defecto sí aprende
    const c = d.recategorizar(b.id, 'ocio', 'bot');
    expect(c.movimiento.categoria_id).toBe('ocio');
    expect(n(db, 'SELECT count(*) AS n FROM reglas_categoria')).toBe(reglas + 1);
  });
});
