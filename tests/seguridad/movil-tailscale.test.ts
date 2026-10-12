// Panel en el celular por Tailscale Serve: hosts *.ts.net, Origin https, cookie Secure y PLATA_URL_PANEL.
// Datos sintéticos. No debilita nada: un host desconocido sigue dando 403.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { conAuth, fijarAlmacenSeguridad, fijarEntorno, reiniciarEstadoHTTP, respuestaJSON } from '@/lib/http';
import {
  cookieSesion, cookieSesionBorrada, crearAlmacenSQLite, guardarPinNuevo, hashPin, hostPermitido, leerEntorno,
  llegoPorHttps, origenPermitido,
} from '@/lib/seguridad';
import { DELETE as cerrarSesion, POST as entrar } from '@/app/api/sesion/route';
import { proxy } from '@/proxy';
import { ENV_PRUEBA, baseDePrueba } from './base-prueba';

const TS = 'mi-pc.tail1a2b3.ts.net';
const HOSTS = `127.0.0.1:3010,localhost:3010,${TS}`;
const PIN = '482916';
const sinParams = { params: Promise.resolve({}) };
const entorno = (extra: Record<string, string> = {}) => leerEntorno({ ...ENV_PRUEBA, PLATA_HOSTS: HOSTS, ...extra });

describe('PLATA_HOSTS con Tailscale', () => {
  it('acepta un nombre *.ts.net exacto y su origen es https', () => {
    const e = entorno();
    expect(e.hosts).toContain(TS);
    expect(e.origenes).toEqual(['http://127.0.0.1:3010', 'http://localhost:3010', `https://${TS}`]);
    expect(e.url_panel).toBe('http://127.0.0.1:3010');
  });
  it('acepta un puerto en el nombre de Tailscale (serve en 8443)', () => {
    expect(entorno({ PLATA_HOSTS: `${TS}:8443` }).origenes).toEqual([`https://${TS}:8443`]);
  });
  it('rechaza comodines, otros dominios, http:// y nombres cortos', () => {
    for (const h of ['*.ts.net', '*.tail1a2b3.ts.net', 'evil.com', 'mi-pc.ts.net', `https://${TS}`, `${TS}.evil.com`, `evil.com/${TS}`, 'ts.net', `x.${TS}:99999`]) {
      expect(() => entorno({ PLATA_HOSTS: `127.0.0.1:3010,${h}` }), h).toThrow(/PLATA_HOSTS/);
    }
  });
  it('hostPermitido: el nombre añadido sí; uno parecido o desconocido no', () => {
    const e = entorno();
    expect(hostPermitido(TS, e)).toBe(true);
    expect(hostPermitido(TS.toUpperCase(), e)).toBe(true);
    expect(hostPermitido(`otro.${TS}`, e)).toBe(false);
    expect(hostPermitido(`${TS}.evil.com`, e)).toBe(false);
    expect(hostPermitido('otro-pc.tail1a2b3.ts.net', e)).toBe(false);
    // Sin añadirlo a PLATA_HOSTS, ningún *.ts.net pasa.
    expect(hostPermitido(TS, leerEntorno(ENV_PRUEBA))).toBe(false);
  });
  it('origenPermitido: solo https://<host de la lista> y same-origin', () => {
    const e = entorno();
    expect(origenPermitido(`https://${TS}`, 'same-origin', e)).toBe(true);
    expect(origenPermitido(`http://${TS}`, null, e)).toBe(false);
    expect(origenPermitido('https://otro-pc.tail1a2b3.ts.net', 'same-origin', e)).toBe(false);
    expect(origenPermitido(`https://${TS}`, 'cross-site', e)).toBe(false);
    expect(origenPermitido(`https://${TS}`, null, leerEntorno(ENV_PRUEBA))).toBe(false);
  });
});

describe('PLATA_URL_PANEL', () => {
  it('por defecto es el primer host; si se fija, debe ser un origen de la lista', () => {
    expect(entorno({ PLATA_URL_PANEL: `https://${TS}` }).url_panel).toBe(`https://${TS}`);
    expect(entorno({ PLATA_URL_PANEL: `https://${TS}/` }).url_panel).toBe(`https://${TS}`);
    expect(entorno({ PLATA_URL_PANEL: '   ' }).url_panel).toBe('http://127.0.0.1:3010');
  });
  it('rechaza rutas, credenciales, hosts fuera de la lista y basura', () => {
    for (const u of [`https://${TS}/movimientos`, `https://user:pw@${TS}`, 'https://evil.com', `http://${TS}`, 'no es url', `https://${TS}?x=1`]) {
      expect(() => entorno({ PLATA_URL_PANEL: u }), u).toThrow(/PLATA_URL_PANEL/);
    }
  });
});

