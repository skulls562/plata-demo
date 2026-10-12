import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResumenPeriodo } from './metricas';
import { escaparMarkdown, escribirNotaMensual, esComercioDeCompra, notaMensual, type NotaMensualExtra, rutaNotaMensual } from './vault';
import type { Categoria } from './tipos';

const dirs: string[] = [];
function temp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plata-vault-'));   // SIEMPRE temporal: jamás el vault real
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

const cat = (id: string, nombre: string, emoji: string): Categoria => ({
  id, nombre, emoji, es_gasto: true, esencial: false, cuenta_hormiga: true, orden: 1, sistema: false, activa: true,
});

const resumen: ResumenPeriodo = {
  desde: '2026-09-01', hasta: '2026-09-30', gastado_variable: 1_850_000, gastado_fijos: 1_500_000, ingresos: 4_000_000,
  por_categoria: [{ categoria_id: 'comida', total: 450_000, cantidad: 20 }, { categoria_id: 'mercado', total: 600_000, cantidad: 9 }],
  top_comercios: [{ comercio: 'RAPPI [[Evil]] 123456789', total: 200_000, cantidad: 8 }, { comercio: 'Transferencias enviadas', total: 300_000, cantidad: 2 }],
  mayor_gasto: {
    id: 77, fecha: '2026-09-12', hora: '22:41', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 999_111, comercio: 'SECRETO MAYOR',
    comercio_norm: 'secreto mayor', categoria_id: 'otros', categoria_fuente: 'regla', computa: true, fijo_id: null, recurrente_id: null,
    medio: 'debito', origen: 'aviso', confianza: 'regla', verificado: true, ref_correo: 'mid:REF-SECRETA-0000', nota: 'NOTA PRIVADA',
    creado_en: '2026-09-12T03:41:00Z', actualizado_en: '2026-09-12T03:41:00Z', version: 1,
  },
  cantidad: 45,
};
const extra: NotaMensualExtra = {
  mes: '2026-09', generado_en: '2026-10-01T13:00:00Z', fijos: 1_500_000, ahorro_real: 650_000, score: 72,
  presupuestos: [{ categoria_id: 'comida', presupuesto: 400_000, gastado: 450_000 }],
  suscripciones: [{ nombre: 'Netflix | <b>x</b>', monto: 29_900, periodo: 'mensual', costo_anual: 358_800 }],
  metas: [{ nombre: 'Viaje', objetivo: 3_000_000, aportado: 600_000 }],
  en_corto: 'Gastaste $1.850.000 este mes.\n# Titulo falso [[enlace]] cuenta 123456789012',
  categorias: [cat('comida', 'Comida', '🍔'), cat('mercado', 'Mercado', '🛒')],
};

describe('rutaNotaMensual', () => {
  it('arma <dir>/Plata/AAAA-MM.md', () => {
    const d = temp();
    expect(rutaNotaMensual(d, '2026-09')).toBe(path.join(path.resolve(d), 'Plata', '2026-09.md'));
  });
  it('lanza con meses raros o traversal', () => {
    const d = temp();
    for (const m of ['../x', '2026-13', '2026-00', '2026-9', '', '2026-09/../..', '..\\..\\x', '2026-09\0', 'abcd-ef']) {
      expect(() => rutaNotaMensual(d, m), m).toThrow();
    }
    expect(() => rutaNotaMensual(d, undefined as unknown as string)).toThrow();
  });
});

