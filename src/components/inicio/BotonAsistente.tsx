'use client';
// Botón que abre el asistente de bienvenida (vive en el layout; aquí solo se le avisa por evento).
import { abrirGuia } from '../guia/eventos';

export function BotonAsistente({ texto, primario = true }: { texto: string; primario?: boolean }) {
  return (
    <button type="button" className={primario ? 'btn btn-prim' : 'btn'} onClick={() => abrirGuia('asistente')}>
      {texto}
    </button>
  );
}
