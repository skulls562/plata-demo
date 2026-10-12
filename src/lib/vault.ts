// Nota mensual para el vault de Obsidian (SPEC §7.9). Solo agregados: nunca movimientos uno por uno, horas, notas,
// referencias de correo, números de cuenta/tarjeta ni nombres de personas.
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatearCOP, formatearPct } from './formato';
import type { ResumenPeriodo } from './metricas';
import { enmascararDigitos } from './seguridad';
import type { Categoria, InstanteISO, Mes, Periodo, Pesos } from './tipos';

export interface NotaMensualExtra {
  mes: Mes; generado_en: InstanteISO; fijos: Pesos; ahorro_real: Pesos | null; score: number | null;
  presupuestos: { categoria_id: string; presupuesto: Pesos; gastado: Pesos }[];
  suscripciones: { nombre: string; monto: Pesos; periodo: Periodo; costo_anual: Pesos }[];
  metas: { nombre: string; objetivo: Pesos; aportado: Pesos }[];
  en_corto: string; categorias: Categoria[];
}

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `<dir>/Plata/AAAA-MM.md`. Lanza si el mes no cumple la regex o si la ruta resuelta sale del directorio. */
export function rutaNotaMensual(dirFinanzas: string, mes: Mes): string {
  if (typeof mes !== 'string' || !RE_MES.test(mes)) throw new Error('Mes inválido para la nota');
  const base = path.resolve(dirFinanzas);
  const ruta = path.resolve(base, 'Plata', `${mes}.md`);
  if (!ruta.startsWith(base + path.sep)) throw new Error('Ruta fuera del directorio del vault');
  return ruta;
}

/** Neutraliza lo que Obsidian interpretaría (enlaces, tablas, etiquetas, código, HTML) y los saltos de línea. */
export function escaparMarkdown(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\[\]|#`<>]/g, (c) => '\\' + c);
}

/** Texto libre seguro para una celda o frase: sin dígitos largos y escapado. */
const seguro = (s: string) => escaparMarkdown(enmascararDigitos(s));

function celda(s: string): string {
  return seguro(s) || '—';
}

// «Dónde más gastaste» solo lista comercios donde compraste o pagaste. Quedan fuera las transferencias, los
// ingresos y las personas (pagos P2P, llaves Bre-B, «a cuenta»), porque en el vault no van nombres propios.
const RE_NO_ES_COMERCIO =
  /transferencia|transferiste|\bllave\b|bre-?b\b|a cuenta|\bcuenta\b|\bp2p\b|ingreso|n[oó]mina|recibiste|abono|consignaci[oó]n|dep[oó]sito|retiro|cajero|\bdesde tu\b/i;
const RE_PARECE_NEGOCIO =
  /tienda|droguer|farmacia|panader|restaurante|caf[eé]|super|mercado|almac[eé]n|ferreter|pizz|crepes|rappi|didi|uber|spotify|netflix|google|apple|amazon|metro|terpel|estaci[oó]n|éxito|exito|carulla|jumbo|d1|\bara\b|falabella|\bs\.?a\.?s?\b|ltda|\d/i;
const NOMBRES_PROPIOS = new Set([
  'juan', 'jose', 'josé', 'carlos', 'luis', 'andres', 'andrés', 'jorge', 'pedro', 'miguel', 'david', 'daniel', 'camilo', 'sebastian', 'sebastián',
  'maria', 'maría', 'ana', 'laura', 'sofia', 'sofía', 'camila', 'valentina', 'paula', 'diana', 'claudia', 'sandra', 'natalia', 'luisa', 'juliana',
  'felipe', 'santiago', 'alejandro', 'nicolas', 'nicolás', 'jhon', 'john', 'edwin', 'oscar', 'óscar', 'fernando', 'ricardo', 'manuel', 'mateo',
]);
const MARCAS_CON_NOMBRE = new Set(['juan valdez']);

/** true si el texto parece una persona: 2 a 4 palabras solo con letras y la primera es un nombre de pila común. */
function pareceNombrePropio(nombre: string): boolean {
  const limpio = nombre.trim().toLowerCase().replace(/\s+/g, ' ');
  if (MARCAS_CON_NOMBRE.has(limpio) || RE_PARECE_NEGOCIO.test(limpio)) return false;
  const palabras = limpio.split(' ');
  if (palabras.length < 2 || palabras.length > 4) return false;
  if (!palabras.every((p) => /^[a-záéíóúüñ]+$/.test(p))) return false;
  return NOMBRES_PROPIOS.has(palabras[0]);
}

