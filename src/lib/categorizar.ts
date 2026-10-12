// Categorización por reglas (SPEC §1.4, §2.2). Todo PURO.
import { normalizarComercio, normalizarTexto } from './formato';
import type { Categoria, FuenteCategoria, ReglaCategoria, TipoMovimiento } from './tipos';

/**
 * Reglas semilla (origen = 'semilla'). Deben coincidir con las que inserta la migración 1 de db.ts
 * (hay un test que lo comprueba). Patrones ya normalizados.
 */
export const REGLAS_SEMILLA: ReadonlyArray<{ patron: string; categoria_id: string }> = [
  { patron: 'd1', categoria_id: 'mercado' },
  { patron: 'ara', categoria_id: 'mercado' },
  { patron: 'exito', categoria_id: 'mercado' },
  { patron: 'carulla', categoria_id: 'mercado' },
  { patron: 'olimpica', categoria_id: 'mercado' },
  { patron: 'jumbo', categoria_id: 'mercado' },
  { patron: 'euro supermercado', categoria_id: 'mercado' },
  { patron: 'isimo', categoria_id: 'mercado' },
  { patron: 'surtimax', categoria_id: 'mercado' },
  { patron: 'super inter', categoria_id: 'mercado' },
  { patron: 'merqueo', categoria_id: 'mercado' },
  { patron: 'mercado', categoria_id: 'mercado' },
  { patron: 'supermercado', categoria_id: 'mercado' },
  { patron: 'oxxo', categoria_id: 'mercado' },
  { patron: 'justo y bueno', categoria_id: 'mercado' },
  { patron: 'colsubsidio mercado', categoria_id: 'mercado' },
  { patron: 'rappi', categoria_id: 'comida' },
  { patron: 'ifood', categoria_id: 'comida' },
  { patron: 'domicilios', categoria_id: 'comida' },
  { patron: 'mcdonalds', categoria_id: 'comida' },
  { patron: 'kfc', categoria_id: 'comida' },
  { patron: 'frisby', categoria_id: 'comida' },
  { patron: 'el corral', categoria_id: 'comida' },
  { patron: 'crepes', categoria_id: 'comida' },
  { patron: 'presto', categoria_id: 'comida' },
  { patron: 'juan valdez', categoria_id: 'comida' },
  { patron: 'starbucks', categoria_id: 'comida' },
  { patron: 'oma', categoria_id: 'comida' },
  { patron: 'dunkin', categoria_id: 'comida' },
  { patron: 'subway', categoria_id: 'comida' },
  { patron: 'burger', categoria_id: 'comida' },
  { patron: 'pizza', categoria_id: 'comida' },
  { patron: 'sushi', categoria_id: 'comida' },
  { patron: 'restaurante', categoria_id: 'comida' },
  { patron: 'panaderia', categoria_id: 'comida' },
  { patron: 'cafe', categoria_id: 'comida' },
  { patron: 'wok', categoria_id: 'comida' },
  { patron: 'qbano', categoria_id: 'comida' },
  { patron: 'piqueteadero', categoria_id: 'comida' },
  { patron: 'didi', categoria_id: 'transporte' },
  { patron: 'uber', categoria_id: 'transporte' },
  { patron: 'cabify', categoria_id: 'transporte' },
  { patron: 'indrive', categoria_id: 'transporte' },
  { patron: 'metro de medellin', categoria_id: 'transporte' },
  { patron: 'civica', categoria_id: 'transporte' },
  { patron: 'terpel', categoria_id: 'transporte' },
  { patron: 'primax', categoria_id: 'transporte' },
  { patron: 'texaco', categoria_id: 'transporte' },
  { patron: 'biomax', categoria_id: 'transporte' },
  { patron: 'esso', categoria_id: 'transporte' },
  { patron: 'peaje', categoria_id: 'transporte' },
  { patron: 'parqueadero', categoria_id: 'transporte' },
  { patron: 'gasolina', categoria_id: 'transporte' },
  { patron: 'tembici', categoria_id: 'transporte' },
  { patron: 'taxi', categoria_id: 'transporte' },
  { patron: 'netflix', categoria_id: 'suscripciones' },
  { patron: 'spotify', categoria_id: 'suscripciones' },
  { patron: 'disney', categoria_id: 'suscripciones' },
  { patron: 'hbo', categoria_id: 'suscripciones' },
  { patron: 'prime video', categoria_id: 'suscripciones' },
  { patron: 'amazon prime', categoria_id: 'suscripciones' },
  { patron: 'youtube', categoria_id: 'suscripciones' },
  { patron: 'apple com', categoria_id: 'suscripciones' },
  { patron: 'icloud', categoria_id: 'suscripciones' },
  { patron: 'google one', categoria_id: 'suscripciones' },
  { patron: 'google play', categoria_id: 'suscripciones' },
  { patron: 'chatgpt', categoria_id: 'suscripciones' },
  { patron: 'openai', categoria_id: 'suscripciones' },
  { patron: 'anthropic', categoria_id: 'suscripciones' },
  { patron: 'claude ai', categoria_id: 'suscripciones' },
  { patron: 'crunchyroll', categoria_id: 'suscripciones' },
  { patron: 'paramount', categoria_id: 'suscripciones' },
  { patron: 'deezer', categoria_id: 'suscripciones' },
  { patron: 'canva', categoria_id: 'suscripciones' },
  { patron: 'microsoft', categoria_id: 'suscripciones' },
  { patron: 'xbox', categoria_id: 'suscripciones' },
  { patron: 'playstation', categoria_id: 'suscripciones' },
  { patron: 'adobe', categoria_id: 'suscripciones' },
  { patron: 'notion', categoria_id: 'suscripciones' },
  { patron: 'github', categoria_id: 'suscripciones' },
  { patron: 'drogueria', categoria_id: 'salud' },
  { patron: 'farmacia', categoria_id: 'salud' },
  { patron: 'cruz verde', categoria_id: 'salud' },
  { patron: 'farmatodo', categoria_id: 'salud' },
  { patron: 'pasteur', categoria_id: 'salud' },
  { patron: 'la rebaja', categoria_id: 'salud' },
  { patron: 'clinica', categoria_id: 'salud' },
  { patron: 'laboratorio', categoria_id: 'salud' },
  { patron: 'odontolog', categoria_id: 'salud' },
  { patron: 'optica', categoria_id: 'salud' },
  { patron: 'eps', categoria_id: 'salud' },
  { patron: 'sura', categoria_id: 'salud' },
  { patron: 'colsanitas', categoria_id: 'salud' },
  { patron: 'medico', categoria_id: 'salud' },
  { patron: 'cine', categoria_id: 'ocio' },
  { patron: 'cinecolombia', categoria_id: 'ocio' },
  { patron: 'procinal', categoria_id: 'ocio' },
  { patron: 'cinemark', categoria_id: 'ocio' },
  { patron: 'tuboleta', categoria_id: 'ocio' },
  { patron: 'eticket', categoria_id: 'ocio' },
  { patron: 'steam', categoria_id: 'ocio' },
  { patron: 'epic games', categoria_id: 'ocio' },
  { patron: 'teatro', categoria_id: 'ocio' },
  { patron: 'concierto', categoria_id: 'ocio' },
  { patron: 'bar', categoria_id: 'ocio' },
  { patron: 'discoteca', categoria_id: 'ocio' },
  { patron: 'parque', categoria_id: 'ocio' },
  { patron: 'falabella', categoria_id: 'compras' },
  { patron: 'mercadolibre', categoria_id: 'compras' },
  { patron: 'mercado libre', categoria_id: 'compras' },
  { patron: 'amazon', categoria_id: 'compras' },
  { patron: 'temu', categoria_id: 'compras' },
  { patron: 'shein', categoria_id: 'compras' },
  { patron: 'zara', categoria_id: 'compras' },
  { patron: 'arturo calle', categoria_id: 'compras' },
  { patron: 'koaj', categoria_id: 'compras' },
  { patron: 'studio f', categoria_id: 'compras' },
  { patron: 'homecenter', categoria_id: 'compras' },
  { patron: 'alkosto', categoria_id: 'compras' },
  { patron: 'ktronix', categoria_id: 'compras' },
  { patron: 'dafiti', categoria_id: 'compras' },
  { patron: 'adidas', categoria_id: 'compras' },
  { patron: 'nike', categoria_id: 'compras' },
  { patron: 'tennis', categoria_id: 'compras' },
  { patron: 'flamingo', categoria_id: 'compras' },
  { patron: 'pepe ganga', categoria_id: 'compras' },
  { patron: 'universidad', categoria_id: 'estudio' },
  { patron: 'eafit', categoria_id: 'estudio' },
  { patron: 'udea', categoria_id: 'estudio' },
  { patron: 'upb', categoria_id: 'estudio' },
  { patron: 'unal', categoria_id: 'estudio' },
  { patron: 'coursera', categoria_id: 'estudio' },
  { patron: 'udemy', categoria_id: 'estudio' },
  { patron: 'platzi', categoria_id: 'estudio' },
  { patron: 'panamericana', categoria_id: 'estudio' },
  { patron: 'libreria', categoria_id: 'estudio' },
  { patron: 'icetex', categoria_id: 'estudio' },
  { patron: 'epm', categoria_id: 'servicios' },
  { patron: 'une', categoria_id: 'servicios' },
  { patron: 'tigo', categoria_id: 'servicios' },
  { patron: 'claro', categoria_id: 'servicios' },
  { patron: 'movistar', categoria_id: 'servicios' },
  { patron: 'wom', categoria_id: 'servicios' },
  { patron: 'etb', categoria_id: 'servicios' },
  { patron: 'vanti', categoria_id: 'servicios' },
  { patron: 'aseo', categoria_id: 'servicios' },
  { patron: 'administracion', categoria_id: 'servicios' },
  { patron: 'arriendo', categoria_id: 'servicios' },
  { patron: 'internet', categoria_id: 'servicios' },
  { patron: 'energia', categoria_id: 'servicios' },
  { patron: 'acueducto', categoria_id: 'servicios' },
  // ---- Migración 2: comercios frecuentes del historial real (deben coincidir con db.ts, migración 2) ----
  { patron: 'gopass', categoria_id: 'transporte' },
  { patron: 'eds', categoria_id: 'transporte' },
  { patron: 'parking', categoria_id: 'transporte' },
  { patron: 'pon tu precio', categoria_id: 'transporte' },
  { patron: 'lubritodo', categoria_id: 'transporte' },
  { patron: 'lubricentro', categoria_id: 'transporte' },
  { patron: 'estacion de servicio', categoria_id: 'transporte' },
  { patron: 's publicas de medellin', categoria_id: 'servicios' },
  { patron: 'empresas publicas', categoria_id: 'servicios' },
  { patron: 'comunicacion celular', categoria_id: 'servicios' },
  { patron: 'comcel', categoria_id: 'servicios' },
  { patron: 'univers', categoria_id: 'estudio' },
  { patron: 'univ pontificia', categoria_id: 'estudio' },
  { patron: 'novaventa', categoria_id: 'compras' },
  { patron: 'dollarcity', categoria_id: 'compras' },
  { patron: 'miniso', categoria_id: 'compras' },
  { patron: 'hym', categoria_id: 'compras' },
  { patron: 'h y m', categoria_id: 'compras' },
  { patron: 'alkomprar', categoria_id: 'compras' },
  { patron: 'recanto', categoria_id: 'comida' },
  { patron: 'taco factory', categoria_id: 'comida' },
  { patron: 'coffee lab', categoria_id: 'comida' },
  { patron: 'sabor llanero', categoria_id: 'comida' },
  { patron: 'sabor y tradicion', categoria_id: 'comida' },
  { patron: 'mcdonal', categoria_id: 'comida' },
  { patron: 'papa john', categoria_id: 'comida' },
  { patron: 'kokoriko', categoria_id: 'comida' },
  { patron: 'heladeria', categoria_id: 'comida' },
  { patron: 'taqueria', categoria_id: 'comida' },
  { patron: 'dim sum', categoria_id: 'comida' },
  { patron: 'cocorollo', categoria_id: 'comida' },
  { patron: 'mesa de abuela', categoria_id: 'comida' },
  { patron: 'pastelitos', categoria_id: 'comida' },
  { patron: 'fit and fat food', categoria_id: 'comida' },
  { patron: 'long hang', categoria_id: 'comida' },
  { patron: 'mimos', categoria_id: 'comida' },
  { patron: 'rapipharma', categoria_id: 'salud' },
  { patron: 'pharma', categoria_id: 'salud' },
  { patron: 'farma', categoria_id: 'salud' },
  { patron: 'el faro de la marini', categoria_id: 'mercado' },
  { patron: 'superoriente', categoria_id: 'mercado' },
  { patron: 'fruver', categoria_id: 'mercado' },
  { patron: 'airbnb', categoria_id: 'viajes' },     // era ocio; la migración 6 la pasa a viajes
  { patron: 'despegar', categoria_id: 'viajes' },   // era ocio; la migración 6 la pasa a viajes
  { patron: 'multiplex', categoria_id: 'ocio' },
  { patron: 'eneba', categoria_id: 'ocio' },
  { patron: 'g2a', categoria_id: 'ocio' },
  { patron: 'ticketing', categoria_id: 'ocio' },
  { patron: 'alcanos', categoria_id: 'servicios' },
  { patron: 'banco davivienda', categoria_id: 'deudas' },
  { patron: 'davivienda', categoria_id: 'deudas' },
  { patron: 'hdi', categoria_id: 'deudas' },
  { patron: 'financiacion', categoria_id: 'deudas' },
  // ---- Migración 6: viajes (deben coincidir con db.ts, migración 6) ----
  { patron: 'hotel', categoria_id: 'viajes' },
  { patron: 'hostal', categoria_id: 'viajes' },
  { patron: 'hostel', categoria_id: 'viajes' },
  { patron: 'hospedaje', categoria_id: 'viajes' },
  { patron: 'alojamiento', categoria_id: 'viajes' },
  { patron: 'booking', categoria_id: 'viajes' },
  { patron: 'expedia', categoria_id: 'viajes' },
  { patron: 'reserva', categoria_id: 'viajes' },
  { patron: 'vuelo', categoria_id: 'viajes' },
  { patron: 'aerolinea', categoria_id: 'viajes' },
  { patron: 'avianca', categoria_id: 'viajes' },
  { patron: 'latam', categoria_id: 'viajes' },
  { patron: 'wingo', categoria_id: 'viajes' },
  { patron: 'tiquete aereo', categoria_id: 'viajes' },
  { patron: 'tiquetes aereos', categoria_id: 'viajes' },
  { patron: 'pasaje aereo', categoria_id: 'viajes' },
  { patron: 'pasajes aereos', categoria_id: 'viajes' },
];

