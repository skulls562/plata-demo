'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampoPesos } from './CampoPesos';
import { llamar } from './llamar';
import { Campo, CampoSelect, Tarjeta } from './ui';
import { formatearCOP, formatearFechaCorta } from '@/lib/formato';
import type { Movimiento } from '@/lib/tipos';

export interface CategoriaVista { id: string; nombre: string; es_gasto: boolean }

export function FormularioGasto({ categorias, hoy }: { categorias: CategoriaVista[]; hoy: string }) {
  const router = useRouter();
  const [monto, setMonto] = useState<number | null>(null);
  const [comercio, setComercio] = useState('');
  const [cat, setCat] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setOcupado(true);
    const cuerpo: Record<string, unknown> = {
      fecha, hora: null, banco: 'efectivo', tipo: 'compra', sentido: 'salida', monto, comercio: comercio.trim(), medio: 'efectivo', origen: 'manual',
    };
    if (cat) cuerpo.categoria_id = cat;
    const r = await llamar<Movimiento>('/api/movimientos', 'POST', cuerpo);
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    setAviso(`Anotado: ${r.datos.comercio} por ${formatearCOP(r.datos.monto)}.`);
    setMonto(null);
    setComercio('');
    setCat('');
    router.refresh();
  }

  return (
    <Tarjeta>
      <form onSubmit={guardar} aria-label="Añadir gasto en efectivo" className="form-rejilla">
        <CampoPesos etiqueta="Monto" valor={monto} onCambio={setMonto} nombre="monto" requerido />
        <Campo etiqueta="¿En qué lo gastaste?" id="g-comercio" name="comercio" value={comercio} maxLength={120} onChange={(e) => setComercio(e.target.value)} placeholder="Tienda de la esquina" required />
        <CampoSelect etiqueta="Categoría" id="g-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Automática</option>
          {categorias.filter((c) => c.es_gasto).map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
        </CampoSelect>
        <Campo etiqueta="Fecha" id="g-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
        <div className="form-pie">
          <button className="btn btn-prim" type="submit" disabled={ocupado || !monto || !comercio.trim()}>{ocupado ? 'Guardando…' : 'Añadir gasto'}</button>
          {aviso && <span role="status" className="ok-campo" data-testid="gasto-ok">{aviso}</span>}
          {error && <span role="alert" className="error-campo">{error}</span>}
        </div>
      </form>
    </Tarjeta>
  );
}

