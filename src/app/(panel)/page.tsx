import Link from 'next/link';
import { BarraLlena } from '@/components/BarraLlena';
import { Calendario, type DiaCalor } from '@/components/Calendario';
import { Cifra } from '@/components/Cifra';
import { Escena } from '@/components/Escena';
import { Semaforo } from '@/components/Semaforo';
import { BotonAsistente } from '@/components/inicio/BotonAsistente';
import { Cinta, frases, NotaAsesoria, textoPanel } from '@/components/piezas';
import { Estadistica, Insignia, Tarjeta, Vacio } from '@/components/ui';
import '@/components/inicio/inicio.css';
import { vencimientos } from '@/lib/deudas';
import { diasEntre, formatearCOP, formatearFechaCorta, formatearPct } from '@/lib/formato';
import { evaluarReglas, ordenarRecomendaciones } from '@/lib/recomendar';
import type { Metricas, Recomendacion } from '@/lib/tipos';
import { contextoPanel, faltaConfigurar } from '@/panel/contexto';

export const metadata = { title: 'Inicio' };

const SEVERIDAD: Record<Recomendacion['severidad'], { tono: 'peligro' | 'aviso' | 'acento'; palabra: string }> = {
  alerta: { tono: 'peligro', palabra: 'Urgente' },
  aviso: { tono: 'aviso', palabra: 'Ojo' },
  info: { tono: 'acento', palabra: 'Dato' },
};

function cuando(dias: number): string {
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return `En ${dias} días`;
}

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** '2026-10-30' → «30 de octubre». */
const fechaLarga = (f: string) => `${Number(f.slice(8, 10))} de ${MESES_LARGOS[Number(f.slice(5, 7)) - 1]}`;

/** Desglose de «hoy puedes gastar» cuando hay cuentas anotadas: de dónde sale el límite, con cifras que cuadran. */
function lineaBaseHoy(m: Metricas): string {
  const b = m.base_hoy;
  if (b.limita === 'ingreso') {
    const fuente = m.base.modo === 'presupuesto_total' ? 'tu presupuesto del mes' : 'tu ingreso';
    return `Hoy manda ${fuente}: te deja ${formatearCOP(b.limite_ingreso ?? 0)} al día, y con lo que tienes en cuentas serían ${formatearCOP(b.limite_saldo ?? 0)}.`;
  }
  const cuentas = `${formatearCOP(b.saldo_inicio_hoy)} en tus cuentas${b.saldo_inicio_hoy !== b.saldo_liquido ? ' al empezar el día' : ''}`;
  const restas: string[] = [];
  if (b.minimos_pendientes > 0) restas.push(`${formatearCOP(b.minimos_pendientes)} de mínimos de deudas`);
  if (b.comprometido > 0) restas.push(`${formatearCOP(b.comprometido)} de fijos y suscripciones`);
  if (b.ahorro_pendiente > 0) restas.push(`${formatearCOP(b.ahorro_pendiente)} de ahorro`);
  if ((b.disponible_saldo ?? 0) <= 0) {
    const falta = b.minimos_pendientes + b.comprometido + b.ahorro_pendiente;
    return `Hoy mandan tus cuentas: ${cuentas} no alcanzan para los ${formatearCOP(falta)} que faltan por pagar ${b.hasta ? 'antes de tu próximo ingreso' : 'este mes'}.`;
  }
  // Con día de ingreso: la plata solo tiene que durar hasta el próximo ingreso (ese día incluido).
  const dias = b.hasta !== null && b.dias_hasta_ingreso !== null
    ? b.dias_hasta_ingreso === 1
      ? 'para hoy, que es el día de tu ingreso'
      : `entre ${b.dias_hasta_ingreso} días, hasta tu próximo ingreso el ${fechaLarga(b.hasta)}`
    : b.dias_restantes === 1 ? 'para hoy, que es el último día del mes' : `entre ${b.dias_restantes} días`;
  return `Hoy mandan tus cuentas: ${[cuentas, ...restas].join(' − ')}, ${dias}. Eso da ${formatearCOP(b.limite_saldo ?? 0)} al día.`;
}

