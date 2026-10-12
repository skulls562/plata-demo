'use client';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { llamar } from './llamar';

interface Respuesta { texto: string; intencion: string; hechos: Record<string, unknown>; fuente: 'ia' | 'plantilla' }
interface Turno { pregunta: string; respuesta?: Respuesta; error?: string }

const SUGERENCIAS = ['¿Cuánto llevo gastado este mes?', '¿Cuánto me queda para hoy?', '¿Cuáles son mis suscripciones?', '¿En qué comercios gasto más?'];

export function Pregunta() {
  const [texto, setTexto] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const ultimaRespuesta = turnos.at(-1)?.respuesta;

  useEffect(() => {
    if (turnos.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo('.turno:last-child', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
  }, [turnos.length, ultimaRespuesta]);

  async function preguntar(p: string) {
    const limpia = p.trim();
    if (!limpia || ocupado) return;
    setOcupado(true);
    setTexto('');
    setTurnos((t) => [...t, { pregunta: limpia }]);
    const r = await llamar<Respuesta>('/api/pregunta', 'POST', { pregunta: limpia });
    setOcupado(false);
    setTurnos((t) => t.map((x, i) => (i === t.length - 1 ? (r.ok ? { ...x, respuesta: r.datos } : { ...x, error: r.mensaje }) : x)));
    fin.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return (
    <div className="chat">
      <div data-testid="conversacion" aria-live="polite" className="chat-hilo">
        {turnos.map((t, i) => (
          <div key={i} className="turno">
            <p className="turno-pregunta">{t.pregunta}</p>
            {t.respuesta ? (
              <div className="turno-respuesta">
                <p data-testid="respuesta">{t.respuesta.texto}</p>
                <p className="meta">{t.respuesta.fuente === 'ia' ? 'Redactado por la IA local con tus cifras.' : 'Respuesta directa de tus datos, sin IA.'}</p>
              </div>
            ) : t.error ? (
              <p role="alert" className="error-campo">{t.error}</p>
            ) : (
              <p className="suave">Buscando en tus movimientos…</p>
            )}
          </div>
        ))}
        <div ref={fin} />
      </div>

      {turnos.length === 0 && (
        <div className="chat-sugerencias">
          {SUGERENCIAS.map((s) => (<button key={s} type="button" className="btn" onClick={() => preguntar(s)} disabled={ocupado}>{s}</button>))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} className="chat-form" aria-label="Preguntar a tu plata">
        <div className="grupo">
          <label htmlFor="pregunta" className="visualmente-oculto">Tu pregunta</label>
          <input id="pregunta" className="campo" value={texto} maxLength={500} onChange={(e) => setTexto(e.target.value)} placeholder="¿Cuánto gasté en Rappi en septiembre?" />
        </div>
        <button type="submit" className="btn btn-prim" disabled={ocupado || !texto.trim()}>{ocupado ? 'Pensando…' : 'Preguntar'}</button>
      </form>
    </div>
  );
}
