import { Cifra, type FormatoCifra } from '../Cifra';
import { cx } from './cx';

export interface DeltaEstadistica {
  /** Variación ya calculada (se muestra con signo). */
  valor: number;
  formato?: FormatoCifra;
  /** Si subir es bueno (ingresos, ahorro) o malo (gasto, deuda). Por defecto subir es malo. */
  sube?: 'bueno' | 'malo';
  /** Texto que acompaña la variación, p. ej. «frente al mes pasado». */
  texto?: string;
}

export interface PropsEstadistica {
  etiqueta: string;
  valor: number;
  formato?: FormatoCifra;
  tamano?: 'chica' | 'normal' | 'gigante';
  tono?: 'base' | 'listo' | 'exito' | 'peligro' | 'acento';
  delta?: DeltaEstadistica;
  /** Metadato en mono bajo la cifra (fecha, regla, fuente). */
  meta?: string;
  /** Cuenta hasta el valor con GSAP (usa Cifra). En false se muestra el valor fijo. */
  animar?: boolean;
  className?: string;
  'data-testid'?: string;
}

function textoDelta(d: DeltaEstadistica): string {
  const f = d.formato ?? 'cop';
  const signo = d.valor > 0 ? '+' : d.valor < 0 ? '-' : '';
  const abs = Math.abs(d.valor);
  const base = f === 'pct' ? `${Math.round(abs)}%` : f === 'entero' ? String(Math.round(abs)) : f === 'corto' ? `$${Math.round(abs / 1000)} mil` : `$${Math.round(abs).toLocaleString('es-CO')}`;
  return `${signo}${base}`;
}

function signoDelta(d?: DeltaEstadistica): 'bueno' | 'malo' | undefined {
  if (!d || d.valor === 0) return undefined;
  const sube = d.valor > 0;
  return sube === ((d.sube ?? 'malo') === 'bueno') ? 'bueno' : 'malo';
}

/** Cifra grande con etiqueta, variación y metadato. Reusa `Cifra`, así hereda el conteo y el respeto a prefers-reduced-motion. */
export function Estadistica({ etiqueta, valor, formato = 'cop', tamano = 'normal', tono = 'base', delta, meta, animar = true, className, ...resto }: PropsEstadistica) {
  return (
    <div className={cx('ui-est', className)} data-tamano={tamano} data-tono={tono} data-testid={resto['data-testid']}>
      <p className="ui-est-etq">{etiqueta}</p>
      <p className="ui-est-cifra">
        <Cifra valor={valor} formato={formato} duracion={animar ? 0.9 : 0} />
      </p>
      {(delta || meta) && (
        <div className="ui-est-pie">
          {delta && <span className="ui-delta" data-signo={signoDelta(delta)}>{textoDelta(delta)}{delta.texto ? ` ${delta.texto}` : ''}</span>}
          {meta && <span className="meta">{meta}</span>}
        </div>
      )}
    </div>
  );
}
