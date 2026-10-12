// Constructores de datos SINTÉTICOS para pruebas (SPEC §8.2). Nada real; montos y comercios inventados.
import type {
  Categoria, ConfigPlata, EstadoSistema, GastoFijo, Instantanea, ItemEspera, Meta, MetaConAportes,
  Movimiento, Recurrente, ReglaCategoria,
} from '@/lib/tipos';

export const AHORA_CANONICO = new Date('2026-10-15T17:00:00Z'); // 12:00 en Bogotá

// ---------- Catálogos (copia de la migración 1, §1.2) ----------
const cat = (id: string, nombre: string, emoji: string, es_gasto: boolean, esencial: boolean, cuenta_hormiga: boolean, orden: number, sistema = false): Categoria =>
  ({ id, nombre, emoji, es_gasto, esencial, cuenta_hormiga, orden, sistema, activa: true });

export const CATEGORIAS_BASE: Categoria[] = [
  cat('mercado', 'Mercado', '🛒', true, true, true, 1),
  cat('comida', 'Comida', '🍔', true, false, true, 2),
  cat('transporte', 'Transporte', '🚕', true, true, true, 3),
  cat('suscripciones', 'Suscripciones', '📱', true, false, false, 4),
  cat('salud', 'Salud', '💊', true, true, false, 5),
  cat('ocio', 'Ocio', '🎟', true, false, true, 6),
  cat('compras', 'Compras', '🛍', true, false, true, 7),
  cat('estudio', 'Estudio', '🎓', true, true, false, 8),
  cat('servicios', 'Servicios', '🏠', true, true, false, 9),
  cat('otros', 'Otros', '📦', true, false, true, 10),
  cat('ingresos', 'Ingresos', '💰', false, false, false, 90, true),
  cat('interno', 'Entre cuentas', '🔁', false, false, false, 91, true),
];

/** Subconjunto de reglas semilla suficiente para las pruebas. */
export const REGLAS_BASE: ReglaCategoria[] = [
  ['d1', 'mercado'], ['exito', 'mercado'], ['rappi', 'comida'], ['mcdonalds', 'comida'], ['didi', 'transporte'],
  ['uber', 'transporte'], ['netflix', 'suscripciones'], ['spotify', 'suscripciones'], ['drogueria', 'salud'],
  ['cine', 'ocio'], ['amazon', 'compras'], ['amazon prime', 'suscripciones'], ['epm', 'servicios'],
].map(([patron, categoria_id], i) => ({ id: i + 1, patron, categoria_id, origen: 'semilla' as const, aciertos: 0 }));

// ---------- Configuración (§8.1) ----------
export function config(over: Partial<ConfigPlata> = {}): ConfigPlata {
  return {
    ingreso_mensual: null,
    pct_ahorro: 10,
    umbral_gasto_alto: 200_000,
    umbral_hormiga: 25_000,
    umbral_impulso: 100_000,
    horas_espera_impulso: 48,
    nocturno: { desde: '22:00', hasta: '05:00' },
    horario_push: { desde: '07:00', hasta: '21:30' },
    pausa_hasta: null,
    semaforo: { dia_amarillo: 0.7, dia_rojo: 1.0, mes_amarillo: 0.95, mes_rojo: 1.05 },
    patrones_pago_tarjeta: ['rappicard', 'rappi card', 'didi card', 'tarjeta de credito', 'pago tc', 'pago tarjeta', 'abono tarjeta'],
    patrones_interno: ['bolsillo', 'cuenta de ahorros propia', 'traslado entre cuentas', 'nequi propio'],
    minutos_fusion: 30,
    minutos_duplicado: 10,
    max_push_por_evaluacion: 3,
    tutorial_visto: false,
    estrategia_deudas: 'avalancha',
    pago_deudas_mensual: null,
    dia_ingreso: null,
    ...over,
  };
}

// ---------- Movimientos ----------
let secuencia = 0;
export function reiniciarIds(): void { secuencia = 0; }

