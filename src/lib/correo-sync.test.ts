import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estadoSync, iniciarSyncAutomatico, rutaClaveGmail, sincronizarCorreo } from './correo-sync';
import { conVariable } from '../../scripts/guardar-clave-gmail';

describe('«Actualizar Gmail»', () => {
  it('sin correo configurado pide el correo; con correo pero sin contraseña pide la contraseña', () => {
    expect(estadoSync({})).toEqual({ configurado: false, falta: 'tu correo (PLATA_IMAP_USER)' });
    const carpeta = mkdtempSync(join(tmpdir(), 'plata-gmail-'));
    try {
      const env = { PLATA_IMAP_USER: 'yo@gmail.com', IMAP_PASS_FILE: join(carpeta, 'no-existe.txt') };
      expect(estadoSync(env)).toEqual({ configurado: false, falta: 'la contraseña de aplicación de Gmail' });
      writeFileSync(join(carpeta, 'clave.txt'), 'abcdefghijklmnop\n');
      expect(estadoSync({ ...env, IMAP_PASS_FILE: join(carpeta, 'clave.txt') })).toEqual({ configurado: true, falta: null });
    } finally { rmSync(carpeta, { recursive: true, force: true }); }
  });

  it('sin configurar no lanza nada y explica el paso único', async () => {
    const r = await sincronizarCorreo(7, {});
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('sin_configurar');
    expect(r.mensaje).toContain('npm run gmail-clave');
  });

  it('la ruta de la clave sale de IMAP_PASS_FILE o de ~/.plata/gmail.txt', () => {
    expect(rutaClaveGmail({ IMAP_PASS_FILE: 'C:/x/clave.txt' })).toBe('C:/x/clave.txt');
    expect(rutaClaveGmail({})).toMatch(/\/\.plata\/gmail\.txt$/);
  });

  it('la revisión automática es opcional: sin PLATA_SYNC_AUTO_MIN o con un valor fuera de rango no arranca', () => {
    const g = globalThis as typeof globalThis & { __plataSyncAuto?: NodeJS.Timeout };
    iniciarSyncAutomatico({});
    iniciarSyncAutomatico({ PLATA_SYNC_AUTO_MIN: '1' });
    iniciarSyncAutomatico({ PLATA_SYNC_AUTO_MIN: 'abc' });
    expect(g.__plataSyncAuto).toBeUndefined();
  });

  it('el script pone o cambia variables del .env sin tocar las demás', () => {
    expect(conVariable('', 'A', '1')).toBe('A=1\n');
    expect(conVariable('X=9\nA=0\n', 'A', '1')).toBe('X=9\nA=1\n');
    expect(conVariable('X=9', 'A', '1')).toBe('X=9\nA=1\n');
  });
});
