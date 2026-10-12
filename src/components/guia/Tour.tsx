'use client';
// Recorrido guiado sobre el panel real: un resalte (el resto se oscurece) y una tarjeta flotante con el texto de cada paso.
// Teclado: flechas para ir y volver, Escape para salir, Tab se queda dentro de la tarjeta. El foco vuelve a donde estaba al cerrar.
// Con prefers-reduced-motion no hay animación ni desplazamiento suave.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import './guia.css';

interface Paso {
  titulo: string;
  texto: string;
  /** Selectores en orden de preferencia; se usa el primero que esté a la vista (así sirve en escritorio y en celular). */
  objetivos: string[];
  /** Solo existe en la página de Inicio. */
  enInicio?: boolean;
}

const PASOS: Paso[] = [
  { titulo: 'Tu cifra del día', texto: 'Esto es lo que puedes gastar hoy sin salirte de tu plan. El semáforo y la razón de abajo te dicen por qué.', objetivos: ['[data-tour="hoy"]'], enInicio: true },
  { titulo: 'Tu plata hoy', texto: 'Aquí ves cuánto tienes, cuánto debes, los pagos mínimos del mes y qué vence primero.', objetivos: ['[data-tour="saldos"]'], enInicio: true },
  { titulo: 'El ritmo del mes', texto: 'La barra compara lo que llevas gastado con lo que tienes para el mes. La marca blanca es dónde tocaría ir a esta altura.', objetivos: ['[data-tour="ritmo"]'], enInicio: true },
  { titulo: 'Todo está en el menú', texto: 'Mes, movimientos, suscripciones, metas, recomendaciones, simulador y más. En el celular, lo que no cabe está en «Más».', objetivos: ['.lateral', '.nav-movil'] },
  { titulo: 'Deudas y saldos', texto: 'Anota tus cuentas y deudas, mira cuánto tardas en pagarlas con avalancha o bola de nieve y cuánto ahorras en intereses.', objetivos: ['.lateral a[href="/deudas"]', '.nav-movil .tab[aria-controls]'] },
  { titulo: 'Vuelve cuando quieras', texto: 'El botón Tutorial repite este recorrido. Si quieres cambiar tus cuentas, deudas o ingreso, abre el asistente de bienvenida.', objetivos: ['.lateral .lat-pie button', '.nav-movil .tab[aria-controls]'] },
];

const MARGEN = 12;
const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function buscar(p: Paso): HTMLElement | null {
  for (const s of p.objetivos) {
    const el = document.querySelector(s);
    if (visible(el)) return el;
  }
  return null;
}

interface Caja { top: number; left: number; width: number; height: number }