function normSimple(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Movimiento con valores por defecto razonables. `sentido` y `computa` se derivan del `tipo` si no se indican. */
export function mov(over: Partial<Movimiento> = {}): Movimiento {
  const id = over.id ?? ++secuencia;
  const tipo = over.tipo ?? 'compra';
  const sentido = over.sentido ?? (tipo === 'ingreso' || tipo === 'reverso' ? 'entrada' : 'salida');
  const computa = over.computa ?? !(tipo === 'pago_tarjeta' || tipo === 'interno');
  const comercio = over.comercio ?? 'TIENDA PRUEBA';
  return {
    id,
    fecha: '2026-10-15', hora: '12:00',
    banco: 'bancolombia',
    monto: 10_000,
    categoria_id: 'otros', categoria_fuente: 'regla',
    fijo_id: null, recurrente_id: null,
    medio: 'debito', origen: 'aviso', confianza: 'regla',
    verificado: true,
    ref_correo: `mid:test${id}`,
    nota: null,
    creado_en: '2026-10-15T17:00:00Z', actualizado_en: '2026-10-15T17:00:00Z',
    version: 1,
    ...over,
    comercio, comercio_norm: over.comercio_norm ?? normSimple(comercio),
    tipo, sentido, computa,
  };
}

/** Atajo: gasto de `monto` en `fecha`. */
export function gasto(fecha: string, monto: number, comercio = 'TIENDA PRUEBA', over: Partial<Movimiento> = {}): Movimiento {
  return mov({ fecha, monto, comercio, ...over });
}

export function sistemaVacio(over: Partial<EstadoSistema> = {}): EstadoSistema {
  return {
    ultimo_aviso_en: null, avisos_promedio_diario_90d: 0,
    por_revisar_pendientes: 0, por_revisar_mas_viejo_en: null,
    latidos: {}, pin_bloqueado_hasta: null,
    ...over,
  };
}

export function fijo(over: Partial<GastoFijo> = {}): GastoFijo {
  return { id: 1, nombre: 'Arriendo', monto: 1_500_000, dia_mes: 5, patron: 'arriendo', categoria_id: 'servicios', activo: true, ...over };
}

export function metaConAportes(over: Partial<MetaConAportes> = {}): MetaConAportes {
  const base: Meta = {
    id: 1, nombre: 'Viaje', emoji: '✈️', objetivo: 3_000_000, fecha_objetivo: null,
    estado: 'activa', prioridad: 100, creada_en: '2026-07-01T12:00:00Z',
  };
  const aportes = over.aportes ?? [];
  const aportado = over.aportado ?? aportes.reduce((s, a) => s + a.monto, 0);
  return { ...base, ...over, aportes, aportado };
}

export function itemEspera(over: Partial<ItemEspera> = {}): ItemEspera {
  return {
    id: 1, descripcion: 'Audífonos', monto: 150_000, categoria_id: 'compras',
    creado_en: '2026-10-10T12:00:00Z', disponible_en: '2026-10-12T12:00:00Z',
    estado: 'esperando', recordado_en: null,
    ...over,
  };
}

export function recurrente(over: Partial<Recurrente> = {}): Recurrente {
  return {
    id: 1, comercio_norm: 'netflix', nombre: 'Netflix', categoria_id: 'suscripciones',
    clase: 'suscripcion', periodo: 'mensual', monto_tipico: 45_000, monto_anterior: null, ocurrencias: 6,
    primer_cobro: '2026-04-20', ultimo_cobro: '2026-09-20', proximo_cobro: '2026-10-20',
    activa: true, costo_mensual: 45_000, costo_anual: 540_000, movimiento_ids: [],
    estado: 'confirmada',
    ...over,
  };
}

// ---------- Instantánea ----------
export function inst(over: Partial<Instantanea> = {}): Instantanea {
  return {
    ahora: AHORA_CANONICO,
    config: config(),
    categorias: CATEGORIAS_BASE,
    reglas: REGLAS_BASE,
    movimientos: [],
    presupuestos: [],
    fijos: [],
    recurrentes: [],
    metas: [],
    lista_espera: [],
    dias: [],
    emisiones: [],
    sistema: sistemaVacio(),
    cuentas: [],
    deudas: [],
    ...over,
  };
}

/** Días consecutivos 'desde'..'hasta' (inclusive) con un gasto diario de `monto`. */
export function gastosDiarios(desde: string, hasta: string, monto: number, comercio = 'TIENDA PRUEBA', over: Partial<Movimiento> = {}): Movimiento[] {
  const res: Movimiento[] = [];
  const [y, m, d] = desde.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (;;) {
    const f = new Date(t).toISOString().slice(0, 10);
    if (f > hasta) break;
    res.push(mov({ fecha: f, monto, comercio, ...over }));
    t += 86_400_000;
  }
  return res;
}

/**
 * Ejemplo canónico de SPEC §3.5: ahora = 2026-10-15T17:00:00Z, ingreso 4M, ahorro 10 %, fijos 1,5M,
 * G_antes = 1.050.000 (1–7 oct a 70.000 y 8–14 oct a 80.000), G_hoy = 30.000, P = 45.000 (Netflix el 20),
 * ritmo_hist = 70.000 (septiembre completo a 70.000/día).
 */
export function escenarioCanonico(over: Partial<Instantanea> = {}): Instantanea {
  reiniciarIds();
  const movimientos = [
    ...gastosDiarios('2026-09-01', '2026-09-30', 70_000, 'TIENDA SEPTIEMBRE'),
    ...gastosDiarios('2026-10-01', '2026-10-07', 70_000, 'TIENDA OCTUBRE'),
    ...gastosDiarios('2026-10-08', '2026-10-14', 80_000, 'TIENDA OCTUBRE'),
    mov({ fecha: '2026-10-15', hora: '11:00', monto: 30_000, comercio: 'TIENDA HOY' }),
  ];
  return inst({
    config: config({ ingreso_mensual: 4_000_000, pct_ahorro: 10 }),
    movimientos,
    fijos: [fijo({ id: 1, nombre: 'Arriendo', monto: 1_500_000, patron: 'arriendo' })],
    recurrentes: [recurrente({ id: 1, comercio_norm: 'netflix', monto_tipico: 45_000, proximo_cobro: '2026-10-20', ultimo_cobro: '2026-09-20' })],
    ...over,
  });
}
