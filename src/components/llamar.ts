// Llamadas del navegador a /api/* (mismo origen; la cookie de sesión viaja sola). Nada de Server Actions.
export type Respuesta<T> = { ok: true; datos: T } | { ok: false; estado: number; codigo: string; mensaje: string };

export async function llamar<T = unknown>(ruta: string, metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', cuerpo?: unknown): Promise<Respuesta<T>> {
  try {
    const cabeceras: Record<string, string> = {};
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
    if (metodo === 'POST' && ruta === '/api/movimientos') cabeceras['Idempotency-Key'] = crypto.randomUUID();
    const r = await fetch(ruta, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), credentials: 'same-origin' });
    if (r.status === 204) return { ok: true, datos: undefined as T };
    const texto = await r.text();
    const json = texto ? JSON.parse(texto) : null;
    if (r.ok) return { ok: true, datos: json as T };
    // Sesión vencida: recarga completa hacia /entrar (limpia el estado del cliente).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.status === 401 && ruta !== '/api/sesion') window.location.assign('/entrar');
    return { ok: false, estado: r.status, codigo: json?.error?.codigo ?? 'error', mensaje: json?.error?.mensaje ?? 'Algo salió mal. Intenta otra vez.' };
  } catch {
    return { ok: false, estado: 0, codigo: 'red', mensaje: 'No pude hablar con el servidor. Revisa que Plata siga prendida.' };
  }
}
