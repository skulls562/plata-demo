'use client';
// Número que cuenta hasta su valor. El HTML del servidor ya trae el valor final (sin JS se ve igual).
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { formatearCOP, formatearCOPCorto } from '@/lib/formato';

export type FormatoCifra = 'cop' | 'corto' | 'entero' | 'pct';

export function formatear(v: number, f: FormatoCifra): string {
  if (f === 'cop') return formatearCOP(v);
  if (f === 'corto') return formatearCOPCorto(v);
  if (f === 'pct') return `${Math.round(v)}%`;
  return String(Math.round(v));
}

export function Cifra({ valor, formato = 'cop', className, duracion = 0.9 }: { valor: number; formato?: FormatoCifra; className?: string; duracion?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nodo = el.current;
    if (!nodo || duracion <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = { v: 0 };
    nodo.textContent = formatear(0, formato);
    const t = gsap.to(o, {
      v: valor, duration: duracion, ease: 'power3.out', delay: 0.1,
      onUpdate: () => { nodo.textContent = formatear(o.v, formato); },
      onComplete: () => { nodo.textContent = formatear(valor, formato); },
    });
    return () => { t.kill(); nodo.textContent = formatear(valor, formato); };
  }, [valor, formato, duracion]);
  return <span ref={el} className={`num ${className ?? ''}`}>{formatear(valor, formato)}</span>;
}
