'use client';
// Navegación del panel. Escritorio (>= 1180 px): barra fija a la izquierda, agrupada y contraíble a íconos (se recuerda en
// localStorage). Celular: barra inferior con las cuatro secciones de uso diario y un «Más» que abre el resto; nada se
// esconde, todas las secciones se alcanzan en ambos tamaños.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import { llamar } from './llamar';
import { Icono, type NombreIcono } from './iconos';

interface Enlace { href: string; texto: string; icono: NombreIcono }

const GRUPOS: { titulo: string; enlaces: Enlace[] }[] = [
  { titulo: 'Resumen', enlaces: [
    { href: '/', texto: 'Inicio', icono: 'inicio' },
    { href: '/mes', texto: 'Mes', icono: 'mes' },
    { href: '/tendencias', texto: 'Tendencias', icono: 'tendencias' },
  ] },
  { titulo: 'Mi plata', enlaces: [
    { href: '/movimientos', texto: 'Movimientos', icono: 'movimientos' },
    { href: '/suscripciones', texto: 'Suscripciones', icono: 'suscripciones' },
    { href: '/deudas', texto: 'Deudas y saldos', icono: 'deudas' },
    { href: '/metas', texto: 'Metas', icono: 'metas' },
  ] },
  { titulo: 'Decidir', enlaces: [
    { href: '/recomendaciones', texto: 'Recomendaciones', icono: 'recomendaciones' },
    { href: '/simulador', texto: 'Simulador', icono: 'simulador' },
    { href: '/pregunta', texto: 'Pregunta', icono: 'pregunta' },
  ] },
  { titulo: 'Sistema', enlaces: [{ href: '/sistema', texto: 'Sistema', icono: 'sistema' }] },
];

const TODOS = GRUPOS.flatMap((g) => g.enlaces);
// Las que van en la barra del celular; el resto vive en «Más».
const PRINCIPALES = ['/', '/mes', '/movimientos', '/simulador'];

const CLAVE_MIN = 'plata:lateral-min';
const EVENTO_TUTORIAL = 'plata:tutorial';

const esActual = (ruta: string, href: string) => (href === '/' ? ruta === '/' : ruta.startsWith(href));
const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function abrirTutorial() {
  window.dispatchEvent(new CustomEvent(EVENTO_TUTORIAL));
}

// ---- Estado «contraído»: localStorage con try/catch; en el servidor y sin almacenamiento se ve expandido. ----
const oyentes = new Set<() => void>();
function leerMin(): boolean {
  try { return window.localStorage.getItem(CLAVE_MIN) === '1'; } catch { return false; }
}
function guardarMin(v: boolean) {
  try { window.localStorage.setItem(CLAVE_MIN, v ? '1' : '0'); } catch { /* sin almacenamiento: solo dura esta visita */ }
  memoria = v;
  oyentes.forEach((f) => f());
}
let memoria: boolean | null = null;
function suscribir(f: () => void) {
  oyentes.add(f);
  const otraPestana = (e: StorageEvent) => { if (e.key === CLAVE_MIN) { memoria = null; f(); } };
  window.addEventListener('storage', otraPestana);
  return () => { oyentes.delete(f); window.removeEventListener('storage', otraPestana); };
}
function instantaneaMin(): boolean {
  if (memoria === null) memoria = leerMin();
  return memoria;
}
function useMin(): [boolean, (v: boolean) => void] {
  const min = useSyncExternalStore(suscribir, instantaneaMin, () => false);
  return [min, guardarMin];
}

function useSalir() {
  return async function salir() {
    await llamar('/api/sesion', 'DELETE');
    // Navegación completa: con router.replace + refresh, Next 16 pedía /entrar por RSC y recibía 404.
    window.location.assign('/entrar');
  };
}

