'use client';
// Gráficas de tendencias (Recharts). Un solo acento cobalto marca lo que cambia (el gasto del día a día); lo fijo va en un
// gris azulado y los ingresos en una línea clara punteada. Paleta validada con el validador de dataviz sobre el fondo
// oscuro (--fondo, #0a0b0c; revalidada el 2026-10-09 con --surface "#0a0b0c"): banda de luminosidad, separación para daltónicos
// (ΔE 17,7; normal 18,1), contraste >= 3:1. Solo «piso de croma» marca FAIL en el gris azulado y es a propósito: El gris azulado es neutro a
// propósito (no compite con el cobalto), por eso lleva leyenda, 2 px de separación entre segmentos y vista en tabla.
import { useSyncExternalStore } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearCOP, formatearCOPCorto } from '@/lib/formato';

// Los colores salen de los tokens de globals.css (--grafica-*), así un cambio de paleta llega a las gráficas sin tocar este archivo.
const C = { variable: 'var(--grafica-variable)', fijos: 'var(--grafica-fijos)', ingresos: 'var(--grafica-ingresos)', eje: 'var(--grafica-eje)', rejilla: 'var(--grafica-rejilla)', fondo: 'var(--fondo)', texto: 'var(--texto-2)' };

export interface PuntoMes { mes: string; etiqueta: string; ingresos: number; variable: number; fijos: number }
export interface PuntoSimple { etiqueta: string; valor: number; cantidad?: number }

function useAnimar(): boolean {
  // Sin animación de dibujo si la persona prefiere reducir el movimiento.
  return useSyncExternalStore(
    (cb) => { const q = window.matchMedia('(prefers-reduced-motion: reduce)'); q.addEventListener('change', cb); return () => q.removeEventListener('change', cb); },
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

function useMontado(): boolean {
  // false en el servidor y en la hidratación, true ya montado en el navegador (Recharts mide el contenedor al montar).
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}

const estiloTooltip = { background: 'var(--fondo-2)', border: '1px solid var(--linea-2)', borderRadius: 'var(--r-2)', color: 'var(--texto)' } as const;
const estiloEtiqueta = { color: 'var(--texto-2)' } as const;

export function GraficaMeses({ datos }: { datos: PuntoMes[] }) {
  const montado = useMontado();
  const animar = useAnimar();
  return (
    <div className="grafica grafica-meses" role="img" aria-label="Gasto e ingresos de los últimos meses" data-testid="grafica-meses">
      {montado && (
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.rejilla} vertical={false} />
            <XAxis dataKey="etiqueta" tick={{ fill: C.eje, fontSize: 12 }} axisLine={{ stroke: C.rejilla }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C.eje, fontSize: 12 }} axisLine={false} tickLine={false} width={58} tickFormatter={(v: number) => formatearCOPCorto(v)} />
            <Tooltip contentStyle={estiloTooltip} labelStyle={estiloEtiqueta} itemStyle={{ color: 'var(--texto)' }} cursor={{ fill: 'var(--velo)' }} formatter={(v, n) => [formatearCOP(Number(v)), String(n)]} />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={(v) => <span className="grafica-leyenda">{String(v)}</span>} />
            <Bar dataKey="fijos" name="Fijos" stackId="g" fill={C.fijos} stroke={C.fondo} strokeWidth={2} isAnimationActive={animar} animationDuration={700} animationEasing="ease-out" />
            <Bar dataKey="variable" name="Día a día" stackId="g" fill={C.variable} stroke={C.fondo} strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={animar} animationDuration={700} animationEasing="ease-out" />
            <Line dataKey="ingresos" name="Ingresos" stroke={C.ingresos} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: C.fondo, strokeWidth: 2 }} isAnimationActive={animar} animationDuration={900} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function GraficaBarras({ datos, nombre, etiquetaAria, testid }: { datos: PuntoSimple[]; nombre: string; etiquetaAria: string; testid: string }) {
  const montado = useMontado();
  const animar = useAnimar();
  return (
    <div className="grafica grafica-barras" role="img" aria-label={etiquetaAria} data-testid={testid}>
      {montado && (
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={datos} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.rejilla} vertical={false} />
            <XAxis dataKey="etiqueta" tick={{ fill: C.eje, fontSize: 12 }} axisLine={{ stroke: C.rejilla }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C.eje, fontSize: 12 }} axisLine={false} tickLine={false} width={58} tickFormatter={(v: number) => formatearCOPCorto(v)} />
            <Tooltip contentStyle={estiloTooltip} labelStyle={estiloEtiqueta} itemStyle={{ color: 'var(--texto)' }} cursor={{ fill: 'var(--velo)' }} formatter={(v) => [formatearCOP(Number(v)), nombre]} />
            <Bar dataKey="valor" name={nombre} fill={C.variable} radius={[4, 4, 0, 0]} isAnimationActive={animar} animationDuration={700} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
