import { BarraLlena } from '@/components/BarraLlena';
import { Calendario, type DiaCalor } from '@/components/Calendario';
import { Cifra } from '@/components/Cifra';
import { Escena } from '@/components/Escena';
import { AvisoConfig, Encabezado, frases, NotaAsesoria, textoPanel } from '@/components/piezas';
import { Estadistica, Vacio } from '@/components/ui';
import { formatearCOP, formatearPct } from '@/lib/formato';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Mes' };

const ESTADO = {
  ok: { color: 'var(--verde)', palabra: 'Va bien' },
  cerca: { color: 'var(--ambar)', palabra: 'Cerca del tope' },
  pasado: { color: 'var(--rojo)', palabra: 'Te pasaste' },
  sin_presupuesto: { color: 'var(--acento)', palabra: 'Sin presupuesto' },
} as const;

export default async function Mes() {
  const c = await contextoPanel();
  const { m, inst, hoy, mes } = c;
  const nombres = new Map(inst.categorias.map((x) => [x.id, x.nombre]));
  const nombreMes = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-15T12:00:00Z`));

  const dias: DiaCalor[] = inst.dias.filter((d) => d.fecha.startsWith(mes) && d.fecha < hoy).map((d) => ({ fecha: d.fecha, gastado: d.gastado, limite: d.limite }));
  dias.push({ fecha: hoy, gastado: m.gastado_hoy, limite: m.limite_hoy });

  const categorias = m.por_categoria.filter((x) => x.gastado > 0 || x.presupuesto !== null);
  const ningunPresupuesto = categorias.length > 0 && categorias.every((x) => x.presupuesto === null);
  const vmes = m.base.disponible_variable;
  const pctProy = vmes && vmes > 0 ? (m.proyeccion_fin_mes / vmes) * 100 : null;

  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo={`Tu ${nombreMes}`} texto="Cómo va el mes por categoría, día por día y hacia dónde va a cerrar." meta={`${mes} · día ${hoy.slice(8)}, quedan ${m.dias_restantes}`} />

        <section className="reticula reticula-3 reticula-mes" data-ent aria-label="Resumen del mes">
          <div>
            <Estadistica className="est-heroe" etiqueta="Llevas gastado" valor={m.gastado_mes} formato="corto" />
            <p className="suave">en el día a día, sin contar los fijos.</p>
          </div>
          <div>
            {vmes === null ? (
              <>
                <p className="ui-est-etq">Tienes para el mes</p>
                <p className="grande">Sin calcular</p>
              </>
            ) : (
              <Estadistica etiqueta="Tienes para el mes" valor={vmes} formato="corto" />
            )}
            <p className="suave">{vmes === null ? 'Falta tu ingreso o un presupuesto para calcularlo.' : textoPanel(m.base.aviso_modo ?? 'Lo que queda después de fijos y ahorro.')}</p>
          </div>
          <div>
            <Estadistica etiqueta="Ritmo diario" valor={m.ritmo_diario} formato="corto" />
            <p className="suave">Lo que gastas por día, con más peso a los días recientes.</p>
          </div>
        </section>

        <section className="sec" aria-labelledby="t-cat">
          <div className="sec-cab" data-ent>
            <h2 id="t-cat" className="seccion-titulo">Por categoría frente a su presupuesto</h2>
            <p className="meta">{categorias.length} {categorias.length === 1 ? 'categoría' : 'categorías'}</p>
          </div>
          {ningunPresupuesto && (
            <p className="suave texto-ancho" data-ent>
              Ninguna categoría tiene presupuesto todavía, así que aquí ves cuánto llevas en cada una. Con un tope por categoría (por ejemplo, <span className="num">/presupuesto comida 400k</span> en el bot) también te aviso cuando te acerques.
            </p>
          )}
          {categorias.length === 0 ? (
            <div data-ent><Vacio titulo="Todavía sin gastos este mes" texto="Cuando entre el primero, aquí lo ves por categoría." /></div>
          ) : (
            <ul className="divide lista" data-testid="barras-categoria">
              {categorias.map((x) => {
                const e = ESTADO[x.estado];
                const nombre = nombres.get(x.categoria_id) ?? x.categoria_id;
                const pct = x.pct === null ? 0 : x.pct * 100;
                return (
                  <li key={x.categoria_id} data-ent className="cat" data-estado={x.presupuesto !== null ? x.estado : 'sin_presupuesto'}>
                    <span className="cat-nombre">{nombre}</span>
                    <div className="cat-barra">
                      {x.presupuesto !== null && (
                        <BarraLlena pct={pct} marca={100} color={e.color} etiqueta={`${nombre}: ${Math.round(pct)}% del presupuesto`} />
                      )}
                      {(x.presupuesto !== null || !ningunPresupuesto) && (
                        <p className="cat-estado">
                          {x.presupuesto !== null && x.pct !== null ? `${e.palabra}: llevas el ${formatearPct(x.pct)} de su presupuesto.` : 'Sin presupuesto asignado.'}
                        </p>
                      )}
                    </div>
                    <span className="num suave cat-monto">
                      {formatearCOP(x.gastado)}{x.presupuesto !== null ? ` de ${formatearCOP(x.presupuesto)}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sec cols">
          <div data-ent>
            <h2 className="seccion-titulo">Calendario de calor</h2>
            <Calendario mes={mes} dias={dias} hoy={hoy} />
          </div>
          <div data-ent className="proy" aria-labelledby="t-proy">
            <h2 id="t-proy" className="seccion-titulo">Hacia dónde va el mes</h2>
            <p className="grande"><Cifra valor={m.proyeccion_fin_mes} formato="corto" /></p>
            <p className="suave">
              {pctProy === null ? 'Es lo que calculo que habrás gastado al cerrar el mes.' : `Así cerrarías el mes: el ${Math.round(pctProy)}% de lo que tienes disponible.`}
            </p>
            {pctProy !== null && (
              <BarraLlena pct={Math.min(100, pctProy)} marca={100} color={pctProy > 105 ? 'var(--rojo)' : pctProy > 95 ? 'var(--ambar)' : 'var(--verde)'} etiqueta={`Proyección: ${Math.round(pctProy)}% del presupuesto del mes`} />
            )}
            {pctProy === null && <p className="suave">{frases(m.semaforo_razon)}</p>}
            {m.mes_pasado && (
              <p className="suave">
                A esta fecha el mes pasado llevabas <span className="num">{formatearCOP(m.mes_pasado.gastado_a_la_fecha)}</span>
                {m.mes_pasado.diferencia === 0 ? '.' : m.mes_pasado.diferencia > 0 ? `, hoy vas ${formatearCOP(m.mes_pasado.diferencia)} por encima.` : `, hoy vas ${formatearCOP(-m.mes_pasado.diferencia)} por debajo.`}
              </p>
            )}
          </div>
        </section>

        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
