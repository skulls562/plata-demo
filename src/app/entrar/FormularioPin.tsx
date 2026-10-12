'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { llamar } from '@/components/llamar';

export function FormularioPin() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!raiz.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('.letra', { yPercent: 110, opacity: 0, duration: 0.9, ease: 'power4.out', stagger: 0.07 });
      gsap.from('.entra', { y: 20, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.5 });
    }, raiz);
    return () => ctx.revert();
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (cargando) return;
    setError(null);
    setCargando(true);
    const r = await llamar('/api/sesion', 'POST', { pin });
    if (r.ok) {
      router.replace('/');
      router.refresh();
      return;
    }
    setCargando(false);
    setPin('');
    if (r.codigo === 'demasiados_intentos') setError('Demasiados intentos. Espera un rato y vuelve a probar.');
    else if (r.codigo === 'pin_no_configurado') setError('Este panel todavía no tiene PIN. Créalo en la terminal con: npm run pin');
    else if (r.estado === 401) setError('Ese PIN no es. Prueba otra vez.');
    else setError(r.mensaje);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && raiz.current) {
      gsap.fromTo('.caja-pin', { x: -10 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.25)' });
    }
    campo.current?.focus();
  }

  return (
    <div ref={raiz} className="pagina entrar-cuerpo">
      <h1 className="gigante entrar-marca" aria-label="Plata">
        {'Plata'.split('').map((l, i) => (
          <span key={i} className="letra" aria-hidden>{l}</span>
        ))}
      </h1>
      <p className="suave entra entrar-texto">
        Tu plata, clara. Mete tu PIN para ver cuánto puedes gastar hoy.
      </p>
      <form onSubmit={enviar} className="caja-pin entra entrar-form" noValidate>
        <div className="grupo">
          <label htmlFor="pin">PIN de 6 a 12 dígitos</label>
          <input
            id="pin" ref={campo} className="campo num campo-pin" type="password" inputMode="numeric" autoComplete="current-password"
            pattern="[0-9]*" maxLength={12} value={pin} autoFocus aria-describedby={error ? 'error-pin' : undefined} aria-invalid={error ? true : undefined}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          {error && <p id="error-pin" role="alert" className="error-campo">{error}</p>}
        </div>
        <button type="submit" className="btn btn-prim" disabled={cargando || pin.length < 6}>
          {cargando ? 'Revisando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
