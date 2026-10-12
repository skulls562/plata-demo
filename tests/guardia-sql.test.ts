// Guardia de SQL (SPEC §8.2): ningún prepare(...) / exec(...) puede llevar una plantilla con interpolación `${`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function archivos(dir: string): string[] {
  const res: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...archivos(p));
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) res.push(p);
  }
  return res;
}

describe('guardia de SQL', () => {
  it('no hay prepare/exec con plantillas interpoladas en src/**/*.ts', () => {
    const malos: string[] = [];
    // prepare(` ... ${ ... `  /  exec(` ... ${ ... `   (la plantilla no contiene otra comilla invertida antes del ${)
    const re = /\b(?:prepare|exec)\(\s*`[^`]*\$\{/;
    for (const f of archivos(path.resolve(process.cwd(), 'src'))) {
      if (re.test(fs.readFileSync(f, 'utf8'))) malos.push(path.relative(process.cwd(), f));
    }
    expect(malos).toEqual([]);
  });

  it('la guardia detecta un caso malo', () => {
    const re = /\b(?:prepare|exec)\(\s*`[^`]*\$\{/;
    expect(re.test('db.prepare(`SELECT * FROM t WHERE a = ${x}`)')).toBe(true);
    expect(re.test('db.prepare(`SELECT * FROM t WHERE a = ?`)')).toBe(false);
  });
});