export function Tour({ onCerrar, onAsistente }: { onCerrar: () => void; onAsistente: () => void }) {
  const ruta = usePathname();
  const router = useRouter();
  const [i, setI] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const tarjeta = useRef<HTMLDivElement>(null);
  const previo = useRef<Element | null>(null);
  const paso = PASOS[i];
  const ultimo = i === PASOS.length - 1;

  // El recorrido de los primeros pasos vive en Inicio: si se abrió desde otra página, lo lleva allá.
  useEffect(() => {
    if (paso.enInicio && ruta !== '/') router.push('/');
  }, [paso.enInicio, ruta, router]);

  // Recuerda dónde estaba el foco para devolverlo al cerrar.
  useEffect(() => {
    previo.current = document.activeElement;
    return () => { (previo.current as HTMLElement | null)?.focus?.(); };
  }, []);

  // Mide el objetivo y coloca resalte y tarjeta; se repite al hacer scroll o cambiar el tamaño.
  const medir = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = buscar(paso);
    const cw = tarjeta.current?.offsetWidth ?? 360;
    const ch = tarjeta.current?.offsetHeight ?? 230;
    if (!el || (paso.enInicio && ruta !== '/')) {
      setCaja(null);
      setPos({ top: Math.max(MARGEN, (vh - ch) / 2), left: Math.max(MARGEN, (vw - cw) / 2) });
      return;
    }
    const r = el.getBoundingClientRect();
    const top = Math.max(0, r.top - 6);
    const bottom = Math.min(vh, r.bottom + 6);
    const left = Math.max(0, r.left - 6);
    const right = Math.min(vw, r.right + 6);
    setCaja({ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
    const centrarX = Math.min(Math.max(MARGEN, r.left), vw - cw - MARGEN);
    if (vh - bottom >= ch + MARGEN * 2) setPos({ top: bottom + MARGEN, left: centrarX });
    else if (top >= ch + MARGEN * 2) setPos({ top: top - ch - MARGEN, left: centrarX });
    else if (vw - right >= cw + MARGEN * 2) setPos({ top: Math.min(Math.max(MARGEN, top), vh - ch - MARGEN), left: right + MARGEN });
    else if (left >= cw + MARGEN * 2) setPos({ top: Math.min(Math.max(MARGEN, top), vh - ch - MARGEN), left: left - cw - MARGEN });
    else setPos({ top: vh - ch - MARGEN, left: Math.max(MARGEN, (vw - cw) / 2) });
  }, [paso, ruta]);

  // Al cambiar de paso: lleva el objetivo a la vista y lo vuelve a medir hasta que aparezca (la página de destino puede tardar).
  useLayoutEffect(() => {
    let intentos = 0;
    let desplazado = false;
    const ciclo = () => {
      const el = buscar(paso);
      if (el && !desplazado) {
        desplazado = true;
        const alto = el.getBoundingClientRect().height;
        if (!el.closest('.lateral, .nav-movil')) el.scrollIntoView({ block: alto > window.innerHeight * 0.6 ? 'start' : 'center', behavior: sinMovimiento() ? 'auto' : 'smooth' });
      }
      medir();
      intentos++;
    };
    ciclo();
    const t = window.setInterval(() => { if (intentos > 12) window.clearInterval(t); else ciclo(); }, 250);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, { passive: true });
    return () => { window.clearInterval(t); window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir); };
  }, [paso, medir]);

  // Al mostrar un paso: foco a la tarjeta (la lee el lector de pantalla) y una entrada corta.
  const colocada = pos !== null;
  useEffect(() => {
    const nodo = tarjeta.current;
    if (!nodo || !colocada) return;
    nodo.focus({ preventScroll: true });
    if (sinMovimiento()) return;
    const t = gsap.fromTo(nodo, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'opacity,transform' });
    return () => { t.kill(); gsap.set(nodo, { clearProps: 'opacity,transform' }); };
  }, [i, colocada]);

  const atras = () => setI((n) => Math.max(0, n - 1));
  const adelante = () => (ultimo ? onCerrar() : setI((n) => n + 1));

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCerrar(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); adelante(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); atras(); }
      else if (e.key === 'Tab' && tarjeta.current) {
        const f = Array.from(tarjeta.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (!f.length) return;
        const activo = document.activeElement;
        if (e.shiftKey && (activo === f[0] || activo === tarjeta.current)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && activo === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        else if (!tarjeta.current.contains(activo)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => document.removeEventListener('keydown', tecla, true);
  });

  return (
    <>
      <div className="tour-bloqueo" aria-hidden />
      <div className="tour-foco" data-vacio={caja ? undefined : 'true'} aria-hidden style={caja ? { top: caja.top, left: caja.left, width: caja.width, height: caja.height } : { top: 0, left: 0, width: 0, height: 0 }} />
      <div
        ref={tarjeta} className="tour-tarjeta" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto" tabIndex={-1} data-testid="tour"
        style={pos ? { top: pos.top, left: pos.left } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', visibility: 'hidden' }}
      >
        <span className="meta">Paso {i + 1} de {PASOS.length}</span>
        <h2 id="tour-titulo">{paso.titulo}</h2>
        <p id="tour-texto">{paso.texto}</p>
        <div className="tour-pie">
          <button type="button" className="btn btn-chico" onClick={onCerrar}>Saltar</button>
          <div className="botones">
            {ultimo && <button type="button" className="btn btn-chico" onClick={onAsistente}>Abrir asistente</button>}
            {i > 0 && <button type="button" className="btn btn-chico" onClick={atras}>Atrás</button>}
            <button type="button" className="btn btn-chico btn-prim" onClick={adelante}>{ultimo ? 'Terminar' : 'Siguiente'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
