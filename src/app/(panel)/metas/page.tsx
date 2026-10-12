import { BarraLlena } from '@/components/BarraLlena';
import { Cifra } from '@/components/Cifra';
import { Escena } from '@/components/Escena';
import { AccionesMeta, FormularioMeta } from '@/components/MetasUI';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { Insignia, Vacio } from '@/components/ui';
import { formatearCOP, formatearFechaCorta } from '@/lib/formato';
import { metaAlDia } from '@/lib/metricas';
import { listarMetas } from '@/lib/panel';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Metas' };

const ESTADO = { activa: 'Activa', pausada: 'Pausada', cumplida: 'Cumplida', cancelada: 'Cancelada' } as const;

export default async function Metas() {
  const c = await contextoPanel();
  const metas = listarMetas(c.db);
  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Tus metas" texto="Lo que estás juntando, cuánto llevas y si vas a tiempo para la fecha que te pusiste." meta={`${metas.length} ${metas.length === 1 ? 'meta' : 'metas'}`} />

        {metas.length === 0 ? (
          <div data-ent><Vacio titulo="Todavía no tienes metas" texto="Crea la primera abajo: un viaje, un colchón de emergencia, lo que estés juntando." /></div>
        ) : (
          <ul className="divide lista" data-testid="lista-metas">
            {metas.map((m) => {
              const pct = Math.min(100, (m.aportado / m.objetivo) * 100);
              const alDia = m.fecha_objetivo && m.estado === 'activa' ? metaAlDia(m, c.hoy) : null;
              return (
                <li key={m.id} data-ent className="meta-fila" data-estado={m.estado}>
                  <p className="meta-pct" aria-hidden><Cifra valor={pct} formato="pct" /></p>
                  <div className="meta-cuerpo">
                    <p className="meta">{m.fecha_objetivo ? `para el ${formatearFechaCorta(m.fecha_objetivo)}` : 'sin fecha límite'}</p>
                    <h2 className="meta-nombre">{m.nombre}</h2>
                    <p className="grande"><Cifra valor={m.aportado} formato="corto" /></p>
                    <p className="suave">{m.aportado > 0 ? `de ${formatearCOP(m.objetivo)}, el ${Math.round(pct)}%.` : `Meta de ${formatearCOP(m.objetivo)}. Todavía no has aportado.`}</p>
                    <BarraLlena pct={pct} color={m.estado === 'cumplida' ? 'var(--listo)' : 'var(--acento)'} etiqueta={`${m.nombre}: ${Math.round(pct)}% de la meta`} />
                    <div className="acciones">
                      <Insignia tono={m.estado === 'cumplida' ? 'listo' : m.estado === 'activa' ? 'acento' : 'neutro'}>{ESTADO[m.estado]}</Insignia>
                      {alDia !== null && (
                        <Insignia tono={alDia ? 'exito' : 'aviso'}>{alDia ? 'Vas al día con tu fecha.' : 'Vas atrasado frente a tu fecha.'}</Insignia>
                      )}
                    </div>
                  </div>
                  <AccionesMeta id={m.id} nombre={m.nombre} estado={m.estado} />
                </li>
              );
            })}
          </ul>
        )}

        <section className="sec" aria-labelledby="t-nueva" data-ent>
          <h2 id="t-nueva" className="seccion-titulo">Crear una meta</h2>
          <FormularioMeta />
        </section>
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
