// Lecturas y escrituras pequeñas que solo usa el panel (/api/*): presupuestos, metas, categorías, reglas, por revisar,
// lista de espera. Sentencias preparadas; validación en TypeScript antes de tocar la base (errores 422 claros).
import type { DatabaseSync } from 'node:sqlite';
import { aEspera, aMeta, metaConAportes } from './datos';
import { aInstanteISO } from './db';
import { normalizarComercio } from './formato';
import { aCategoria, aRegla, type Fila } from './repo';
import { ErrorUsuario } from './tipos';
import type { Categoria, ItemEspera, MetaConAportes, Mes, Pesos, ReglaCategoria } from './tipos';

// Cuentas y deudas viven en cuentas-deudas.ts (las usa también el bot); aquí se reexportan para las rutas del panel.
export {
  archivarDeuda, borrarCuenta, crearCuenta, crearDeuda, editarCuenta, editarDeuda, listarCuentas, listarDeudas, obtenerCuenta, obtenerDeuda,
  type DatosDeuda,
} from './cuentas-deudas';

const num = (v: unknown) => Number(v);
const invalido = (m: string): never => {
  throw new ErrorUsuario('validacion', m);
};

// ---------------------------------------------------------------------------
// Presupuestos (§5.8)
// ---------------------------------------------------------------------------

export interface VistaPresupuestos {
  mes: Mes;
  items: { categoria_id: string; monto: Pesos; origen: 'mes' | 'siempre' }[];
  total: { monto: Pesos; origen: 'mes' | 'siempre' } | null;
}

export function presupuestosDe(db: DatabaseSync, mes: Mes): VistaPresupuestos {
  const filas = db.prepare("SELECT mes, categoria_id, monto FROM presupuestos WHERE mes IN (?, '*') ORDER BY categoria_id").all(mes) as Fila[];
  const porCat = new Map<string, { monto: Pesos; origen: 'mes' | 'siempre' }>();
  // Primero los de «siempre»; los del mes los pisan.
  for (const f of filas.filter((x) => String(x.mes) === '*')) porCat.set(String(f.categoria_id), { monto: num(f.monto), origen: 'siempre' });
  for (const f of filas.filter((x) => String(x.mes) !== '*')) porCat.set(String(f.categoria_id), { monto: num(f.monto), origen: 'mes' });
  const total = porCat.get('*') ?? null;
  porCat.delete('*');
  return {
    mes,
    items: [...porCat.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoria_id, v]) => ({ categoria_id, ...v })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

export function listarMetas(db: DatabaseSync): MetaConAportes[] {
  return (db.prepare("SELECT * FROM metas WHERE estado <> 'cancelada' ORDER BY prioridad, id").all() as Fila[]).map((f) => metaConAportes(db, f));
}

export function obtenerMeta(db: DatabaseSync, id: number): MetaConAportes | null {
  const f = db.prepare('SELECT * FROM metas WHERE id = ?').get(id) as Fila | undefined;
  return f ? metaConAportes(db, f) : null;
}

/** Cambios de nombre, objetivo, fecha, emoji o prioridad (el estado va por cambiarEstadoMeta). */
export function editarMeta(
  db: DatabaseSync, id: number,
  c: { nombre?: string; objetivo?: number; fecha_objetivo?: string | null; emoji?: string; prioridad?: number },
): MetaConAportes {
  const f = db.prepare('SELECT * FROM metas WHERE id = ?').get(id) as Fila | undefined;
  if (!f) throw new ErrorUsuario('no_encontrado', 'Meta no encontrada');
  const m = aMeta(f);
  const nombre = c.nombre !== undefined ? c.nombre.replace(/\s+/g, ' ').trim() : m.nombre;
  if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
  const nombre_norm = normalizarComercio(nombre);
  if (c.objetivo !== undefined && (!Number.isInteger(c.objetivo) || c.objetivo <= 0 || c.objetivo > 10_000_000_000)) invalido('objetivo inválido');
  if (c.fecha_objetivo != null && !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha_objetivo)) invalido('fecha_objetivo debe ser AAAA-MM-DD');
  if (c.emoji !== undefined && (c.emoji.length < 1 || c.emoji.length > 8)) invalido('emoji inválido');
  if (c.prioridad !== undefined && !Number.isInteger(c.prioridad)) invalido('prioridad inválida');
  if (c.nombre !== undefined && (m.estado === 'activa' || m.estado === 'pausada')) {
    if (db.prepare("SELECT 1 AS x FROM metas WHERE nombre_norm = ? AND estado IN ('activa','pausada') AND id <> ?").get(nombre_norm, id)) {
      throw new ErrorUsuario('meta_existente', `Ya tienes una meta «${nombre}»`);
    }
  }
  try {
    db.prepare('UPDATE metas SET nombre = ?, nombre_norm = ?, objetivo = ?, fecha_objetivo = ?, emoji = ?, prioridad = ? WHERE id = ?').run(
      nombre, nombre_norm, c.objetivo ?? m.objetivo, c.fecha_objetivo !== undefined ? c.fecha_objetivo : m.fecha_objetivo,
      c.emoji ?? m.emoji, c.prioridad ?? m.prioridad, id,
    );
  } catch {
    invalido('fecha_objetivo no es una fecha real');
  }
  return obtenerMeta(db, id)!;
}

