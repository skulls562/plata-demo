// Piezas de servidor compartidas por las páginas (sin estado ni efectos).
import Link from 'next/link';
import { formatearCOP } from '@/lib/formato';
import type { Metricas, Recomendacion } from '@/lib/tipos';

export function NotaAsesoria() {
  return (
    <p className="nota-asesoria" data-testid="nota-asesoria">
      Plata lee tus números; no es asesoría financiera. Para decisiones grandes, como un crédito o una inversión, habla con un profesional.
    </p>
  );
}

/** Aviso corto cuando falta ingreso o presupuesto; lleva al formulario del inicio. */
export function AvisoConfig({ ingreso, presupuesto }: { ingreso: boolean; presupuesto: boolean }) {
  if (!ingreso && !presupuesto) return null;
  const falta = ingreso && presupuesto ? 'tu ingreso y tu presupuesto' : ingreso ? 'tu ingreso mensual' : 'tu presupuesto total';
  return (
    <div role="note" data-testid="aviso-config" className="aviso-config">
      <span>Falta {falta}. Mientras tanto, las cifras son un estimado.</span>
      <Link className="btn btn-chico" href="/#configurar">Completarlo ahora</Link>
    </div>
  );
}

/** Los avisos de cálculo se escriben pensando en el bot de Telegram (`/ingreso`); en el panel se apuntan al formulario. */
export function textoPanel(s: string): string {
  return s
    .replace(/Configúralo con \/ingreso para que sea exacto\./, 'Pon tu ingreso en el formulario de Inicio para que sea exacto.')
    .replace(/\/ingreso/g, 'el formulario de Inicio');
}

/** Une frases sueltas con su punto final, sin dejar dos frases pegadas ni puntos repetidos. */
export function frases(...partes: (string | null | undefined)[]): string {
  return partes.filter((p): p is string => !!p && p.trim() !== '').map((p) => { const t = p.trim(); return /[.!?…]$/.test(t) ? t : `${t}.`; }).join(' ');
}

/** Titular de página: titular a la izquierda; texto y metadato mono (opcional) a la derecha. */
export function Encabezado({ titulo, texto, meta }: { titulo: string; texto?: string; meta?: string }) {
  return (
    <header className="enc" data-ent>
      <h1 className="titulo-pagina">{titulo}</h1>
      {(texto || meta) && (
        <div className="enc-lado">
          {texto && <p className="subtitulo">{texto}</p>}
          {meta && <p className="meta">{meta}</p>}
        </div>
      )}
    </header>
  );
}

const SEV: Record<Recomendacion['severidad'], string> = { alerta: 'Urgente', aviso: 'Ojo', info: 'Dato' };

/** `conEtiqueta`: muestra la palabra de gravedad (Inicio, donde se mezclan). En Recomendaciones ya la dice el grupo. */
export function ItemRecomendacion({ r, grande, conEtiqueta }: { r: Recomendacion; grande?: boolean; conEtiqueta?: boolean }) {
  return (
    <article className="rec" data-ent data-sev={r.severidad} data-grande={grande ? 'true' : undefined}>
      <p className={conEtiqueta ? 'rec-sev' : 'visualmente-oculto'}>{SEV[r.severidad]}</p>
      <h3>{r.titulo}</h3>
      <p className="suave">{r.detalle_con_cifras}</p>
      {r.accion?.ruta_panel && <Link href={r.accion.ruta_panel} className="btn btn-chico">{r.accion.texto}</Link>}
    </article>
  );
}

/** Cinta de datos con cifras reales del día (se repite el grupo para el bucle visual). */
export function Cinta({ m }: { m: Metricas }) {
  const items: [string, string][] = [
    ['Gastado hoy', formatearCOP(m.gastado_hoy)],
    ['Gastado en el mes', formatearCOP(m.gastado_mes)],
    ['Restante del mes', m.restante_mes === null ? 'sin calcular' : formatearCOP(m.restante_mes)],
    ['Proyección a fin de mes', formatearCOP(m.proyeccion_fin_mes)],
    ['Racha bajo el límite', `${m.racha.dias} ${m.racha.dias === 1 ? 'día' : 'días'}`],
    ['Puntaje', m.score.valor === null ? 'sin calcular' : `${m.score.valor} de 100`],
  ];
  const grupo = (oculto: boolean) => (
    <div className="cinta-grupo num" aria-hidden={oculto || undefined}>
      {items.map(([k, v]) => (<p key={k}><span>{k}</span><b>{v}</b></p>))}
    </div>
  );
  return (
    <div className="cinta bajo-nav" role="group" aria-label="Cifras del día" data-testid="cinta">
      <div className="cinta-pista">{grupo(false)}{grupo(true)}</div>
    </div>
  );
}
