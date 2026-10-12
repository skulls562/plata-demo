import Link from 'next/link';
import { Escena } from '@/components/Escena';
import { BotonDeshacer, FilaMovimiento, FormularioGasto } from '@/components/MovimientosUI';
import { Campo, CampoSelect, Tarjeta, Vacio } from '@/components/ui';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import type { FiltroMovimientos, PaginaMovimientos } from '@/lib/tipos';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Movimientos' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Movimientos({ searchParams }: { searchParams: Params }) {
  const p = await searchParams;
  const c = await contextoPanel();
  const categorias = c.inst.categorias.filter((x) => x.activa).map((x) => ({ id: x.id, nombre: x.nombre, es_gasto: x.es_gasto }));

  const q = uno(p.q).trim().slice(0, 80);
  const categoria = categorias.some((x) => x.id === uno(p.categoria)) ? uno(p.categoria) : '';
  const sentido = uno(p.sentido) === 'salida' || uno(p.sentido) === 'entrada' ? (uno(p.sentido) as 'salida' | 'entrada') : '';
  const desde = RE_FECHA.test(uno(p.desde)) ? uno(p.desde) : '';
  const hasta = RE_FECHA.test(uno(p.hasta)) ? uno(p.hasta) : '';
  const cursor = uno(p.cursor) || null;

  const filtro: FiltroMovimientos = { limite: 30, cursor };
  if (q) filtro.q = q;
  if (categoria) filtro.categoria_id = categoria;
  if (sentido) filtro.sentido = sentido;
  if (desde) filtro.desde = desde;
  if (hasta) filtro.hasta = hasta;

  let pagina: PaginaMovimientos = { items: [], siguiente_cursor: null };
  let fallo = false;
  try {
    pagina = c.datos.buscarMovimientos(filtro);
  } catch {
    fallo = true;
  }

  const base = new URLSearchParams();
  if (q) base.set('q', q);
  if (categoria) base.set('categoria', categoria);
  if (sentido) base.set('sentido', sentido);
  if (desde) base.set('desde', desde);
  if (hasta) base.set('hasta', hasta);
  const siguiente = pagina.siguiente_cursor ? `/movimientos?${new URLSearchParams([...base, ['cursor', pagina.siguiente_cursor]]).toString()}` : null;

  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Tus movimientos" texto="Busca, corrige la categoría (Plata aprende de eso), anota un gasto en efectivo o deshaz lo último. Las transferencias no cuentan como gasto hasta que toques «Cuenta como gasto»." meta={`${pagina.items.length} a la vista${siguiente ? ', hay más' : ''}`} />

        <section aria-labelledby="t-gasto" data-ent>
          <h2 id="t-gasto" className="seccion-titulo">Añadir un gasto en efectivo</h2>
          <FormularioGasto categorias={categorias} hoy={c.hoy} />
        </section>

        <section className="sec" aria-label="Buscar" data-ent>
          <Tarjeta relleno="chico">
            <form method="get" action="/movimientos" aria-label="Filtrar movimientos" className="filtros">
              <Campo etiqueta="Buscar" id="f-q" name="q" defaultValue={q} placeholder="Comercio o nota" maxLength={80} />
              <CampoSelect etiqueta="Categoría" id="f-cat" name="categoria" defaultValue={categoria}>
                <option value="">Todas</option>
                {categorias.map((x) => (<option key={x.id} value={x.id}>{x.nombre}</option>))}
              </CampoSelect>
              <CampoSelect etiqueta="Tipo" id="f-sent" name="sentido" defaultValue={sentido}>
                <option value="">Todos</option><option value="salida">Salidas</option><option value="entrada">Ingresos</option>
              </CampoSelect>
              <Campo etiqueta="Desde" id="f-desde" name="desde" type="date" defaultValue={desde} />
              <Campo etiqueta="Hasta" id="f-hasta" name="hasta" type="date" defaultValue={hasta} />
              <div className="filtros-acciones">
                <button type="submit" className="btn btn-prim">Filtrar</button>
                <Link href="/movimientos" className="btn">Limpiar</Link>
              </div>
            </form>
          </Tarjeta>
        </section>

        <div data-ent className="mov-barra">
          <BotonDeshacer />
          <a className="btn" href={`/api/movimientos/exportar?mes=${c.mes}`} download>Exportar {c.mes} (CSV)</a>
        </div>

        {fallo && <p role="alert" className="error-campo">Ese filtro no se pudo aplicar. Límpialo e intenta otra vez.</p>}
        {!fallo && pagina.items.length === 0 ? (
          <div data-ent><Vacio titulo="Sin movimientos" texto="No encontré movimientos con ese filtro." /></div>
        ) : (
          <ul className="divide lista" data-testid="lista-movimientos">
            {pagina.items.map((m) => (<FilaMovimiento key={m.id} m={m} categorias={categorias} />))}
          </ul>
        )}
        {siguiente && <p className="nota-pie"><Link href={siguiente} className="btn">Ver más antiguos</Link></p>}
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
