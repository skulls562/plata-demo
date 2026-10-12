import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PropsVacio {
  titulo: string;
  /** Qué pasa y qué hacer, en una o dos frases. */
  texto?: string;
  /** Botón o enlace de la acción que llena este espacio (p. ej. un `<Link className="btn btn-prim">`). */
  accion?: ReactNode;
  className?: string;
}

/** Estado vacío que enseña el siguiente paso en vez de mostrar un hueco. */
export function Vacio({ titulo, texto, accion, className }: PropsVacio) {
  return (
    <div className={cx('ui-vacio', className)} role="status">
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {accion && <div className="ui-vacio-accion">{accion}</div>}
    </div>
  );
}
