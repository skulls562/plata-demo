'use client';
// Barra que se llena desde la izquierda cuando entra en pantalla (no mientras está fuera de vista); la marca (opcional)
// señala un tope, p. ej. el 100 % del presupuesto. Es un SVG: el ancho y el color son atributos, no estilos en línea.
// Sin movimiento si la persona prefiere reducirlo.
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

export function BarraLlena({ pct, color, marca, etiqueta }: { pct: number; color: string; marca?: number; etiqueta: string }) {
  const rel = useRef<SVGRectElement>(null);
  const ancho = Math.max(0, Math.min(100, pct));
  useEffect(() => {
    const nodo = rel.current;
    if (!nodo || ancho === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t: gsap.core.Tween | null = null;
    const llenar = () => { t = gsap.fromTo(nodo, { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: 'power3.out', delay: 0.1, clearProps: 'transform' }); };
    const pista = nodo.ownerSVGElement ?? nodo;
    const visible = pista.getBoundingClientRect().top < window.innerHeight;
    if (visible) {
      gsap.set(nodo, { scaleX: 0 });
      llenar();
      return () => { t?.kill(); gsap.set(nodo, { clearProps: 'transform' }); };
    }
    gsap.set(nodo, { scaleX: 0 });
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); llenar(); } }, { threshold: 0.6 });
    io.observe(pista);
    return () => { io.disconnect(); t?.kill(); gsap.set(nodo, { clearProps: 'transform' }); };
  }, [ancho]);
  return (
    <svg className="barra" role="img" aria-label={etiqueta} viewBox="0 0 100 10" preserveAspectRatio="none">
      <rect ref={rel} className="barra-relleno" x="0" y="0" width={ancho} height="10" fill={color} />
      {marca !== undefined && <rect className="barra-marca" x={Math.min(100, marca) - 0.6} y="0" width="0.6" height="10" />}
    </svg>
  );
}