/** Patrón de ≤ 3 caracteres = token completo; más largo = prefijo de token. Sin regex: el patrón es texto plano. */
export function coincide(comercio_norm: string, patron: string): boolean {
  if (!patron || !comercio_norm) return false;
  if (patron.length <= 3) return (' ' + comercio_norm + ' ').includes(' ' + patron + ' ');
  return (' ' + comercio_norm).includes(' ' + patron);
}

const PRIORIDAD_ORIGEN: Record<ReglaCategoria['origen'], number> = { manual: 2, aprendida: 2, semilla: 1 };

/** ¿`a` le gana a `b`? Patrón más largo; en empate aprendida/manual antes que semilla; luego más aciertos; luego id menor. */
function gana(a: ReglaCategoria, b: ReglaCategoria): boolean {
  if (a.patron.length !== b.patron.length) return a.patron.length > b.patron.length;
  if (PRIORIDAD_ORIGEN[a.origen] !== PRIORIDAD_ORIGEN[b.origen]) return PRIORIDAD_ORIGEN[a.origen] > PRIORIDAD_ORIGEN[b.origen];
  if (a.aciertos !== b.aciertos) return a.aciertos > b.aciertos;
  return a.id < b.id;
}

function mejorRegla(comercio_norm: string, reglas: ReglaCategoria[]): ReglaCategoria | null {
  let mejor: ReglaCategoria | null = null;
  for (const r of reglas) {
    if (!coincide(comercio_norm, r.patron)) continue;
    if (!mejor || gana(r, mejor)) mejor = r;
  }
  return mejor;
}

