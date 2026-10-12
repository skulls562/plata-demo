// AccesoDatos en memoria para probar bot.ts e ia.ts sin base de datos (SPEC §8.2). Datos sintéticos.
import { aBogota, normalizarComercio } from '@/lib/formato';
import {
  ErrorConflicto, ErrorUsuario,
  type AccesoDatos, type Actor, type AporteMeta, type Categoria, type ConfigPlata, type EmisionPrevia,
  type FiltroMovimientos, type GastoFijo, type Instantanea, type ItemEspera, type Meta, type MetaConAportes,
  type Movimiento, type NuevoEvento, type NuevoMovimiento, type PaginaMovimientos, type Presupuesto,
  type Cuenta, type Deuda, type EstadoBot, type Recomendacion, type Recurrente, type ReglaCategoria,
} from '@/lib/tipos';
import { validarCuenta, validarDeuda } from '@/lib/cuentas-deudas';
import { CATEGORIAS_BASE, REGLAS_BASE, config as configBase, inst as instBase, metaConAportes, mov as movBase, sistemaVacio } from '../fixtures/constructores';

interface Accion { id: number; ts: Date; actor: Actor; descripcion: string; deshacer: () => void; deshecha: boolean; ent: number | null }

export interface EstadoFalso {
  ahora: Date;
  config: ConfigPlata;
  categorias: Categoria[];
  reglas: ReglaCategoria[];
  movimientos: Movimiento[];
  borrados: Set<number>;
  presupuestos: Presupuesto[];
  fijos: GastoFijo[];
  recurrentes: Recurrente[];
  metas: MetaConAportes[];
  espera: ItemEspera[];
  emisiones: EmisionPrevia[];
  silenciadas: Map<string, string>;
  eventos: NuevoEvento[];
  acciones: Accion[];
  estadosBot: Map<string, { estado: EstadoBot; expira: number }>;
  cuentas: Cuenta[];
  deudas: Deuda[];
}

export interface DatosFalsos extends AccesoDatos {
  estado: EstadoFalso;
  /** Nombres de los métodos de escritura llamados, en orden (para afirmar que no hubo efectos). */
  llamadas: string[];
}

const ESCRITURAS = new Set([
  'crearMovimiento', 'editarMovimiento', 'recategorizar', 'borrarMovimiento', 'deshacerUltima', 'deshacer',
  'fijarPresupuesto', 'fijarConfig', 'guardarFijo', 'quitarFijo', 'crearMeta', 'aportarMeta', 'cambiarEstadoMeta',
  'agregarEspera', 'actualizarEspera', 'marcarEsperaRecordada', 'cambiarEstadoRecurrente', 'registrarEmisiones', 'silenciar',
  'crearCuenta', 'editarCuenta', 'crearDeuda', 'editarDeuda',
]);

