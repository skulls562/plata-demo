'use client';
// Botón «Actualizar Gmail» de Sistema: trae ya los avisos del banco y refresca la página; además la mantiene al día sola.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { llamar } from './llamar';

const CADA_MS = 30_000;

interface Respuesta { ok: boolean; codigo: string; mensaje: string }

export function ActualizarGmail({ configurado, falta }: { configurado: boolean; falta: string | null }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<Respuesta | null>(null);

  // La página se vuelve a calcular sola mientras esté a la vista (latidos, último aviso, avisos por revisar).
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, CADA_MS);
    return () => clearInterval(id);
  }, [router]);

  async function actualizar() {
    setCargando(true);
    setResultado(null);
    const r = await llamar<Respuesta>('/api/correo/sincronizar', 'POST', {});
    setCargando(false);
    if (r.ok) {
      setResultado(r.datos);
      router.refresh();
    } else setResultado({ ok: false, codigo: r.codigo, mensaje: r.mensaje });
  }

  return (
    <div className="gmail-accion">
      <button type="button" className="btn btn-prim" onClick={actualizar} disabled={cargando} aria-busy={cargando} data-testid="actualizar-gmail">
        {cargando ? 'Revisando tu correo…' : 'Actualizar Gmail'}
      </button>
      {resultado && <p role={resultado.ok ? 'status' : 'alert'} className={resultado.ok ? 'ok-campo' : 'error-campo'} data-testid="resultado-gmail">{resultado.mensaje}</p>}
      {!resultado && !configurado && <p className="suave texto-ancho">Falta {falta}. En la carpeta de Plata corre «npm run gmail-clave» una sola vez y reinicia Plata.</p>}
    </div>
  );
}
