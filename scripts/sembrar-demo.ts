// Siembra data/panel-dev.db con ~6 meses de movimientos 100 % SINTÉTICOS para desarrollar y probar el panel.
// Uso: npm run demo. Solo toca data/panel-dev.db (la recrea desde cero); nunca data/plata.db.
// Usa las funciones reales de la app (abrirDB, crearAccesoDatos, refrescarRecurrentes). No crea PIN.

import fs from 'node:fs';
import path from 'node:path';
import { abrirDB } from '../src/lib/db';
import { crearAccesoDatos, refrescarRecurrentes, registrarLatido } from '../src/lib/datos';
import { aBogota, sumarDias } from '../src/lib/formato';
import type { Banco, ISODate, NuevoMovimiento } from '../src/lib/tipos';

const RUTA = path.join('data', 'panel-dev.db');
for (const sufijo of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(RUTA + sufijo, { force: true });
  } catch {
    /* si está abierta por el servidor de desarrollo, abrirDB la reutiliza */
  }
}

const db = abrirDB(RUTA);
const ahora = new Date();
const datos = crearAccesoDatos(db, () => ahora);
const hoy = aBogota(ahora).fecha;

// Generador pseudoaleatorio fijo: la demostración sale igual cada vez.
let semilla = 20261009;
const azar = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const redondear = (n: number, paso = 100) => Math.round(n / paso) * paso;
const elegir = <T,>(xs: T[]): T => xs[Math.floor(azar() * xs.length)];
const hora = (h1: number, h2: number) =>
  `${String(entre(h1, h2)).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}`;

let creados = 0;
function gasto(fecha: ISODate, comercio: string, monto: number, h: string | null, extra: Partial<NuevoMovimiento> = {}) {
  if (fecha > hoy) return;
  const banco: Banco = 'bancolombia';
  datos.crearMovimiento(
    { fecha, hora: h, banco, tipo: 'compra', sentido: 'salida', monto, comercio, medio: 'debito', origen: 'historial', ...extra },
    'sistema',
  );
  creados++;
}

// Configuración, fijos y presupuestos.
datos.fijarConfig('ingreso_mensual', 4_200_000, 'sistema');
datos.fijarConfig('pct_ahorro', 10, 'sistema');
datos.guardarFijo({ nombre: 'Arriendo', monto: 1_100_000, dia_mes: 3, patron: 'arriendo', categoria_id: 'servicios' }, 'sistema');
datos.guardarFijo({ nombre: 'Internet hogar', monto: 89_900, dia_mes: 8, patron: 'internet hogar', categoria_id: 'servicios' }, 'sistema');
datos.fijarPresupuesto('*', '*', 2_300_000, 'sistema');
datos.fijarPresupuesto('*', 'mercado', 750_000, 'sistema');
datos.fijarPresupuesto('*', 'comida', 520_000, 'sistema');
datos.fijarPresupuesto('*', 'transporte', 260_000, 'sistema');
datos.fijarPresupuesto('*', 'ocio', 200_000, 'sistema');
datos.fijarPresupuesto('*', 'suscripciones', 90_000, 'sistema');

const inicio = sumarDias(hoy, -181);
const SUSCRIPCIONES: [string, number, number][] = [
  ['Spotify', 17_900, 5],
  ['Netflix', 38_900, 12],
  ['Google One', 9_900, 18],
];
const MERCADO = ['Exito Laureles', 'Jumbo Viva Envigado', 'Ara Belen', 'D1 Estadio', 'Carulla Poblado'];
const COMIDA = ['Rappi', 'Crepes y Waffles', 'Corrientazo Dona Marta', 'Sandwich Qbano', 'Pizzeria Il Forno', 'Frisby'];
const TRANSPORTE = ['Uber', 'Didi', 'Recarga Cívica Metro', 'Terpel Estacion'];
const CAFE = ['Juan Valdez', 'Tostao Cafe', 'Panaderia La Esquina'];
const OCIO = ['Cine Colombia', 'Parque Explora', 'Bar El Guayabo'];