function iso(d: Date): string { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** Categoría por el patrón más largo (suficiente para las pruebas). */
function categorizarSimple(norm: string, reglas: ReglaCategoria[]): string {
  let mejor: ReglaCategoria | null = null;
  for (const r of reglas) {
    const ok = r.patron.length <= 3 ? new RegExp(`(^| )${r.patron}( |$)`).test(norm) : new RegExp(`(^| )${r.patron}`).test(norm);
    if (ok && (!mejor || r.patron.length > mejor.patron.length)) mejor = r;
  }
  return mejor?.categoria_id ?? 'otros';
}

export function crearDatosFalsos(semilla: Partial<Omit<EstadoFalso, 'borrados' | 'silenciadas' | 'eventos' | 'acciones' | 'estadosBot' | 'cuentas' | 'deudas'>> & { cuentas?: Cuenta[]; deudas?: Deuda[] } = {}): DatosFalsos {
  const e: EstadoFalso = {
    ahora: semilla.ahora ?? new Date('2026-10-15T17:00:00Z'),
    config: semilla.config ?? configBase(),
    categorias: semilla.categorias ?? CATEGORIAS_BASE.map((c) => ({ ...c })),
    reglas: semilla.reglas ?? REGLAS_BASE.map((r) => ({ ...r })),
    movimientos: semilla.movimientos ?? [],
    borrados: new Set(),
    presupuestos: semilla.presupuestos ?? [],
    fijos: semilla.fijos ?? [],
    recurrentes: semilla.recurrentes ?? [],
    metas: semilla.metas ?? [],
    espera: semilla.espera ?? [],
    emisiones: semilla.emisiones ?? [],
    silenciadas: new Map(),
    eventos: [],
    acciones: [],
    estadosBot: new Map(),
    cuentas: semilla.cuentas ?? [],
    deudas: semilla.deudas ?? [],
  };
  const llamadas: string[] = [];
  let sigId = Math.max(1000, ...e.movimientos.map((m) => m.id + 1));
  let sigAccion = 1;
  let sigMeta = Math.max(1, ...e.metas.map((m) => m.id + 1));
  let sigFijo = Math.max(1, ...e.fijos.map((f) => f.id + 1));
  let sigEspera = Math.max(1, ...e.espera.map((x) => x.id + 1));
  let sigAporte = 1;
  let sigCuenta = Math.max(1, ...e.cuentas.map((x) => x.id + 1));
  let sigDeuda = Math.max(1, ...e.deudas.map((x) => x.id + 1));

  const vivos = () => e.movimientos.filter((m) => !e.borrados.has(m.id));
  const find = (id: number) => vivos().find((m) => m.id === id) ?? null;
  const registrar = (actor: Actor, descripcion: string, deshacer: () => void, ent: number | null = null) => {
    const a: Accion = { id: sigAccion++, ts: e.ahora, actor, descripcion, deshacer, deshecha: false, ent };
    e.acciones.push(a);
    return a;
  };
  const reemplazar = (m: Movimiento) => { e.movimientos = e.movimientos.map((x) => (x.id === m.id ? m : x)); };

  const impl: AccesoDatos = {
    instantanea(ahora: Date): Instantanea {
      return instBase({
        ahora,
        config: e.config, categorias: e.categorias, reglas: e.reglas,
        movimientos: vivos(),
        presupuestos: e.presupuestos, fijos: e.fijos.filter((f) => f.activo), recurrentes: e.recurrentes,
        metas: e.metas.filter((m) => m.estado === 'activa' || m.estado === 'pausada'),
        lista_espera: e.espera.filter((x) => x.estado === 'esperando'),
        dias: [], emisiones: e.emisiones, sistema: sistemaVacio(),
        cuentas: e.cuentas, deudas: e.deudas.filter((d) => d.activa),
      });
    },
    ultimosMovimientos(n) {
      return [...vivos()].sort((a, b) => (b.fecha + (b.hora ?? '00:00')).localeCompare(a.fecha + (a.hora ?? '00:00')) || b.id - a.id).slice(0, n);
    },
    obtenerMovimiento: (id) => find(id),
    buscarMovimientos(f: FiltroMovimientos): PaginaMovimientos {
      let xs = vivos().filter((m) =>
        (!f.desde || m.fecha >= f.desde) && (!f.hasta || m.fecha <= f.hasta) &&
        (!f.categoria_id || m.categoria_id === f.categoria_id) && (!f.banco || m.banco === f.banco) &&
        (!f.tipo || m.tipo === f.tipo) && (!f.sentido || m.sentido === f.sentido) && (!f.origen || m.origen === f.origen) &&
        (!f.q || m.comercio_norm.includes(f.q)) && (f.min === undefined || m.monto >= f.min) && (f.max === undefined || m.monto <= f.max));
      xs = xs.sort((a, b) => (b.fecha + (b.hora ?? '00:00')).localeCompare(a.fecha + (a.hora ?? '00:00')) || b.id - a.id);
      const limite = Math.min(200, Math.max(1, f.limite ?? 50));
      const inicio = f.cursor ? Number(f.cursor) : 0;
      const items = xs.slice(inicio, inicio + limite);
      return { items, siguiente_cursor: inicio + limite < xs.length ? String(inicio + limite) : null };
    },
    crearMovimiento(n: NuevoMovimiento, actor): Movimiento {
      const norm = normalizarComercio(n.comercio);
      const m = movBase({
        id: sigId++, fecha: n.fecha, hora: n.hora, banco: n.banco, tipo: n.tipo, sentido: n.sentido, monto: n.monto,
        comercio: n.comercio, comercio_norm: norm,
        categoria_id: n.categoria_id ?? (n.tipo === 'ingreso' ? 'ingresos' : categorizarSimple(norm, e.reglas)),
        categoria_fuente: n.categoria_id ? 'manual' : (n.tipo === 'ingreso' || categorizarSimple(norm, e.reglas) !== 'otros' ? 'regla' : 'defecto'),
        medio: n.medio ?? null, nota: n.nota ?? null, computa: n.computa, origen: n.origen,
        confianza: n.origen === 'manual' ? 'manual' : 'regla', ref_correo: n.origen === 'manual' ? null : `mid:f${sigId}`,
      });
      e.movimientos.push(m);
      registrar(actor, `Registraste ${m.comercio}`, () => e.borrados.add(m.id), m.id);
      return m;
    },
    editarMovimiento(id, cambios, actor) {
      const actual = find(id);
      if (!actual) throw new ErrorUsuario('no_encontrado', 'Movimiento no encontrado');
      if (cambios.version !== actual.version) throw new ErrorConflicto(actual.version);
      const { version: _v, ...resto } = cambios;
      void _v;
      const nuevo: Movimiento = { ...actual, ...resto, version: actual.version + 1 } as Movimiento;
      if (cambios.comercio) nuevo.comercio_norm = normalizarComercio(cambios.comercio);
      if (cambios.categoria_id) nuevo.categoria_fuente = 'manual';
      reemplazar(nuevo);
      registrar(actor, `Editaste ${actual.comercio}`, () => reemplazar(actual), id);
      return nuevo;
    },
    recategorizar(id, categoria_id, actor, opciones) {
      const aprender = opciones?.aprender !== false;
      const actual = find(id);
      if (!actual) throw new ErrorUsuario('no_encontrado', 'Movimiento no encontrado');
      const antes = e.movimientos.map((m) => ({ ...m }));
      const reglasAntes = e.reglas.map((r) => ({ ...r }));
      const otros = !aprender ? [] : vivos().filter((m) => m.id !== id && m.comercio_norm === actual.comercio_norm && m.categoria_fuente !== 'manual' && m.categoria_id !== categoria_id);
      for (const o of otros) reemplazar({ ...o, categoria_id, categoria_fuente: 'aprendida', version: o.version + 1 });
      const nuevo = { ...actual, categoria_id, categoria_fuente: 'manual' as const, version: actual.version + 1 };
      reemplazar(nuevo);
      if (aprender && actual.comercio_norm && !e.reglas.some((r) => r.patron === actual.comercio_norm)) {
        e.reglas.push({ id: e.reglas.length + 100, patron: actual.comercio_norm, categoria_id, origen: 'aprendida', aciertos: 0 });
      }
      registrar(actor, `Cambiaste la categoría de ${actual.comercio}`, () => { e.movimientos = antes; e.reglas = reglasAntes; }, id);
      return { movimiento: nuevo, aplicados_a: otros.length };
    },
    borrarMovimiento(id, actor) {
      const actual = find(id);
      if (!actual) throw new ErrorUsuario('no_encontrado', 'Movimiento no encontrado');
      e.borrados.add(id);
      const a = registrar(actor, `Ignoraste ${actual.comercio}`, () => e.borrados.delete(id), id);
      return { accion_id: a.id };
    },
    ultimaAccionDe(movimiento_id) {
      const a = [...e.acciones].reverse().find((x) => !x.deshecha && x.ent === movimiento_id);
      return a ? a.id : null;
    },
    leerEstadoBot(chat_id, ahora) {
      const f = e.estadosBot.get(chat_id);
      return f && f.expira > ahora.getTime() ? { flujo: f.estado.flujo, datos: JSON.parse(JSON.stringify(f.estado.datos)) } : null;
    },
    guardarEstadoBot(chat_id, estado, ahora) {
      e.estadosBot.set(chat_id, { estado: JSON.parse(JSON.stringify(estado)), expira: ahora.getTime() + 15 * 60_000 });
    },
    borrarEstadoBot(chat_id) { e.estadosBot.delete(chat_id); },
    deshacerUltima(_actor, ahora) {
      void _actor;
      const vivas = e.acciones.filter((a) => !a.deshecha && ahora.getTime() - a.ts.getTime() <= 24 * 3_600_000);
      const a = vivas[vivas.length - 1];
      if (!a) return null;
      a.deshacer(); a.deshecha = true;
      return { accion_id: a.id, descripcion: a.descripcion };
    },
    deshacer(accion_id, ahora) {
      const a = e.acciones.find((x) => x.id === accion_id && !x.deshecha);
      if (!a || ahora.getTime() - a.ts.getTime() > 24 * 3_600_000) return null;
      a.deshacer(); a.deshecha = true;
      return { accion_id: a.id, descripcion: a.descripcion };
    },
    listarCategorias: () => e.categorias,
    fijarPresupuesto(mes, categoria_id, monto) {
      e.presupuestos = e.presupuestos.filter((p) => !(p.mes === mes && p.categoria_id === categoria_id));
      if (monto !== null) e.presupuestos.push({ mes, categoria_id, monto });
    },
    leerConfig: () => e.config,
    fijarConfig(clave, valor) { e.config = { ...e.config, [clave]: valor }; },
    listarFijos: () => e.fijos.filter((f) => f.activo),
    guardarFijo(f) {
      const existente = e.fijos.find((x) => normalizarComercio(x.nombre) === normalizarComercio(f.nombre));
      const nuevo: GastoFijo = { id: existente?.id ?? sigFijo++, nombre: f.nombre, monto: f.monto, dia_mes: f.dia_mes, patron: f.patron, categoria_id: f.categoria_id ?? 'servicios', activo: true };
      e.fijos = existente ? e.fijos.map((x) => (x.id === nuevo.id ? nuevo : x)) : [...e.fijos, nuevo];
      return nuevo;
    },
    quitarFijo(nombre) {
      const f = e.fijos.find((x) => x.activo && normalizarComercio(x.nombre) === normalizarComercio(nombre));
      if (!f) return false;
      e.fijos = e.fijos.map((x) => (x.id === f.id ? { ...x, activo: false } : x));
      return true;
    },
    crearMeta(m): Meta {
      const meta = metaConAportes({ id: sigMeta++, nombre: m.nombre, objetivo: m.objetivo, fecha_objetivo: m.fecha_objetivo, emoji: m.emoji ?? '🎯', creada_en: iso(e.ahora) });
      e.metas.push(meta);
      const { aportes: _a, aportado: _p, ...sola } = meta;
      void _a; void _p;
      return sola;
    },
    buscarMetaPorNombre(nombre) {
      const n = normalizarComercio(nombre);
      return e.metas.find((m) => (m.estado === 'activa' || m.estado === 'pausada') && normalizarComercio(m.nombre) === n) ?? null;
    },
    aportarMeta(meta_id, monto, fecha) {
      const meta = e.metas.find((m) => m.id === meta_id);
      if (!meta) throw new ErrorUsuario('no_encontrado', 'Meta no encontrada');
      if (meta.aportado + monto < 0) throw new ErrorUsuario('saldo_negativo', 'No puedes sacar más de lo que llevas');
      const ap: AporteMeta = { id: sigAporte++, meta_id, fecha, monto, nota: null };
      meta.aportes.push(ap);
      meta.aportado += monto;
      return ap;
    },
    cambiarEstadoMeta(meta_id, estado) {
      const meta = e.metas.find((m) => m.id === meta_id);
      if (!meta) throw new ErrorUsuario('no_encontrado', 'Meta no encontrada');
      meta.estado = estado;
      const { aportes: _a, aportado: _p, ...sola } = meta;
      void _a; void _p;
      return sola;
    },
    agregarEspera(descripcion, monto, categoria_id, ahora) {
      const it: ItemEspera = {
        id: sigEspera++, descripcion, monto, categoria_id, creado_en: iso(ahora),
        disponible_en: iso(new Date(ahora.getTime() + e.config.horas_espera_impulso * 3_600_000)),
        estado: 'esperando', recordado_en: null,
      };
      e.espera.push(it);
      return it;
    },
    actualizarEspera(id, accion, ahora) {
      const it = e.espera.find((x) => x.id === id && x.estado === 'esperando');
      if (!it) return null;
      if (accion === 'comprado') it.estado = 'comprado';
      else if (accion === 'descartado') it.estado = 'descartado';
      else { it.disponible_en = iso(new Date(new Date(it.disponible_en).getTime() + 48 * 3_600_000)); it.recordado_en = null; void ahora; }
      return { ...it };
    },
    marcarEsperaRecordada(ids, ahora) { for (const it of e.espera) if (ids.includes(it.id)) it.recordado_en = iso(ahora); },
    cambiarEstadoRecurrente(id, estado) {
      const r = e.recurrentes.find((x) => x.id === id);
      if (!r) return null;
      r.estado = estado;
      return { ...r };
    },
    registrarEmisiones(recs: Recomendacion[], ahora) {
      for (const r of recs) {
        const prev = e.emisiones.find((x) => x.clave === r.id);
        if (prev) { prev.ultima_en = iso(ahora); prev.veces += 1; prev.valor_ref = r.valor_ref; prev.severidad = r.severidad; }
        else e.emisiones.push({ clave: r.id, regla: r.regla, severidad: r.severidad, valor_ref: r.valor_ref, primera_en: iso(ahora), ultima_en: iso(ahora), veces: 1, silenciada_hasta: null });
      }
    },
    silenciar(clave, hasta) { e.silenciadas.set(clave, hasta); },
    registrarEvento(ev) { e.eventos.push(ev); },
    // Cuentas y deudas: mismas validaciones que la base (validarCuenta / validarDeuda) sobre arreglos en memoria.
    crearCuenta(c, ahora) {
      const v = validarCuenta(c);
      if (e.cuentas.some((x) => normalizarComercio(x.nombre) === v.nombre_norm)) throw new ErrorUsuario('cuenta_existente', `Ya tienes una cuenta «${v.nombre}»`);
      const cuenta: Cuenta = { id: sigCuenta++, nombre: v.nombre, tipo: v.tipo, saldo: v.saldo, creado_en: iso(ahora), actualizado_en: iso(ahora) };
      e.cuentas.push(cuenta);
      return cuenta;
    },
    editarCuenta(id, c, ahora) {
      const x = e.cuentas.find((y) => y.id === id);
      if (!x) throw new ErrorUsuario('no_encontrado', 'Cuenta no encontrada');
      const v = validarCuenta({ nombre: c.nombre ?? x.nombre, tipo: c.tipo ?? x.tipo, saldo: c.saldo ?? x.saldo });
      Object.assign(x, { nombre: v.nombre, tipo: v.tipo, saldo: v.saldo, actualizado_en: iso(ahora) });
      return x;
    },
    crearDeuda(d, ahora) {
      const v = validarDeuda(d);
      if (e.deudas.some((x) => x.activa && normalizarComercio(x.nombre) === v.nombre_norm)) throw new ErrorUsuario('deuda_existente', `Ya tienes una deuda «${v.nombre}»`);
      const deuda: Deuda = {
        id: sigDeuda++, nombre: v.nombre, tipo: v.tipo, saldo: v.saldo, tasa_ea: v.tasa, pago_minimo: v.minimo, dia_pago: v.dia, activa: true,
        creado_en: iso(ahora), actualizado_en: iso(ahora),
      };
      e.deudas.push(deuda);
      return deuda;
    },
    editarDeuda(id, c, ahora) {
      const x = e.deudas.find((y) => y.id === id);
      if (!x) throw new ErrorUsuario('no_encontrado', 'Deuda no encontrada');
      const v = validarDeuda({
        nombre: c.nombre ?? x.nombre, tipo: c.tipo ?? x.tipo, saldo: c.saldo ?? x.saldo, tasa_ea: c.tasa_ea ?? x.tasa_ea,
        pago_minimo: c.pago_minimo ?? x.pago_minimo, dia_pago: c.dia_pago !== undefined ? c.dia_pago : x.dia_pago,
      });
      Object.assign(x, { nombre: v.nombre, tipo: v.tipo, saldo: v.saldo, tasa_ea: v.tasa, pago_minimo: v.minimo, dia_pago: v.dia, actualizado_en: iso(ahora) });
      return x;
    },
  };

  // Envuelve para registrar las escrituras.
  const proxy = { estado: e, llamadas } as DatosFalsos;
  for (const k of Object.keys(impl) as (keyof AccesoDatos)[]) {
    const fn = impl[k] as (...a: unknown[]) => unknown;
    (proxy as unknown as Record<string, unknown>)[k] = (...args: unknown[]) => {
      if (ESCRITURAS.has(k) || k === 'registrarEvento') llamadas.push(k);
      return fn(...args);
    };
  }
  // `aBogota` se importa para que quien use el fake pueda comparar fechas; evitamos advertencia de import sin uso.
  void aBogota;
  return proxy;
}
