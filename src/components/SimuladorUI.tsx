'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { CampoPesos } from './CampoPesos';
import { llamar } from './llamar';
import { Campo, Insignia, Tarjeta, Vacio } from './ui';
import { formatearCOP } from '@/lib/formato';
import type { ItemEspera, Veredicto } from '@/lib/tipos';

const DECISION = { si: 'Sí, cabe', espera: 'Espera', no: 'Mejor no' } as const;

const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;
const cuandoVence = (d: number) => (d <= 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

export function Simulador() {
  const router = useRouter();
  const [monto, setMonto] = useState<number | null>(null);
  const [desc, setDesc] = useState('');
  const [v, setV] = useState<Veredicto | null>(null);
  const [consultado, setConsultado] = useState<{ monto: number; desc: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const salida = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!v || !salida.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('.v-palabra', { yPercent: 100, opacity: 0, duration: 0.6, ease: 'power4.out' });
      gsap.from('.v-linea', { y: 14, opacity: 0, duration: 0.5, ease: 'power3.out', stagger: 0.08, delay: 0.2 });
    }, salida);
    return () => ctx.revert();
  }, [v]);

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    if (!monto) return;
    setError(null);
    setAviso(null);
    setOcupado(true);
    const r = await llamar<Veredicto>('/api/puedo', 'POST', { monto, descripcion: desc.trim() });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    setV(r.datos);
    setConsultado({ monto, desc: desc.trim() });
  }

  async function aEspera() {
    if (!consultado || !v) return;
    setOcupado(true);
    const r = await llamar('/api/lista-espera', 'POST', { descripcion: consultado.desc || 'Compra pendiente', monto: consultado.monto, categoria_id: v.categoria_id });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    setAviso('Listo, quedó en tu lista de espera. Te pregunto en 48 horas.');
    router.refresh();
  }

  return (
    <div className="cols-asim">
      <Tarjeta relleno="grande">
        <form onSubmit={consultar} aria-label="Consultar si puedes comprarlo" className="sim-form">
          <CampoPesos etiqueta="¿Cuánto cuesta?" valor={monto} onCambio={setMonto} requerido />
          <Campo etiqueta="¿Qué es? (opcional, me ayuda a ubicar la categoría)" id="sim-desc" maxLength={80} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Audífonos, mercado, cine…" />
          <button type="submit" className="btn btn-prim" disabled={ocupado || !monto}>{ocupado ? 'Mirando tus números…' : '¿Puedo comprarlo?'}</button>
          {error && <p role="alert" className="error-campo">{error}</p>}
        </form>
      </Tarjeta>

      <div ref={salida} aria-live="polite" data-testid="veredicto" className="sim-resultado" data-tono={v?.decision}>
        {v ? (
          <>
            <div className="v-recorte">
              <p className="v-palabra gigante" data-decision={v.decision}>{DECISION[v.decision]}</p>
            </div>
            <ul className="lista v-razones">
              {v.razones.map((r, i) => (<li key={i} className="v-linea">{r}</li>))}
            </ul>
            <dl className="reticula reticula-2 v-linea v-cifras">
              {v.cifras.libre_hoy !== null && (<div><dt className="etq">Te queda hoy</dt><dd className="num">{formatearCOP(v.cifras.libre_hoy)}</dd></div>)}
              {v.cifras.restante_mes !== null && (<div><dt className="etq">Te queda en el mes</dt><dd className="num">{formatearCOP(v.cifras.restante_mes)}</dd></div>)}
              {v.cifras.limite_hoy !== null && v.cifras.nuevo_limite !== null && (
                <div><dt className="etq">Tu límite diario pasaría de</dt><dd className="num">{formatearCOP(v.cifras.limite_hoy)} a {formatearCOP(Math.max(0, v.cifras.nuevo_limite))}</dd></div>
              )}
              {v.cifras.restante_cat !== null && (<div><dt className="etq">Te queda en esa categoría</dt><dd className="num">{formatearCOP(v.cifras.restante_cat)}</dd></div>)}
              {v.cifras.saldo_tras !== null && (
                <div data-testid="v-saldo-tras"><dt className="etq">Tendrías en tus cuentas después</dt><dd className="num">{formatearCOP(v.cifras.saldo_tras)}</dd></div>
              )}
              {v.cifras.falta_minimos !== null && v.cifras.falta_minimos > 0 && (
                <div data-testid="v-falta-minimos"><dt className="etq">Te faltarían para los mínimos</dt><dd className="num">{formatearCOP(v.cifras.falta_minimos)} <Insignia tono="peligro">no alcanza</Insignia></dd></div>
              )}
              {v.cifras.proximo_minimo !== null && (
                <div data-testid="v-proximo-minimo"><dt className="etq">Próximo mínimo</dt><dd className="num">{formatearCOP(v.cifras.proximo_minimo)}{v.cifras.proximo_minimo_dias !== null ? ` · ${cuandoVence(v.cifras.proximo_minimo_dias)}` : ''}</dd></div>
              )}
              {v.cifras.colchon_dias_tras !== null && (
                <div data-testid="v-colchon"><dt className="etq">Tu plata alcanzaría para</dt><dd className="num">{dias(v.cifras.colchon_dias_tras)} de gasto{v.cifras.colchon_dias !== null ? ` (hoy ${dias(v.cifras.colchon_dias)})` : ''}</dd></div>
              )}
            </dl>
            {(v.regla_48h || v.decision === 'espera') && !aviso && (
              <div className="v-linea v-espera">
                <p className="suave">Si en 48 horas todavía lo quieres, la plata sigue ahí.</p>
                <button type="button" className="btn" onClick={aEspera} disabled={ocupado}>Ponerlo en lista de espera 48 h</button>
              </div>
            )}
            {aviso && <p role="status" className="ok-campo v-espera">{aviso}</p>}
          </>
        ) : (
          <Vacio titulo="Todavía sin veredicto" texto="Aquí aparece el veredicto, con sus razones y lo que te quedaría después de comprarlo." />
        )}
      </div>
    </div>
  );
}