export function FilaMovimiento({ m, categorias }: { m: Movimiento; categorias: CategoriaVista[] }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = m.sentido === 'entrada';
  const nombreCat = categorias.find((c) => c.id === m.categoria_id)?.nombre ?? m.categoria_id;

  async function recategorizar(id: string) {
    setOcupado(true);
    setError(null);
    setAviso(null);
    const r = await llamar<{ movimiento: Movimiento; aplicados_a: number }>(`/api/movimientos/${m.id}`, 'PATCH', { version: m.version, categoria_id: id });
    setOcupado(false);
    if (!r.ok) {
      setError(r.estado === 409 ? 'Ese movimiento cambió mientras lo mirabas. Recargo la lista.' : r.mensaje);
      if (r.estado === 409) router.refresh();
      return;
    }
    const otros = r.datos.aplicados_a;
    setAviso(otros > 0 ? `Aprendí: cambié ${otros} ${otros === 1 ? 'movimiento más' : 'movimientos más'} del mismo comercio.` : 'Listo, la próxima vez ya lo sé.');
    router.refresh();
  }

  // Cuenta / no cuenta como gasto: una transferencia nace sin contar (decisión de Jero); pago de tarjeta e interno nunca cuentan.
  const sePuedeAlternar = !entrada && m.tipo !== 'pago_tarjeta' && m.tipo !== 'interno';
  async function alternarCuenta() {
    setOcupado(true);
    setError(null);
    setAviso(null);
    const r = await llamar<Movimiento>(`/api/movimientos/${m.id}`, 'PATCH', { version: m.version, computa: !m.computa });
    setOcupado(false);
    if (!r.ok) {
      setError(r.estado === 409 ? 'Ese movimiento cambió mientras lo mirabas. Recargo la lista.' : r.mensaje);
      if (r.estado === 409) router.refresh();
      return;
    }
    setAviso(r.datos.computa ? 'Ahora cuenta como gasto.' : 'Ya no cuenta como gasto.');
    router.refresh();
  }

  async function borrar() {
    setOcupado(true);
    setError(null);
    const r = await llamar(`/api/movimientos/${m.id}`, 'DELETE');
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    router.refresh();
  }

  return (
    <li className="fila-dato fila-mov" data-testid="movimiento">
      <p className="etq num mov-fecha">{formatearFechaCorta(m.fecha)}{m.hora ? ` ${m.hora}` : ''}</p>
      <div className="mov-nombre">
        <p>{m.comercio}</p>
        <p className="etq">{m.banco}, {m.tipo}{m.origen === 'manual' ? ', a mano' : ''}{!m.computa ? (entrada ? ', no cuenta' : ', no cuenta como gasto') : ''}</p>
      </div>
      <div className="mov-cat">
        {entrada || !categorias.some((c) => c.id === m.categoria_id && c.es_gasto) ? (
          <p className="suave">{nombreCat}</p>
        ) : (
          <>
            <label htmlFor={`cat-${m.id}`} className="visualmente-oculto">Categoría de {m.comercio}</label>
            <select id={`cat-${m.id}`} className="select" value={m.categoria_id} disabled={ocupado} onChange={(e) => recategorizar(e.target.value)}>
              {categorias.filter((c) => c.es_gasto).map((c) => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
            </select>
          </>
        )}
        {m.categoria_id === 'transferencias' && <p className="etq">Las transferencias no cuentan como gasto salvo que las marques.</p>}
      </div>
      <p className="num mov-monto" data-entrada={entrada ? 'true' : undefined}>
        <span className="visualmente-oculto">{entrada ? 'Entró ' : 'Salió '}</span>{entrada ? '+' : '−'}{formatearCOP(m.monto).replace('$', '$')}
      </p>
      <div className="mov-borrar">
        {sePuedeAlternar && (
          <button type="button" className="btn btn-chico" disabled={ocupado} onClick={alternarCuenta} aria-pressed={m.computa}
            aria-label={`${m.computa ? 'No cuenta como gasto' : 'Cuenta como gasto'}: ${m.comercio}`}>
            {m.computa ? 'No cuenta' : 'Cuenta como gasto'}
          </button>
        )}
        <button type="button" className="btn btn-chico btn-peligro" disabled={ocupado} onClick={borrar} aria-label={`Borrar ${m.comercio}`}>Borrar</button>
      </div>
      {(aviso || error) && (
        <p role={error ? 'alert' : 'status'} className={`mov-aviso ${error ? 'error-campo' : 'ok-campo'}`}>{error ?? aviso}</p>
      )}
    </li>
  );
}

export function BotonDeshacer() {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [esError, setEsError] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  async function deshacer() {
    setOcupado(true);
    setMensaje(null);
    const r = await llamar<{ descripcion: string }>('/api/deshacer', 'POST', {});
    setOcupado(false);
    setEsError(!r.ok);
    setMensaje(r.ok ? `Deshecho: ${r.datos.descripcion}` : r.estado === 404 ? 'No hay nada para deshacer en las últimas 24 horas.' : r.mensaje);
    if (r.ok) router.refresh();
  }
  return (
    <span className="mov-aviso-inline">
      <button type="button" className="btn" onClick={deshacer} disabled={ocupado}>Deshacer lo último</button>
      {mensaje && <span role={esError ? 'alert' : 'status'} className={esError ? 'error-campo' : 'ok-campo'} data-testid="deshacer-msg">{mensaje}</span>}
    </span>
  );
}
