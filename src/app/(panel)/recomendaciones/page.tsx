import { Escena } from '@/components/Escena';
import { AvisoConfig, Encabezado, ItemRecomendacion, NotaAsesoria } from '@/components/piezas';
import { Vacio } from '@/components/ui';
import { evaluarReglas, ordenarRecomendaciones } from '@/lib/recomendar';
import type { Recomendacion } from '@/lib/tipos';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Recomendaciones' };

// Cada gravedad tiene su propia composición: lo urgente ocupa el ancho y va en grande, lo del radar en dos columnas,
// y los datos sueltos en una lista compacta. Así la jerarquía se lee sin etiquetas.
const GRUPOS: { sev: Recomendacion['severidad']; titulo: string; clase: string }[] = [
  { sev: 'alerta', titulo: 'Para atender ya', clase: 'rec-alertas' },
  { sev: 'aviso', titulo: 'Para tener en el radar', clase: 'rec-avisos' },
  { sev: 'info', titulo: 'Datos que te pueden servir', clase: 'rec-datos' },
];

export default async function Recomendaciones() {
  const c = await contextoPanel();
  const todas = ordenarRecomendaciones(evaluarReglas(c.inst, c.m));
  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado
          titulo="Lo que veo en tus números"
          texto="Cada aviso trae sus cifras para que veas por qué te lo digo. Aquí están todos los que siguen vigentes."
          meta={`${todas.length} ${todas.length === 1 ? 'aviso vigente' : 'avisos vigentes'}`}
        />
        {todas.length === 0 && <div data-ent><Vacio titulo="Nada que revisar" texto="Tus números están en orden por ahora. Cuando algo cambie, aparece aquí con sus cifras." /></div>}
        {GRUPOS.map((g) => {
          const items = todas.filter((r) => r.severidad === g.sev);
          if (items.length === 0) return null;
          return (
            <section key={g.sev} className="rec-grupo" aria-labelledby={`g-${g.sev}`}>
              <div className="sec-cab" data-ent>
                <h2 id={`g-${g.sev}`} className="seccion-titulo">{g.titulo}</h2>
                <p className="meta">{items.length}</p>
              </div>
              <div className={g.clase}>
                {items.map((r) => (<ItemRecomendacion key={r.id} r={r} grande={g.sev === 'alerta'} />))}
              </div>
            </section>
          );
        })}
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
