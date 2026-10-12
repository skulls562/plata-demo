import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface PropsInsignia extends HTMLAttributes<HTMLSpanElement> {
  /** `listo` es el ámbar de «terminado/cumplido». Sin puntito decorativo a propósito. */
  tono?: 'neutro' | 'acento' | 'listo' | 'exito' | 'aviso' | 'peligro';
  /** Tipografía mono, para códigos, fechas y cifras cortas. */
  mono?: boolean;
}

export function Insignia({ tono = 'neutro', mono, className, ...resto }: PropsInsignia) {
  return <span className={cx('ui-insignia', className)} data-tono={tono} data-mono={mono ? 'true' : undefined} {...resto} />;
}
