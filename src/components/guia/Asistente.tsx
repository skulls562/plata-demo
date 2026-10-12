'use client';
// Asistente de bienvenida: cuánta plata hay → qué deudas hay (se puede omitir) → ingreso, ahorro y tope → primer plan.
// Todo se guarda al terminar el paso 3 (cuentas, deudas, ingreso, ahorro y presupuesto '*'); si falla a medias, se puede
// reintentar sin duplicar: lo ya creado se recuerda con su id y se edita en vez de crearse otra vez.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CampoPesos } from '../CampoPesos';
import { llamar } from '../llamar';
import { Campo, CampoSelect, Dialogo, Estadistica, Tarjeta } from '../ui';
import { compararPlanes, mesesLegible, minimosMes, NOTA_ASESORIA, tasaLegible } from '@/lib/deudas';
import { formatearCOP } from '@/lib/formato';
import type { ConfigPlata, Cuenta, Deuda, FuenteLimite, Metricas, TipoCuenta, TipoDeuda } from '@/lib/tipos';
import './guia.css';

interface FilaCuenta { clave: string; id: number | null; nombre: string; tipo: TipoCuenta; saldo: number | null }
interface FilaDeuda { clave: string; id: number | null; nombre: string; tipo: TipoDeuda; saldo: number | null; tasa: string; minimo: number | null; dia: string }

let contador = 0;
const nuevaClave = () => `f${++contador}`;
const cuentaVacia = (nombre = '', tipo: TipoCuenta = 'banco'): FilaCuenta => ({ clave: nuevaClave(), id: null, nombre, tipo, saldo: null });
const deudaVacia = (): FilaDeuda => ({ clave: nuevaClave(), id: null, nombre: '', tipo: 'tarjeta', saldo: null, tasa: '', minimo: null, dia: '' });

const aTasa = (s: string): number => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const aDia = (s: string): number | null => { const n = parseInt(s, 10); return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null; };

const TITULOS = ['¿Con cuánta plata cuentas hoy?', '¿Qué deudas tienes?', 'Tu ingreso y cuánto quieres gastar', 'Este es tu primer plan'];