// ---------------------------------------------------------------------------
// Categorías y reglas
// ---------------------------------------------------------------------------

export function crearCategoria(
  db: DatabaseSync,
  c: { id: string; nombre: string; emoji: string; esencial?: boolean; cuenta_hormiga?: boolean },
): Categoria {
  if (typeof c.id !== 'string' || !/^[a-z0-9_]{2,24}$/.test(c.id)) invalido('id debe tener 2 a 24 caracteres [a-z0-9_]');
  const nombre = String(c.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
  const emoji = String(c.emoji ?? '');
  if (emoji.length < 1 || emoji.length > 8) invalido('emoji debe tener entre 1 y 8 caracteres');
  if (db.prepare('SELECT 1 AS x FROM categorias WHERE id = ?').get(c.id)) throw new ErrorUsuario('categoria_existente', 'Esa categoría ya existe');
  const orden = num((db.prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM categorias WHERE orden < 90').get() as Fila).o);
  db.prepare('INSERT INTO categorias (id, nombre, emoji, es_gasto, esencial, cuenta_hormiga, orden, sistema) VALUES (?, ?, ?, 1, ?, ?, ?, 0)')
    .run(c.id, nombre, emoji, c.esencial ? 1 : 0, c.cuenta_hormiga === false ? 0 : 1, orden);
  return aCategoria(db.prepare('SELECT * FROM categorias WHERE id = ?').get(c.id) as Fila);
}

export function editarCategoria(
  db: DatabaseSync, id: string,
  c: { nombre?: string; emoji?: string; esencial?: boolean; cuenta_hormiga?: boolean; activa?: boolean; orden?: number },
): Categoria {
  const f = db.prepare('SELECT * FROM categorias WHERE id = ?').get(id) as Fila | undefined;
  if (!f) throw new ErrorUsuario('no_encontrado', 'Categoría no encontrada');
  const actual = aCategoria(f);
  const nombre = c.nombre !== undefined ? c.nombre.replace(/\s+/g, ' ').trim() : actual.nombre;
  if (nombre.length < 1 || nombre.length > 40) invalido('nombre debe tener entre 1 y 40 caracteres');
  const emoji = c.emoji ?? actual.emoji;
  if (emoji.length < 1 || emoji.length > 8) invalido('emoji inválido');
  if (actual.sistema && (c.activa === false || c.esencial !== undefined || c.cuenta_hormiga !== undefined || c.orden !== undefined)) {
    invalido('Las categorías del sistema solo admiten cambiar nombre y emoji');
  }
  if (c.orden !== undefined && (!Number.isInteger(c.orden) || c.orden < 0 || c.orden > 89)) invalido('orden inválido');
  db.prepare('UPDATE categorias SET nombre = ?, emoji = ?, esencial = ?, cuenta_hormiga = ?, activa = ?, orden = ? WHERE id = ?').run(
    nombre, emoji, (c.esencial ?? actual.esencial) ? 1 : 0, (c.cuenta_hormiga ?? actual.cuenta_hormiga) ? 1 : 0,
    (c.activa ?? actual.activa) ? 1 : 0, c.orden ?? actual.orden, id,
  );
  return aCategoria(db.prepare('SELECT * FROM categorias WHERE id = ?').get(id) as Fila);
}

export function listarReglas(db: DatabaseSync): ReglaCategoria[] {
  return (db.prepare('SELECT id, patron, categoria_id, origen, aciertos FROM reglas_categoria ORDER BY patron').all() as Fila[]).map(aRegla);
}

/** Regla puesta a mano: si el patrón ya existe, pasa a esa categoría con origen «manual». */
export function crearRegla(db: DatabaseSync, patron: string, categoria_id: string): ReglaCategoria {
  const p = normalizarComercio(String(patron ?? ''));
  if (p.length < 2 || p.length > 60) invalido('patron debe tener entre 2 y 60 caracteres útiles');
  const cat = db.prepare('SELECT activa FROM categorias WHERE id = ?').get(String(categoria_id)) as Fila | undefined;
  if (!cat || num(cat.activa) !== 1) invalido('La categoría no existe');
  const ahora = aInstanteISO(new Date());
  db.prepare(
    `INSERT INTO reglas_categoria (patron, categoria_id, origen, creada_en, actualizada_en) VALUES (?, ?, 'manual', ?, ?)
     ON CONFLICT(patron) DO UPDATE SET categoria_id = excluded.categoria_id, origen = 'manual', actualizada_en = excluded.actualizada_en`,
  ).run(p, categoria_id, ahora, ahora);
  return aRegla(db.prepare('SELECT id, patron, categoria_id, origen, aciertos FROM reglas_categoria WHERE patron = ?').get(p) as Fila);
}

export function borrarRegla(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare('DELETE FROM reglas_categoria WHERE id = ?').run(id).changes) > 0;
}

// ---------------------------------------------------------------------------
// Por revisar
// ---------------------------------------------------------------------------

export interface FilaPorRevisar {
  id: number; remitente_dominio: string; banco: string | null; asunto: string; texto: string; fecha_correo: string;
  motivo: string; intentos: number; estado: string; movimiento_id: number | null; creado_en: string; resuelto_en: string | null;
}

function aPorRevisar(f: Fila): FilaPorRevisar {
  return {
    id: num(f.id), remitente_dominio: String(f.remitente_dominio), banco: f.banco === null ? null : String(f.banco),
    asunto: String(f.asunto), texto: String(f.texto), fecha_correo: String(f.fecha_correo), motivo: String(f.motivo),
    intentos: num(f.intentos), estado: String(f.estado), movimiento_id: f.movimiento_id === null ? null : num(f.movimiento_id),
    creado_en: String(f.creado_en), resuelto_en: f.resuelto_en === null ? null : String(f.resuelto_en),
  };
}

const COLS_REVISAR = 'id, remitente_dominio, banco, asunto, texto, fecha_correo, motivo, intentos, estado, movimiento_id, creado_en, resuelto_en';

export function listarPorRevisar(db: DatabaseSync, estado: 'pendiente' | 'resuelto' | 'descartado' = 'pendiente'): FilaPorRevisar[] {
  return (db.prepare('SELECT ' + COLS_REVISAR + ' FROM por_revisar WHERE estado = ? ORDER BY creado_en DESC, id DESC LIMIT 200').all(estado) as Fila[]).map(aPorRevisar);
}

export function obtenerPorRevisar(db: DatabaseSync, id: number): FilaPorRevisar | null {
  const f = db.prepare('SELECT ' + COLS_REVISAR + ' FROM por_revisar WHERE id = ?').get(id) as Fila | undefined;
  return f ? aPorRevisar(f) : null;
}

/** Marca un pendiente como resuelto (con el movimiento creado) o descartado, y lo refleja en el libro de avisos. */
export function cerrarPorRevisar(db: DatabaseSync, id: number, resultado: { movimiento_id: number } | 'descartado', ahora: Date): void {
  const f = db.prepare("SELECT ref_correo, banco FROM por_revisar WHERE id = ? AND estado = 'pendiente'").get(id) as Fila | undefined;
  if (!f) throw new ErrorUsuario('no_encontrado', 'Aviso por revisar no encontrado');
  const iso = aInstanteISO(ahora);
  if (resultado === 'descartado') {
    db.prepare("UPDATE por_revisar SET estado = 'descartado', resuelto_en = ? WHERE id = ?").run(iso, id);
    db.prepare("UPDATE avisos_procesados SET estado = 'ignorado', motivo = 'descartado_manual' WHERE ref_correo = ?").run(String(f.ref_correo));
  } else {
    db.prepare("UPDATE por_revisar SET estado = 'resuelto', movimiento_id = ?, resuelto_en = ? WHERE id = ?").run(resultado.movimiento_id, iso, id);
    db.prepare("UPDATE avisos_procesados SET estado = 'creado', motivo = NULL, movimiento_id = ? WHERE ref_correo = ?")
      .run(resultado.movimiento_id, String(f.ref_correo));
  }
}

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------

export function listarEspera(db: DatabaseSync, mes: Mes): { items: ItemEspera[]; ahorrado_mes: Pesos } {
  const items = (db.prepare("SELECT * FROM lista_espera WHERE estado = 'esperando' ORDER BY disponible_en, id").all() as Fila[]).map(aEspera);
  const r = db
    .prepare("SELECT COALESCE(SUM(monto), 0) AS s FROM lista_espera WHERE estado = 'descartado' AND substr(cerrado_en, 1, 7) = ?")
    .get(mes) as Fila;
  return { items, ahorrado_mes: num(r.s) };
}
