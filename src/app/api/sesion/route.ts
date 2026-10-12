// POST /api/sesion { pin } → 204 + Set-Cookie | 401 | 429 | 503 pin_no_configurado
// DELETE /api/sesion → 204, borra la fila y la cookie. (SPEC §5.8, §7.3)
//
// Política «pública» con límite de intentos; `conAuth` exige Host permitido y, por ser mutación
// sin token, Origin permitido (+ Sec-Fetch-Site same-origin si viene).

import { ErrorHTTP, LIMITES_CUERPO, conAuth, leerJSON, obtenerAlmacen, respuestaVacia } from '@/lib/http';
import {
  NOMBRE_COOKIE_SESION, cookieSesion, cookieSesionBorrada, evaluarIntentoPin, firmarCookie, hashIdSesion,
  llegoPorHttps, leerCookie, leerCookieFirmada, nuevaFilaSesion, nuevoIdSesion, registrarResultadoPin, verificarPin,
} from '@/lib/seguridad';

// Los intentos de PIN se atienden de uno en uno: si no, N peticiones simultáneas leerían el mismo
// contador antes de que scrypt termine y se saltarían el límite. (Un solo proceso: `next start`.)
const g = globalThis as typeof globalThis & { __plataCerrojoPin?: Promise<unknown> };
function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const previo = g.__plataCerrojoPin ?? Promise.resolve();
  const actual = previo.catch(() => undefined).then(fn);
  g.__plataCerrojoPin = actual.catch(() => undefined);
  return actual;
}

export const POST = conAuth('publica', async (req, { entorno }) => {
  const cuerpo = await leerJSON<{ pin?: unknown }>(req, LIMITES_CUERPO.sesion);
  const almacen = obtenerAlmacen();

  const pinHash = almacen.leerPinHash();
  if (!pinHash) {
    throw new ErrorHTTP(503, 'pin_no_configurado', 'El panel no tiene PIN. Créalo en la terminal con: npm run pin');
  }

  return enSerie(async () => {
    const limite = almacen.leerLimite('pin');
    const ev = evaluarIntentoPin(limite, new Date());
    if (!ev.permitido) {
      throw new ErrorHTTP(429, 'demasiados_intentos', 'Demasiados intentos. Espera y vuelve a probar.', { reintentar_en_s: ev.reintentar_en_s });
    }

    const pin = cuerpo && typeof cuerpo === 'object' ? cuerpo.pin : undefined;
    const forma = typeof pin === 'string' && /^\d{6,12}$/.test(pin);
    const ok = forma ? await verificarPin(pin as string, pinHash) : false;

    const ahora = new Date();
    const r = registrarResultadoPin(limite, ok, ahora);
    almacen.guardarLimite('pin', r.estado);
    if (r.bloqueo_24h) {
      almacen.registrarEvento({ nivel: 'aviso', tipo: 'pin_bloqueo', detalle: `20 fallos de PIN en 24 h; bloqueado hasta ${r.estado.bloqueado_hasta}` });
    }
    if (!ok) {
      almacen.registrarEvento({ nivel: 'info', tipo: 'pin_fallido', detalle: `fallos=${r.estado.fallos} fallos_24h=${r.estado.fallos_24h}` });
      throw new ErrorHTTP(401, 'no_autenticado', 'PIN incorrecto');
    }

    // Sin fijación: cada inicio crea un id nuevo y se descarta la sesión anterior de este navegador.
    const anterior = leerCookieFirmada(leerCookie(req.headers.get('cookie'), NOMBRE_COOKIE_SESION), entorno.secreto_sesion);
    if (anterior) almacen.borrarSesion(hashIdSesion(anterior));
    almacen.borrarSesionesVencidas(ahora);

    const id = nuevoIdSesion();
    almacen.crearSesion(nuevaFilaSesion(id, ahora));
    almacen.registrarEvento({ nivel: 'info', tipo: 'sesion_iniciada' });
    return respuestaVacia(204, { 'Set-Cookie': cookieSesion(firmarCookie(id, entorno.secreto_sesion), llegoPorHttps(req.headers, new URL(req.url).protocol)) });
  });
});

export const DELETE = conAuth('publica', async (req, { entorno }) => {
  const id = leerCookieFirmada(leerCookie(req.headers.get('cookie'), NOMBRE_COOKIE_SESION), entorno.secreto_sesion);
  if (id) obtenerAlmacen().borrarSesion(hashIdSesion(id));
  return respuestaVacia(204, { 'Set-Cookie': cookieSesionBorrada(llegoPorHttps(req.headers, new URL(req.url).protocol)) });
});
