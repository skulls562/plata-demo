'use client';
// Campo de dinero: el usuario teclea dígitos y se ven con puntos de miles ($1.250.000). El valor es un entero (o null).
import { useId } from 'react';

export function CampoPesos({
  etiqueta, valor, onCambio, ayuda, nombre, requerido,
}: { etiqueta: string; valor: number | null; onCambio: (v: number | null) => void; ayuda?: string; nombre?: string; requerido?: boolean }) {
  const id = useId();
  const texto = valor === null ? '' : String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (
    <div className="grupo">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id} name={nombre} className="campo num" inputMode="numeric" autoComplete="off" placeholder="$0" required={requerido}
        value={texto ? `$${texto}` : ''} aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '').slice(0, 11);
          onCambio(d ? Number(d) : null);
        }}
      />
      {ayuda && <span id={`${id}-ayuda`} className="ayuda-campo">{ayuda}</span>}
    </div>
  );
}
