// Procesamiento de un aviso: dedupe, fusión pasarela+banco, por_revisar e inserción (SPEC §1.3, §5.4, §7.6).
// La IA se llama SIEMPRE antes de abrir la transacción (nunca se espera a Ollama con la base bloqueada).
import type { DatabaseSync } from 'node:sqlite';
import { categorizar } from '../categorizar';
import { aInstanteISO, enTransaccion } from '../db';
import { aBogota, normalizarComercio, parsearFechaCorreo, sumarDias } from '../formato';
import {
  aMovimiento, COLUMNAS_MOV, insertarMovimiento, leerConfigDB, leerReglasDB, ligarFijo, obtenerMovimientoDB,
  registrarEventoDB, type Fila,
} from '../repo';
import { enmascararDigitos } from '../seguridad';
import type {
  Anomalia, AvisoCrudo, Banco, ClienteIA, DatosAviso, Movimiento, MotivoRevision, ResultadoAviso,
} from '../tipos';
import {
  ajustarTipo, buscarFusion, comercioPorDefecto, huella, limpiarComercio, refCorreo, textoPlano, validarAvisoCrudo,
} from './comun';
import { extraerConIA } from './extractor-ia';
import { interpretarAviso } from './index';
import { bancoPorDominio, dominioRemitente, verificarAutenticacion } from './remitentes';

interface Deps { db: DatabaseSync; ia: ClienteIA; ahora: Date }

interface CtxRegistro {
  ref: string;
  banco: Banco;
  origen: 'aviso' | 'historial';
  verificado: boolean;
  ahora: Date;
  /** true = el aviso ya está en el libro (reintento de un por_revisar): se actualiza en vez de comprobar duplicado. */
  reintento: boolean;
}

const MAX_INTENTOS_IA = 5;

// ---------------------------------------------------------------------------
// Libro de avisos procesados
// ---------------------------------------------------------------------------

function buscarEnLibro(db: DatabaseSync, ref: string): { movimiento_id: number | null } | null {
  const f = db.prepare('SELECT movimiento_id FROM avisos_procesados WHERE ref_correo = ?').get(ref) as Fila | undefined;
  return f ? { movimiento_id: f.movimiento_id === null ? null : Number(f.movimiento_id) } : null;
}

function anotarLibro(
  db: DatabaseSync, ref: string, estado: 'creado' | 'fusionado' | 'ignorado' | 'por_revisar', motivo: string | null,
  banco: Banco | null, movimiento_id: number | null, ahora: Date,
): void {
  db.prepare(
    `INSERT INTO avisos_procesados (ref_correo, estado, motivo, banco, movimiento_id, procesado_en)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ref_correo) DO UPDATE SET estado = excluded.estado, motivo = excluded.motivo, banco = excluded.banco,
       movimiento_id = excluded.movimiento_id, procesado_en = excluded.procesado_en`,
  ).run(ref, estado, motivo, banco, movimiento_id, aInstanteISO(ahora));
}

function resultadoDuplicado(ref: string, movimiento_id: number | null): ResultadoAviso {
  return { estado: 'duplicado', movimiento_id, ref_correo: ref };
}

// ---------------------------------------------------------------------------
// Por revisar
// ---------------------------------------------------------------------------