function faltan(disponible: string, ahoraMs: number): string {
  const ms = Date.parse(disponible) - ahoraMs;
  if (ms <= 0) return 'Ya pasaron las 48 horas';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `Faltan ${h} h ${m} min` : `Faltan ${m} min`;
}

export function ListaEspera({ items, ahorrado, ahoraMs }: { items: ItemEspera[]; ahorrado: number; ahoraMs: number }) {
  const router = useRouter();
  const [ahora, setAhora] = useState(ahoraMs);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  async function actuar(id: number, accion: 'comprado' | 'descartado' | 'extender') {
    setOcupado(true);
    setError(null);
    const r = await llamar(`/api/lista-espera/${id}`, 'PATCH', { accion });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    router.refresh();
  }
  return (
    <div data-testid="lista-espera">
      <p className="suave">
        Ahorrado este mes por no comprar: <b className="num" data-testid="ahorrado">{formatearCOP(ahorrado)}</b>
      </p>
      {items.length === 0 ? (
        <Vacio titulo="Nada esperando" texto="Lo grande y no esencial lo dejas aquí 48 horas antes de decidir." />
      ) : (
        <ul className="divide lista">
          {items.map((it) => (
            <li key={it.id} className="espera-fila" data-listo={Date.parse(it.disponible_en) <= ahora ? 'true' : 'false'}>
              <div>
                <p className="nombre">{it.descripcion}</p>
                <p className="num suave">{formatearCOP(it.monto)}</p>
                <p className="meta faltan">{faltan(it.disponible_en, ahora)}</p>
              </div>
              <div className="acciones">
                <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => actuar(it.id, 'comprado')}>Lo compré</button>
                <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => actuar(it.id, 'descartado')}>Ya no lo quiero</button>
                <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => actuar(it.id, 'extender')}>48 h más</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="error-campo">{error}</p>}
    </div>
  );
}
