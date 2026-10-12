import type { ElementType, HTMLAttributes } from 'react';
import { cx } from './cx';

export interface PropsTarjeta extends HTMLAttributes<HTMLElement> {
  /** Etiqueta HTML a usar (por defecto `div`). */
  como?: 'div' | 'section' | 'article' | 'aside' | 'li';
  /** `base` fondo 2, `elevada` con sombra, `plana` sin fondo, y los tonos de significado: acento, listo (ámbar), peligro. */
  tono?: 'base' | 'elevada' | 'plana' | 'acento' | 'listo' | 'peligro';
  relleno?: 'ninguno' | 'chico' | 'normal' | 'grande';
  /** Marca la tarjeta como pulsable (sube 1 px al pasar el cursor). */
  interactiva?: boolean;
}

/** Contenedor con borde de 1 px. Úsala solo cuando el borde agrupa algo; para listas basta `.divide` o la retícula. */
export function Tarjeta({ como = 'div', tono = 'base', relleno = 'normal', interactiva, className, ...resto }: PropsTarjeta) {
  const Etiqueta = como as ElementType;
  return <Etiqueta className={cx('ui-tarjeta', className)} data-tono={tono} data-relleno={relleno} data-interactiva={interactiva ? 'true' : undefined} {...resto} />;
}
