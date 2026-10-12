import { Escena } from '@/components/Escena';
import { Encabezado } from '@/components/piezas';
import { vencimientos } from '@/lib/deudas';
import { listarCuentas, listarDeudas } from '@/lib/panel';
import { contextoPanel } from '@/panel/contexto';
import { DeudasUI } from './DeudasUI';
import './deudas.css';

export const metadata = { title: 'Deudas y saldos' };

export default async function Deudas() {
  const c = await contextoPanel();
  const cuentas = listarCuentas(c.db);
  const deudas = listarDeudas(c.db, true);
  const cfg = c.inst.config;
  return (
    <Escena>
      <div className="pagina">
        <Encabezado titulo="Deudas y saldos" texto="Cuánta plata tienes, cuánto debes y cuál es la mejor forma de ir saliendo de las deudas." />
        <DeudasUI
          cuentas={cuentas}
          deudas={deudas}
          resumen={c.m.saldos}
          vencimientos={vencimientos(deudas.filter((d) => d.activa), c.hoy)}
          estrategia={cfg.estrategia_deudas}
          pagoConfig={cfg.pago_deudas_mensual}
        />
      </div>
    </Escena>
  );
}