function BarraLateral() {
  const ruta = usePathname();
  const salir = useSalir();
  const [min, setMin] = useMin();
  const raiz = useRef<HTMLElement>(null);

  // Entrada escalonada de los enlaces al abrir el panel: orienta dónde está cada cosa. Solo una vez por carga.
  useEffect(() => {
    const nodo = raiz.current;
    if (!nodo || sinMovimiento()) return;
    const ctx = gsap.context(() => {
      gsap.from('.lat-item', { opacity: 0, x: -10, duration: 0.45, ease: 'power3.out', stagger: 0.025, delay: 0.05, clearProps: 'opacity,transform' });
    }, nodo);
    return () => ctx.revert();
  }, []);

  return (
    <nav ref={raiz} className="lateral" data-min={min ? 'true' : 'false'} aria-label="Secciones">
      <div className="lat-marca">
        <span className="lat-nombre" aria-hidden>Plata</span>
        <span className="lat-marca-letra" aria-hidden>P</span>
      </div>
      <div className="lat-grupos">
        {GRUPOS.map((g) => (
          <div key={g.titulo} className="lat-grupo" role="group" aria-label={g.titulo}>
            <p className="lat-titulo" aria-hidden>{g.titulo}</p>
            {g.enlaces.map((e) => (
              <Link key={e.href} href={e.href} className="lat-item" title={min ? e.texto : undefined} aria-current={esActual(ruta, e.href) ? 'page' : undefined}>
                <Icono nombre={e.icono} />
                <span className="lat-texto">{e.texto}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="lat-pie">
        <button type="button" className="lat-item" onClick={abrirTutorial} title={min ? 'Tutorial' : undefined}>
          <Icono nombre="tutorial" />
          <span className="lat-texto">Tutorial</span>
        </button>
        <button type="button" className="lat-item salir" onClick={salir} title={min ? 'Salir' : undefined}>
          <Icono nombre="salir" />
          <span className="lat-texto">Salir</span>
        </button>
        <button type="button" className="lat-item" onClick={() => setMin(!min)} aria-expanded={!min} aria-label={min ? 'Expandir menú' : 'Contraer menú'} title={min ? 'Expandir menú' : undefined}>
          <Icono nombre={min ? 'expandir' : 'contraer'} />
          <span className="lat-texto">Contraer menú</span>
        </button>
      </div>
    </nav>
  );
}

function BarraMovil() {
  const ruta = usePathname();
  const salir = useSalir();
  // La hoja se recuerda con la ruta en que se abrió: al cambiar de sección deja de coincidir y queda cerrada.
  const [abiertaEn, setAbiertaEn] = useState<string | null>(null);
  const abierto = abiertaEn === ruta;
  const setAbierto = (v: boolean | ((a: boolean) => boolean)) => setAbiertaEn((cur) => ((typeof v === 'function' ? v(cur === ruta) : v) ? ruta : null));
  const hoja = useRef<HTMLDivElement>(null);
  const botonMas = useRef<HTMLButtonElement>(null);
  const raiz = useRef<HTMLElement>(null);

  const secundarias = TODOS.filter((e) => !PRINCIPALES.includes(e.href));
  const actualSecundaria = secundarias.find((e) => esActual(ruta, e.href));

  // Cierra con Escape o al tocar fuera; al abrir, la hoja crece desde el botón «Más» (origen en su esquina).
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbiertaEn(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbiertaEn(null); botonMas.current?.focus(); } };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  useEffect(() => {
    const nodo = hoja.current;
    if (!abierto || !nodo || sinMovimiento()) return;
    const t = gsap.timeline();
    t.fromTo(nodo, { opacity: 0, y: 14, scale: 0.97, transformOrigin: '100% 100%' }, { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: 'power3.out' });
    t.fromTo(nodo.querySelectorAll('a, button'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', stagger: 0.022, clearProps: 'opacity,transform' }, 0.04);
    return () => { t.kill(); gsap.set(nodo, { clearProps: 'opacity,transform' }); };
  }, [abierto]);

  return (
    <nav ref={raiz} className="nav-movil" aria-label="Secciones (móvil)">
      <div className="hoja" id="hoja-mas" ref={hoja} hidden={!abierto}>
        {secundarias.map((e) => (
          <Link key={e.href} href={e.href} aria-current={esActual(ruta, e.href) ? 'page' : undefined}>
            <Icono nombre={e.icono} tam={20} />
            {e.texto}
          </Link>
        ))}
        <button type="button" onClick={() => { setAbiertaEn(null); abrirTutorial(); }}>
          <Icono nombre="tutorial" tam={20} />
          Tutorial
        </button>
        <button type="button" className="salir" onClick={salir}>
          <Icono nombre="salir" tam={20} />
          Salir
        </button>
      </div>
      {PRINCIPALES.map((href) => {
        const e = TODOS.find((x) => x.href === href)!;
        return (
          <Link key={href} href={href} className="tab" aria-current={esActual(ruta, href) ? 'page' : undefined}>
            <Icono nombre={e.icono} />
            <span>{e.texto}</span>
          </Link>
        );
      })}
      <button
        ref={botonMas} type="button" className="tab" aria-expanded={abierto} aria-controls="hoja-mas" data-activo={actualSecundaria ? 'true' : undefined}
        onClick={() => setAbierto((v) => !v)}
      >
        <Icono nombre="mas" />
        <span>Más</span>
      </button>
    </nav>
  );
}

export function Sidebar() {
  return (
    <>
      <BarraLateral />
      <BarraMovil />
    </>
  );
}
