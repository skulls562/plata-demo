'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampoPesos } from './CampoPesos';
import { llamar } from './llamar';
import { Campo, Vacio } from './ui';

export interface ItemRevisar { id: number; banco: string | null; asunto: string; texto: string; motivo: string; fecha: string; intentos: number }

const MOTIVO: Record<string, string> = {
  formato_desconocido: 'No reconocí el formato del correo.',
  ia_no_disponible: 'La IA local no estaba disponible cuando llegó.',
  ia_invalida: 'La IA no devolvió algo que yo pudiera confiar.',
  monto_no_verificado: 'No pude comprobar el monto en el texto.',
  autenticacion_fallida: 'El correo no pasó la verificación del remitente.',
  fecha_invalida: 'La fecha del correo no tiene sentido.',
};
const BANCOS = ['bancolombia', 'wompi', 'pse', 'rappicard', 'didi', 'nequi', 'efectivo', 'otro'];

function Item({ it, hoy }: { it: ItemRevisar; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState<number | null>(null);
  const [comercio, setComercio] = useState('');
  const [fecha, setFecha] = useState(it.fecha.slice(0, 10) || hoy);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function resolver(cuerpo: unknown) {
    setOcupado(true);
    setError(null);
    const r = await llamar(`/api/por-revisar/${it.id}/resolver`, 'POST', cuerpo);
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    router.refresh();
  }

  return (
    <li className="revisar" data-testid="por-revisar-item">
      <div>
        <p className="revisar-titulo">{it.asunto}</p>
        <p className="meta">{it.banco ?? 'banco sin identificar'}, {it.fecha.slice(0, 10)}, {it.intentos} {it.intentos === 1 ? 'intento' : 'intentos'}</p>
        <p className="suave">{MOTIVO[it.motivo] ?? it.motivo}</p>
      </div>
      <details>
        <summary className="etq">Ver el texto del aviso</summary>
        <p className="num suave revisar-texto">{it.texto}</p>
      </details>
      <div className="acciones">
        {['ia_no_disponible', 'ia_invalida', 'monto_no_verificado'].includes(it.motivo) && (
          <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => resolver({ accion: 'reintentar_ia' })}>Reintentar con la IA</button>
        )}
        <button type="button" className="btn btn-chico" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>Anotarlo a mano</button>
        <button type="button" className="btn btn-chico btn-peligro" disabled={ocupado} onClick={() => resolver({ accion: 'descartar' })}>Descartar</button>
      </div>
      {abierto && (
        <form
          className="revisar-form"
          onSubmit={(e) => {
            e.preventDefault();
            resolver({ accion: 'crear', movimiento: { fecha, hora: null, banco: BANCOS.includes(it.banco ?? '') ? it.banco : 'otro', tipo: 'compra', sentido: 'salida', monto, comercio: comercio.trim() } });
          }}
        >
          <CampoPesos etiqueta="Monto" valor={monto} onCambio={setMonto} requerido />
          <Campo etiqueta="Comercio" id={`rc-${it.id}`} value={comercio} onChange={(e) => setComercio(e.target.value)} required maxLength={120} />
          <Campo etiqueta="Fecha" id={`rf-${it.id}`} type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
          <button type="submit" className="btn btn-prim" disabled={ocupado || !monto || !comercio.trim()}>Guardar movimiento</button>
        </form>
      )}
      {error && <p role="alert" className="error-campo">{error}</p>}
    </li>
  );
}

export function ListaPorRevisar({ items, hoy }: { items: ItemRevisar[]; hoy: string }) {
  if (items.length === 0) return <div data-testid="sin-pendientes"><Vacio titulo="Nada por revisar" texto="No hay avisos pendientes. Todo lo que llegó lo pude leer." /></div>;
  return (
    <ul className="divide lista" data-testid="lista-por-revisar">
      {items.map((it) => (<Item key={it.id} it={it} hoy={hoy} />))}
    </ul>
  );
}