export function categorizar(
  comercio_norm: string,
  tipo: TipoMovimiento,
  computa: boolean,
  reglas: ReglaCategoria[],
): { categoria_id: string; fuente: FuenteCategoria; regla_id: number | null } {
  // Una transferencia sin computar es el valor por defecto (no es gasto hasta que Jero la marque): conserva su categoría.
  if (!computa && tipo !== 'transferencia') return { categoria_id: 'interno', fuente: 'regla', regla_id: null };
  if (tipo === 'ingreso') return { categoria_id: 'ingresos', fuente: 'regla', regla_id: null };
  // Un retiro nombra un cajero, no un comercio: las reglas no aplican («upb1» no es estudio).
  if (tipo === 'retiro') return { categoria_id: 'efectivo', fuente: 'defecto', regla_id: null };
  // El reverso resta en la categoría que daría el comercio.
  const r = mejorRegla(comercio_norm, reglas);
  if (!r) return { categoria_id: tipo === 'transferencia' ? 'transferencias' : 'otros', fuente: 'defecto', regla_id: null };
  // Una regla manual es una regla puesta por Jero: cuenta como regla, no como categoría puesta a mano en el movimiento.
  return { categoria_id: r.categoria_id, fuente: r.origen === 'aprendida' ? 'aprendida' : 'regla', regla_id: r.id };
}

