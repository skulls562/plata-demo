import { Escena } from '@/components/Escena';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { ListaEspera, Simulador } from '@/components/SimuladorUI';
import { listarEspera } from '@/lib/panel';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Simulador' };

export default async function PaginaSimulador() {
  const c = await contextoPanel();
  const espera = listarEspera(c.db, c.mes);
  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="¿Puedo comprarlo?" texto="Dime cuánto cuesta y te digo si cabe, con tus números de hoy. Es el mismo veredicto del bot de Telegram. Lo grande y no esencial reposa 48 horas." meta="mismo veredicto que el bot" />
        <section data-ent aria-labelledby="t-sim"><h2 id="t-sim" className="visualmente-oculto">Simulador</h2><Simulador /></section>
        <section className="sec" aria-labelledby="t-espera" data-ent>
          <div className="sec-cab">
            <h2 id="t-espera" className="seccion-titulo">Lista de espera de 48 horas</h2>
            <p className="meta">{espera.items.length} en espera</p>
          </div>
          <ListaEspera items={espera.items} ahorrado={espera.ahorrado_mes} ahoraMs={c.ahora.getTime()} />
        </section>
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