describe('escaparMarkdown', () => {
  it('neutraliza enlaces, tablas, etiquetas, código y HTML', () => {
    const e = escaparMarkdown('[[x]] | # `c` <b>');
    expect(e).not.toContain('[[');
    expect(e).not.toMatch(/(^|[^\\])[|#`<>]/);
    expect(e).toBe('\\[\\[x\\]\\] \\| \\# \\`c\\` \\<b\\>');
  });
  it('quita saltos de línea', () => {
    expect(escaparMarkdown('a\nb\r\nc')).toBe('a b c');
  });
});

describe('notaMensual', () => {
  const nota = notaMensual(resumen, extra);

  it('frontmatter y enlaces', () => {
    expect(nota.startsWith('---\ntags: [finanzas, plata, mes]\nmes: 2026-09\n')).toBe(true);
    for (const l of ['gastado_variable: 1850000', 'gastos_fijos: 1500000', 'ingresos: 4000000', 'ahorro_real: 650000', 'score: 72', 'generado: 2026-10-01T13:00:00Z']) {
      expect(nota).toContain(l);
    }
    expect(nota).toContain('[[plata]]');
    expect(nota).toContain('[[_Finanzas]]');
  });

  it('tabla por categoría contra presupuesto', () => {
    expect(nota).toContain('| 🍔 Comida | $450.000 | $400.000 | 113% |');
    expect(nota).toContain('| 🛒 Mercado | $600.000 | — | — |');
  });

  it('suscripciones y metas', () => {
    expect(nota).toContain('| $29.900 | mensual | $358.800 |');
    expect(nota).toContain('| Viaje | $3.000.000 | $600.000 | 20% |');
  });

  it('nada de lo prohibido: movimiento individual, hora, nota, referencia, dígitos largos, enlaces inyectados', () => {
    for (const prohibido of ['SECRETO MAYOR', '22:41', 'NOTA PRIVADA', 'REF-SECRETA', 'mid:', '999.111', '999111']) {
      expect(nota).not.toContain(prohibido);
    }
    expect(nota).not.toMatch(/\d{5,}/.test(nota.replace(/gastado_variable: \d+|gastos_fijos: \d+|ingresos: \d+|ahorro_real: \d+/g, '')) ? /./ : /^$/);
    expect(nota).not.toContain('[[Evil]]');
    expect(nota).not.toContain('[[enlace]]');
    expect(nota).not.toContain('<b>');
    // el "# Titulo falso" no abre un encabezado
    expect(nota.split('\n').filter((l) => l.startsWith('# '))).toEqual(['# Plata · 2026-09']);
  });

  it('«Dónde más gastaste» solo lista comercios: sin transferencias, ingresos, llaves ni personas', () => {
    const sucios = ['Transferencias enviadas', 'Llave Bre-B', 'Transferencia a cuenta', 'Nómina empresa', 'Recibiste de Ana', 'Juan Camilo Perez Gomez', 'Maria Fernanda Lopez', 'Pago a cuenta de ahorros'];
    const buenos = ['Rappi', 'Carulla Poblado', 'Crepes y Waffles', 'Juan Valdez', 'Droguería Cruz Verde', 'Ara Belen', 'Pizzeria Il Forno'];
    const r2: ResumenPeriodo = {
      ...resumen,
      top_comercios: [...sucios, ...buenos].map((comercio, i) => ({ comercio, total: 1_000_000 - i * 1000, cantidad: 2 })),
    };
    const n = notaMensual(r2, extra);
    const seccion = n.split('## Dónde más gastaste')[1].split('## Suscripciones activas')[0];
    for (const x of sucios) expect(seccion, x).not.toContain(x);
    for (const x of buenos) expect(seccion, x).toContain(x);
    expect(esComercioDeCompra('')).toBe(false);
  });

  it('valores nulos y secciones vacías', () => {
    const vacia = notaMensual(
      { ...resumen, por_categoria: [], top_comercios: [], mayor_gasto: null },
      { ...extra, ahorro_real: null, score: null, suscripciones: [], metas: [], presupuestos: [], en_corto: '' },
    );
    expect(vacia).toContain('ahorro_real: null');
    expect(vacia).toContain('score: null');
    expect(vacia).toContain('Sin gastos este mes.');
    expect(vacia).toContain('Ninguna detectada.');
    expect(vacia).toContain('Sin metas activas.');
  });
});

describe('escribirNotaMensual', () => {
  it('escribe de forma atómica, sobrescribe y no deja temporales', async () => {
    const d = temp();
    const r1 = await escribirNotaMensual(d, '2026-09', 'uno ñ');
    expect(r1.ruta).toBe(path.join(path.resolve(d), 'Plata', '2026-09.md'));
    expect(r1.bytes).toBe(Buffer.byteLength('uno ñ'));
    await escribirNotaMensual(d, '2026-09', 'dos');
    expect(fs.readFileSync(r1.ruta, 'utf8')).toBe('dos');
    expect(fs.readdirSync(path.join(d, 'Plata'))).toEqual(['2026-09.md']);
  });
  it('rechaza un mes con traversal sin escribir nada', async () => {
    const d = temp();
    await expect(escribirNotaMensual(d, '../../evil', 'x')).rejects.toThrow();
    expect(fs.readdirSync(d)).toEqual([]);
  });
});
