// Pruebas de seguridad.ts (SPEC §7, §8.2). Datos 100 % sintéticos.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_PRUEBA, SECRETO_PRUEBA, TOKEN_PRUEBA, TOKEN_VIEJO_PRUEBA, baseDePrueba } from '../../tests/seguridad/base-prueba';
import {
  aISO, chatAutorizado, compararSeguro, cookieSesion, cookieSesionBorrada, crearAlmacenSQLite, enmascararDigitos,
  evaluarAuthResults, evaluarIntentoPin, evaluarSesion, firmarCookie, guardarPinNuevo, hashIdSesion, hashPin,
  hostPermitido, leerCookie, leerCookieFirmada, leerEntorno, nuevaFilaSesion, nuevoIdSesion, origenPermitido,
  registrarResultadoPin, sanitizarDetalle, tokenValido, validarFormatoPin, verificarPin,
} from './seguridad';
import type { EntornoPlata, EstadoLimite, FilaSesion } from './seguridad';

// Secretos sintéticos (no reales).
const TOKEN = TOKEN_PRUEBA;
const TOKEN_VIEJO = TOKEN_VIEJO_PRUEBA;
const SECRETO = SECRETO_PRUEBA;
const ENV_OK: Record<string, string | undefined> = ENV_PRUEBA;

function entorno(extra: Record<string, string> = {}): EntornoPlata {
  return leerEntorno({ ...ENV_OK, ...extra });
}

describe('leerEntorno', () => {
  it('acepta el mínimo y aplica los valores por defecto', () => {
    const e = entorno();
    expect(e.hosts).toEqual(['127.0.0.1:3010', 'localhost:3010']);
    expect(e.origenes).toEqual(['http://127.0.0.1:3010', 'http://localhost:3010']);
    expect(e.url_panel).toBe('http://127.0.0.1:3010');
    expect(e.ollama_url).toBe('http://127.0.0.1:11434');
    expect(e.db_path).toBe('data/plata.db');
    expect(e.token_anterior).toBeNull();
  });
  it('rechaza secretos cortos o ausentes sin mostrar su valor', () => {
    expect(() => leerEntorno({ ...ENV_OK, PLATA_TOKEN: 'corto' })).toThrow(/PLATA_TOKEN/);
    try { leerEntorno({ ...ENV_OK, PLATA_TOKEN: 'corto123' }); } catch (e) { expect(String(e)).not.toContain('corto123'); }
    expect(() => leerEntorno({ ...ENV_OK, PLATA_SESION_SECRETO: undefined })).toThrow(/PLATA_SESION_SECRETO/);
    expect(() => leerEntorno({ ...ENV_OK, PLATA_SESION_SECRETO: 'x'.repeat(42) })).toThrow(/PLATA_SESION_SECRETO/);
    expect(() => leerEntorno({ ...ENV_OK, PLATA_TOKEN_ANTERIOR: 'corto' })).toThrow(/PLATA_TOKEN_ANTERIOR/);
  });
  it('rechaza secreto de sesión igual al token', () => {
    expect(() => leerEntorno({ ...ENV_OK, PLATA_SESION_SECRETO: TOKEN })).toThrow(/distinto/);
  });
  it('rechaza OLLAMA_URL remota y acepta loopback', () => {
    expect(() => entorno({ OLLAMA_URL: 'http://192.168.1.20:11434' })).toThrow(/OLLAMA_URL/);
    expect(() => entorno({ OLLAMA_URL: 'http://127.0.0.1.evil.com:11434' })).toThrow(/OLLAMA_URL/);
    expect(() => entorno({ OLLAMA_URL: 'http://user:pw@localhost:11434' })).toThrow(/OLLAMA_URL/);
    expect(entorno({ OLLAMA_URL: 'http://localhost:11434' }).ollama_url).toBe('http://localhost:11434');
  });
  it('PLATA_HOSTS solo loopback; chat solo dígitos; vault con ruta absoluta', () => {
    expect(() => entorno({ PLATA_HOSTS: '0.0.0.0:3010' })).toThrow(/PLATA_HOSTS/);
    expect(() => entorno({ PLATA_HOSTS: 'plata.local:3010' })).toThrow(/PLATA_HOSTS/);
    expect(() => entorno({ PLATA_TELEGRAM_CHAT_ID: '12345x' })).toThrow(/CHAT_ID/);
    expect(() => entorno({ PLATA_VAULT_FINANZAS: 'vault/Finanzas' })).toThrow(/PLATA_VAULT_FINANZAS/);
    expect(entorno({ PLATA_VAULT_FINANZAS: 'C:\\vault\\Finanzas' }).dir_finanzas).toBe('C:\\vault\\Finanzas');
  });
});