export function esComercioDeCompra(nombre: string): boolean {
  const t = String(nombre ?? '').trim();
  if (!t) return false;
  return !RE_NO_ES_COMERCIO.test(t) && !pareceNombrePropio(t);
}

export function notaMensual(r: ResumenPeriodo, extra: NotaMensualExtra): string {
  const nombreCat = (id: string) => {
    const c = extra.categorias.find((x) => x.id === id);
    return c ? `${c.emoji} ${c.nombre}` : id;
  };
  const presPorCat = new Map(extra.presupuestos.map((p) => [p.categoria_id, p.presupuesto]));
  const num = (n: number | null) => (n === null ? 'null' : String(Math.round(n)));
  const L: string[] = [];

  L.push('---');
  L.push('tags: [finanzas, plata, mes]');
  L.push(`mes: ${extra.mes}`);
  L.push(`gastado_variable: ${num(r.gastado_variable)}`);
  L.push(`gastos_fijos: ${num(extra.fijos)}`);
  L.push(`ingresos: ${num(r.ingresos)}`);
  L.push(`ahorro_real: ${num(extra.ahorro_real)}`);
  L.push(`score: ${num(extra.score)}`);
  L.push(`generado: ${extra.generado_en}`);
  L.push('---', '');
  L.push(`# Plata · ${extra.mes}`, '');
  L.push('Resumen automático de [[plata]] · volver a [[_Finanzas]]', '');

  L.push('## En corto', '', seguro(extra.en_corto) || 'Sin resumen.', '');

  L.push('## Por categoría', '');
  if (r.por_categoria.length === 0) L.push('Sin gastos este mes.', '');
  else {
    L.push('| Categoría | Gastado | Presupuesto | Uso |', '|---|---:|---:|---:|');
    for (const c of r.por_categoria) {
      const pres = presPorCat.get(c.categoria_id);
      L.push(
        `| ${celda(nombreCat(c.categoria_id))} | ${formatearCOP(c.total)} | ${pres ? formatearCOP(pres) : '—'} | ${pres ? formatearPct(c.total / pres) : '—'} |`,
      );
    }
    L.push('');
  }

  L.push('## Dónde más gastaste', '');
  const top = r.top_comercios.filter((t) => esComercioDeCompra(t.comercio)).slice(0, 10);
  if (top.length === 0) L.push('Sin datos.', '');
  else {
    L.push('| Comercio | Total | Veces |', '|---|---:|---:|');
    for (const t of top) L.push(`| ${celda(t.comercio)} | ${formatearCOP(t.total)} | ${t.cantidad} |`);
    L.push('');
  }

  L.push('## Suscripciones activas', '');
  if (extra.suscripciones.length === 0) L.push('Ninguna detectada.', '');
  else {
    L.push('| Nombre | Monto | Periodo | Al año |', '|---|---:|---|---:|');
    for (const s of extra.suscripciones) L.push(`| ${celda(s.nombre)} | ${formatearCOP(s.monto)} | ${s.periodo} | ${formatearCOP(s.costo_anual)} |`);
    L.push('');
  }

  L.push('## Metas', '');
  if (extra.metas.length === 0) L.push('Sin metas activas.', '');
  else {
    L.push('| Meta | Objetivo | Aportado | Avance |', '|---|---:|---:|---:|');
    for (const m of extra.metas) {
      L.push(`| ${celda(m.nombre)} | ${formatearCOP(m.objetivo)} | ${formatearCOP(m.aportado)} | ${m.objetivo > 0 ? formatearPct(m.aportado / m.objetivo) : '—'} |`);
    }
    L.push('');
  }

  return L.join('\n');
}

/** Escritura atómica (archivo temporal + rename). Devuelve la ruta absoluta y los bytes escritos. */
export async function escribirNotaMensual(
  dirFinanzas: string, mes: Mes, contenido: string,
): Promise<{ ruta: string; bytes: number }> {
  const ruta = rutaNotaMensual(dirFinanzas, mes);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contenido, 'utf8');
  try {
    await fs.rename(tmp, ruta);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return { ruta, bytes: Buffer.byteLength(contenido, 'utf8') };
}
