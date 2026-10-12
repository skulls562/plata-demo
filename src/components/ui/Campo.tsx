import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

interface BaseCampo {
  etiqueta: string;
  /** Texto de apoyo bajo el control. */
  ayuda?: string;
  /** Mensaje de error bajo el control; marca el campo como inválido. */
  error?: string;
}

type Aria = { 'aria-describedby'?: string; 'aria-invalid'?: true };

function Envoltura({ etiqueta, ayuda, error, id, children }: BaseCampo & { id: string; children: (a: Aria) => ReactNode }) {
  const idMsg = `${id}-msg`;
  const msg = error ?? ayuda;
  return (
    <div className="grupo">
      <label htmlFor={id}>{etiqueta}</label>
      {children({ 'aria-describedby': msg ? idMsg : undefined, 'aria-invalid': error ? true : undefined })}
      {msg && <p id={idMsg} className={error ? 'error-campo' : 'ayuda-campo'} role={error ? 'alert' : undefined}>{msg}</p>}
    </div>
  );
}

export type PropsCampo = BaseCampo & InputHTMLAttributes<HTMLInputElement>;
/** Entrada de una línea: etiqueta arriba, error o ayuda debajo, 44 px de alto. */
export function Campo({ etiqueta, ayuda, error, id, className, ...resto }: PropsCampo) {
  const auto = useId();
  const ident = id ?? auto;
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} id={ident}>
      {(aria) => <input id={ident} className={cx('campo', className)} {...aria} {...resto} />}
    </Envoltura>
  );
}

export type PropsCampoSelect = BaseCampo & SelectHTMLAttributes<HTMLSelectElement>;
export function CampoSelect({ etiqueta, ayuda, error, id, className, children, ...resto }: PropsCampoSelect) {
  const auto = useId();
  const ident = id ?? auto;
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} id={ident}>
      {(aria) => <select id={ident} className={cx('select', className)} {...aria} {...resto}>{children}</select>}
    </Envoltura>
  );
}

export type PropsCampoArea = BaseCampo & TextareaHTMLAttributes<HTMLTextAreaElement>;
export function CampoArea({ etiqueta, ayuda, error, id, className, ...resto }: PropsCampoArea) {
  const auto = useId();
  const ident = id ?? auto;
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} id={ident}>
      {(aria) => <textarea id={ident} className={cx('campo', className)} {...aria} {...resto} />}
    </Envoltura>
  );
}