describe('token de n8n (tiempo constante)', () => {
  const e = entorno({ PLATA_TOKEN_ANTERIOR: TOKEN_VIEJO });
  it('compararSeguro no depende de la longitud ni lanza', () => {
    expect(compararSeguro('abc', 'abc')).toBe(true);
    expect(compararSeguro('abc', 'abd')).toBe(false);
    expect(compararSeguro('abc', 'abcdef')).toBe(false);   // timingSafeEqual directo lanzaría con largos distintos
    expect(compararSeguro('', '')).toBe(true);
  });
  it('acepta el actual y el anterior; rechaza lo demás', () => {
    expect(tokenValido(`Bearer ${TOKEN}`, e)).toBe(true);
    expect(tokenValido(`bearer ${TOKEN}`, e)).toBe(true);
    expect(tokenValido(`Bearer ${TOKEN_VIEJO}`, e)).toBe(true);
    expect(tokenValido(`Bearer ${TOKEN}x`, e)).toBe(false);
    expect(tokenValido(TOKEN, e)).toBe(false);
    expect(tokenValido(`Basic ${TOKEN}`, e)).toBe(false);
    expect(tokenValido('Bearer ', e)).toBe(false);
    expect(tokenValido(null, e)).toBe(false);
    expect(tokenValido(`Bearer ${TOKEN_VIEJO}`, entorno())).toBe(false);   // sin rotación, el viejo no vale
  });
});

describe('PIN', () => {
  it('formato: 6–12 dígitos y no trivial', () => {
    for (const ok of ['482916', '73918264', '508127349160']) expect(validarFormatoPin(ok), ok).toBe(true);
    for (const malo of ['48291', '4829163759102', 'abcdef', '48 2916', '111111', '123456', '654321', '890123',
      '121212', '123123', '19900514', '14051990', '150590', '900514', '0000000']) {
      expect(validarFormatoPin(malo), malo).toBe(false);
    }
  });
  it('hash scrypt con el formato del SPEC y verificación', async () => {
    const h = await hashPin('482916');
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/);
    expect(await verificarPin('482916', h)).toBe(true);
    expect(await verificarPin('482917', h)).toBe(false);
    expect(await hashPin('482916')).not.toBe(h);   // sal aleatoria
  });
  it('rechaza hashes manipulados o con parámetros peligrosos', async () => {
    const h = await hashPin('482916');
    const p = h.split('$');
    expect(await verificarPin('482916', `${p.slice(0, 5).join('$')}$${'A'.repeat(44)}`)).toBe(false);
    expect(await verificarPin('482916', h.replace('$16384$', '$1073741824$'))).toBe(false);
    expect(await verificarPin('482916', h.replace('$16384$', '$1024$'))).toBe(false);
    expect(await verificarPin('482916', 'texto')).toBe(false);
    expect(await verificarPin('', h)).toBe(false);
  });
  it('hashPin no acepta PIN trivial', async () => {
    await expect(hashPin('123456')).rejects.toThrow();
  });
});

