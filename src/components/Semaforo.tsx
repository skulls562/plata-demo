'use client';
// Semáforo que respira: el anillo late despacio y su color y su palabra dicen el estado (nunca solo el color).
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import type { Semaforo as EstadoSemaforo } from '@/lib/tipos';

const COLOR: Record<EstadoSemaforo, string> = { verde: 'var(--verde)', amarillo: 'var(--ambar)', rojo: 'var(--rojo)', gris: 'var(--gris)', estimando: 'var(--ambar)' };
const PALABRA: Record<EstadoSemaforo, string> = { verde: 'Vas bien', amarillo: 'Ojo', rojo: 'Frena', gris: 'Sin datos', estimando: 'Estimando' };

export function Semaforo({ estado, tamano = 132 }: { estado: EstadoSemaforo; tamano?: number }) {
  const anillo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nodo = anillo.current;
    if (!nodo || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = gsap.to(nodo, { scale: 1.045, duration: estado === 'rojo' ? 1.3 : 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    return () => { t.kill(); gsap.set(nodo, { clearProps: 'transform' }); };
  }, [estado]);
  const color = COLOR[estado];
  // El resplandor es un degradado radial aparte (no una sombra difusa): se pinta igual en todos los navegadores.
  return (
    <div ref={anillo} style={{ position: 'relative', width: tamano, height: tamano, flex: 'none' }}>
      <div aria-hidden style={{ position: 'absolute', inset: '-42%', pointerEvents: 'none', background: `radial-gradient(closest-side, color-mix(in srgb, ${color} 24%, transparent), transparent)` }} />
      <div
        role="img"
        aria-label={`Semáforo: ${PALABRA[estado]}`}
        style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '50%', border: `3px solid ${color}`, display: 'grid', placeItems: 'center', background: 'var(--fondo)' }}
      >
        <span style={{ color, fontWeight: 600, fontSize: tamano / 6.2, letterSpacing: '-0.02em' }}>{PALABRA[estado]}</span>
      </div>
    </div>
  );
}