const MAX_PATRON_APRENDIDO = 40;

/** Patrón a aprender de un comercio: tokens enteros hasta 40 caracteres. null si queda < 2 caracteres. */
export function patronAprendido(comercio_norm: string): string | null {
  const tokens = normalizarComercio(comercio_norm).split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  let patron = '';
  for (const t of tokens) {
    const siguiente = patron ? patron + ' ' + t : t;
    if (siguiente.length > MAX_PATRON_APRENDIDO) break;
    patron = siguiente;
  }
  if (!patron) patron = tokens[0].slice(0, MAX_PATRON_APRENDIDO);   // un solo token más largo que el máximo
  return patron.length >= 2 ? patron : null;
}

const sinVS16 = (s: string) => s.replace(/\uFE0F/g, '');

/** Resuelve lo que escribió Jero: id, nombre, emoji o prefijo (≥ 3 caracteres) que identifique una sola categoría. */
export function resolverCategoria(
  entrada: string,
  cats: Categoria[],
): { ok: true; categoria: Categoria } | { ok: false; opciones: Categoria[] } {
  const activas = cats.filter((c) => c.activa);
  const crudo = sinVS16(String(entrada ?? '').trim().replace(/^#/, ''));
  const t = normalizarTexto(crudo);
  if (!crudo) return { ok: false, opciones: activas };

  const exacta = activas.find(
    (c) => c.id === t || normalizarTexto(c.nombre) === t || (sinVS16(c.emoji) === crudo),
  );
  if (exacta) return { ok: true, categoria: exacta };

  if (t.length >= 3) {
    const candidatas = activas.filter((c) => c.id.startsWith(t) || normalizarTexto(c.nombre).startsWith(t));
    if (candidatas.length === 1) return { ok: true, categoria: candidatas[0] };
    if (candidatas.length > 1) return { ok: false, opciones: candidatas };
  }
  return { ok: false, opciones: activas };
}
