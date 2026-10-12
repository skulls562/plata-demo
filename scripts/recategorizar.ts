// Re-aplica las reglas de categoría a los movimientos ya guardados (calidad de datos tras importar el historial).
// Uso: `npm run recategorizar [-- --dry-run | --aplicar] [-- --db ruta]`   (por defecto: --dry-run)
//   --dry-run  trabaja sobre una COPIA temporal de la base (migrada a la última versión) y solo imprime el antes/después
//              por categoría: la base real no se modifica ni se migra.
//   --aplicar  respalda la base (VACUUM INTO data/respaldos/plata-AAAA-MM-DD.db), migra y actualiza dentro de una transacción.
// Nunca toca movimientos con categoria_fuente = 'manual' ni borrados; es idempotente (una 2.ª corrida no cambia nada).
// No imprime comercios ni nombres: solo conteos por categoría.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { categorizar } from '../src/lib/categorizar';
import { abrirDB, aInstanteISO, enTransaccion, respaldar } from '../src/lib/db';
import { aBogota } from '../src/lib/formato';
import { leerReglasDB } from '../src/lib/repo';
import type { TipoMovimiento } from '../src/lib/tipos';

export interface Cambio { id: number; de: string; a: string; fuente: string }
export interface Plan { total: number; cambios: Cambio[]; antes: Record<string, number>; despues: Record<string, number> }

interface Fila { id: number; comercio_norm: string; tipo: string; computa: number; categoria_id: string; categoria_fuente: string }

/** Calcula qué cambiaría (sin escribir). `db` debe estar migrada. */
export function planificar(db: DatabaseSync): Plan {
  const reglas = leerReglasDB(db);
  const filas = db.prepare(
    'SELECT id, comercio_norm, tipo, computa, categoria_id, categoria_fuente FROM movimientos WHERE borrado_en IS NULL',
  ).all() as unknown as Fila[];
  const antes: Record<string, number> = {};
  const despues: Record<string, number> = {};
  const cambios: Cambio[] = [];
  for (const f of filas) {
    antes[f.categoria_id] = (antes[f.categoria_id] ?? 0) + 1;
    let destino = f.categoria_id;
    if (f.categoria_fuente !== 'manual') {
      const r = categorizar(f.comercio_norm, f.tipo as TipoMovimiento, f.computa === 1, reglas);
      // Una categoría que puso la IA no se degrada a «otros» si ninguna regla la contradice.
      const degrada = f.categoria_fuente === 'ia' && r.regla_id === null && r.fuente === 'defecto';
      if (!degrada && (r.categoria_id !== f.categoria_id || r.fuente !== f.categoria_fuente)) {
        destino = r.categoria_id;
        cambios.push({ id: f.id, de: f.categoria_id, a: r.categoria_id, fuente: r.fuente });
      }
    }
    despues[destino] = (despues[destino] ?? 0) + 1;
  }
  return { total: filas.length, cambios, antes, despues };
}

/** Escribe el plan en una transacción. Devuelve las filas actualizadas. */
export function aplicarPlan(db: DatabaseSync, plan: Plan, ahora = new Date()): number {
  const iso = aInstanteISO(ahora);
  const up = db.prepare(
    "UPDATE movimientos SET categoria_id = ?, categoria_fuente = ?, version = version + 1, actualizado_en = ? WHERE id = ? AND categoria_fuente <> 'manual' AND borrado_en IS NULL",
  );
  return enTransaccion(db, () => {
    let n = 0;
    for (const c of plan.cambios) n += Number(up.run(c.a, c.fuente, iso, c.id).changes);
    return n;
  });
}

function tabla(plan: Plan): string[] {
  const ids = [...new Set([...Object.keys(plan.antes), ...Object.keys(plan.despues)])]
    .sort((a, b) => (plan.despues[b] ?? 0) - (plan.despues[a] ?? 0));
  const lineas = [`${'categoria'.padEnd(16)}${'antes'.padStart(7)}${'despues'.padStart(9)}`];
  for (const id of ids) lineas.push(`${id.padEnd(16)}${String(plan.antes[id] ?? 0).padStart(7)}${String(plan.despues[id] ?? 0).padStart(9)}`);
  return lineas;
}

function flujos(plan: Plan): string[] {
  const m = new Map<string, number>();
  for (const c of plan.cambios) m.set(`${c.de} -> ${c.a}`, (m.get(`${c.de} -> ${c.a}`) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`);
}

export function leerArgs(args: string[]): { aplicar: boolean; db: string } {
  let aplicar = false;
  let db = process.env.PLATA_DB_PATH ?? path.join('data', 'plata.db');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--aplicar') aplicar = true;
    else if (a === '--dry-run') aplicar = false;
    else if (a === '--db') db = args[++i] ?? '';
    else if (a === '--') continue;
    else throw new Error('Uso: npm run recategorizar [-- --dry-run | --aplicar] [-- --db ruta]');
  }
  if (!db) throw new Error('Falta la ruta tras --db');
  return { aplicar, db };
}

function main(): number {
  const { aplicar, db: ruta } = leerArgs(process.argv.slice(3));
  if (!fs.existsSync(ruta)) { console.error('No existe la base: ' + ruta); return 2; }
  const dirTmp = aplicar ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'plata-recat-'));
  let destino = ruta;
  try {
    const ro = new DatabaseSync(ruta, { readOnly: true });
    try {
      if (dirTmp) {
        // Copia coherente de la base real (solo lectura) para poder migrar y simular sin tocar el original.
        destino = path.join(dirTmp, 'copia.db');
        ro.prepare('VACUUM INTO ?').run(destino);
      } else {
        const dir = path.join(path.dirname(path.resolve(ruta)), 'respaldos');
        console.log('Respaldo previo: ' + path.relative(process.cwd(), respaldar(ro, dir, aBogota(new Date()).fecha)));
      }
    } finally { ro.close(); }
    const db = abrirDB(destino);   // migra a la última versión (en la copia si es dry-run)
    try {
      const plan = planificar(db);
      console.log(`${aplicar ? 'APLICAR' : 'DRY-RUN'}: ${plan.total} movimientos, ${plan.cambios.length} cambiarían de categoría`);
      console.log(tabla(plan).join('\n'));
      console.log('Cambios:\n' + (flujos(plan).join('\n') || '  (ninguno)'));
      if (aplicar) console.log(`Actualizados: ${aplicarPlan(db, plan)}`);
      else console.log('Dry-run: no se escribió nada en ' + ruta + '. Usa --aplicar para escribir.');
    } finally { db.close(); }
    return 0;
  } finally {
    if (dirTmp) fs.rmSync(dirTmp, { recursive: true, force: true });
  }
}

// Solo corre como script (`node scripts/ejecutar-ts.mjs scripts/recategorizar.ts …`); las pruebas importan las funciones.
if (process.argv[1]?.endsWith('ejecutar-ts.mjs') && process.argv[2]?.endsWith('recategorizar.ts')) {
  try { process.exitCode = main(); } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
