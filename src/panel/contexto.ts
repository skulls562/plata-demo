// Contexto de datos para las páginas del panel (Server Components): sesión revalidada + foto de la base + métricas.
// Todas las cifras salen de las funciones de la app (calcularMetricas, evaluarReglas, ...): aquí no se recalcula nada.
import { obtenerDB } from '@/lib/db';
import { crearAccesoDatos } from '@/lib/datos';
import { aBogota, mesDe } from '@/lib/formato';
import { calcularMetricas } from '@/lib/metricas';
import { presupuestosDe } from '@/lib/panel';
import { requerirSesion } from './sesion';

export async function contextoPanel() {
  await requerirSesion();
  const db = obtenerDB();
  const ahora = new Date(); // tras leer la cookie: ya es código dinámico, no del caparazón estático
  const datos = crearAccesoDatos(db, () => new Date());
  const hoy = aBogota(ahora).fecha;
  const inst = datos.instantanea(ahora);
  const m = calcularMetricas(inst);
  const presupuestos = presupuestosDe(db, mesDe(hoy));
  return { db, datos, ahora, hoy, mes: mesDe(hoy), inst, m, presupuestos };
}

export type ContextoPanel = Awaited<ReturnType<typeof contextoPanel>>;

/** ¿Falta configurar ingreso o presupuesto total? (aviso de onboarding) */
export function faltaConfigurar(c: Pick<ContextoPanel, 'inst' | 'presupuestos'>): { ingreso: boolean; presupuesto: boolean } {
  return { ingreso: !c.inst.config.ingreso_mensual, presupuesto: c.presupuestos.total === null };
}
