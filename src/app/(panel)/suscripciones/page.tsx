import { AccionesSuscripcion } from '@/components/AccionesSuscripcion';
import { Escena } from '@/components/Escena';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { Estadistica, Insignia, Vacio } from '@/components/ui';
import { leerRecurrentes, refrescarRecurrentes } from '@/lib/datos';
import { diasEntre, formatearCOP, formatearFechaCorta } from '@/lib/formato';
import { subioDePrecio } from '@/lib/suscripciones';
import type { Recurrente } from '@/lib/tipos';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Suscripciones' };

function cuando(hoy: string, fecha: string | null): string {
  if (!fecha) return 'Sin fecha';
  const d = diasEntre(hoy, fecha);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  return `En ${d} días (${formatearFechaCorta(fecha)})`;
}

function Fila({ r, hoy }: { r: Recurrente; hoy: string }) {
  const subio = subioDePrecio(r.monto_tipico, r.monto_anterior);
  return (
    <li data-ent className="fila-dato susc-fila">
      <div className="susc-nombre">
        <p>{r.nombre}</p>
        <div className="susc-meta">
          <span className="meta">{r.periodo}</span>
          {r.estado === 'confirmada' && <Insignia tono="listo">Confirmada</Insignia>}
          {r.estado === 'detectada' && <Insignia tono="acento">Detectada por Plata</Insignia>}
          {subio && r.monto_anterior !== null && <Insignia tono="aviso" mono>Subió de {formatearCOP(r.monto_anterior)}</Insignia>}
        </div>
      </div>
      <p className="num susc-monto">{formatearCOP(r.monto_tipico)}</p>
      <p className="suave susc-cuando">{cuando(hoy, r.proximo_cobro)}</p>
      <p className="num suave susc-anual"><span className="visualmente-oculto">Costo al año </span>{formatearCOP(r.costo_anual)} al año</p>
      {r.estado === 'detectada' ? <div className="susc-acciones"><AccionesSuscripcion id={r.id} nombre={r.nombre} /></div> : <span />}
    </li>
  );
}

export default async function Suscripciones() {
  const c = await contextoPanel();
  refrescarRecurrentes(c.db, c.hoy);
  const todos = leerRecurrentes(c.db).filter((r) => r.activa && r.estado !== 'descartada').sort((a, b) => b.costo_anual - a.costo_anual || a.id - b.id);
  const subs = todos.filter((r) => r.clase === 'suscripcion');
  const otros = todos.filter((r) => r.clase !== 'suscripcion');
  const anual = subs.reduce((s, r) => s + r.costo_anual, 0);
  const mensual = subs.reduce((s, r) => s + r.costo_mensual, 0);

  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Lo que se repite" texto="Cobros que Plata detectó solos en tus movimientos: cuándo te cobran de nuevo y cuánto suman al año." meta={`${todos.length} ${todos.length === 1 ? 'cobro' : 'cobros'} activos`} />

        <section className="susc-hero" data-ent aria-label="Costo de las suscripciones">
          <Estadistica etiqueta="Suscripciones al año" valor={anual} data-testid="costo-anual" />
          <div>
            <Estadistica etiqueta="Cada mes" valor={mensual} />
            <p className="suave">{subs.length} {subs.length === 1 ? 'suscripción activa' : 'suscripciones activas'}.</p>
          </div>
        </section>

        <section className="sec" aria-labelledby="t-subs">
          <h2 id="t-subs" className="seccion-titulo" data-ent>Suscripciones</h2>
          {subs.length === 0 ? (
            <div data-ent><Vacio titulo="Sin suscripciones activas" texto="No detecté ninguna todavía. Salen solas cuando un cobro se repite tres veces." /></div>
          ) : (
            <ul className="divide lista" data-testid="lista-suscripciones">
              {subs.map((r) => (<Fila key={r.id} r={r} hoy={c.hoy} />))}
            </ul>
          )}
        </section>

        {otros.length > 0 && (
          <section className="sec" aria-labelledby="t-otros">
            <h2 id="t-otros" className="seccion-titulo" data-ent>Otros cobros que se repiten</h2>
            <ul className="divide lista">
              {otros.map((r) => (<Fila key={r.id} r={r} hoy={c.hoy} />))}
            </ul>
          </section>
        )}
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
