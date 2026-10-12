'use client';
// Scroll reveal con stagger: los elementos con data-ent aparecen en orden al llegar a la pantalla. Corto y suave a propósito:
// el panel se abre todos los días (frecuencia de uso alta), así que el movimiento acompaña y no se interpone. Sin movimiento
// si la persona prefiere reducirlo (el CSS tampoco los oculta en ese caso).
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function Escena({ children, className }: { children: React.ReactNode; className?: string }) {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!raiz.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('[data-ent]', {
        start: 'top 94%',
        once: true,
        onEnter: (els) => {
          gsap.fromTo(els, { opacity: 0, y: 18, filter: 'blur(4px)' }, {
            opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out', stagger: { each: 0.05, amount: 0.45 }, overwrite: true, clearProps: 'filter,transform',
          });
        },
      });
    }, raiz);
    return () => ctx.revert();
  }, []);
  return <div ref={raiz} className={className}>{children}</div>;
}
