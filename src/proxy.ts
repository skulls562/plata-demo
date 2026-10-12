// Proxy de Next 16 (antes «middleware»; runtime Node). SPEC §2.2 `proxy.ts`, §7.2, §7.10.
// Controles rápidos SIN base de datos. Las rutas repiten todo con `conAuth` y, además, validan la
// sesión contra la base (vencimiento e inactividad): el proxy solo ve la firma de la cookie.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { NOMBRE_COOKIE_SESION, hostPermitido, leerCookieFirmada, leerEntorno, llegoPorHttps } from './lib/seguridad';
import type { EntornoPlata } from './lib/seguridad';

const RUTAS_API_PUBLICAS = new Set(['/api/sesion', '/api/salud']);
const RUTAS_PAGINA_PUBLICAS = new Set(['/entrar']);
const RE_RECURSO_ESTATICO = /^\/[A-Za-z0-9._/-]+\.(?:svg|png|ico|webp|jpg|jpeg|gif|woff2?|txt|webmanifest)$/;

function cabecerasSeguridad(): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production';
  const scriptSrc = dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
  return {
    'Content-Security-Policy': [
      "default-src 'self'", scriptSrc, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

function conCabeceras<T extends Response>(res: T, esApi: boolean): T {
  for (const [k, v] of Object.entries(cabecerasSeguridad())) res.headers.set(k, v);
  if (esApi) res.headers.set('Cache-Control', 'no-store');
  return res;
}

function error(estado: number, codigo: string, mensaje?: string): NextResponse {
  const cuerpo = mensaje ? { error: { codigo, mensaje } } : { error: { codigo } };
  return conCabeceras(NextResponse.json(cuerpo, { status: estado }), true);
}

let entornoCache: EntornoPlata | null = null;
function entorno(): EntornoPlata | null {
  if (entornoCache) return entornoCache;
  try {
    entornoCache = leerEntorno(process.env);
    return entornoCache;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const ruta = request.nextUrl.pathname;
  const esApi = ruta === '/api' || ruta.startsWith('/api/');

  const e = entorno();
  if (!e) {
    // Falla cerrado: sin entorno válido no se sirve nada (el detalle sale en la consola al arrancar).
    console.error('[plata] entorno inválido: revisa .env.local');
    return error(500, 'interno', 'Error interno');
  }

  // 1) Host (DNS rebinding). También X-Forwarded-Host, que una página «rebindeada» puede fijar.
  const xfh = request.headers.get('x-forwarded-host');
  if (!hostPermitido(request.headers.get('host'), e) || (xfh !== null && !hostPermitido(xfh, e))) {
    return error(403, 'host_no_permitido');
  }

  // 2) Sin Server Actions en v1 (§0.10).
  if (request.headers.has('next-action')) return error(403, 'origen_no_permitido');

  // 3) Recursos internos de Next y estáticos públicos: solo el control de Host.
  if (ruta.startsWith('/_next/') || ruta === '/favicon.ico' || (!esApi && RE_RECURSO_ESTATICO.test(ruta))) {
    return conCabeceras(NextResponse.next(), false);
  }

  const sesionFirmada = leerCookieFirmada(request.cookies.get(NOMBRE_COOKIE_SESION)?.value, e.secreto_sesion) !== null;

  if (esApi) {
    // Sin CORS: no se atiende ningún preflight.
    if (request.method === 'OPTIONS') return error(405, 'metodo_no_permitido', 'Método no permitido');
    if (RUTAS_API_PUBLICAS.has(ruta)) return conCabeceras(NextResponse.next(), true);
    const auth = request.headers.get('authorization');
    if (auth !== null && /^Bearer\s/i.test(auth)) return conCabeceras(NextResponse.next(), true); // la ruta valida el token
    if (sesionFirmada) return conCabeceras(NextResponse.next(), true);
    return error(401, 'no_autenticado', 'No autenticado');
  }

  if (RUTAS_PAGINA_PUBLICAS.has(ruta) || sesionFirmada) return conCabeceras(NextResponse.next(), false);
  // Se redirige al MISMO Host (ya validado), no a `request.url`: NextRequest normaliza 127.0.0.1 a
  // localhost y eso cambiaría de origen (la cookie de 127.0.0.1 no viaja a localhost → bucle de login).
  const host = (request.headers.get('host') as string).trim().toLowerCase();
  // Tras `tailscale serve` el esquema real es https (X-Forwarded-Proto); en loopback sigue siendo http.
  const esquema = llegoPorHttps(request.headers) ? 'https' : 'http';
  return conCabeceras(NextResponse.redirect(new URL('/entrar', `${esquema}://${host}`), 303), false);
}

export const config = {
  // Todo salvo los estáticos compilados y la ruta de lote (2 MB: no debe pasar por el búfer del
  // proxy, limitado a 512 KB; `conAuth` hace ahí los mismos controles).
  matcher: ['/((?!_next/static|_next/image|api/avisos/lote).*)'],
};