describe('cookie de sesión según el protocolo', () => {
  it('Secure solo por https; siempre HttpOnly + SameSite=Strict', () => {
    const https = cookieSesion('x.y', true);
    expect(https).toContain('; Secure');
    expect(https).toContain('HttpOnly');
    expect(https).toContain('SameSite=Strict');
    expect(cookieSesion('x.y')).not.toContain('Secure');
    expect(cookieSesionBorrada(true)).toContain('; Secure');
    expect(cookieSesionBorrada()).not.toContain('Secure');
  });
  it('llegoPorHttps lee X-Forwarded-Proto o el protocolo de la URL', () => {
    expect(llegoPorHttps(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(llegoPorHttps(new Headers({ 'x-forwarded-proto': 'HTTPS, http' }))).toBe(true);
    expect(llegoPorHttps(new Headers({ 'x-forwarded-proto': 'http' }), 'https:')).toBe(false);
    expect(llegoPorHttps(new Headers(), 'https:')).toBe(true);
    expect(llegoPorHttps(new Headers(), 'http:')).toBe(false);
  });
});

describe('rutas y proxy con el host de Tailscale', () => {
  let db: DatabaseSync;
  let hash = '';
  beforeAll(async () => { hash = await hashPin(PIN); });
  beforeEach(() => {
    db = baseDePrueba();
    guardarPinNuevo(db, hash);
    fijarEntorno(entorno());
    fijarAlmacenSeguridad(crearAlmacenSQLite(db));
    reiniciarEstadoHTTP();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  const post = (host: string, headers: Record<string, string>) => entrar(new Request(`http://127.0.0.1:3010/api/sesion`, {
    method: 'POST', body: JSON.stringify({ pin: PIN }),
    headers: { host, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
  }), sinParams);

  it('POST /api/sesion por Tailscale: 204 y cookie Secure', async () => {
    const res = await post(TS, { origin: `https://${TS}`, 'x-forwarded-proto': 'https', 'x-forwarded-host': TS });
    expect(res.status).toBe(204);
    const c = res.headers.get('set-cookie') ?? '';
    expect(c).toContain('; Secure');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
  });
  it('POST /api/sesion en loopback http: 204 y cookie sin Secure', async () => {
    const res = await post('127.0.0.1:3010', { origin: 'http://127.0.0.1:3010' });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).not.toContain('Secure');
  });
  it('Origin http:// o de otro host con el Host de Tailscale → 403', async () => {
    expect((await post(TS, { origin: `http://${TS}` })).status).toBe(403);
    expect((await post(TS, { origin: 'https://evil.com' })).status).toBe(403);
  });
  it('Host desconocido → 403 aunque el Origin coincida', async () => {
    const res = await post('intruso.tail1a2b3.ts.net', { origin: 'https://intruso.tail1a2b3.ts.net' });
    expect(res.status).toBe(403);
  });
  it('PATCH desde la URL de Tailscale: Origin permitido pasa, ajeno no', async () => {
    const ruta = conAuth('publica', async () => respuestaJSON({ ok: true }));
    const mk = (origin: string) => ruta(new Request('http://127.0.0.1:3010/api/x', {
      method: 'PATCH', headers: { host: TS, origin, 'sec-fetch-site': 'same-origin' },
    }), sinParams);
    expect((await mk(`https://${TS}`)).status).toBe(200);
    expect((await mk('https://evil.com')).status).toBe(403);
  });
  it('proxy: Host ts.net en la lista pasa; fuera de la lista → 403; redirección a /entrar en https', () => {
    vi.stubEnv('PLATA_TOKEN', ENV_PRUEBA.PLATA_TOKEN);
    vi.stubEnv('PLATA_SESION_SECRETO', ENV_PRUEBA.PLATA_SESION_SECRETO);
    vi.stubEnv('PLATA_TELEGRAM_CHAT_ID', ENV_PRUEBA.PLATA_TELEGRAM_CHAT_ID);
    vi.stubEnv('PLATA_HOSTS', HOSTS);
    const req = (host: string, extra: Record<string, string> = {}) =>
      new NextRequest('http://127.0.0.1:3010/', { headers: { host, ...extra } });
    const malo = proxy(req('intruso.tail1a2b3.ts.net'));
    expect(malo.status).toBe(403);
    const falso = proxy(req(TS, { 'x-forwarded-host': 'evil.com' }));
    expect(falso.status).toBe(403);
    const sinSesion = proxy(req(TS, { 'x-forwarded-proto': 'https' }));
    expect(sinSesion.status).toBe(303);
    expect(sinSesion.headers.get('location')).toBe(`https://${TS}/entrar`);
    const local = proxy(req('127.0.0.1:3010'));
    expect(local.headers.get('location')).toBe('http://127.0.0.1:3010/entrar');
  });
  it('DELETE /api/sesion por https borra con Secure', async () => {
    const res = await cerrarSesion(new Request('http://127.0.0.1:3010/api/sesion', {
      method: 'DELETE', headers: { host: TS, origin: `https://${TS}`, 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https' },
    }), sinParams);
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0; Secure');
  });
});
