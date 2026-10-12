import type { CSSProperties } from 'react';
import { cx } from './cx';

export interface PropsEsqueleto {
  /** `bloque` rectángulo, `cifra` alto de una cifra grande, `circulo`, `texto` varias líneas. */
  forma?: 'bloque' | 'cifra' | 'circulo' | 'texto';
  ancho?: string | number;
  alto?: string | number;
  /** Solo con `forma="texto"`: número de líneas (la última más corta). */
  lineas?: number;
  className?: string;
}

const ALTOS = { bloque: '1rem', cifra: 'clamp(2rem, 5vw, 3.2rem)', circulo: '2.5rem', texto: '0.9rem' } as const;

/** Marcador de carga con la forma del contenido final; el brillo se apaga con prefers-reduced-motion. */
export function Esqueleto({ forma = 'bloque', ancho, alto, lineas = 3, className }: PropsEsqueleto) {
  if (forma === 'texto') {
    return (
      <div className={cx('ui-esq-texto', className)} aria-hidden>
        {Array.from({ length: lineas }, (_, i) => (
          <span key={i} className="esqueleto" style={{ height: alto ?? ALTOS.texto, width: i === lineas - 1 ? '60%' : (ancho ?? '100%') }} />
        ))}
      </div>
    );
  }
  const estilo: CSSProperties = { width: ancho ?? (forma === 'circulo' ? ALTOS.circulo : '100%'), height: alto ?? ALTOS[forma] };
  return <span className={cx('esqueleto', className)} data-forma={forma} style={estilo} aria-hidden />;
}
