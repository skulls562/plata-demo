import { Escena } from '@/components/Escena';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { Pregunta } from '@/components/PreguntaUI';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Pregúntale a tu plata' };

export default async function PaginaPregunta() {
  const c = await contextoPanel();
  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Pregúntale a tu plata" texto="Escribe como hablas. Solo leo tus datos: no cambio nada. Si la IA local está apagada, respondo con plantillas." meta="solo lectura" />
        <div data-ent><Pregunta /></div>
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
