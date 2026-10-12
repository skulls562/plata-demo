'use client';
// Calendario de calor del mes: cuanto más gastaste ese día, más ámbar (5 niveles). Un borde rojo y el signo "!" marcan los
// días en que pasaste el límite (no solo color). Toca o enfoca un día para ver sus cifras abajo.
import { useState } from 'react';
import { formatearCOP } from '@/lib/formato';

export interface DiaCalor { fecha: string; gastado: number; limite: number | null }

const SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function Calendario({ mes, dias, hoy }: { mes: string; dias: DiaCalor[]; hoy: string }) {
  const [anio, nmes] = mes.split('-').map(Number);
  const primero = new Date(Date.UTC(anio, nmes - 1, 1));
  const total = new Date(Date.UTC(anio, nmes, 0)).getUTCDate();
  const hueco = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const max = Math.max(1, ...dias.map((d) => d.gastado));
  const [sel, setSel] = useState<string | null>(hoy.startsWith(mes) ? hoy : null);
  const detalle = sel ? porFecha.get(sel) : undefined;

  const celdas: React.ReactNode[] = [];
  for (let i = 0; i < hueco; i++) celdas.push(<div key={`h${i}`} className="calor-celda vacio" aria-hidden />);
  for (let n = 1; n <= total; n++) {
    const fecha = `${mes}-${String(n).padStart(2, '0')}`;
    const d = porFecha.get(fecha);
    const pasado = d !== undefined && d.limite !== null && d.gastado > d.limite;
    const nivel = d && d.gastado > 0 ? Math.min(5, Math.max(1, Math.ceil((d.gastado / max) * 5))) : 0;
    const etiqueta = d
      ? `Día ${n}: gastaste ${formatearCOP(d.gastado)}${d.limite !== null ? `, límite ${formatearCOP(d.limite)}` : ''}${pasado ? ', te pasaste' : ''}`
      : `Día ${n}: sin datos`;
    celdas.push(
      <button
        key={fecha} type="button" className="calor-celda" aria-pressed={sel === fecha} aria-label={etiqueta} disabled={!d}
        data-nivel={nivel || undefined} data-pasado={pasado ? 'true' : undefined}
        onClick={() => setSel(fecha)}
      >
        <span>{n}</span>
        {pasado && <span aria-hidden className="calor-marca">!</span>}
      </button>,
    );
  }

  return (
    <div data-testid="calendario-calor">
      <div className="calendario-rejilla">
        {SEMANA.map((s, i) => (<div key={s + i} className="calendario-sem">{s}</div>))}
        {celdas}
      </div>
      <p aria-live="polite" className="calendario-detalle">
        {detalle && sel ? (
          <>
            <b>{NOMBRE_DIA[new Date(sel + 'T12:00:00Z').getUTCDay()]} {Number(sel.slice(8))}:</b>{' '}
            gastaste <span className="num">{formatearCOP(detalle.gastado)}</span>
            {detalle.limite !== null && (
              <>
                {' '}y tu límite era <span className="num">{formatearCOP(detalle.limite)}</span>
                {detalle.gastado > detalle.limite ? ', así que te pasaste.' : ', así que te quedaste dentro.'}
              </>
            )}
          </>
        ) : 'Toca un día para ver cuánto gastaste.'}
      </p>
    </div>
  );
}
