// Eventos de ventana para abrir la guía de bienvenida desde cualquier parte del panel.
// `plata:tutorial` sin detalle abre el recorrido guiado; con `{ que: 'asistente' }` abre el asistente de bienvenida.
export const EVENTO_TUTORIAL = 'plata:tutorial';

export type QueAbrir = 'tour' | 'asistente';

export function abrirGuia(que: QueAbrir = 'tour') {
  window.dispatchEvent(new CustomEvent(EVENTO_TUTORIAL, { detail: { que } }));
}
