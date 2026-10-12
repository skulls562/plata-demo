'use client';
// Cuentas y deudas editables, resumen de mínimos y comparación avalancha / bola de nieve con un pago mensual simulable.
// Los cálculos del plan se hacen aquí mismo con el motor puro de src/lib/deudas.ts (sin ir al servidor en cada tecla).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampoPesos } from '@/components/CampoPesos';
import { BotonAsistente } from '@/components/inicio/BotonAsistente';
import { llamar } from '@/components/llamar';
import { Campo, CampoSelect, Estadistica, Hoja, Insignia, Tarjeta, Vacio } from '@/components/ui';
import { compararPlanes, mesesLegible, NOTA_ASESORIA, simularSoloMinimo, tasaLegible } from '@/lib/deudas';
import { formatearCOP, formatearFechaCorta } from '@/lib/formato';
import type { Cuenta, Deuda, EstrategiaDeudas, PlanDeudas, ProximoVencimiento, ResumenSaldos, TipoCuenta, TipoDeuda } from '@/lib/tipos';

const TIPO_CUENTA: Record<TipoCuenta, string> = { efectivo: 'Efectivo', banco: 'Banco', ahorro: 'Ahorro' };
const TIPO_DEUDA: Record<TipoDeuda, string> = { tarjeta: 'Tarjeta', prestamo: 'Préstamo', otra: 'Otra' };
const NOMBRE_ESTRATEGIA: Record<EstrategiaDeudas, string> = { avalancha: 'Avalancha', bola_nieve: 'Bola de nieve' };
const EXPLICA: Record<EstrategiaDeudas, string> = {
  avalancha: 'Pagas primero la deuda con la tasa más alta. Es la que menos intereses cuesta.',
  bola_nieve: 'Pagas primero la deuda más pequeña. Cierras deudas pronto y eso motiva, aunque paga algo más de intereses.',
};

const aTasa = (s: string): number => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const aDia = (s: string): number | null => { const n = parseInt(s, 10); return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null; };

function cuando(dias: number): string {
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return `En ${dias} días`;
}

type Edicion = { tipo: 'cuenta'; item: Cuenta | null } | { tipo: 'deuda'; item: Deuda | null } | null;

