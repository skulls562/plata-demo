'use client';
// Orquesta el asistente de bienvenida y el recorrido guiado. Vive en el layout del panel, así que el botón «Tutorial»
// (evento `plata:tutorial`) funciona desde cualquier página.
//  - Primera vez: sin ingreso, cuentas ni deudas → asistente; al terminarlo (u omitirlo) sigue el recorrido.
//  - Con datos pero sin `tutorial_visto` → recorrido directo.
//  - Al terminar u omitir el recorrido: PATCH /api/config { clave: 'tutorial_visto', valor: true }.
import { useCallback, useEffect, useRef, useState } from 'react';
import { llamar } from '../llamar';
import { Asistente } from './Asistente';
import { EVENTO_TUTORIAL, type QueAbrir } from './eventos';
import { Tour } from './Tour';
import type { ConfigPlata, Cuenta, Deuda } from '@/lib/tipos';

type Vista = 'nada' | 'asistente' | 'tour';

export function GuiaPlata() {
  const [vista, setVista] = useState<Vista>('nada');
  const vistoRef = useRef(true);
  const decidido = useRef(false);

  const marcarVisto = useCallback(() => {
    if (vistoRef.current) return;
    vistoRef.current = true;
    void llamar('/api/config', 'PATCH', { clave: 'tutorial_visto', valor: true });
  }, []);

  // Decisión de la primera visita (una sola vez por carga del panel).
  useEffect(() => {
    if (decidido.current) return;
    decidido.current = true;
    (async () => {
      const [cfg, cuentas, deudas] = await Promise.all([
        llamar<ConfigPlata>('/api/config', 'GET'),
        llamar<{ items: Cuenta[] }>('/api/cuentas', 'GET'),
        llamar<{ items: Deuda[] }>('/api/deudas', 'GET'),
      ]);
      if (!cfg.ok) return;
      vistoRef.current = cfg.datos.tutorial_visto;
      const sinNada = !cfg.datos.ingreso_mensual && cuentas.ok && cuentas.datos.items.length === 0 && deudas.ok && deudas.datos.items.length === 0;
      if (sinNada) setVista('asistente');
      else if (!cfg.datos.tutorial_visto) setVista('tour');
    })();
  }, []);

  // Botón «Tutorial»: recorrido por defecto; con detalle { que: 'asistente' }, el asistente.
  useEffect(() => {
    const abrir = (e: Event) => {
      const que = ((e as CustomEvent<{ que?: QueAbrir }>).detail?.que) ?? 'tour';
      setVista(que === 'asistente' ? 'asistente' : 'tour');
    };
    window.addEventListener(EVENTO_TUTORIAL, abrir);
    return () => window.removeEventListener(EVENTO_TUTORIAL, abrir);
  }, []);

  if (vista === 'asistente') {
    // Al cerrar el asistente se sigue con el recorrido si todavía no lo ha visto.
    return <Asistente onCerrar={() => setVista(vistoRef.current ? 'nada' : 'tour')} />;
  }
  if (vista === 'tour') {
    return <Tour onCerrar={() => { marcarVisto(); setVista('nada'); }} onAsistente={() => { marcarVisto(); setVista('asistente'); }} />;
  }
  return null;
}