export function Asistente({ onCerrar }: { onCerrar: (terminado: boolean) => void }) {
  const router = useRouter();
  const [paso, setPaso] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuentas, setCuentas] = useState<FilaCuenta[]>([cuentaVacia('Efectivo', 'efectivo'), cuentaVacia('Cuenta principal', 'banco')]);
  const [deudas, setDeudas] = useState<FilaDeuda[]>([deudaVacia()]);
  const [ingreso, setIngreso] = useState<number | null>(null);
  const [diaIngreso, setDiaIngreso] = useState('');
  const [ahorro, setAhorro] = useState('10');
  const [tope, setTope] = useState<number | null>(null);
  // Lo que calculó el motor tras guardar: cuánto puede gastar hoy, qué fuente manda y si limita un tope '*' guardado.
  const [resultado, setResultado] = useState<{ libre: number | null; limita: FuenteLimite | null; topeSiempre: number | null } | null>(null);

  // Si ya hay datos (el asistente se reabre desde «Tutorial»), se parte de ellos para editarlos y no duplicarlos.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [rc, rd, rcfg, rp] = await Promise.all([
        llamar<{ items: Cuenta[] }>('/api/cuentas', 'GET'),
        llamar<{ items: Deuda[] }>('/api/deudas', 'GET'),
        llamar<ConfigPlata>('/api/config', 'GET'),
        llamar<{ total: { monto: number } | null }>('/api/presupuestos', 'GET'),
      ]);
      if (!vivo) return;
      if (rc.ok && rc.datos.items.length) setCuentas(rc.datos.items.map((c) => ({ clave: nuevaClave(), id: c.id, nombre: c.nombre, tipo: c.tipo, saldo: c.saldo })));
      if (rd.ok && rd.datos.items.length) setDeudas(rd.datos.items.filter((d) => d.activa).map((d) => ({ clave: nuevaClave(), id: d.id, nombre: d.nombre, tipo: d.tipo, saldo: d.saldo, tasa: d.tasa_ea ? String(d.tasa_ea).replace('.', ',') : '', minimo: d.pago_minimo, dia: d.dia_pago ? String(d.dia_pago) : '' })));
      if (rcfg.ok) {
        setIngreso(rcfg.datos.ingreso_mensual);
        setDiaIngreso(rcfg.datos.dia_ingreso ? String(rcfg.datos.dia_ingreso) : '');
        setAhorro(String(rcfg.datos.pct_ahorro));
      }
      if (rp.ok && rp.datos.total) setTope(rp.datos.total.monto);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, []);

  const cuentasUsadas = cuentas.filter((c) => c.saldo !== null);
  const deudasUsadas = deudas.filter((d) => d.saldo !== null || d.nombre.trim() !== '' || d.minimo !== null);

  function validarCuentas(): string | null {
    for (const c of cuentasUsadas) if (!c.nombre.trim()) return 'Ponle nombre a cada cuenta que tenga saldo.';
    return null;
  }
  function validarDeudas(): string | null {
    for (const d of deudasUsadas) {
      if (!d.nombre.trim()) return 'Ponle nombre a cada deuda.';
      if (d.saldo === null) return `Falta cuánto debes en «${d.nombre.trim()}».`;
      if (d.dia && aDia(d.dia) === null) return `El día de pago de «${d.nombre.trim()}» va de 1 a 31.`;
    }
    return null;
  }

  function siguiente() {
    const msg = paso === 0 ? validarCuentas() : paso === 1 ? validarDeudas() : null;
    setError(msg);
    if (!msg) setPaso(paso + 1);
  }

  /** Pide al motor cómo quedó «hoy puedes gastar» y si un tope '*' (para todos los meses) es lo que lo limita. */
  async function leerResultado() {
    const [rm, rp] = await Promise.all([
      llamar<Metricas>('/api/metricas', 'GET'),
      llamar<{ total: { monto: number; origen: 'mes' | 'siempre' } | null }>('/api/presupuestos', 'GET'),
    ]);
    if (!rm.ok) { setResultado(null); return; }
    const m = rm.datos;
    const total = rp.ok ? rp.datos.total : null;
    const topeLimita = total !== null && total.origen === 'siempre' && m.base.modo === 'presupuesto_total'
      && m.base.disponible_variable === total.monto && m.base_hoy.limita === 'ingreso';
    setResultado({ libre: m.libre_hoy, limita: m.base_hoy.limita, topeSiempre: topeLimita ? total.monto : null });
  }

  async function quitarTope() {
    setError(null);
    const r = await llamar('/api/presupuestos', 'PUT', { mes: '*', categoria_id: '*', monto: null });
    if (!r.ok) { setError(r.mensaje); return; }
    setTope(null);
    await leerResultado();
    router.refresh();
  }

  async function guardar() {
    if (diaIngreso && aDia(diaIngreso) === null) { setError('El día en que te entra la plata va de 1 a 31.'); return; }
    setError(null);
    setGuardando(true);
    // Si algo falla a medias, lo que sí quedó guardado ya cambia las cifras: Inicio se refresca igual.
    let guardoAlgo = false;
    const fallo = (mensaje: string) => { setGuardando(false); setError(mensaje); if (guardoAlgo) router.refresh(); };
    // 1. Cuentas
    const cs = [...cuentas];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.saldo === null) continue;
      const cuerpo = { nombre: c.nombre.trim(), tipo: c.tipo, saldo: c.saldo };
      const r = c.id ? await llamar<Cuenta>(`/api/cuentas/${c.id}`, 'PATCH', cuerpo) : await llamar<Cuenta>('/api/cuentas', 'POST', cuerpo);
      if (!r.ok) { setCuentas(cs); fallo(r.mensaje); return; }
      guardoAlgo = true;
      cs[i] = { ...c, id: r.datos.id };
    }
    setCuentas(cs);
    // 2. Deudas
    const ds = [...deudas];
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (!deudasUsadas.includes(deudas[i])) continue;
      const cuerpo = { nombre: d.nombre.trim(), tipo: d.tipo, saldo: d.saldo ?? 0, tasa_ea: aTasa(d.tasa), pago_minimo: d.minimo ?? 0, dia_pago: aDia(d.dia) };
      const r = d.id ? await llamar<Deuda>(`/api/deudas/${d.id}`, 'PATCH', cuerpo) : await llamar<Deuda>('/api/deudas', 'POST', cuerpo);
      if (!r.ok) { setDeudas(ds); fallo(r.mensaje); return; }
      guardoAlgo = true;
      ds[i] = { ...d, id: r.datos.id };
    }
    setDeudas(ds);
    // 3. Ingreso, ahorro y presupuesto (lo mismo que guardaba el Onboarding anterior)
    const pasos: [string, 'PATCH' | 'PUT', unknown][] = [];
    if (ingreso) pasos.push(['/api/config', 'PATCH', { clave: 'ingreso_mensual', valor: ingreso }]);
    // Vacío = ingreso irregular (null): Plata reparte la plata hasta fin de mes.
    pasos.push(['/api/config', 'PATCH', { clave: 'dia_ingreso', valor: aDia(diaIngreso) }]);
    pasos.push(['/api/config', 'PATCH', { clave: 'pct_ahorro', valor: Number(ahorro) || 0 }]);
    if (tope) pasos.push(['/api/presupuestos', 'PUT', { mes: '*', categoria_id: '*', monto: tope }]);
    for (const [ruta, metodo, cuerpo] of pasos) {
      const r = await llamar(ruta, metodo, cuerpo);
      if (!r.ok) { fallo(r.mensaje); return; }
      guardoAlgo = true;
    }
    await leerResultado();
    setGuardando(false);
    setPaso(3);
    router.refresh();
  }

  const act = <T extends { clave: string }>(lista: T[], set: (l: T[]) => void, clave: string, cambios: Partial<T>) =>
    set(lista.map((x) => (x.clave === clave ? { ...x, ...cambios } : x)));

  // ---- Resumen (paso 4): cifras de lo que se acaba de guardar y el plan que propone el motor de deudas ----
  const saldoTotal = cuentasUsadas.reduce((s, c) => s + (c.saldo ?? 0), 0);
  const deudasMotor: Deuda[] = deudasUsadas.filter((d) => (d.saldo ?? 0) > 0).map((d, i) => ({
    id: i + 1, nombre: d.nombre.trim(), tipo: d.tipo, saldo: d.saldo ?? 0, tasa_ea: aTasa(d.tasa), pago_minimo: d.minimo ?? 0, dia_pago: aDia(d.dia), activa: true, creado_en: '', actualizado_en: '',
  }));
  const deudaTotal = deudasMotor.reduce((s, d) => s + d.saldo, 0);
  const comparacion = paso === 3 && deudasMotor.length ? compararPlanes(deudasMotor, null) : null;
  const plan = comparacion ? comparacion[comparacion.recomendada] : null;

  let pie;
  if (paso === 3) {
    pie = <button type="button" className="btn btn-prim" onClick={() => onCerrar(true)}>Ir a mi Inicio</button>;
  } else {
    pie = (
      <>
        {paso > 0 && <button type="button" className="btn" onClick={() => { setError(null); setPaso(paso - 1); }} disabled={guardando}>Atrás</button>}
        {paso === 1 && <button type="button" className="btn" onClick={() => { setDeudas([deudaVacia()]); setError(null); setPaso(2); }}>No tengo deudas</button>}
        {paso < 2 && <button type="button" className="btn btn-prim" onClick={siguiente} disabled={cargando}>Siguiente</button>}
        {paso === 2 && <button type="button" className="btn btn-prim" onClick={guardar} disabled={guardando || (!ingreso && !tope && !cuentasUsadas.length && !deudasUsadas.length)}>{guardando ? 'Guardando…' : 'Guardar y ver mi plan'}</button>}
      </>
    );
  }

  return (
    <Dialogo abierto onCerrar={() => onCerrar(paso === 3)} titulo={TITULOS[paso]} className="as-dialogo" pie={pie}
      descripcion={paso === 3 ? 'Ya quedó guardado. Lo puedes cambiar cuando quieras desde Deudas y saldos.' : 'Se tarda un par de minutos y lo puedes cambiar después.'}>
      <div className="as-cuerpo" data-testid="asistente">
        {paso < 3 && (
          <div className="as-paso">
            <span className="meta">Paso {paso + 1} de 3</span>
            <div className="as-puntos" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="as-punto" data-hecho={i <= paso} />)}</div>
          </div>
        )}
        {cargando && <p role="status">Mirando lo que ya tienes anotado…</p>}

        {!cargando && paso === 0 && (
          <>
            <p>Suma lo que tienes en efectivo, en el banco o ahorrado. Deja en blanco lo que no uses.</p>
            <div className="as-filas">
              {cuentas.map((c, i) => (
                <div key={c.clave} className="as-fila cuenta">
                  <div className="as-fila-campos">
                    <Campo etiqueta={`Nombre de la cuenta ${i + 1}`} value={c.nombre} maxLength={40} onChange={(e) => act(cuentas, setCuentas, c.clave, { nombre: e.target.value })} />
                    <CampoSelect etiqueta="Tipo" value={c.tipo} onChange={(e) => act(cuentas, setCuentas, c.clave, { tipo: e.target.value as TipoCuenta })}>
                      <option value="efectivo">Efectivo</option><option value="banco">Banco</option><option value="ahorro">Ahorro</option>
                    </CampoSelect>
                    <CampoPesos etiqueta="Saldo hoy" valor={c.saldo} onCambio={(v) => act(cuentas, setCuentas, c.clave, { saldo: v })} />
                  </div>
                  {!c.id && cuentas.length > 1 && <div className="as-fila-pie"><button type="button" className="btn btn-chico" onClick={() => setCuentas(cuentas.filter((x) => x.clave !== c.clave))}>Quitar</button></div>}
                </div>
              ))}
            </div>
            <button type="button" className="btn" style={{ marginTop: 'var(--e-3)' }} onClick={() => setCuentas([...cuentas, cuentaVacia()])}>Añadir otra cuenta</button>
          </>
        )}

        {!cargando && paso === 1 && (
          <>
            <p>Tarjetas, préstamos o lo que debas. Con el saldo, la tasa y el pago mínimo te digo qué pagar primero. Puedes omitir este paso.</p>
            <div className="as-filas">
              {deudas.map((d, i) => (
                <div key={d.clave} className="as-fila deuda">
                  <div className="as-fila-campos">
                    <Campo etiqueta={`Nombre de la deuda ${i + 1}`} value={d.nombre} maxLength={40} placeholder="Ej. Tarjeta Visa" onChange={(e) => act(deudas, setDeudas, d.clave, { nombre: e.target.value })} />
                    <CampoSelect etiqueta="Tipo" value={d.tipo} onChange={(e) => act(deudas, setDeudas, d.clave, { tipo: e.target.value as TipoDeuda })}>
                      <option value="tarjeta">Tarjeta</option><option value="prestamo">Préstamo</option><option value="otra">Otra</option>
                    </CampoSelect>
                    <CampoPesos etiqueta="Cuánto debes" valor={d.saldo} onCambio={(v) => act(deudas, setDeudas, d.clave, { saldo: v })} />
                    <Campo etiqueta="Tasa E.A. (%)" inputMode="decimal" placeholder="28,5" value={d.tasa} onChange={(e) => act(deudas, setDeudas, d.clave, { tasa: e.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })} />
                    <CampoPesos etiqueta="Pago mínimo" valor={d.minimo} onCambio={(v) => act(deudas, setDeudas, d.clave, { minimo: v })} />
                    <Campo etiqueta="Día de pago" inputMode="numeric" placeholder="1 a 31" value={d.dia} onChange={(e) => act(deudas, setDeudas, d.clave, { dia: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                  </div>
                  {!d.id && deudas.length > 1 && <div className="as-fila-pie"><button type="button" className="btn btn-chico" onClick={() => setDeudas(deudas.filter((x) => x.clave !== d.clave))}>Quitar</button></div>}
                </div>
              ))}
            </div>
            <button type="button" className="btn" style={{ marginTop: 'var(--e-3)' }} onClick={() => setDeudas([...deudas, deudaVacia()])}>Añadir otra deuda</button>
          </>
        )}

        {!cargando && paso === 2 && (
          <>
            <p>Con esto calculo cuánto puedes gastar cada día. Si anotaste tus cuentas, uso lo menor entre lo que te deja tu ingreso y la plata que de verdad tienes. Lo puedes cambiar cuando quieras.</p>
            <div className="as-filas">
              <CampoPesos etiqueta="Ingreso mensual" valor={ingreso} onCambio={setIngreso} ayuda="Lo que te entra en un mes normal." />
              <div className="grupo">
                <label htmlFor="as-dia-ingreso" className="etq">¿Qué día del mes te entra la plata?</label>
                <input id="as-dia-ingreso" className="campo num" inputMode="numeric" placeholder="1 a 31" value={diaIngreso}
                  data-testid="asistente-dia-ingreso" aria-describedby="as-dia-ingreso-ayuda"
                  onChange={(e) => setDiaIngreso(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                <span id="as-dia-ingreso-ayuda" className="etq">Opcional. Así reparto tu saldo hasta ese día y no hasta fin de mes. Déjalo en blanco si no es fijo.</span>
              </div>
              <div className="grupo">
                <label htmlFor="as-ahorro" className="etq">Ahorro (% del ingreso)</label>
                <input id="as-ahorro" className="campo num" inputMode="numeric" value={ahorro} onChange={(e) => setAhorro(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                <span className="etq">De 0 a 80. Lo aparto antes de repartir el resto.</span>
              </div>
              <CampoPesos etiqueta="Tope del mes para el día a día" valor={tope} onCambio={setTope} ayuda="Sin contar los gastos fijos ni las deudas." />
            </div>
          </>
        )}

        {paso === 3 && (
          <>
            <div className="as-resumen">
              <Estadistica etiqueta="Saldo total" valor={saldoTotal} formato="corto" tamano="chica" tono="exito" />
              <Estadistica etiqueta="Deuda total" valor={deudaTotal} formato="corto" tamano="chica" tono={deudaTotal > 0 ? 'peligro' : 'base'} />
              <Estadistica etiqueta="Pagos mínimos" valor={minimosMes(deudasMotor)} formato="corto" tamano="chica" tono="listo" />
              {ingreso ? <Estadistica etiqueta="Ingreso mensual" valor={ingreso} formato="corto" tamano="chica" /> : null}
              {resultado && resultado.libre !== null && (
                <Estadistica etiqueta="Hoy puedes gastar" valor={Math.max(0, resultado.libre)} formato="corto" tamano="chica" tono="exito"
                  meta={resultado.limita === 'saldo' ? 'Según tus cuentas' : resultado.limita === 'ingreso' ? 'Según tu ingreso' : 'Estimado'} />
              )}
            </div>
            {resultado?.topeSiempre != null && (
              <Tarjeta tono="listo" relleno="chico" style={{ marginTop: 'var(--e-4)' }} data-testid="asistente-tope">
                <p>Hoy manda tu tope de {formatearCOP(resultado.topeSiempre)} para todos los meses, que es menos de lo que te deja tu ingreso{!tope ? ' (lo dejaste en blanco, pero sigue guardado)' : ''}. Si es de antes y ya no aplica, quítalo.</p>
                <button type="button" className="btn btn-chico" style={{ marginTop: 'var(--e-3)' }} onClick={quitarTope}>Quitar ese tope</button>
              </Tarjeta>
            )}
            {plan && comparacion ? (
              <div className="as-plan" data-testid="asistente-plan">
                <h3>{comparacion.recomendada === 'avalancha' ? 'Plan recomendado: avalancha' : 'Plan recomendado: bola de nieve'}</h3>
                {plan.se_paga && plan.meses !== null ? (
                  <p>Pagando {formatearCOP(plan.pago_mensual)} al mes sales de deudas en {mesesLegible(plan.meses)} y pagas unos {formatearCOP(plan.intereses ?? 0)} de intereses.</p>
                ) : (
                  <p>Con {formatearCOP(plan.pago_mensual)} al mes no se alcanza a salir de las deudas. Sube el pago o revisa la tasa ({deudasMotor[0] ? tasaLegible(deudasMotor[0].tasa_ea) : ''}).</p>
                )}
                <ol>{plan.orden.map((o) => <li key={o.deuda_id}>{o.nombre}{o.mes_pagada ? `: lista en ${mesesLegible(o.mes_pagada)}` : ''}</li>)}</ol>
              </div>
            ) : (
              <div className="as-plan" data-testid="asistente-plan">
                <h3>{deudaTotal === 0 ? 'Sin deudas, vas liviano' : 'Listo'}</h3>
                <p>{deudaTotal > 0 ? 'Tus deudas quedaron anotadas.'
                  : !ingreso && cuentasUsadas.length > 0 ? 'Con lo que tienes en cuentas ya te digo cuánto puedes gastar hoy. Cuando anotes tu ingreso, uso lo menor de los dos. Si más adelante debes algo, lo anotas en Deudas y saldos.'
                    : 'Con tu saldo y tu ingreso ya te puedo decir cuánto puedes gastar hoy. Si más adelante debes algo, lo anotas en Deudas y saldos.'}</p>
              </div>
            )}
            <p className="nota-asesoria" style={{ marginTop: 'var(--e-4)' }}>{NOTA_ASESORIA}</p>
          </>
        )}

        {error && <p role="alert" className="error-campo" style={{ marginTop: 'var(--e-3)' }}>{error}</p>}
      </div>
    </Dialogo>
  );
}
