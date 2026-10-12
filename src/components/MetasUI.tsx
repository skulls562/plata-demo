'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampoPesos } from './CampoPesos';
import { llamar } from './llamar';
import { Campo, Tarjeta } from './ui';

export function FormularioMeta() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [objetivo, setObjetivo] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    const r = await llamar('/api/metas', 'POST', { nombre: nombre.trim(), objetivo, fecha_objetivo: fecha || null });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    setNombre('');
    setObjetivo(null);
    setFecha('');
    router.refresh();
  }

  return (
    <Tarjeta>
      <form onSubmit={crear} aria-label="Crear una meta" className="form-rejilla">
        <Campo etiqueta="Nombre de la meta" id="meta-nombre" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} required />
        <CampoPesos etiqueta="Cuánto quieres juntar" valor={objetivo} onCambio={setObjetivo} requerido />
        <Campo etiqueta="Fecha límite (opcional)" id="meta-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <div className="form-pie">
          <button className="btn btn-prim" type="submit" disabled={ocupado || !nombre.trim() || !objetivo}>{ocupado ? 'Creando…' : 'Crear meta'}</button>
          {error && <span role="alert" className="error-campo">{error}</span>}
        </div>
      </form>
    </Tarjeta>
  );
}

export function AccionesMeta({ id, nombre, estado }: { id: number; nombre: string; estado: 'activa' | 'pausada' | 'cumplida' | 'cancelada' }) {
  const router = useRouter();
  const [monto, setMonto] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aportar(e: React.FormEvent, signo: 1 | -1) {
    e.preventDefault();
    if (!monto) return;
    setError(null);
    setOcupado(true);
    const r = await llamar(`/api/metas/${id}/aportes`, 'POST', { monto: signo * monto });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    setMonto(null);
    router.refresh();
  }
  async function estadoNuevo(e: 'activa' | 'pausada' | 'cumplida' | 'cancelada') {
    setOcupado(true);
    const r = await llamar(`/api/metas/${id}`, 'PATCH', { estado: e });
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    router.refresh();
  }

  return (
    <div className="meta-aporta">
      {(estado === 'activa' || estado === 'pausada') && (
        <form onSubmit={(e) => aportar(e, 1)} className="meta-aporte-form">
          <CampoPesos etiqueta={`Aporte a ${nombre}`} valor={monto} onCambio={setMonto} />
          <button type="submit" className="btn btn-prim" disabled={ocupado || !monto}>Aportar</button>
          <button type="button" className="btn" disabled={ocupado || !monto} onClick={(e) => aportar(e, -1)}>Sacar</button>
        </form>
      )}
      <div className="acciones">
        {estado === 'activa' && <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => estadoNuevo('pausada')}>Pausar</button>}
        {estado === 'pausada' && <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => estadoNuevo('activa')}>Reanudar</button>}
        {(estado === 'activa' || estado === 'pausada') && <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => estadoNuevo('cumplida')}>La cumplí</button>}
        {estado !== 'cancelada' && <button type="button" className="btn btn-chico btn-peligro" disabled={ocupado} onClick={() => estadoNuevo('cancelada')}>Cancelar meta</button>}
      </div>
      {error && <p role="alert" className="error-campo">{error}</p>}
    </div>
  );
}
