'use client';
// Diálogo y hoja sobre el elemento <dialog> nativo: showModal() ya atrapa el foco, bloquea el fondo y cierra con Escape.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icono } from '../iconos';
import { cx } from './cx';

export interface PropsDialogo {
  abierto: boolean;
  /** Se llama al cerrar por Escape, por la X o al tocar el fondo. El padre decide poner `abierto` en false. */
  onCerrar: () => void;
  titulo: string;
  descripcion?: string;
  children: ReactNode;
  /** Botones de la fila inferior (alineados a la derecha). */
  pie?: ReactNode;
  /** `centro` modal clásico; `hoja` panel lateral en escritorio y hoja inferior en celular. */
  variante?: 'centro' | 'hoja';
  className?: string;
}

export function Dialogo({ abierto, onCerrar, titulo, descripcion, children, pie, variante = 'centro', className }: PropsDialogo) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idDesc = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      className={cx('ui-dialogo', className)}
      data-variante={variante}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      onClose={onCerrar}
      onClick={(e) => { if (e.target === ref.current) onCerrar(); }}
    >
      <div className="ui-dialogo-cab">
        <div>
          <h2 id={idTitulo}>{titulo}</h2>
          {descripcion && <p id={idDesc}>{descripcion}</p>}
        </div>
        <button type="button" className="btn ui-cerrar" onClick={onCerrar} aria-label="Cerrar">
          <Icono nombre="cerrar" tam={20} />
        </button>
      </div>
      <div className="ui-dialogo-cuerpo">{children}</div>
      {pie && <div className="ui-dialogo-pie">{pie}</div>}
    </dialog>
  );
}

/** Atajo de `Dialogo` con la variante de panel lateral / hoja inferior. */
export function Hoja(props: Omit<PropsDialogo, 'variante'>) {
  return <Dialogo {...props} variante="hoja" />;
}
