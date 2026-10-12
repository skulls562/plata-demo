// Revalidación de la sesión en cada página del panel. El proxy solo mira la firma de la cookie
// (aviso de A2): aquí se comprueba la fila viva en la base (vencimiento e inactividad).
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { conectarSeguridad } from '@/lib/arranque';
import { obtenerEntorno, obtenerAlmacen, sesionValida } from '@/lib/http';
import { NOMBRE_COOKIE_SESION } from '@/lib/seguridad';

/** Llamar al inicio de cada página protegida. Sin sesión válida redirige a /entrar. */
export async function requerirSesion(): Promise<void> {
  await connection(); // lo que sigue depende de la petición (hora y cookie): nunca va al caparazón estático
  conectarSeguridad();
  const valor = (await cookies()).get(NOMBRE_COOKIE_SESION)?.value;
  if (!sesionValida(valor, obtenerEntorno(), obtenerAlmacen(), new Date())) redirect('/entrar');
}

/** ¿Hay sesión válida? (para /entrar: si ya entraste, te lleva al inicio). No redirige. */
export async function haySesion(): Promise<boolean> {
  await connection(); // lo que sigue depende de la petición (hora y cookie): nunca va al caparazón estático
  conectarSeguridad();
  const valor = (await cookies()).get(NOMBRE_COOKIE_SESION)?.value;
  return sesionValida(valor, obtenerEntorno(), obtenerAlmacen(), new Date());
}