for (let f = inicio; f <= hoy; f = sumarDias(f, 1)) {
  const dia = Number(f.slice(8, 10));
  const dow = new Date(f + 'T12:00:00Z').getUTCDay(); // 0 domingo
  if (dia === 1) {
    datos.crearMovimiento(
      { fecha: f, hora: '07:40', banco: 'bancolombia', tipo: 'ingreso', sentido: 'entrada', monto: 4_200_000, comercio: 'Nómina empresa', origen: 'historial' },
      'sistema',
    );
    creados++;
  }
  if (dia === 3) gasto(f, 'Arriendo apartamento', 1_100_000, '09:10', { tipo: 'transferencia' });
  if (dia === 8) gasto(f, 'Internet hogar', 89_900, '06:30', { tipo: 'pago', medio: 'cuenta' });
  for (const [nombre, monto, d] of SUSCRIPCIONES) {
    if (dia === d) gasto(f, nombre, monto, hora(2, 5), { tipo: 'pago', medio: 'credito' });
  }
  if (dia === 15) gasto(f, 'EPM servicios', redondear(entre(150_000, 190_000), 1000), '10:05', { tipo: 'pago', medio: 'pse' });
  // Mercado: sábado casi siempre, entre semana a veces.
  if (dow === 6 || (dow === 3 && azar() < 0.5)) gasto(f, elegir(MERCADO), redondear(entre(60_000, dow === 6 ? 210_000 : 90_000), 100), hora(10, 17));
  // Comida: casi todos los días.
  if (azar() < 0.62) gasto(f, elegir(COMIDA), redondear(entre(12_000, 68_000), 100), hora(12, 21), { tipo: 'pago' });
  if (azar() < 0.4) gasto(f, elegir(TRANSPORTE), redondear(entre(6_000, 38_000), 100), hora(6, 19));
  if (azar() < 0.45) gasto(f, elegir(CAFE), redondear(entre(4_500, 15_000), 100), hora(7, 16));
  if (azar() < 0.07) gasto(f, elegir(OCIO), redondear(entre(25_000, 85_000), 100), hora(18, 23));
  if (azar() < 0.05) gasto(f, 'Drogueria Cruz Verde', redondear(entre(18_000, 70_000), 100), hora(9, 19));
  // Alguna compra de madrugada (para el hábito nocturno).
  if (azar() < 0.035) gasto(f, 'Rappi', redondear(entre(25_000, 55_000), 100), hora(22, 23), { tipo: 'pago' });
}
// Un gasto alto reciente (compra de ropa) y un par de ingresos extra.
gasto(sumarDias(hoy, -9), 'Falabella Zapatos', 389_000, '16:20', { tipo: 'compra', medio: 'credito' });
gasto(sumarDias(hoy, -41), 'Mercado Libre Monitor', 612_000, '20:15', { tipo: 'pago', medio: 'credito' });
datos.crearMovimiento(
  { fecha: sumarDias(hoy, -20), hora: '14:30', banco: 'bancolombia', tipo: 'ingreso', sentido: 'entrada', monto: 350_000, comercio: 'Trabajo independiente', origen: 'historial' },
  'sistema',
);
creados++;

// Meta con aportes y lista de espera.
const meta = datos.crearMeta({ nombre: 'Viaje a Cartagena', objetivo: 3_000_000, fecha_objetivo: sumarDias(hoy, 150), emoji: '✈' });
for (const [d, monto] of [[-95, 300_000], [-62, 250_000], [-30, 300_000]] as const) datos.aportarMeta(meta.id, monto, sumarDias(hoy, d), 'sistema');
datos.crearMeta({ nombre: 'Colchón de emergencia', objetivo: 5_000_000, fecha_objetivo: null, emoji: '☂' });
const espera1 = datos.agregarEspera('Audífonos Sony inalámbricos', 450_000, 'compras', new Date(ahora.getTime() - 20 * 3_600_000));
const espera2 = datos.agregarEspera('Zapatillas para correr', 320_000, 'compras', new Date(ahora.getTime() - 3 * 3_600_000));
void espera1;
void espera2;

// Avisos por revisar (texto sintético, sin dígitos reales).
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const revisar = db.prepare(
  `INSERT INTO por_revisar (ref_correo, remitente_dominio, banco, asunto, texto, fecha_correo, motivo, intentos, creado_en)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
revisar.run('demo-revisar-0001', 'rappicard.com', 'rappicard', 'Compra con tu RappiCard', 'Compra por $**** en un comercio de ejemplo. Formato nuevo que la app no reconoció.',
  iso(new Date(ahora.getTime() - 30 * 3_600_000)), 'formato_desconocido', 0, iso(new Date(ahora.getTime() - 30 * 3_600_000)));
revisar.run('demo-revisar-0002', 'didi.com', 'didi', 'Pagaste un viaje', 'Viaje pagado con DiDi. La IA local no estaba disponible cuando llegó.',
  iso(new Date(ahora.getTime() - 5 * 3_600_000)), 'ia_no_disponible', 1, iso(new Date(ahora.getTime() - 5 * 3_600_000)));

// Latidos de n8n: ingesta y bot vivos, reportes caído (para ver los dos estados en /sistema).
registrarLatido(db, 'ingesta', new Date(ahora.getTime() - 4 * 60_000));
registrarLatido(db, 'bot', new Date(ahora.getTime() - 7 * 60_000));
registrarLatido(db, 'reportes', new Date(ahora.getTime() - 3 * 3_600_000));

refrescarRecurrentes(db, hoy);
datos.instantanea(ahora); // cierra los días y deja listo el cálculo

const total = (db.prepare('SELECT count(*) AS n FROM movimientos').get() as { n: number }).n;
console.log(`Demostración lista en ${RUTA}: ${total} movimientos sintéticos (${creados} creados), desde ${inicio} hasta ${hoy}.`);
db.close();
