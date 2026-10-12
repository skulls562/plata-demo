'use client';
// Aviso discreto «Instala Plata en tu celular». Solo aparece si todavía no está instalada la app:
//  - Android/Chrome: guarda el evento `beforeinstallprompt` y el botón lo dispara.
//  - iPhone/iPad (Safari no lo emite): explica Compartir → Añadir a pantalla de inicio.
// Se puede descartar; el descarte se recuerda en localStorage (con try/catch: puede estar bloqueado).
import { useEffect, useState } from 'react';

const CLAVE_DESCARTE = 'plata_aviso_instalar_descartado';

interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function yaInstalada(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function esIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se presenta como Mac con pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function leerDescarte(): boolean {
  try { return window.localStorage.getItem(CLAVE_DESCARTE) === '1'; } catch { return false; }
}

function guardarDescarte(): void {
  try { window.localStorage.setItem(CLAVE_DESCARTE, '1'); } catch { /* sin almacenamiento: reaparecerá */ }
}

export function AvisoInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [ios, setIos] = useState(false);
  const [oculto, setOculto] = useState(true);

  useEffect(() => {
    if (yaInstalada() || leerDescarte()) return;
    const alEvento = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalar);
      setOculto(false);
    };
    const alInstalar = () => { setOculto(true); setEvento(null); };
    window.addEventListener('beforeinstallprompt', alEvento);
    window.addEventListener('appinstalled', alInstalar);
    // iOS no emite el evento: se decide tras montar (fuera del cuerpo síncrono del efecto).
    if (esIOS()) queueMicrotask(() => { setIos(true); setOculto(false); });
    return () => {
      window.removeEventListener('beforeinstallprompt', alEvento);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  if (oculto) return null;

  const descartar = () => { guardarDescarte(); setOculto(true); };
  const instalar = async () => {
    if (!evento) return;
    await evento.prompt();
    const r = await evento.userChoice.catch(() => null);
    setEvento(null);
    if (r?.outcome === 'accepted') setOculto(true);
  };

  return (
    <aside
      role="region"
      aria-label="Instalar Plata"
      data-testid="aviso-instalar"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem',
        margin: '0.75rem', padding: '0.75rem 1rem',
        border: '1px solid var(--linea-2)', background: 'var(--fondo-2)', borderRadius: 'var(--radio)',
      }}
    >
      <p style={{ margin: 0, flex: '1 1 14rem', color: 'var(--texto-2)', fontSize: 'var(--t-sm)' }}>
        <strong style={{ color: 'var(--texto)' }}>Instala Plata en tu celular.</strong>{' '}
        {ios && !evento
          ? <>Toca el botón Compartir y luego «Añadir a pantalla de inicio».</>
          : <>Se abre como una app, sin barra del navegador.</>}
      </p>
      {evento && (
        <button type="button" className="btn btn-prim" onClick={instalar}>Instalar</button>
      )}
      <button type="button" className="btn" onClick={descartar} aria-label="Cerrar el aviso de instalar">Ahora no</button>
    </aside>
  );
}