export function DeudasUI({ cuentas, deudas, resumen, vencimientos, estrategia, pagoConfig }: {
  cuentas: Cuenta[]; deudas: Deuda[]; resumen: ResumenSaldos; vencimientos: ProximoVencimiento[]; estrategia: EstrategiaDeudas; pagoConfig: number | null;
}) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<Edicion>(null);
  const activas = deudas.filter((d) => d.activa);
  const archivadas = deudas.filter((d) => !d.activa);
  const vivas = activas.filter((d) => d.saldo > 0);
  const [pago, setPago] = useState<number | null>(pagoConfig);
  const [msg, setMsg] = useState<string | null>(null);
  const [errorCfg, setErrorCfg] = useState<string | null>(null);

  const comparacion = vivas.length ? compararPlanes(vivas, pago) : null;
  const pagoEfectivo = comparacion?.avalancha.pago_mensual ?? 0;
  const pagoBajo = pago !== null && comparacion !== null && pago < pagoEfectivo;

  async function guardarConfig(clave: 'estrategia_deudas' | 'pago_deudas_mensual', valor: unknown, aviso: string) {
    setMsg(null);
    setErrorCfg(null);
    const r = await llamar('/api/config', 'PATCH', { clave, valor });
    if (!r.ok) { setErrorCfg(r.mensaje); return; }
    setMsg(aviso);
    router.refresh();
  }

  async function reactivar(d: Deuda) {
    const r = await llamar(`/api/deudas/${d.id}`, 'PATCH', { activa: true });
    if (!r.ok) setErrorCfg(r.mensaje); else router.refresh();
  }

  const sinNada = cuentas.length === 0 && deudas.length === 0;

  return (
    <>
      {sinNada ? (
        <div data-ent>
          <Vacio
            titulo="Aquí vas a ver tu plata y tus deudas"
            texto="Anota lo que tienes en cada cuenta y lo que debes. Con eso calculo cuánto te alcanza, qué pagar primero y cuánto te ahorras en intereses."
            accion={<div style={{ display: 'flex', gap: 'var(--e-3)', flexWrap: 'wrap' }}><BotonAsistente texto="Empezar con el asistente" /><button type="button" className="btn" onClick={() => setEdicion({ tipo: 'cuenta', item: null })}>Añadir una cuenta</button></div>}
          />
        </div>
      ) : (
        <section className="de-resumen" aria-label="Resumen de saldos y deudas" data-testid="resumen-deudas">
          <Tarjeta tono="elevada" className="de-saldo" data-ent>
            <Estadistica etiqueta="Saldo total" valor={resumen.saldo_total} tono="exito" meta={resumen.colchon_dias === null ? undefined : `Te alcanza para ${resumen.colchon_dias} ${resumen.colchon_dias === 1 ? 'día' : 'días'} de gasto`} />
          </Tarjeta>
          <Tarjeta tono={resumen.hay_deudas ? 'peligro' : 'base'} className="de-deuda" data-ent>
            <Estadistica etiqueta="Deuda total" valor={resumen.deuda_total} formato="corto" tono={resumen.hay_deudas ? 'peligro' : 'base'} meta={resumen.hay_deudas ? undefined : 'Sin deudas anotadas'} />
          </Tarjeta>
          <Tarjeta className="de-minimos" data-ent>
            <Estadistica etiqueta="Pagos mínimos del mes" valor={resumen.minimos_mes} formato="corto" tono={resumen.minimos_mes > 0 ? 'listo' : 'base'} />
          </Tarjeta>
          <Tarjeta className="de-venc" tono={resumen.proximo_vencimiento && resumen.proximo_vencimiento.dias <= 3 ? 'listo' : 'base'} data-ent>
            <p className="etq">Próximo vencimiento</p>
            {resumen.proximo_vencimiento ? (
              <div className="de-venc-fila">
                <div>
                  <p className="de-venc-nombre">{resumen.proximo_vencimiento.nombre}</p>
                  <p className="meta">{formatearFechaCorta(resumen.proximo_vencimiento.fecha)} · {cuando(resumen.proximo_vencimiento.dias)}</p>
                </div>
                <p className="grande num">{formatearCOP(resumen.proximo_vencimiento.pago_minimo)}</p>
              </div>
            ) : (
              <p className="suave" style={{ marginTop: 'var(--e-2)' }}>{resumen.hay_deudas ? 'Ninguna deuda tiene día de pago anotado. Edítalas para ver cuándo vence cada una.' : 'No tienes pagos de deuda por venir.'}</p>
            )}
            {vencimientos.length > 1 && <p className="meta" style={{ marginTop: 'var(--e-3)' }}>Después: {vencimientos.slice(1, 4).map((v) => `${v.nombre} (${formatearFechaCorta(v.fecha)})`).join(', ')}</p>}
          </Tarjeta>
        </section>
      )}

      <div className="de-bloque de-dos">
        <section aria-labelledby="t-cuentas">
          <div className="de-cab" data-ent>
            <h2 id="t-cuentas">Cuentas</h2>
            <button type="button" className="btn btn-chico" onClick={() => setEdicion({ tipo: 'cuenta', item: null })}>Añadir cuenta</button>
          </div>
          {cuentas.length === 0 ? (
            <p className="suave" data-ent>Todavía no hay cuentas. Anota tu efectivo y tus cuentas del banco.</p>
          ) : (
            <Tarjeta relleno="chico" data-ent data-testid="lista-cuentas">
              {cuentas.map((c) => (
                <div key={c.id} className="de-fila">
                  <div className="de-fila-cab">
                    <div>
                      <p className="de-fila-nombre">{c.nombre} <Insignia>{TIPO_CUENTA[c.tipo]}</Insignia></p>
                      <p className="grande num" style={{ marginTop: 'var(--e-2)' }}>{formatearCOP(c.saldo)}</p>
                    </div>
                    <button type="button" className="btn btn-chico" onClick={() => setEdicion({ tipo: 'cuenta', item: c })} aria-label={`Editar la cuenta ${c.nombre}`}>Editar</button>
                  </div>
                </div>
              ))}
            </Tarjeta>
          )}
        </section>

        <section aria-labelledby="t-deudas">
          <div className="de-cab" data-ent>
            <h2 id="t-deudas">Deudas</h2>
            <button type="button" className="btn btn-chico" onClick={() => setEdicion({ tipo: 'deuda', item: null })}>Añadir deuda</button>
          </div>
          {activas.length === 0 ? (
            <p className="suave" data-ent>No tienes deudas anotadas. Si debes una tarjeta o un préstamo, añádela para ver su plan de pago.</p>
          ) : (
            <Tarjeta relleno="chico" data-ent data-testid="lista-deudas">
              {activas.map((d) => {
                const sm = simularSoloMinimo(d);
                return (
                  <div key={d.id} className="de-fila">
                    <div className="de-fila-cab">
                      <p className="de-fila-nombre">{d.nombre} <Insignia tono="aviso">{TIPO_DEUDA[d.tipo]}</Insignia></p>
                      <div className="de-acciones">
                        <button type="button" className="btn btn-chico" onClick={() => setEdicion({ tipo: 'deuda', item: d })} aria-label={`Editar la deuda ${d.nombre}`}>Editar</button>
                      </div>
                    </div>
                    <div className="de-datos">
                      <div><p className="etq">Debes</p><p className="num grande" style={{ fontSize: 'var(--t-xl)' }}>{formatearCOP(d.saldo)}</p></div>
                      <div><p className="etq">Tasa E.A.</p><p className="num">{d.tasa_ea > 0 ? tasaLegible(d.tasa_ea) : 'Sin intereses'}</p></div>
                      <div><p className="etq">Pago mínimo</p><p className="num">{formatearCOP(d.pago_minimo)}</p></div>
                      <div><p className="etq">Día de pago</p><p className="num">{d.dia_pago ?? 'Sin anotar'}</p></div>
                    </div>
                    {d.saldo > 0 && (
                      sm.se_paga && sm.meses !== null ? (
                        <p className="de-aviso" data-tono="ok">Pagando solo el mínimo la terminas en {mesesLegible(sm.meses)} y pagas {formatearCOP(sm.intereses ?? 0)} de intereses.</p>
                      ) : (
                        <p className="de-aviso">Con solo el mínimo no se paga: los intereses del primer mes son {formatearCOP(sm.interes_primer_mes)} y tu mínimo no los cubre. Conviene pagar más que el mínimo.</p>
                      )
                    )}
                  </div>
                );
              })}
            </Tarjeta>
          )}
          {archivadas.length > 0 && (
            <details style={{ marginTop: 'var(--e-4)' }}>
              <summary className="btn btn-chico" style={{ display: 'inline-flex' }}>Archivadas ({archivadas.length})</summary>
              <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--e-3)' }}>
                {archivadas.map((d) => (
                  <li key={d.id} className="de-fila-cab" style={{ padding: 'var(--e-2) 0' }}>
                    <span className="suave">{d.nombre} · {formatearCOP(d.saldo)}</span>
                    <button type="button" className="btn btn-chico" onClick={() => reactivar(d)}>Reactivar</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>

      <section className="de-bloque" aria-labelledby="t-plan" data-testid="plan-deudas">
        <div className="de-cab" data-ent><h2 id="t-plan">Plan de pago: avalancha o bola de nieve</h2></div>
        {!comparacion ? (
          <Vacio titulo="Sin deudas para planear" texto="Cuando anotes una deuda con su saldo, su tasa y su pago mínimo, aquí comparo las dos formas de pagarla." />
        ) : (
          <>
            <Tarjeta data-ent>
              <div className="de-simula">
                <CampoPesos
                  etiqueta="Pago mensual a deudas" valor={pago} onCambio={setPago}
                  ayuda={`Mínimo posible: ${formatearCOP(resumen.minimos_mes)} (la suma de los mínimos). Todo lo que pongas encima acelera el plan.`}
                />
                <div className="de-acciones">
                  <button type="button" className="btn" onClick={() => setPago(null)}>Solo mínimos</button>
                  <button type="button" className="btn btn-prim" disabled={pago === null || pago === pagoConfig} onClick={() => guardarConfig('pago_deudas_mensual', pago, 'Guardé tu pago mensual a deudas.')}>Guardar este pago</button>
                </div>
              </div>
              {pagoBajo && <p className="de-aviso" style={{ marginTop: 'var(--e-3)' }}>Ese pago es menor que la suma de tus mínimos; calculé el plan con {formatearCOP(pagoEfectivo)}.</p>}
              {msg && <p role="status" className="ok-campo" style={{ marginTop: 'var(--e-3)' }}>{msg}</p>}
              {errorCfg && <p role="alert" className="error-campo" style={{ marginTop: 'var(--e-3)' }}>{errorCfg}</p>}
            </Tarjeta>

            <div className="de-planes">
              {(['avalancha', 'bola_nieve'] as const).map((e) => (
                <PlanTarjeta key={e} estrategia={e} plan={comparacion[e]} recomendada={comparacion.recomendada === e} elegida={estrategia === e} onElegir={() => guardarConfig('estrategia_deudas', e, `Quedó «${NOMBRE_ESTRATEGIA[e]}» como tu estrategia.`)} />
              ))}
            </div>

            <p className="de-ahorro suave" data-ent data-testid="ahorro-intereses">
              {comparacion.ahorro_intereses === null
                ? 'Con ese pago alguna de las dos formas no alcanza a pagar las deudas en 50 años; sube el pago para comparar.'
                : comparacion.ahorro_intereses > 0
                  ? `La avalancha te ahorra ${formatearCOP(comparacion.ahorro_intereses)} en intereses frente a la bola de nieve.`
                  : 'Con tus deudas, las dos formas cuestan lo mismo en intereses.'}
            </p>
          </>
        )}
      </section>

      <p className="nota-asesoria de-nota" data-ent data-testid="nota-deudas">{NOTA_ASESORIA}</p>

      <FormularioEdicion edicion={edicion} onCerrar={() => setEdicion(null)} onGuardado={() => { setEdicion(null); router.refresh(); }} />
    </>
  );
}

function PlanTarjeta({ estrategia, plan, recomendada, elegida, onElegir }: { estrategia: EstrategiaDeudas; plan: PlanDeudas; recomendada: boolean; elegida: boolean; onElegir: () => void }) {
  return (
    <Tarjeta como="article" tono={recomendada ? 'acento' : 'base'} className="de-plan" data-ent data-testid={`plan-${estrategia}`}>
      <div className="de-plan-cab">
        <h3>{NOMBRE_ESTRATEGIA[estrategia]}</h3>
        <span style={{ display: 'flex', gap: 'var(--e-2)', flexWrap: 'wrap' }}>
          {recomendada && <Insignia tono="listo">Recomendada</Insignia>}
          {elegida && <Insignia tono="acento">Tu estrategia</Insignia>}
        </span>
      </div>
      <p className="suave" style={{ marginBottom: 'var(--e-4)' }}>{EXPLICA[estrategia]}</p>
      {plan.se_paga && plan.meses !== null ? (
        <div style={{ display: 'grid', gap: 'var(--e-4)', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div><p className="etq">Sales de deudas en</p><p className="grande" style={{ fontSize: 'var(--t-xl)' }} data-testid={`meses-${estrategia}`}>{mesesLegible(plan.meses)}</p></div>
          <div><p className="etq">Intereses totales</p><p className="grande num" style={{ fontSize: 'var(--t-xl)' }} data-testid={`intereses-${estrategia}`}>{formatearCOP(plan.intereses ?? 0)}</p></div>
        </div>
      ) : (
        <p className="de-aviso">Con {formatearCOP(plan.pago_mensual)} al mes no se paga en 50 años. Sube el pago mensual.</p>
      )}
      <ol>
        {plan.orden.map((o) => <li key={o.deuda_id}>{o.nombre}{o.mes_pagada ? ` — lista en ${mesesLegible(o.mes_pagada)}` : ''}</li>)}
      </ol>
      {!elegida && <button type="button" className="btn btn-chico" style={{ marginTop: 'var(--e-4)' }} onClick={onElegir}>Usar {NOMBRE_ESTRATEGIA[estrategia].toLowerCase()}</button>}
    </Tarjeta>
  );
}

function FormularioEdicion({ edicion, onCerrar, onGuardado }: { edicion: Edicion; onCerrar: () => void; onGuardado: () => void }) {
  // El formulario se monta de nuevo en cada apertura (clave por tipo y registro) para partir siempre del valor guardado.
  const clave = edicion ? `${edicion.tipo}-${edicion.item?.id ?? 'nuevo'}` : 'cerrado';
  return edicion ? <Formulario key={clave} edicion={edicion} onCerrar={onCerrar} onGuardado={onGuardado} /> : null;
}

function Formulario({ edicion, onCerrar, onGuardado }: { edicion: NonNullable<Edicion>; onCerrar: () => void; onGuardado: () => void }) {
  const esCuenta = edicion.tipo === 'cuenta';
  const cuenta = esCuenta ? edicion.item as Cuenta | null : null;
  const deuda = !esCuenta ? edicion.item as Deuda | null : null;
  const [nombre, setNombre] = useState((cuenta ?? deuda)?.nombre ?? '');
  const [tipoC, setTipoC] = useState<TipoCuenta>(cuenta?.tipo ?? 'banco');
  const [tipoD, setTipoD] = useState<TipoDeuda>(deuda?.tipo ?? 'tarjeta');
  const [saldo, setSaldo] = useState<number | null>((cuenta ?? deuda)?.saldo ?? null);
  const [tasa, setTasa] = useState(deuda?.tasa_ea ? String(deuda.tasa_ea).replace('.', ',') : '');
  const [minimo, setMinimo] = useState<number | null>(deuda?.pago_minimo ?? null);
  const [dia, setDia] = useState(deuda?.dia_pago ? String(deuda.dia_pago) : '');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const item = edicion.item;
  const idForm = 'form-deudas';

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError('Ponle un nombre.');
    if (saldo === null) return setError(esCuenta ? 'Escribe cuánto hay en la cuenta (puede ser 0).' : 'Escribe cuánto debes (puede ser 0).');
    if (!esCuenta && dia && aDia(dia) === null) return setError('El día de pago va de 1 a 31.');
    setOcupado(true);
    const base = '/api/' + (esCuenta ? 'cuentas' : 'deudas');
    const cuerpo = esCuenta
      ? { nombre: nombre.trim(), tipo: tipoC, saldo }
      : { nombre: nombre.trim(), tipo: tipoD, saldo, tasa_ea: aTasa(tasa), pago_minimo: minimo ?? 0, dia_pago: aDia(dia) };
    const r = item ? await llamar(`${base}/${item.id}`, 'PATCH', cuerpo) : await llamar(base, 'POST', cuerpo);
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    onGuardado();
  }

  async function quitar() {
    if (!item) return;
    setOcupado(true);
    const r = await llamar(`/api/${esCuenta ? 'cuentas' : 'deudas'}/${item.id}`, 'DELETE');
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    onGuardado();
  }

  const titulo = `${item ? 'Editar' : 'Añadir'} ${esCuenta ? 'cuenta' : 'deuda'}`;
  return (
    <Hoja
      abierto onCerrar={onCerrar} titulo={titulo}
      descripcion={esCuenta ? 'Lo que tienes hoy en efectivo, en el banco o ahorrado.' : 'Con el saldo, la tasa y el pago mínimo calculo cuánto tardas y cuánto pagas de intereses.'}
      pie={
        <>
          {item && !confirmando && <button type="button" className="btn btn-peligro" onClick={() => setConfirmando(true)} disabled={ocupado}>{esCuenta ? 'Borrar cuenta' : 'Archivar deuda'}</button>}
          {item && confirmando && <button type="button" className="btn btn-peligro" onClick={quitar} disabled={ocupado}>{esCuenta ? 'Sí, borrar' : 'Sí, archivar'}</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="submit" form={idForm} className="btn btn-prim" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </>
      }
    >
      <form id={idForm} className="de-form" onSubmit={enviar} noValidate>
        <Campo etiqueta="Nombre" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} placeholder={esCuenta ? 'Ej. Nequi' : 'Ej. Tarjeta Visa'} />
        {esCuenta ? (
          <CampoSelect etiqueta="Tipo" value={tipoC} onChange={(e) => setTipoC(e.target.value as TipoCuenta)}>
            <option value="efectivo">Efectivo</option><option value="banco">Banco</option><option value="ahorro">Ahorro</option>
          </CampoSelect>
        ) : (
          <CampoSelect etiqueta="Tipo" value={tipoD} onChange={(e) => setTipoD(e.target.value as TipoDeuda)}>
            <option value="tarjeta">Tarjeta</option><option value="prestamo">Préstamo</option><option value="otra">Otra</option>
          </CampoSelect>
        )}
        <CampoPesos etiqueta={esCuenta ? 'Saldo' : 'Cuánto debes'} valor={saldo} onCambio={setSaldo} />
        {!esCuenta && (
          <>
            <div className="de-form-doble">
              <Campo etiqueta="Tasa E.A. (%)" inputMode="decimal" placeholder="28,5" value={tasa} ayuda="Si no tiene intereses, déjala en blanco." onChange={(e) => setTasa(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} />
              <Campo etiqueta="Día de pago" inputMode="numeric" placeholder="1 a 31" value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </div>
            <CampoPesos etiqueta="Pago mínimo al mes" valor={minimo} onCambio={setMinimo} />
          </>
        )}
        {confirmando && <p className="suave">{esCuenta ? 'La cuenta se borra del todo.' : 'La deuda sale de los cálculos; la puedes reactivar desde «Archivadas».'}</p>}
        {error && <p role="alert" className="error-campo">{error}</p>}
      </form>
    </Hoja>
  );
}