function guardarPorRevisar(
  db: DatabaseSync, aviso: AvisoCrudo, ref: string, dominio: string, banco: Banco | null, motivo: MotivoRevision, ahora: Date,
): ResultadoAviso {
  return enTransaccion(db, () => {
    const ya = buscarEnLibro(db, ref);
    if (ya) return resultadoDuplicado(ref, ya.movimiento_id);
    const fechaCorreo = parsearFechaCorreo(aviso.date) ?? ahora;
    const r = db
      .prepare(
        `INSERT INTO por_revisar (ref_correo, remitente_dominio, banco, asunto, texto, fecha_correo, motivo, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ref, dominio.slice(0, 120), banco, enmascararDigitos(aviso.subject).replace(/\s+/g, ' ').trim().slice(0, 200),
        enmascararDigitos(textoPlano(aviso.text)).slice(0, 4000), aInstanteISO(fechaCorreo), motivo, aInstanteISO(ahora),
      );
    const id = Number(r.lastInsertRowid);
    db.prepare(
      `INSERT INTO avisos_procesados (ref_correo, estado, motivo, banco, por_revisar_id, procesado_en)
       VALUES (?, 'por_revisar', ?, ?, ?, ?)`,
    ).run(ref, motivo, banco, id, aInstanteISO(ahora));
    registrarEventoDB(db, { nivel: 'aviso', tipo: 'aviso_por_revisar', detalle: `motivo ${motivo}`, ref });
    return { estado: 'por_revisar', por_revisar_id: id, motivo, ref_correo: ref, banco };
  });
}

// ---------------------------------------------------------------------------
// Registro del movimiento (transacción): dedupe por huella, fusión, inserción
// ---------------------------------------------------------------------------

function siguienteSeq(db: DatabaseSync, h: string, exceptoId: number | null): number {
  const f = db
    .prepare('SELECT COALESCE(MAX(huella_seq), -1) + 1 AS s FROM movimientos WHERE huella = ? AND id <> ?')
    .get(h, exceptoId ?? -1) as Fila;
  return Number(f.s);
}

function registrarDatos(db: DatabaseSync, datos: DatosAviso, ctx: CtxRegistro): ResultadoAviso {
  const { ref, ahora } = ctx;
  return enTransaccion(db, () => {
    if (!ctx.reintento) {
      const ya = buscarEnLibro(db, ref);
      if (ya) return resultadoDuplicado(ref, ya.movimiento_id);   // carrera: otro proceso lo registró mientras tanto
    }

    const comercio = limpiarComercio(datos.comercio) || comercioPorDefecto(datos.tipo);
    const comercio_norm = normalizarComercio(comercio);
    const cfg = leerConfigDB(db);
    const ajuste = ajustarTipo(datos, comercio_norm, cfg);
    const h = huella(datos, comercio_norm);
    const anomalias: Anomalia[] = [];
    let seq = 0;

    // 1) Misma huella: ¿el mismo correo por otro camino, o dos correos reales?
    const igual = db
      .prepare('SELECT id, ref_correo FROM movimientos WHERE huella = ? AND borrado_en IS NULL ORDER BY huella_seq DESC LIMIT 1')
      .get(h) as Fila | undefined;
    let otroId: number | null = null;
    if (igual) {
      const dosReales = String(igual.ref_correo ?? '').startsWith('mid:') && ref.startsWith('mid:');
      if (!dosReales) {
        anotarLibro(db, ref, 'ignorado', 'duplicado_huella', ctx.banco, Number(igual.id), ahora);
        return resultadoDuplicado(ref, Number(igual.id));
      }
      seq = siguienteSeq(db, h, null);
      otroId = Number(igual.id);
    } else {
      // 2) Fusión pasarela + banco (misma compra avisada por dos vías)
      const desde = sumarDias(datos.fecha, -1);
      const hasta = sumarDias(datos.fecha, 1);
      const cands = (
        db
          .prepare(
            'SELECT ' + COLUMNAS_MOV +
              " FROM movimientos WHERE borrado_en IS NULL AND monto = ? AND sentido = ? AND banco <> ? AND origen IN ('aviso','historial')" +
              ' AND ref_secundaria IS NULL AND fecha BETWEEN ? AND ?',
          )
          .all(datos.monto, datos.sentido, datos.banco, desde, hasta) as Fila[]
      ).map(aMovimiento);
      const f = buscarFusion(datos, cands, cfg.minutos_fusion);
      if (f.accion === 'fusionar' && f.con) {
        return fusionar(db, f.con, datos, ctx);
      }
      if (f.accion === 'marcar' && f.con) otroId = f.con.id;
    }

    // 3) Inserción
    const reglas = leerReglasDB(db);
    const cat = categorizar(comercio_norm, ajuste.tipo, ajuste.computa, reglas);
    const fijo_id = ajuste.computa && datos.sentido === 'salida' ? ligarFijo(db, comercio_norm, datos.monto) : null;
    const id = insertarMovimiento(db, {
      fecha: datos.fecha, hora: datos.hora, banco: datos.banco, tipo: ajuste.tipo, sentido: datos.sentido, monto: datos.monto,
      comercio, comercio_norm, categoria_id: cat.categoria_id, categoria_fuente: cat.fuente, computa: ajuste.computa,
      fijo_id, medio: datos.medio, origen: ctx.origen, confianza: datos.confianza, verificado: ctx.verificado,
      ref_correo: ref, huella: h, huella_seq: seq, nota: null, creado_en: aInstanteISO(ahora),
    });
    anotarLibro(db, ref, 'creado', null, ctx.banco, id, ahora);

    if (otroId !== null) {
      anomalias.push({
        tipo: 'posible_duplicado', movimiento_id: id, otro_id: otroId,
        detalle: `${comercio}: otro aviso con el mismo monto y hora muy cercana`, cifras: { monto: datos.monto },
      });
    }
    return { estado: 'creado', movimiento: obtenerMovimientoDB(db, id)!, anomalias };
  });
}

/** El aviso nuevo es la misma compra que `con`: queda UN movimiento (banco del emisor, comercio de la pasarela). */
function fusionar(db: DatabaseSync, con: Movimiento, datos: DatosAviso, ctx: CtxRegistro): ResultadoAviso {
  const nuevoEsPasarela = datos.banco === 'wompi' || datos.banco === 'pse';
  const banco = nuevoEsPasarela ? con.banco : datos.banco;
  const medio = nuevoEsPasarela ? con.medio : datos.medio ?? con.medio;
  const comercio = nuevoEsPasarela ? limpiarComercio(datos.comercio) || con.comercio : con.comercio;
  const comercio_norm = normalizarComercio(comercio);

  let categoria_id = con.categoria_id;
  let categoria_fuente = con.categoria_fuente;
  if (con.categoria_fuente !== 'manual') {
    const cat = categorizar(comercio_norm, con.tipo, con.computa, leerReglasDB(db));
    categoria_id = cat.categoria_id;
    categoria_fuente = cat.fuente;
  }
  const h = huella({ fecha: con.fecha, hora: con.hora, monto: con.monto, banco }, comercio_norm);
  const seq = siguienteSeq(db, h, con.id);

  db.prepare(
    `UPDATE movimientos SET banco = ?, medio = ?, comercio = ?, comercio_norm = ?, categoria_id = ?, categoria_fuente = ?,
       ref_secundaria = ?, huella = ?, huella_seq = ?, version = version + 1, actualizado_en = ? WHERE id = ?`,
  ).run(banco, medio, comercio, comercio_norm, categoria_id, categoria_fuente, ctx.ref, h, seq, aInstanteISO(ctx.ahora), con.id);
  anotarLibro(db, ctx.ref, 'fusionado', null, ctx.banco, con.id, ctx.ahora);
  return { estado: 'fusionado', movimiento: obtenerMovimientoDB(db, con.id)! };
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/** Una fecha más de un día en el futuro (Bogotá) no es creíble. */
function fechaFutura(fecha: string, ahora: Date): boolean {
  return fecha > sumarDias(aBogota(ahora).fecha, 1);
}

export async function procesarAviso(
  a: AvisoCrudo,
  opts: { origen: 'aviso' | 'historial' },
  deps: Deps,
): Promise<ResultadoAviso> {
  const { db, ia, ahora } = deps;
  const aviso = validarAvisoCrudo(a);
  const ref = refCorreo(aviso);

  const dominio = dominioRemitente(aviso.from);
  const banco = dominio ? bancoPorDominio(dominio) : null;
  if (!dominio || !banco) {
    registrarEventoDB(db, {
      nivel: 'aviso', tipo: 'aviso_rechazado', detalle: `remitente no permitido: ${dominio ?? 'ilegible'}`, ref,
    });
    return { estado: 'ignorado', motivo: 'remitente_no_permitido', ref_correo: ref };
  }

  const previo = buscarEnLibro(db, ref);
  if (previo) return resultadoDuplicado(ref, previo.movimiento_id);

  const aut = verificarAutenticacion(aviso.auth_results, dominio);
  if (aut === 'falla') return guardarPorRevisar(db, aviso, ref, dominio, banco, 'autenticacion_fallida', ahora);

  if (parsearFechaCorreo(aviso.date) === null) {
    registrarEventoDB(db, { nivel: 'aviso', tipo: 'fecha_correo_invalida', ref });
  }

  const ignorar = (motivo: Extract<ResultadoAviso, { estado: 'ignorado' }>['motivo']): ResultadoAviso =>
    enTransaccion(db, () => {
      const ya = buscarEnLibro(db, ref);
      if (ya) return resultadoDuplicado(ref, ya.movimiento_id);
      anotarLibro(db, ref, 'ignorado', motivo, banco, null, ahora);
      return { estado: 'ignorado', motivo, ref_correo: ref };
    });

  let datos: DatosAviso;
  const parseo = interpretarAviso(aviso, ahora);
  if (parseo.estado === 'ignorado') return ignorar(parseo.motivo);
  if (parseo.estado === 'leido') {
    datos = parseo.datos;
  } else {
    // Fuera de la transacción: la IA puede tardar decenas de segundos.
    const r = await extraerConIA(aviso, parseo.banco, ia, ahora);
    if ('ignorar' in r) return ignorar(r.ignorar);
    if ('revisar' in r) return guardarPorRevisar(db, aviso, ref, dominio, banco, r.revisar, ahora);
    datos = r;
  }

  if (fechaFutura(datos.fecha, ahora)) return guardarPorRevisar(db, aviso, ref, dominio, banco, 'fecha_invalida', ahora);

  return registrarDatos(db, datos, { ref, banco, origen: opts.origen, verificado: aut === 'pasa', ahora, reintento: false });
}

// ---------------------------------------------------------------------------
// Reintento de «por revisar» (IA que no estaba disponible)
// ---------------------------------------------------------------------------

export async function reintentarPorRevisar(
  deps: Deps,
  max: number,
): Promise<{ resueltos: number; siguen: number }> {
  const { db, ia, ahora } = deps;
  const limite = Math.max(0, Math.min(Math.floor(max), 50));
  const pendientes = () =>
    Number(
      (
        db
          .prepare("SELECT count(*) AS n FROM por_revisar WHERE estado = 'pendiente' AND motivo = 'ia_no_disponible' AND intentos < ?")
          .get(MAX_INTENTOS_IA) as Fila
      ).n,
    );
  if (limite === 0) return { resueltos: 0, siguen: pendientes() };

  const filas = db
    .prepare(
      `SELECT id, ref_correo, remitente_dominio, banco, asunto, texto, fecha_correo FROM por_revisar
       WHERE estado = 'pendiente' AND motivo = 'ia_no_disponible' AND intentos < ? ORDER BY creado_en, id LIMIT ?`,
    )
    .all(MAX_INTENTOS_IA, limite) as Fila[];
  if (filas.length === 0) return { resueltos: 0, siguen: 0 };
  // Con la IA caída no se gastan intentos: un apagón no debe agotar los 5.
  if (!(await ia.disponible())) return { resueltos: 0, siguen: pendientes() };

  let resueltos = 0;
  for (const f of filas) {
    const id = Number(f.id);
    const ref = String(f.ref_correo);
    const dominio = String(f.remitente_dominio);
    const banco = (f.banco ? String(f.banco) : bancoPorDominio(dominio)) as Banco | null;
    if (!banco) {
      db.prepare("UPDATE por_revisar SET estado = 'descartado', resuelto_en = ? WHERE id = ?").run(aInstanteISO(ahora), id);
      continue;
    }
    const pseudo: AvisoCrudo = {
      from: `Plata <aviso@${dominio}>`, subject: String(f.asunto), date: String(f.fecha_correo), text: String(f.texto),
    };
    const r = await extraerConIA(pseudo, banco, ia, ahora);

    if ('revisar' in r) {
      db.prepare('UPDATE por_revisar SET intentos = intentos + 1, motivo = ? WHERE id = ?').run(r.revisar, id);
      continue;
    }
    if ('ignorar' in r) {
      enTransaccion(db, () => {
        db.prepare("UPDATE por_revisar SET estado = 'descartado', intentos = intentos + 1, resuelto_en = ? WHERE id = ?").run(aInstanteISO(ahora), id);
        anotarLibro(db, ref, 'ignorado', r.ignorar, banco, null, ahora);
      });
      resueltos++;
      continue;
    }
    if (fechaFutura(r.fecha, ahora)) {
      db.prepare("UPDATE por_revisar SET intentos = intentos + 1, motivo = 'fecha_invalida' WHERE id = ?").run(id);
      continue;
    }
    enTransaccion(db, () => {
      const res = registrarDatos(db, r, { ref, banco, origen: 'aviso', verificado: false, ahora, reintento: true });
      const movId = res.estado === 'creado' || res.estado === 'fusionado' ? res.movimiento.id : res.estado === 'duplicado' ? res.movimiento_id : null;
      db.prepare("UPDATE por_revisar SET estado = 'resuelto', intentos = intentos + 1, movimiento_id = ?, resuelto_en = ? WHERE id = ?")
        .run(movId, aInstanteISO(ahora), id);
    });
    resueltos++;
  }
  return { resueltos, siguen: pendientes() };
}
