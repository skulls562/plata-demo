import { BarraLlena } from '@/components/BarraLlena';
import { Escena } from '@/components/Escena';
import { GraficaBarras, GraficaMeses, type PuntoMes, type PuntoSimple } from '@/components/Graficas';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { Vacio } from '@/components/ui';
import { resumenDe } from '@/lib/consultas';
import { formatearCOP, mesAnterior, rangoMes, sumarDias } from '@/lib/formato';
import { esGastoVariable } from '@/lib/metricas';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Tendencias' };

const MES_CORTO = new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' });
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default async function Tendencias() {
  const c = await contextoPanel();
  const { datos, inst, hoy, mes } = c;

  // Mismo cálculo que GET /api/tendencias (resumenDe por mes): aquí solo se leen y se presentan.
  const meses: string[] = [];
  for (let m = mes, i = 0; i < 12; i++, m = mesAnterior(m)) meses.push(m);
  meses.reverse();
  const completa: PuntoMes[] = meses.map((m) => {
    const { desde, hasta } = rangoMes(m);
    const r = resumenDe(datos, inst, desde, hasta);
    return { mes: m, etiqueta: MES_CORTO.format(new Date(`${m}-15T12:00:00Z`)).replace('.', ''), ingresos: r.ingresos, variable: r.gastado_variable, fijos: r.gastado_fijos };
  });

  // Los meses de antes de tu primer movimiento no se dibujan (serían barras vacías); se muestran al menos seis.
  const primero = completa.findIndex((p) => p.ingresos > 0 || p.variable > 0 || p.fijos > 0);
  const serie = completa.slice(Math.max(0, Math.min(primero < 0 ? completa.length - 6 : primero, completa.length - 6)));

  const ult90 = resumenDe(datos, inst, sumarDias(hoy, -89), hoy);
  const top = ult90.top_comercios.slice(0, 8);
  const maxTop = Math.max(1, ...top.map((t) => t.total));

  // Hábito: cuándo gastas (últimos 90 días, gasto variable). Se cuentan los movimientos tal cual vienen de la base.
  const desde90 = sumarDias(hoy, -89);
  const porHora = Array.from({ length: 24 }, (_, h) => ({ etiqueta: String(h).padStart(2, '0'), valor: 0, cantidad: 0 }));
  const porDia = DIAS.map((d) => ({ etiqueta: d, valor: 0, cantidad: 0 }));
  for (const m of inst.movimientos) {
    if (m.fecha < desde90 || m.fecha > hoy || !esGastoVariable(m)) continue;
    const dow = new Date(m.fecha + 'T12:00:00Z').getUTCDay();
    porDia[dow].valor += m.monto;
    porDia[dow].cantidad++;
    if (m.hora) {
      const h = Number(m.hora.slice(0, 2));
      porHora[h].valor += m.monto;
      porHora[h].cantidad++;
    }
  }
  const horasConDatos: PuntoSimple[] = porHora;
  const mayorDia = [...porDia].sort((a, b) => b.valor - a.valor)[0];
  const mayorHora = [...porHora].sort((a, b) => b.valor - a.valor)[0];

  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Cómo te mueves en el año" texto="Lo que entra y lo que sale mes a mes, dónde más gastas y a qué horas se te va la plata." meta={`${serie[0]?.mes ?? mes} a ${mes}`} />

        <section aria-labelledby="t-12" data-ent>
          <div className="sec-cab">
            <h2 id="t-12" className="seccion-titulo">{serie.length === 12 ? 'Últimos 12 meses' : `Tus últimos ${serie.length} meses`}</h2>
            <p className="meta">barras: gasto · línea: ingresos</p>
          </div>
          <GraficaMeses datos={serie} />
          <details>
            <summary className="btn btn-chico ver-tabla">Ver como tabla</summary>
            <div className="tabla-scroll">
              <table className="tabla-datos num">
                <caption className="visualmente-oculto">Ingresos y gastos por mes</caption>
                <thead><tr><th scope="col">Mes</th><th scope="col">Ingresos</th><th scope="col">Día a día</th><th scope="col">Fijos</th></tr></thead>
                <tbody>
                  {serie.map((p) => (
                    <tr key={p.mes}>
                      <th scope="row">{p.mes}</th>
                      <td>{formatearCOP(p.ingresos)}</td><td>{formatearCOP(p.variable)}</td><td>{formatearCOP(p.fijos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="sec" aria-labelledby="t-top" data-ent>
          <div className="sec-cab">
            <h2 id="t-top" className="seccion-titulo">Dónde más gastas (últimos 90 días)</h2>
            <p className="meta">top {top.length}</p>
          </div>
          {top.length === 0 ? (
            <Vacio titulo="Sin gastos en este periodo" texto="Cuando registres gastos, aquí ves en qué comercios se va más plata." />
          ) : (
            <ol className="divide lista" data-testid="top-comercios">
              {top.map((t, i) => (
                <li key={t.comercio} className="ranking-fila">
                  <span className="ranking-pos meta">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ranking-nombre">{t.comercio}</span>
                  <span className="ranking-monto num">
                    {formatearCOP(t.total)}
                    <small>{t.cantidad} {t.cantidad === 1 ? 'vez' : 'veces'}</small>
                  </span>
                  <BarraLlena pct={(t.total / maxTop) * 100} color="var(--acento)" etiqueta={`${t.comercio}: ${formatearCOP(t.total)}`} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="sec habito" aria-label="Hábito de gasto">
          <div data-ent>
            <h2 className="seccion-titulo">Por hora del día</h2>
            <GraficaBarras datos={horasConDatos} nombre="Gastado" etiquetaAria="Gasto por hora del día" testid="grafica-horas" />
            {mayorHora.valor > 0 && <p className="suave">Gastas más a las {mayorHora.etiqueta}:00 ({formatearCOP(mayorHora.valor)} en 90 días).</p>}
          </div>
          <div data-ent>
            <h2 className="seccion-titulo">Por día de la semana</h2>
            <GraficaBarras datos={porDia} nombre="Gastado" etiquetaAria="Gasto por día de la semana" testid="grafica-dias" />
            {mayorDia.valor > 0 && <p className="suave">El día más pesado es el {mayorDia.etiqueta.toLowerCase()} ({formatearCOP(mayorDia.valor)} en 90 días).</p>}
          </div>
        </section>
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
