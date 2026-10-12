import { ActualizarGmail } from '@/components/ActualizarGmail';
import { Escena } from '@/components/Escena';
import { ListaPorRevisar } from '@/components/PorRevisarUI';
import { AvisoConfig, Encabezado, NotaAsesoria } from '@/components/piezas';
import { armarEstado, clienteIA } from '@/lib/api';
import { estadoSync } from '@/lib/correo-sync';
import { obtenerEntorno } from '@/lib/http';
import { listarPorRevisar } from '@/lib/panel';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Sistema' };

const FLUJOS: { id: 'ingesta' | 'bot' | 'reportes'; nombre: string; que: string }[] = [
  { id: 'ingesta', nombre: 'Ingesta de correos', que: 'Lee los avisos del banco y los manda a Plata.' },
  { id: 'bot', nombre: 'Bot de Telegram', que: 'Atiende tus comandos y botones.' },
  { id: 'reportes', nombre: 'Reportes y alertas', que: 'Cierra el día y manda las alertas pendientes.' },
];

const UMBRAL_SILENCIO_H = 12;

function hace(ahora: number, iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000));
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

function Dato({ k, v, estado }: { k: string; v: string; estado?: 'bien' | 'mal' | 'neutro' }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="num" data-estado={estado}>{v}</dd>
    </div>
  );
}

export default async function Sistema() {
  const c = await contextoPanel();
  const entorno = obtenerEntorno();
  const estado = await armarEstado({ actor: 'panel', entorno, params: {}, db: c.db, datos: c.datos, ahora: c.ahora, ia: clienteIA(entorno), hoy: c.hoy });
  const pendientes = listarPorRevisar(c.db).map((f) => ({ id: f.id, banco: f.banco, asunto: f.asunto, texto: f.texto, motivo: f.motivo, fecha: f.fecha_correo, intentos: f.intentos }));
  const ahoraMs = c.ahora.getTime();
  const bloqueo = c.inst.sistema.pin_bloqueado_hasta;
  const bloqueado = bloqueo !== null && Date.parse(bloqueo) > ahoraMs;
  const vivos = FLUJOS.filter((f) => !estado.caidos.includes(f.id)).length;
  // El latido de «Ingesta» sale de un reloj de n8n: puede estar vivo con el lector de Gmail mudo. Lo delata el último aviso real.
  const horasSinAvisos = estado.ultimo_aviso_en ? Math.floor((ahoraMs - Date.parse(estado.ultimo_aviso_en)) / 3_600_000) : null;
  const lectorMudo = !estado.caidos.includes('ingesta') && (horasSinAvisos === null || horasSinAvisos >= UMBRAL_SILENCIO_H);
  const sync = estadoSync();

  return (
    <Escena>
      <div className="pagina">
        <AvisoConfig {...faltaConfigurar(c)} />
        <Encabezado titulo="Estado del sistema" texto="Si algo no llega o no se actualiza, aquí se ve primero. n8n avisa que está vivo cada diez minutos." meta={`${vivos} de ${FLUJOS.length} flujos vivos`} />

        <section aria-labelledby="t-flujos" data-ent>
          <div className="sec-cab">
            <h2 id="t-flujos" className="seccion-titulo">n8n, los flujos</h2>
            <p className="meta">latido cada 10 min</p>
          </div>
          <div className="lienzo">
            <ul className="lista flujo-nodos" data-testid="flujos">
              {FLUJOS.map((f) => {
                const caido = estado.caidos.includes(f.id);
                return (
                  <li key={f.id} className="nodo" data-estado={caido ? 'caido' : 'vivo'}>
                    <p className="nodo-nombre">{f.nombre}</p>
                    <p className="nodo-estado">{caido ? 'Caído' : 'Vivo'}</p>
                    <p className="suave">Último latido {hace(ahoraMs, estado.latidos[f.id])}.</p>
                    <p className="meta">{f.que}</p>
                  </li>
                );
              })}
            </ul>
            <div className="nodo nodo-hub">
              <p className="nodo-nombre">Plata</p>
              <p className="nodo-estado">Panel</p>
              <p className="meta">versión {estado.version}</p>
            </div>
          </div>
        </section>

        <section className="sec" aria-labelledby="t-correo" data-ent>
          <div className="sec-cab">
            <h2 id="t-correo" className="seccion-titulo">Correo del banco</h2>
            <p className="meta">se actualiza sola cada 30 s</p>
          </div>
          {lectorMudo && (
            <div className="aviso-silencio" data-testid="aviso-correo-mudo">
              <p><strong>{horasSinAvisos === null ? 'Todavía no ha llegado ningún aviso.' : `Hace ${horasSinAvisos} h que no llega ningún aviso del banco.`}</strong></p>
              <p className="suave">n8n sigue vivo, pero el lector de Gmail puede haberse desconectado (por ejemplo, si cambió la contraseña de aplicación). Toca «Actualizar Gmail» para traer ya lo que falte.</p>
            </div>
          )}
          <ActualizarGmail configurado={sync.configurado} falta={sync.falta} />
        </section>

        <section className="sec" aria-labelledby="t-resto" data-ent>
          <h2 id="t-resto" className="seccion-titulo">Lo demás</h2>
          <dl className="datos-sistema">
            <Dato k="Último aviso del banco" v={hace(ahoraMs, estado.ultimo_aviso_en)} />
            <Dato k="Avisos en 24 horas" v={String(estado.avisos_24h)} />
            <Dato k="Por revisar" v={String(estado.por_revisar_pendientes)} estado={estado.por_revisar_pendientes > 0 ? 'mal' : 'bien'} />
            <Dato k="IA local" v={estado.ia.ok ? `Lista (${estado.ia.modelo}, ${estado.ia.latencia_ms} ms)` : `Apagada (${estado.ia.modelo})`} estado={estado.ia.ok ? 'bien' : 'mal'} />
            <Dato k="Base de datos" v={`${(estado.db.tamano_bytes / 1_048_576).toFixed(1).replace('.', ',')} MB, versión ${estado.db.user_version}`} estado="neutro" />
            <Dato k="Versión de Plata" v={estado.version} estado="neutro" />
            <Dato k="PIN del panel" v={bloqueado ? `Bloqueado hasta ${bloqueo!.slice(11, 16)} UTC` : 'Sin bloqueo'} estado={bloqueado ? 'mal' : 'bien'} />
          </dl>
          {!estado.ia.ok && <p className="suave texto-ancho">Sin la IA local, Plata sigue funcionando: lee los bancos conocidos por reglas y responde con plantillas.</p>}
        </section>

        <section className="sec" aria-labelledby="t-rev" data-ent>
          <h2 id="t-rev" className="seccion-titulo">Avisos por revisar</h2>
          <ListaPorRevisar items={pendientes} hoy={c.hoy} />
        </section>
        <div className="nota-pie" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