/** «Te queda»: con día de ingreso, los días hasta el próximo ingreso (con la fecha); si no, los que faltan de mes, con hoy. */
function metaTeQueda(m: Metricas): string {
  const b = m.base_hoy;
  if (b.dias_hasta_ingreso !== null && b.hasta !== null) {
    return `${b.dias_hasta_ingreso} ${b.dias_hasta_ingreso === 1 ? 'día' : 'días'} hasta tu ingreso del ${fechaLarga(b.hasta)}`;
  }
  return `${m.dias_restantes} ${m.dias_restantes === 1 ? 'día' : 'días'} con hoy`;
}

export default async function Inicio() {
  const c = await contextoPanel();
  const { m, inst, hoy, mes } = c;
  const s = m.saldos;
  const falta = faltaConfigurar(c);
  const recs = ordenarRecomendaciones(evaluarReglas(inst, m)).slice(0, 3);
  const sinDatos = m.libre_hoy === null;
  const pasado = m.libre_hoy !== null && m.libre_hoy < 0;
  const nombres = new Map(inst.categorias.map((x) => [x.id, x.nombre]));

  // Ritmo del mes: lo gastado frente a lo disponible, y dónde «debería» ir según el día del mes.
  const vmes = m.base.disponible_variable;
  const pctGastado = vmes && vmes > 0 ? (m.gastado_mes / vmes) * 100 : null;
  const pctEsperado = (m.dia / m.dias_mes) * 100;

  const categorias = m.por_categoria.filter((x) => x.gastado > 0).sort((a, b) => b.gastado - a.gastado).slice(0, 6);
  const maxCat = Math.max(1, ...categorias.map((x) => x.gastado));

  const ultimos = inst.movimientos
    .filter((x) => x.sentido === 'salida' && x.computa)
    .sort((a, b) => (b.fecha + (b.hora ?? '')).localeCompare(a.fecha + (a.hora ?? '')) || b.id - a.id)
    .slice(0, 6);

  // «Lo que viene»: cobros de suscripciones y vencimientos de deudas, juntos y por fecha.
  const venc = vencimientos(inst.deudas, hoy);
  const proximos = [
    ...inst.recurrentes
      .filter((r) => r.activa && r.clase === 'suscripcion' && r.estado !== 'descartada' && r.proximo_cobro)
      .map((r) => ({ clave: `s${r.id}`, tipo: 'Suscripción' as const, nombre: r.nombre, fecha: r.proximo_cobro as string, monto: r.monto_tipico })),
    ...venc.map((v) => ({ clave: `d${v.deuda_id}`, tipo: 'Deuda' as const, nombre: v.nombre, fecha: v.fecha, monto: v.pago_minimo })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 6);

  const metas = inst.metas.filter((x) => x.estado === 'activa').slice(0, 3);

  const dias: DiaCalor[] = inst.dias.filter((d) => d.fecha.startsWith(mes) && d.fecha < hoy).map((d) => ({ fecha: d.fecha, gastado: d.gastado, limite: d.limite }));
  dias.push({ fecha: hoy, gastado: m.gastado_hoy, limite: m.limite_hoy });

  const pendientes = inst.sistema.por_revisar_pendientes;
  const sinSaldos = !s.hay_cuentas && !s.hay_deudas;
  const bh = m.base_hoy;
  const saldoViejo = bh.saldo_antiguo_dias !== null && bh.saldo_antiguo_dias > 7;
  // Si mandan las cuentas, el aviso de una base estimada («no sé tu ingreso…») ya no aplica.
  const avisoBase = bh.limita === 'saldo' ? null : m.base.aviso_modo;

  return (
    <Escena>
      <Cinta m={m} />
      <div className="pagina" style={{ paddingTop: 'var(--e-7)' }}>
        {(falta.ingreso || falta.presupuesto) && (
          <Tarjeta id="configurar" tono="listo" relleno="chico" data-testid="aviso-config" className="in-config" data-ent style={{ marginBottom: 'var(--e-5)' }}>
            <div className="in-venc-fila">
              <p>Falta {falta.ingreso && falta.presupuesto ? 'tu ingreso y tu presupuesto' : falta.ingreso ? 'tu ingreso mensual' : 'tu presupuesto total'}. {bh.hay_cuentas ? 'Mientras tanto, calculo con la plata de tus cuentas.' : 'Mientras tanto, las cifras son un estimado.'}</p>
              <BotonAsistente texto="Completarlo con el asistente" />
            </div>
          </Tarjeta>
        )}

        <section aria-labelledby="t-hoy" className="in-hero" data-tour="hoy">
          <div>
            <h1 id="t-hoy" data-ent>
              {sinDatos ? 'Todavía no sé cuánto puedes gastar' : pasado ? 'Hoy te pasaste en' : 'Hoy puedes gastar'}
            </h1>
            <p className="gigante" style={{ color: pasado ? 'var(--rojo)' : 'var(--texto)' }} data-ent data-testid="libre-hoy">
              {sinDatos ? <span>Falta tu ingreso</span> : <Cifra valor={Math.abs(m.libre_hoy as number)} formato="cop" duracion={1.1} />}
            </p>
            <p className="subtitulo" data-ent data-testid="razon-semaforo">
              {textoPanel(frases(m.semaforo_razon, avisoBase))}
            </p>
            {bh.hay_cuentas && bh.limita !== null && (
              <p className="in-base-hoy" data-ent data-testid="base-hoy">
                <Insignia tono={bh.limita === 'saldo' ? 'acento' : 'neutro'}>{bh.limita === 'saldo' ? 'Según tus cuentas' : 'Según tu ingreso'}</Insignia>
                <span>
                  {lineaBaseHoy(m)}
                  {bh.limita === 'saldo' && bh.saldo_liquido !== bh.saldo_anotado && ` Anotaste ${formatearCOP(bh.saldo_anotado)}; con lo que se movió después quedan ${formatearCOP(bh.saldo_liquido)}.`}
                </span>
              </p>
            )}
            {saldoViejo && (
              <Tarjeta tono="listo" relleno="chico" className="in-saldo-viejo" data-ent data-testid="saldo-antiguo">
                <div className="in-venc-fila">
                  <p>El saldo de «{bh.saldo_antiguo_cuenta}» lleva {bh.saldo_antiguo_dias} días sin actualizar, así que esta cifra puede no ser real.</p>
                  <Link href="/deudas" className="btn btn-chico">Actualizar saldo</Link>
                </div>
              </Tarjeta>
            )}
            <div className="in-acciones" data-ent>
              <Link href="/movimientos" className="btn btn-prim">Añadir un gasto</Link>
              <Link href="/simulador" className="btn">¿Puedo comprarlo?</Link>
            </div>
          </div>
          <div className="in-hero-lado" data-ent>
            <Semaforo estado={m.semaforo} />
            <div>
              <p className="etq">Puntaje de tus finanzas</p>
              <p className="grande num">{m.score.valor === null ? 'Sin calcular' : <Cifra valor={m.score.valor} formato="entero" />}</p>
              {m.score.nivel && <p className="suave">{{ solida: 'Sólida', bien: 'Bien, con ojo', apretada: 'Apretada', riesgo: 'En riesgo' }[m.score.nivel]}</p>}
              <p className="etq" style={{ marginTop: 'var(--e-2)' }}>Límite de hoy: <span className="num">{m.limite_hoy === null ? 'sin calcular' : formatearCOP(m.limite_hoy)}</span></p>
              <p className="etq">Ya gastaste hoy: <span className="num">{formatearCOP(m.gastado_hoy)}</span></p>
            </div>
          </div>
        </section>

        <section className="in-bloque" aria-labelledby="t-plata" data-tour="saldos">
          <div className="in-cab" data-ent>
            <h2 id="t-plata">Tu plata hoy</h2>
            <Link href="/deudas" className="in-enlace">Ver cuentas y deudas</Link>
          </div>
          {sinSaldos ? (
            <div data-ent>
              <Vacio
                titulo="Todavía no sé cuánta plata tienes"
                texto="Cuéntame cuánto hay en tus cuentas y en efectivo, y si debes algo. Con eso te digo cuánto te alcanza, qué pagar primero y cuándo vence cada cosa."
                accion={<BotonAsistente texto="Empezar con el asistente" />}
              />
            </div>
          ) : (
            <div className="in-plata">
              <Tarjeta className="in-saldo" tono="elevada" data-ent>
                {s.hay_cuentas ? (
                  <>
                    <Estadistica etiqueta="Saldo total" valor={s.saldo_total} tono="exito" meta={s.colchon_dias === null ? undefined : `Te alcanza para ${s.colchon_dias} ${s.colchon_dias === 1 ? 'día' : 'días'} de gasto`} />
                    <div className="in-neto">
                      <span className="etq">Patrimonio neto (saldo menos deudas)</span>
                      <span className="num" style={{ color: s.patrimonio_neto < 0 ? 'var(--rojo)' : 'var(--texto)' }}>{formatearCOP(s.patrimonio_neto)}</span>
                    </div>
                  </>
                ) : (
                  <Vacio titulo="Sin cuentas anotadas" texto="Anota lo que tienes en efectivo y en el banco para ver cuántos días te alcanza." accion={<Link href="/deudas" className="btn">Anotar saldo</Link>} />
                )}
              </Tarjeta>
              <Tarjeta className="in-deuda" tono={s.hay_deudas ? 'peligro' : 'base'} data-ent>
                {s.hay_deudas
                  ? <Estadistica etiqueta="Deuda total" valor={s.deuda_total} formato="corto" tono="peligro" tamano="normal" />
                  : <Estadistica etiqueta="Deuda total" valor={0} formato="corto" meta="Sin deudas anotadas" />}
              </Tarjeta>
              <Tarjeta className="in-minimos" data-ent>
                <Estadistica etiqueta="Pagos mínimos del mes" valor={s.minimos_mes} formato="corto" tono={s.minimos_mes > 0 ? 'listo' : 'base'} meta={s.hay_deudas ? 'Lo mínimo para no entrar en mora' : undefined} />
              </Tarjeta>
              <Tarjeta className="in-venc" tono={s.proximo_vencimiento && s.proximo_vencimiento.dias <= 3 ? 'listo' : 'base'} data-ent>
                <p className="etq">Próximo vencimiento</p>
                {s.proximo_vencimiento ? (
                  <div className="in-venc-fila">
                    <div>
                      <p className="in-venc-nombre">{s.proximo_vencimiento.nombre}</p>
                      <p className="meta">{formatearFechaCorta(s.proximo_vencimiento.fecha)}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p className="grande num">{formatearCOP(s.proximo_vencimiento.pago_minimo)}</p>
                      <Insignia tono={s.proximo_vencimiento.dias <= 3 ? 'aviso' : 'neutro'}>{cuando(s.proximo_vencimiento.dias)}</Insignia>
                    </div>
                  </div>
                ) : (
                  <p className="suave" style={{ marginTop: 'var(--e-2)' }}>{s.hay_deudas ? 'Tus deudas no tienen día de pago anotado.' : 'No tienes pagos de deuda por venir.'}</p>
                )}
              </Tarjeta>
            </div>
          )}
        </section>

        <section className="in-bloque in-dos a" aria-label="Ritmo y categorías" data-tour="ritmo">
          <Tarjeta como="article" data-ent>
            <div className="in-cab"><h2>Ritmo del mes</h2><Link href="/mes" className="in-enlace">Ver el mes</Link></div>
            <div className="in-ritmo-cifras">
              <Estadistica etiqueta="Llevas gastado" valor={m.gastado_mes} formato="corto" tamano="chica" />
              <Estadistica etiqueta="Te queda" valor={m.restante_mes ?? 0} formato="corto" tamano="chica" tono={m.restante_mes !== null && m.restante_mes < 0 ? 'peligro' : 'base'} meta={m.restante_mes === null ? 'Falta tu ingreso' : metaTeQueda(m)} />
              <Estadistica etiqueta="Proyección a fin de mes" valor={m.proyeccion_fin_mes} formato="corto" tamano="chica" tono={m.proyeccion_ratio !== null && m.proyeccion_ratio > 1 ? 'peligro' : 'base'} meta={m.proyeccion_ratio === null ? undefined : `${formatearPct(m.proyeccion_ratio)} de lo disponible`} />
            </div>
            {pctGastado === null ? (
              <p className="suave">Sin ingreso o presupuesto no puedo comparar tu ritmo. Con el asistente lo dejas listo en un minuto.</p>
            ) : (
              <>
                <BarraLlena pct={pctGastado} marca={pctEsperado} color={pctGastado > pctEsperado + 10 ? 'var(--ambar)' : 'var(--acento)'} etiqueta={`Llevas el ${Math.round(pctGastado)}% de lo disponible; a esta altura del mes tocaría el ${Math.round(pctEsperado)}%`} />
                <div className="in-ritmo-pie">
                  <span className="meta">Gastado: {Math.round(pctGastado)}% de {formatearCOP(vmes as number)}</span>
                  <span className="meta">La marca es el {Math.round(pctEsperado)}% del mes</span>
                </div>
              </>
            )}
          </Tarjeta>
          <Tarjeta como="article" data-ent>
            <div className="in-cab"><h2>Gasto por categoría</h2></div>
            {categorias.length === 0 ? (
              <p className="suave">Este mes todavía no hay gastos. Cuando entre el primero, aquí lo ves por categoría.</p>
            ) : (
              <div>
                {categorias.map((x) => {
                  const nombre = nombres.get(x.categoria_id) ?? x.categoria_id;
                  const pct = x.pct !== null ? x.pct * 100 : (x.gastado / maxCat) * 100;
                  const color = x.estado === 'pasado' ? 'var(--rojo)' : x.estado === 'cerca' ? 'var(--ambar)' : 'var(--acento)';
                  return (
                    <div key={x.categoria_id} className="in-cat">
                      <div className="in-cat-cab"><span>{nombre}</span><span className="num suave">{formatearCOP(x.gastado)}</span></div>
                      <BarraLlena pct={pct} marca={x.pct !== null ? 100 : undefined} color={color} etiqueta={`${nombre}: ${formatearCOP(x.gastado)}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </Tarjeta>
        </section>

        <section className="in-bloque in-dos b" aria-label="Movimientos y próximos pagos">
          <Tarjeta como="article" data-ent>
            <div className="in-cab"><h2>Últimos movimientos</h2><Link href="/movimientos" className="in-enlace">Ver todos</Link></div>
            {ultimos.length === 0 ? (
              <p className="suave">Aún no hay movimientos. Los avisos del banco o un gasto en efectivo aparecen aquí.</p>
            ) : (
              <ul className="in-lista" data-testid="inicio-movimientos">
                {ultimos.map((x) => (
                  <li key={x.id}>
                    <div className="quien"><p>{x.comercio}</p><p className="meta">{formatearFechaCorta(x.fecha)} · {nombres.get(x.categoria_id) ?? x.categoria_id}</p></div>
                    <p className="cuanto num">{formatearCOP(x.monto)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
          <Tarjeta como="article" data-ent>
            <div className="in-cab"><h2>Lo que viene</h2><Link href="/suscripciones" className="in-enlace">Suscripciones</Link></div>
            {proximos.length === 0 ? (
              <p className="suave">No hay cobros ni vencimientos próximos. Si tienes deudas, anota su día de pago para verlos aquí.</p>
            ) : (
              <ul className="in-lista" data-testid="inicio-proximos">
                {proximos.map((x) => (
                  <li key={x.clave}>
                    <div className="quien">
                      <p>{x.nombre}</p>
                      <p className="meta">{cuando(diasEntre(hoy, x.fecha))} · {formatearFechaCorta(x.fecha)}</p>
                    </div>
                    <div className="cuanto"><p className="num">{formatearCOP(x.monto)}</p><Insignia tono={x.tipo === 'Deuda' ? 'aviso' : 'neutro'}>{x.tipo}</Insignia></div>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </section>

        <section className="in-bloque in-dos a" aria-label="Recomendaciones y metas">
          <div>
            <div className="in-cab" data-ent><h2>Lo que te conviene mirar</h2><Link href="/recomendaciones" className="in-enlace">Ver todas</Link></div>
            {recs.length === 0 ? (
              <p className="suave" data-ent>Por ahora no hay nada que revisar. Cuando algo cambie en tus números, aparece aquí.</p>
            ) : (
              <div data-testid="inicio-recomendaciones">
                {recs.map((r, i) => (
                  <article key={r.id} className={`in-rec${i === 0 ? ' primera' : ''}`} data-ent>
                    <Insignia tono={SEVERIDAD[r.severidad].tono}>{SEVERIDAD[r.severidad].palabra}</Insignia>
                    <h3>{r.titulo}</h3>
                    <p className="in-porque"><b>Por qué</b>{r.detalle_con_cifras}</p>
                    {r.accion?.ruta_panel && <Link href={r.accion.ruta_panel} className="btn btn-chico" style={{ marginTop: 'var(--e-3)' }}>{r.accion.texto}</Link>}
                  </article>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 'var(--e-4)', alignContent: 'start' }}>
            <Tarjeta como="article" data-ent>
              <div className="in-cab"><h2>Metas</h2><Link href="/metas" className="in-enlace">Ver metas</Link></div>
              {metas.length === 0 ? (
                <p className="suave">Aún no tienes metas activas. Crea una para ver aquí cuánto llevas.</p>
              ) : (
                <div>
                  {metas.map((x) => {
                    const pct = Math.min(100, (x.aportado / x.objetivo) * 100);
                    return (
                      <div key={x.id} className="in-cat">
                        <div className="in-cat-cab"><span>{x.nombre}</span><span className="num suave">{Math.round(pct)}%</span></div>
                        <BarraLlena pct={pct} color="var(--acento)" etiqueta={`${x.nombre}: ${Math.round(pct)}% de la meta`} />
                        <p className="meta">{formatearCOP(x.aportado)} de {formatearCOP(x.objetivo)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Tarjeta>
            <Tarjeta como="article" tono={pendientes > 0 ? 'listo' : 'base'} relleno="chico" data-ent>
              <div className="in-venc-fila">
                <div>
                  <p className="etq">Por revisar</p>
                  <p>{pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'aviso espera' : 'avisos esperan'} tu revisión` : 'Nada pendiente por revisar'}</p>
                </div>
                {pendientes > 0 && <Link href="/sistema" className="btn btn-chico">Revisar</Link>}
              </div>
            </Tarjeta>
          </div>
        </section>

        <section className="in-bloque in-dos c" aria-labelledby="t-cal">
          <div>
            <div className="in-cab" data-ent><h2 id="t-cal">Calendario de gasto</h2><Link href="/mes" className="in-enlace">Ver el mes</Link></div>
            <Tarjeta relleno="ninguno" className="in-cal" data-ent style={{ paddingBlock: 'var(--e-4)' }}>
              <Calendario mes={mes} dias={dias} hoy={hoy} />
            </Tarjeta>
          </div>
          <div style={{ display: 'grid', gap: 'var(--e-4)', alignContent: 'start' }}>
            <Tarjeta como="article" data-ent>
              <Estadistica etiqueta="Racha bajo el límite" valor={m.racha.dias} formato="entero" tono={m.racha.dias > 0 ? 'listo' : 'base'} meta={`Récord: ${m.racha.record} ${m.racha.record === 1 ? 'día' : 'días'}`} />
            </Tarjeta>
            <Tarjeta como="article" data-ent>
              <Estadistica etiqueta="Gastos hormiga este mes" valor={m.hormiga.total} formato="corto" meta={`${m.hormiga.cantidad} compras chicas; a este ritmo, ${formatearCOP(m.hormiga.proyeccion_anual)} al año`} />
            </Tarjeta>
          </div>
        </section>

        <div className="in-nota" data-ent><NotaAsesoria /></div>
      </div>
    </Escena>
  );
}