describe('cookie de sesión firmada', () => {
  it('id aleatorio de 32 bytes y hash sha256 hex', () => {
    const a = nuevoIdSesion();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nuevoIdSesion()).not.toBe(a);
    expect(hashIdSesion(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('firma y verifica; cualquier alteración → null', () => {
    const id = nuevoIdSesion();
    const v = firmarCookie(id, SECRETO);
    expect(leerCookieFirmada(v, SECRETO)).toBe(id);
    const [i, f] = v.split('.');
    const otraLetra = (c: string) => (c === 'A' ? 'B' : 'A');
    expect(leerCookieFirmada(`${i}.${otraLetra(f[0])}${f.slice(1)}`, SECRETO)).toBeNull();
    expect(leerCookieFirmada(`${otraLetra(i[0])}${i.slice(1)}.${f}`, SECRETO)).toBeNull();
    expect(leerCookieFirmada(v, `${SECRETO}x`)).toBeNull();
    expect(leerCookieFirmada(`${v}.x`, SECRETO)).toBeNull();
    expect(leerCookieFirmada(undefined, SECRETO)).toBeNull();
    expect(leerCookieFirmada('', SECRETO)).toBeNull();
  });
  it('atributos: HttpOnly, SameSite=Strict, Path=/, 30 días, sin Secure (loopback)', () => {
    const c = cookieSesion('x.y');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=2592000');
    expect(c).not.toContain('Secure');
    expect(cookieSesionBorrada()).toContain('Max-Age=0');
  });
  it('leerCookie ignora nombres repetidos (cookie tossing)', () => {
    expect(leerCookie('a=1; plata_sesion=xyz; b=2', 'plata_sesion')).toBe('xyz');
    expect(leerCookie('plata_sesion=uno; plata_sesion=dos', 'plata_sesion')).toBeUndefined();
    expect(leerCookie(null, 'plata_sesion')).toBeUndefined();
  });
  it('vence a los 30 días o tras 7 días sin uso; se toca cada 10 min', () => {
    const t0 = new Date('2026-10-01T12:00:00Z');
    const f = nuevaFilaSesion(nuevoIdSesion(), t0);
    const en = (ms: number) => new Date(t0.getTime() + ms);
    const H = 3600e3, D = 24 * H;
    expect(evaluarSesion(f, t0)).toEqual({ valida: true, tocar: false });
    expect(evaluarSesion(f, en(5 * 60e3)).tocar).toBe(false);
    expect(evaluarSesion(f, en(11 * 60e3))).toEqual({ valida: true, tocar: true });
    expect(evaluarSesion(f, en(7 * D - 1000)).valida).toBe(true);
    expect(evaluarSesion(f, en(7 * D)).valida).toBe(false);                     // 7 días sin uso
    const activa: FilaSesion = { ...f, ultima_actividad_en: aISO(en(30 * D - H)) };
    expect(evaluarSesion(activa, en(30 * D - 1000)).valida).toBe(true);
    expect(evaluarSesion(activa, en(30 * D)).valida).toBe(false);              // 30 días aunque se use
    expect(evaluarSesion(null, t0).valida).toBe(false);
  });
});

describe('Host, Origin y chat', () => {
  const e = entorno();
  it('Host exacto', () => {
    expect(hostPermitido('127.0.0.1:3010', e)).toBe(true);
    expect(hostPermitido('LOCALHOST:3010', e)).toBe(true);
    expect(hostPermitido('127.0.0.1:3010.evil.com', e)).toBe(false);
    expect(hostPermitido('localhost:3011', e)).toBe(false);
    expect(hostPermitido('127.0.0.1', e)).toBe(false);
    expect(hostPermitido('evil.com', e)).toBe(false);
    expect(hostPermitido(null, e)).toBe(false);
  });
  it('Origin obligatorio, de la lista; Sec-Fetch-Site same-origin', () => {
    expect(origenPermitido('http://127.0.0.1:3010', null, e)).toBe(true);
    expect(origenPermitido('http://localhost:3010', 'same-origin', e)).toBe(true);
    expect(origenPermitido('http://127.0.0.1:3010', 'same-site', e)).toBe(false);
    expect(origenPermitido('http://127.0.0.1:3010', 'cross-site', e)).toBe(false);
    expect(origenPermitido('null', null, e)).toBe(false);
    expect(origenPermitido(null, null, e)).toBe(false);
    expect(origenPermitido('http://evil.com', null, e)).toBe(false);
    expect(origenPermitido('https://127.0.0.1:3010', null, e)).toBe(false);
  });
  it('chat distinto de 123456789 rechazado', () => {
    expect(chatAutorizado(123456789, e)).toBe(true);
    expect(chatAutorizado('123456789', e)).toBe(true);
    expect(chatAutorizado(123456790, e)).toBe(false);
    expect(chatAutorizado(-123456789, e)).toBe(false);
    expect(chatAutorizado('123456789 ', e)).toBe(false);
    expect(chatAutorizado(123456789.5, e)).toBe(false);
    expect(chatAutorizado('1234567890', e)).toBe(false);
  });
});

describe('enmascararDigitos', () => {
  it('tarjetas, *0991 y referencias', () => {
    expect(enmascararDigitos('Tarjeta 4111 1111 1111 1111 ok')).toBe('Tarjeta [num] ok');
    expect(enmascararDigitos('con tu T.Deb *0991, el')).toBe('con tu T.Deb *[num], el');
    expect(enmascararDigitos('ref. 12345678')).toBe('ref. [num]');
    expect(enmascararDigitos('cuenta 1234-5678-90')).toBe('cuenta [num]');
  });
  it('deja intactos fechas, horas, montos y números cortos', () => {
    const t = 'Compraste $14.730,00 en D1 el 06/10/2026 a las 13:59. COP $129,900 y COP 45,000; 2026-10-06T18:59:00Z; 3 cuotas de 120';
    expect(enmascararDigitos(t)).toBe(t);
    expect(enmascararDigitos('Recibiste $1.234.567,89 en *0000')).toBe('Recibiste $1.234.567,89 en *[num]');
  });
  it('mezcla real (sintética)', () => {
    expect(enmascararDigitos('Bancolombia: Transferiste $50.000 desde tu cta *0000 a la cta 98765432109 el 06/10/2026'))
      .toBe('Bancolombia: Transferiste $50.000 desde tu cta *[num] a la cta [num] el 06/10/2026');
  });
  it('lineal con textos enormes (200 KB < 100 ms)', () => {
    const grande = '4111 1111 1111 1111 $1.234,56 06/10/2026 '.repeat(5000).slice(0, 200_000);
    const t0 = performance.now();
    enmascararDigitos(grande);
    expect(performance.now() - t0).toBeLessThan(100);
  });
  it('sanitizarDetalle enmascara, quita controles y recorta a 500', () => {
    expect(sanitizarDetalle('a\u0000b 12345678')).toBe('a b [num]');
    const s = sanitizarDetalle('x'.repeat(600));
    expect(s).toHaveLength(500);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('Authentication-Results (DKIM/DMARC)', () => {
  const D = 'ayn.notificacionesbancolombia.com';
  it('pasa con dmarc=pass o dkim=pass alineado', () => {
    expect(evaluarAuthResults(`mx.google.com; dkim=pass header.i=@${D}; spf=pass; dmarc=pass`, D)).toBe('pasa');
    expect(evaluarAuthResults('mx.google.com;\r\n       dkim=pass header.i=@notificacionesbancolombia.com header.s=s1 header.b=AbC1;\r\n       spf=pass (google.com: domain of x@y designates 1.2.3.4 as permitted sender) smtp.mailfrom=x@y', D)).toBe('pasa');
    expect(evaluarAuthResults(`mx.google.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${D}`, D)).toBe('pasa');
    expect(evaluarAuthResults(`Authentication-Results: mx.google.com; dkim=pass header.d=${D}`, D)).toBe('pasa');
  });
  it('falla con dmarc=fail o dkim=fail sin otro pass alineado', () => {
    expect(evaluarAuthResults(`mx.google.com; dkim=fail header.i=@${D}; dmarc=fail header.from=${D}`, D)).toBe('falla');
    expect(evaluarAuthResults(`mx.google.com; dkim=fail (bad signature) header.i=@${D}`, D)).toBe('falla');
    expect(evaluarAuthResults(`mx.google.com; dkim=fail header.i=@${D}; dkim=pass header.i=@evil.co`, D)).toBe('falla');
    expect(evaluarAuthResults(`mx.google.com; dkim=pass header.i=@${D}; dmarc=fail`, D)).toBe('falla');
  });
  it('no se deja engañar por firmas de otros dominios ni sufijos falsos', () => {
    expect(evaluarAuthResults('mx.google.com; dkim=pass header.i=@evil.co; spf=pass', D)).toBe('desconocido');
    expect(evaluarAuthResults(`mx.google.com; dkim=pass header.d=${D}.atacante.co`, D)).toBe('desconocido');
    expect(evaluarAuthResults('mx.google.com; dkim=pass header.d=xnotificacionesbancolombia.com', D)).toBe('desconocido');
    expect(evaluarAuthResults('mx.google.com; dmarc=pass header.from=evil.co', D)).toBe('desconocido');
  });
  it('ignora cabeceras de servidores no confiables y lo concatenado después', () => {
    expect(evaluarAuthResults(`evil.co; dkim=pass header.i=@${D}; dmarc=pass`, D)).toBe('desconocido');
    expect(evaluarAuthResults(`mx.google.com; dkim=fail header.i=@${D}\nevil.co; dkim=pass header.i=@${D}`, D)).toBe('falla');
    expect(evaluarAuthResults(`mx.google.com; spf=softfail, evil.co; dkim=pass header.i=@${D}; dmarc=pass`, D)).toBe('desconocido');
    expect(evaluarAuthResults(`mx.google.com; spf=pass (dkim=pass header.i=@${D})`, D)).toBe('desconocido');
  });
  it('sin cabecera → desconocido', () => {
    expect(evaluarAuthResults(undefined, D)).toBe('desconocido');
    expect(evaluarAuthResults('', D)).toBe('desconocido');
    expect(evaluarAuthResults('mx.google.com; spf=pass', D)).toBe('desconocido');
  });
});

describe('límite de intentos de PIN', () => {
  const t0 = new Date('2026-10-06T18:00:00Z');
  /** Ataque continuo: intenta en cuanto se puede, 1 s entre intentos. */
  function atacar(fallos: number) {
    let e: EstadoLimite | null = null;
    let t = t0.getTime();
    const bloqueos: { tras: number; segundos: number; b24: boolean }[] = [];
    for (let n = 1; n <= fallos; n++) {
      let ev = evaluarIntentoPin(e, new Date(t));
      if (!ev.permitido) { t += ev.reintentar_en_s * 1000; ev = evaluarIntentoPin(e, new Date(t)); }
      expect(ev.permitido).toBe(true);
      const r = registrarResultadoPin(e, false, new Date(t));
      e = r.estado;
      const b = evaluarIntentoPin(e, new Date(t));
      if (!b.permitido) bloqueos.push({ tras: n, segundos: b.reintentar_en_s, b24: r.bloqueo_24h });
      t += 1000;
    }
    return { e: e as EstadoLimite, bloqueos, t };
  }
  it('5 → 5 min, 10 → 10 min, 15 → 20 min, 20 → 24 h', () => {
    const { bloqueos } = atacar(20);
    expect(bloqueos).toEqual([
      { tras: 5, segundos: 300, b24: false },
      { tras: 10, segundos: 600, b24: false },
      { tras: 15, segundos: 1200, b24: false },
      { tras: 20, segundos: 86400, b24: true },
    ]);
  });
  it('bloqueado → no se permite intentar (ni con el PIN correcto)', () => {
    const { e } = atacar(5);
    const ahora = new Date(Date.parse(e.ventana_desde) + 1000);
    const ev = evaluarIntentoPin(e, ahora);
    expect(ev.permitido).toBe(false);
    expect(ev.reintentar_en_s).toBe(299);
  });
  it('un acierto reinicia fallos pero no fallos_24h', () => {
    const { e } = atacar(4);
    const r = registrarResultadoPin(e, true, new Date(t0.getTime() + 10_000));
    expect(r.estado.fallos).toBe(0);
    expect(r.estado.fallos_24h).toBe(4);
  });
  it('15 min sin fallos ni bloqueo reinicia la ventana corta; 24 h la larga', () => {
    const { e } = atacar(4);
    const despues = new Date(Date.parse(e.ventana_desde) + 15 * 60e3 + 1000);
    const r = registrarResultadoPin(e, false, despues);
    expect(r.estado.fallos).toBe(1);
    expect(r.estado.fallos_24h).toBe(5);
    expect(r.estado.bloqueado_hasta).toBeNull();
    const diaDespues = new Date(t0.getTime() + 24 * 3600e3 + 60e3);
    expect(registrarResultadoPin(e, false, diaDespues).estado.fallos_24h).toBe(1);
  });
});

// --------------------------------------------------------------------------- almacén SQLite
describe('almacén SQLite (tablas de §1.2)', () => {
  it('límites, sesiones, idempotencia y eventos enmascarados', () => {
    const db = baseDePrueba();
    const a = crearAlmacenSQLite(db);
    expect(a.leerPinHash()).toBeNull();
    expect(a.leerLimite('pin')).toBeNull();
    const { estado } = registrarResultadoPin(null, false, new Date('2026-10-06T18:00:00Z'));
    a.guardarLimite('pin', estado);
    a.guardarLimite('pin', { ...estado, fallos: 2 });
    expect(a.leerLimite('pin')).toEqual({ ...estado, fallos: 2 });

    const t0 = new Date('2026-10-01T12:00:00Z');
    const viva = nuevaFilaSesion(nuevoIdSesion(), t0);
    const vieja = nuevaFilaSesion(nuevoIdSesion(), new Date('2026-09-01T12:00:00Z'));
    a.crearSesion(viva); a.crearSesion(vieja);
    expect(a.leerSesion(viva.id_hash)).toEqual(viva);
    a.tocarSesion(viva.id_hash, '2026-10-02T00:00:00Z');
    expect(a.leerSesion(viva.id_hash)?.ultima_actividad_en).toBe('2026-10-02T00:00:00Z');
    a.borrarSesionesVencidas(new Date('2026-10-03T00:00:00Z'));
    expect(a.leerSesion(vieja.id_hash)).toBeNull();
    expect(a.leerSesion(viva.id_hash)).not.toBeNull();
    a.borrarSesion(viva.id_hash);
    expect(a.leerSesion(viva.id_hash)).toBeNull();

    a.guardarIdempotencia('/api/x', 'clave-123', { huella_cuerpo: 'h', estado_http: 201, respuesta: '{}', creado_en: '2026-10-06T18:00:00Z' });
    expect(a.leerIdempotencia('/api/x', 'clave-123')?.estado_http).toBe(201);

    a.registrarEvento({ nivel: 'error', tipo: 'prueba', detalle: 'cuenta 98765432109 falló' });
    const ev = db.prepare('SELECT detalle FROM eventos').get() as { detalle: string };
    expect(ev.detalle).toBe('cuenta [num] falló');
  });
  it('guardarPinNuevo guarda el hash, cierra sesiones y reinicia el límite', async () => {
    const db = baseDePrueba();
    const a = crearAlmacenSQLite(db);
    a.crearSesion(nuevaFilaSesion(nuevoIdSesion(), new Date()));
    a.guardarLimite('pin', registrarResultadoPin(null, false, new Date()).estado);
    const h = await hashPin('482916');
    guardarPinNuevo(db, h);
    expect(a.leerPinHash()).toBe(h);
    expect((db.prepare('SELECT count(*) AS n FROM sesiones').get() as { n: number }).n).toBe(0);
    expect(a.leerLimite('pin')).toBeNull();
    expect(() => guardarPinNuevo(db, 'pin-en-claro')).toThrow();
    expect(a.leerPinHash()).toBe(h);
  });
});

// --------------------------------------------------------------------------- guardias estáticos
function archivosTS(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivosTS(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const SRC = join(__dirname, '..');

describe('guardias del código', () => {
  it('sin Server Actions en v1 (ningún "use server")', () => {
    const conAcciones = archivosTS(SRC).filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));
    expect(conAcciones).toEqual([]);
  });
  it('seguridad.ts y http.ts: SQL sin interpolar', () => {
    for (const f of ['lib/seguridad.ts', 'lib/http.ts']) {
      const src = readFileSync(join(SRC, f), 'utf8');
      expect(/(prepare|exec)\(\s*`[^`]*\$\{/.test(src), f).toBe(false);
    }
  });
});
