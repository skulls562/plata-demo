'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { llamar } from './llamar';

export function AccionesSuscripcion({ id, nombre }: { id: number; nombre: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cambiar(estado: 'confirmada' | 'descartada') {
    setOcupado(true);
    setError(null);
    const r = await llamar(`/api/suscripciones/${id}`, 'PATCH', { estado });
    setOcupado(false);
    if (!r.ok) setError(r.mensaje);
    else router.refresh();
  }
  return (
    <div className="acciones">
      <button type="button" className="btn btn-chico" disabled={ocupado} onClick={() => cambiar('confirmada')} aria-label={`Confirmar ${nombre}`}>Confirmar</button>
      <button type="button" className="btn btn-chico btn-peligro" disabled={ocupado} onClick={() => cambiar('descartada')} aria-label={`Descartar ${nombre}`}>No es</button>
      {error && <span role="alert" className="error-campo">{error}</span>}
    </div>
  );
}
