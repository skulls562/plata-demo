// ---------- Primitivos ----------
export type ISODate = string;       // 'AAAA-MM-DD' (Bogotá)
export type HoraHM = string;        // 'HH:MM' 24 h (Bogotá)
export type Mes = string;           // 'AAAA-MM'
export type InstanteISO = string;   // UTC con Z
export type Pesos = number;         // entero COP

export type Banco = 'bancolombia' | 'wompi' | 'pse' | 'rappicard' | 'didi' | 'nequi' | 'efectivo' | 'otro';
export type TipoMovimiento = 'compra' | 'pago' | 'retiro' | 'transferencia' | 'ingreso' | 'reverso' | 'pago_tarjeta' | 'interno';
export type Sentido = 'salida' | 'entrada';
export type OrigenMovimiento = 'aviso' | 'manual' | 'historial';
export type FuenteCategoria = 'regla' | 'aprendida' | 'manual' | 'ia' | 'defecto';
export type Medio = 'debito' | 'credito' | 'cuenta' | 'pse' | 'efectivo' | 'otro';
export type Confianza = 'regla' | 'ia' | 'manual';
export type Actor = 'bot' | 'panel' | 'n8n' | 'sistema';

// ---------- Catálogos ----------
export interface Categoria {
  id: string; nombre: string; emoji: string;
  es_gasto: boolean; esencial: boolean; cuenta_hormiga: boolean;
  orden: number; sistema: boolean; activa: boolean;
}
export interface ReglaCategoria {
  id: number; patron: string; categoria_id: string;
  origen: 'semilla' | 'aprendida' | 'manual'; aciertos: number;
}

// ---------- Movimientos ----------
export interface Movimiento {
  id: number;
  fecha: ISODate; hora: HoraHM | null;
  banco: Banco; tipo: TipoMovimiento; sentido: Sentido;
  monto: Pesos;                         // siempre > 0; el signo lo da `sentido`
  comercio: string; comercio_norm: string;
  categoria_id: string; categoria_fuente: FuenteCategoria;
  computa: boolean;                     // false = no cuenta en gastos ni ingresos
  fijo_id: number | null; recurrente_id: number | null;
  medio: Medio | null; origen: OrigenMovimiento; confianza: Confianza;
  verificado: boolean;
  ref_correo: string | null;
  nota: string | null;
  creado_en: InstanteISO; actualizado_en: InstanteISO;
  version: number;
}
export interface NuevoMovimiento {
  fecha: ISODate; hora: HoraHM | null;
  banco: Banco; tipo: TipoMovimiento; sentido: Sentido;
  monto: Pesos; comercio: string;
  categoria_id?: string;                // si falta → categorizar()
  medio?: Medio | null; nota?: string | null; computa?: boolean;
  origen: OrigenMovimiento;
}
export interface CambiosMovimiento {
  version: number;                      // obligatorio (concurrencia optimista)
  categoria_id?: string; tipo?: TipoMovimiento; sentido?: Sentido; computa?: boolean;
  comercio?: string; monto?: Pesos; fecha?: ISODate; hora?: HoraHM | null;
  nota?: string | null; fijo_id?: number | null;
}
export interface FiltroMovimientos {
  desde?: ISODate; hasta?: ISODate; categoria_id?: string; banco?: Banco; tipo?: TipoMovimiento;
  sentido?: Sentido; origen?: OrigenMovimiento; q?: string; min?: Pesos; max?: Pesos;
  limite?: number;                      // 1..200, por defecto 50
  cursor?: string | null;
}
export interface PaginaMovimientos { items: Movimiento[]; siguiente_cursor: string | null; }

// ---------- Avisos ----------
export interface AvisoCrudo {
  from: string;            // ≤ 320
  subject: string;         // ≤ 500
  date: string;            // cabecera Date (RFC 2822) o ISO; ≤ 100
  text: string;            // texto plano o HTML; ≤ 200 000
  message_id?: string;     // ≤ 998; muy recomendado
  auth_results?: string;   // cabecera Authentication-Results; ≤ 4000
}
export interface DatosAviso {
  banco: Banco; tipo: TipoMovimiento; sentido: Sentido;
  monto: Pesos; comercio: string;
  fecha: ISODate; hora: HoraHM | null; medio: Medio | null;
  confianza: 'regla' | 'ia';
}
export type MotivoIgnorado =
  | 'remitente_no_permitido' | 'publicidad' | 'transaccion_rechazada'
  | 'transaccion_pendiente' | 'no_es_transaccion';
export type MotivoRevision =
  | 'formato_desconocido' | 'ia_no_disponible' | 'ia_invalida'
  | 'monto_no_verificado' | 'autenticacion_fallida' | 'fecha_invalida';
export type ResultadoParseo =
  | { estado: 'leido'; datos: DatosAviso }
  | { estado: 'ignorado'; motivo: MotivoIgnorado }
  | { estado: 'necesita_ia'; banco: Banco };
export type ResultadoAviso =
  | { estado: 'creado'; movimiento: Movimiento; anomalias: Anomalia[] }
  | { estado: 'fusionado'; movimiento: Movimiento }
  | { estado: 'duplicado'; movimiento_id: number | null; ref_correo: string }
  | { estado: 'ignorado'; motivo: MotivoIgnorado; ref_correo: string }
  | { estado: 'por_revisar'; por_revisar_id: number; motivo: MotivoRevision; ref_correo: string; banco: Banco | null };

// ---------- Configuración ----------
export interface ConfigPlata {
  ingreso_mensual: Pesos | null;
  pct_ahorro: number;                        // 0..80
  umbral_gasto_alto: Pesos;
  umbral_hormiga: Pesos;
  umbral_impulso: Pesos;
  horas_espera_impulso: number;              // 48
  nocturno: { desde: HoraHM; hasta: HoraHM };          // '22:00'..'05:00' (cruza medianoche)
  horario_push: { desde: HoraHM; hasta: HoraHM };      // '07:00'..'21:30'
  pausa_hasta: InstanteISO | null;
  semaforo: { dia_amarillo: number; dia_rojo: number; mes_amarillo: number; mes_rojo: number };
  patrones_pago_tarjeta: string[];           // normalizados
  patrones_interno: string[];                // normalizados
  minutos_fusion: number;                    // 30
  minutos_duplicado: number;                 // 10
  max_push_por_evaluacion: number;           // 3
  tutorial_visto: boolean;                   // false hasta que Jero termina (u omite) el recorrido guiado
  estrategia_deudas: EstrategiaDeudas;       // 'avalancha' (mayor tasa primero) | 'bola_nieve' (menor saldo primero)
  pago_deudas_mensual: Pesos | null;         // lo que destina al mes a deudas; null = solo la suma de los mínimos
  dia_ingreso: number | null;                // 1..31: día del mes en que entra el ingreso (una vez al mes); null = irregular
}
export interface Presupuesto { mes: Mes | '*'; categoria_id: string | '*'; monto: Pesos; }
export interface GastoFijo {
  id: number; nombre: string; monto: Pesos; dia_mes: number | null;
  patron: string | null; categoria_id: string; activo: boolean;
}

// ---------- Recurrentes ----------
export type Periodo = 'semanal' | 'quincenal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';
export interface RecurrenteDetectado {
  comercio_norm: string; nombre: string; categoria_id: string;
  clase: 'suscripcion' | 'fijo' | 'habito'; periodo: Periodo;
  monto_tipico: Pesos; monto_anterior: Pesos | null; ocurrencias: number;
  primer_cobro: ISODate; ultimo_cobro: ISODate; proximo_cobro: ISODate | null;
  activa: boolean; costo_mensual: Pesos; costo_anual: Pesos;
  movimiento_ids: number[];
}
export interface Recurrente extends RecurrenteDetectado {
  id: number; estado: 'detectada' | 'confirmada' | 'descartada';
}

// ---------- Metas y espera ----------
export interface Meta {
  id: number; nombre: string; emoji: string; objetivo: Pesos;
  fecha_objetivo: ISODate | null; estado: 'activa' | 'pausada' | 'cumplida' | 'cancelada';
  prioridad: number; creada_en: InstanteISO;
}
export interface AporteMeta { id: number; meta_id: number; fecha: ISODate; monto: Pesos; nota: string | null; }
export interface MetaConAportes extends Meta { aportes: AporteMeta[]; aportado: Pesos; }
export interface ItemEspera {
  id: number; descripcion: string; monto: Pesos; categoria_id: string;
  creado_en: InstanteISO; disponible_en: InstanteISO;
  estado: 'esperando' | 'comprado' | 'descartado'; recordado_en: InstanteISO | null;
}

// ---------- Saldos y deudas (migración 5) ----------
export type TipoCuenta = 'efectivo' | 'banco' | 'ahorro';
export interface Cuenta {
  id: number; nombre: string; tipo: TipoCuenta;
  saldo: Pesos;                         // entero ≥ 0 (un sobregiro se anota como deuda)
  creado_en: InstanteISO; actualizado_en: InstanteISO;
}
export type TipoDeuda = 'tarjeta' | 'prestamo' | 'otra';
export interface Deuda {
  id: number; nombre: string; tipo: TipoDeuda;
  saldo: Pesos;                         // lo que se debe hoy (≥ 0)
  tasa_ea: number;                      // % efectivo anual (28.5 = 28,5 % E.A.); 0 = sin intereses
  pago_minimo: Pesos;                   // cuota mínima mensual (≥ 0)
  dia_pago: number | null;              // 1..31; en meses cortos se toma el último día
  activa: boolean;
  creado_en: InstanteISO; actualizado_en: InstanteISO;
}
export type EstrategiaDeudas = 'avalancha' | 'bola_nieve';
export interface ProximoVencimiento {
  deuda_id: number; nombre: string; fecha: ISODate;
  dias: number;                         // 0 = hoy
  pago_minimo: Pesos;                   // min(pago_minimo, saldo)
}
/** Pagar SOLO el mínimo fijo de una deuda. `se_paga: false` = el mínimo no cubre los intereses (o pasa de 50 años). */
export interface SoloMinimo {
  deuda_id: number; nombre: string;
  se_paga: boolean;
  meses: number | null; intereses: Pesos | null; total_pagado: Pesos | null;
  interes_primer_mes: Pesos;            // saldo × tasa mensual (para el «por qué»)
}
export interface PlanDeudas {
  estrategia: EstrategiaDeudas;
  pago_mensual: Pesos;                  // lo que se reparte cada mes (≥ suma de mínimos)
  se_paga: boolean;                     // false = con ese pago no se sale de deudas en 50 años
  meses: number | null; intereses: Pesos | null;
  orden: { deuda_id: number; nombre: string; mes_pagada: number | null }[];   // en el orden en que se atacan
}
export interface ComparacionPlanes {
  avalancha: PlanDeudas; bola_nieve: PlanDeudas;
  recomendada: EstrategiaDeudas;
  ahorro_intereses: Pesos | null;       // intereses(bola de nieve) − intereses(avalancha); null si alguna no se paga
}
export interface ResumenSaldos {
  hay_cuentas: boolean; hay_deudas: boolean;
  saldo_total: Pesos;                   // Σ cuentas
  deuda_total: Pesos;                   // Σ saldo de deudas activas
  patrimonio_neto: Pesos;               // saldo_total − deuda_total
  minimos_mes: Pesos;                   // Σ min(pago_minimo, saldo) de deudas activas con saldo
  proximo_vencimiento: ProximoVencimiento | null;
  gasto_diario: Pesos;                  // ritmo del día a día + (fijos + mínimos) ÷ días del mes
  colchon_dias: number | null;          // ⌊saldo_total ÷ gasto_diario⌋; null sin cuentas o sin gasto
}

// ---------- Foto para cálculos puros ----------
export interface DiaCerrado { fecha: ISODate; limite: Pesos | null; gastado: Pesos; bajo_limite: boolean | null; modo: ModoCalculo; }
export interface EmisionPrevia {
  clave: string; regla: ReglaId; severidad: Severidad; valor_ref: number | null;
  primera_en: InstanteISO; ultima_en: InstanteISO; veces: number; silenciada_hasta: InstanteISO | null;
}
export interface EstadoSistema {
  ultimo_aviso_en: InstanteISO | null;
  avisos_promedio_diario_90d: number;
  por_revisar_pendientes: number;
  por_revisar_mas_viejo_en: InstanteISO | null;
  latidos: Partial<Record<'ingesta' | 'bot' | 'reportes' | 'historial', InstanteISO>>;
  pin_bloqueado_hasta: InstanteISO | null;
}
export interface Instantanea {
  ahora: Date;
  config: ConfigPlata;
  categorias: Categoria[];
  reglas: ReglaCategoria[];
  movimientos: Movimiento[];          // vivos (sin borrados), últimos 400 días hasta hoy, cualquier tipo
  presupuestos: Presupuesto[];
  fijos: GastoFijo[];                 // solo activos
  recurrentes: Recurrente[];
  metas: MetaConAportes[];            // activas y pausadas
  lista_espera: ItemEspera[];         // solo 'esperando'
  dias: DiaCerrado[];                 // últimos 400 días
  emisiones: EmisionPrevia[];
  sistema: EstadoSistema;
  cuentas: Cuenta[];                  // todas
  deudas: Deuda[];                    // solo activas
}

// ---------- Métricas ----------
export type ModoCalculo = 'presupuesto_total' | 'ingreso_configurado' | 'ingreso_estimado' | 'gasto_historico' | 'sin_datos';
// 'estimando' = habría sido rojo, pero la base de cálculo es una estimación (sin ingreso ni presupuesto configurados): no se alarma.
export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'gris' | 'estimando';
export interface BaseMensual {
  modo: ModoCalculo; aviso_modo: string | null;
  ingreso: Pesos | null; ingresos_recibidos: Pesos; fijos: Pesos; ahorro: Pesos;
  disponible_variable: Pesos | null;  // Vmes
  meses_referencia: Mes[];
}
/**
 * De dónde sale el límite de hoy (Fase A, 2026-10-09):
 * - 'ingreso'  → ingreso o presupuesto configurados (y, si hay cuentas, es menor que lo que dan las cuentas).
 * - 'saldo'    → la plata real de las cuentas de efectivo y banco.
 * - 'estimado' → sin cuentas, con una base supuesta (ingreso promedio o gasto histórico).
 * - null       → no hay con qué calcular.
 */
export type FuenteLimite = 'ingreso' | 'saldo' | 'estimado';

/**
 * CONTRATO ESTABLE de «hoy puedes gastar» híbrido (Fase A). Lo consumen Inicio y, en la Fase B, `veredictoPuedo`.
 * Todo en pesos enteros; lo calcula `calcularMetricas` (puro).
 *
 *   limite_ingreso = ⌊(Vmes − G_antes − P) ÷ dr⌋, mínimo 0                     (lo de siempre; null sin base)
 *   saldo_liquido  = Σ saldo de cuentas efectivo + banco (NO ahorro)
 *                    ± movimientos posteriores al `actualizado_en` de la cuenta a la que se atribuyen
 *   saldo_inicio_hoy = saldo_liquido + lo que hoy salió de esas cuentas como gasto variable (base estable del día)
 *   disponible_saldo = saldo_inicio_hoy − minimos_pendientes − comprometido − ahorro_pendiente
 *   limite_saldo   = disponible_saldo ≤ 0 ? 0 : ⌊disponible_saldo ÷ dr⌋
 *
 *   Con `config.dia_ingreso` (2026-10-09, retrocompatible): la plata de las cuentas solo tiene que durar hasta el próximo
 *   ingreso, no hasta fin de mes. Entonces `hasta` = fecha del próximo ingreso y, en vez de dr, se divide entre
 *   dias_hasta_ingreso = días de hoy a `hasta`, AMBOS incluidos (el día del ingreso lo cubre la plata vieja: conservador).
 *   minimos_pendientes y comprometido se cuentan de hoy a `hasta` (aunque crucen de mes); lo que vence después lo paga el
 *   ingreso nuevo. Regla del próximo ingreso (`proximoIngreso` en metricas.ts):
 *     p = primer día de ingreso ≥ hoy (día 31 o 30/29 en mes corto → último día del mes).
 *     Si hay un ingreso registrado entre p − 7 días y hoy (hoy dentro de esa ventana), el de p ya llegó (a tiempo o
 *     adelantado) → `hasta` = el día de ingreso siguiente. Si no → `hasta` = p (el día de ingreso sin registrar cuenta
 *     como que llega ese día: es el último del período viejo y el nuevo empieza al día siguiente).
 *   Sin dia_ingreso (ingreso irregular) o sin cuentas líquidas: hasta = null, dias_hasta_ingreso = null y todo es hasta
 *   fin de mes, igual que antes. limite_ingreso, dias_restantes y la base mensual NO cambian con dia_ingreso.
 *   Con ≥ 1 cuenta líquida: limite_hoy = min(limite_ingreso, limite_saldo) si el ingreso/presupuesto está CONFIGURADO;
 *   si la base es estimada o no hay, manda solo limite_saldo. Sin cuentas líquidas: limite_hoy = limite_ingreso (igual que antes).
 *   libre_hoy = limite_hoy − G_hoy.
 *
 * Sin cuentas líquidas los campos de saldo valen 0 / null y `hay_cuentas` es false.
 */
export interface BaseHoy {
  limita: FuenteLimite | null;
  hay_cuentas: boolean;                 // ≥ 1 cuenta de efectivo o banco (las de ahorro no cuentan)
  saldo_anotado: Pesos;                 // Σ saldos de efectivo + banco tal como se anotaron
  saldo_liquido: Pesos;                 // saldo_anotado ajustado por los movimientos posteriores = lo que hay ahora
  saldo_inicio_hoy: Pesos;              // saldo_liquido + gasto variable de hoy que salió de esas cuentas
  minimos_pendientes: Pesos;            // mínimos de deudas activas que vencen de hoy (incluido) a fin de mes (o a `hasta`)
  comprometido: Pesos;                  // suscripciones/fijos detectados + gastos fijos configurados sin pagar, de hoy a fin de mes (o a `hasta`)
  ahorro_pendiente: Pesos;              // pct_ahorro × ingresos recibidos este mes − aportes a metas del mes (≥ 0)
  disponible_saldo: Pesos | null;       // null sin cuentas
  limite_ingreso: Pesos | null;
  limite_saldo: Pesos | null;           // null sin cuentas
  dias_restantes: number;               // dr: días del mes que faltan, con hoy
  hasta: ISODate | null;                // fecha del próximo ingreso (último día que debe cubrir el saldo); null sin dia_ingreso o sin cuentas
  dias_hasta_ingreso: number | null;    // días de hoy a `hasta`, ambos incluidos: divisor de limite_saldo; null = se usa dr
  saldo_antiguo_dias: number | null;    // días desde la actualización más vieja de una cuenta líquida; null sin cuentas
  saldo_antiguo_cuenta: string | null;  // nombre de esa cuenta
}
export interface EstadoCategoria {
  categoria_id: string; gastado: Pesos; presupuesto: Pesos | null; pct: number | null;
  estado: 'ok' | 'cerca' | 'pasado' | 'sin_presupuesto';
}
export interface ComponenteScore { id: string; nombre: string; peso: number; puntos: number | null; detalle: string; }
export type TipoAnomalia = 'posible_duplicado' | 'monto_inusual' | 'gasto_alto';
export interface Anomalia { tipo: TipoAnomalia; movimiento_id: number; otro_id: number | null; detalle: string; cifras: Record<string, number>; }
export interface Metricas {
  fecha: ISODate; hora: HoraHM; mes: Mes;
  dias_mes: number; dia: number; dias_restantes: number;    // dias_restantes incluye hoy
  base: BaseMensual;                  // base por ingreso/presupuesto (no cambia con las cuentas)
  base_hoy: BaseHoy;                  // límite híbrido ingreso/saldo y su desglose (ver BaseHoy)
  gastado_mes: Pesos;                 // G: variable neto (incluye hoy y excesos de fijos)
  gastado_hoy: Pesos;
  comprometido_pendiente: Pesos;      // P
  limite_hoy: Pesos | null;           // híbrido: ver BaseHoy
  libre_hoy: Pesos | null;            // limite_hoy − gastado_hoy
  restante_mes: Pesos | null;         // con cuentas: el menor entre Vmes − G − P y disponible_saldo − gastado_hoy
  ritmo_diario: Pesos;
  proyeccion_fin_mes: Pesos;
  proyeccion_ratio: number | null;    // proyección / Vmes; con cuentas, el peor entre ese y (gasto proyectado de hoy a fin de mes) / disponible_saldo
  semaforo: Semaforo; semaforo_razon: string;
  por_categoria: EstadoCategoria[];
  hormiga: { cantidad: number; total: Pesos; pct_variable: number; top: { comercio: string; total: Pesos; cantidad: number }[]; proyeccion_mes: Pesos; proyeccion_anual: Pesos; total_7d: Pesos; promedio_semanal_previo: Pesos };
  nocturnas: { cantidad_7d: number; total_7d: Pesos; cantidad_mes: number; total_mes: Pesos; cantidad_30d: number };
  racha: { dias: number; record: number; hoy_bajo_limite: boolean | null };
  score: { valor: number | null; nivel: 'solida' | 'bien' | 'apretada' | 'riesgo' | null; componentes: ComponenteScore[] };
  mes_pasado: { gastado_a_la_fecha: Pesos; diferencia: Pesos; ratio: number | null } | null;
  anomalias: Anomalia[];              // de los últimos 7 días
  saldos: ResumenSaldos;              // cuentas y deudas (migración 5)
}

// ---------- Recomendaciones ----------
export type Severidad = 'info' | 'aviso' | 'alerta';
export type ReglaId =
  | 'pin_bloqueado' | 'fijos_superan_ingreso' | 'riesgo_fin_de_mes' | 'sin_avisos' | 'categoria_sobre_presupuesto'
  | 'posible_duplicado' | 'monto_inusual' | 'limite_dia_superado' | 'categoria_cerca_presupuesto'
  | 'ritmo_mayor_mes_pasado' | 'meta_atrasada' | 'gasto_hormiga' | 'compras_nocturnas' | 'espera_lista'
  | 'suscripcion_subio' | 'suscripcion_manana' | 'gasto_alto' | 'suscripcion_detectada' | 'por_revisar_pendientes'
  | 'ingreso_recibido' | 'buen_ritmo' | 'meta_cumplida' | 'racha_hito' | 'limite_dia_cerca' | 'sin_ingreso_configurado'
  | 'minimos_vs_ingreso' | 'vencimiento_deuda' | 'plan_deudas' | 'solo_minimo' | 'colchon_bajo';
export interface AccionRecomendacion { texto: string; comando?: string; callback_data?: string; ruta_panel?: string; }
export interface Recomendacion {
  id: string;                         // clave de deduplicación: `${regla}:${alcance}`
  regla: ReglaId; severidad: Severidad; prioridad: number;
  titulo: string;                     // ≤ 60 caracteres
  detalle_con_cifras: string;         // texto de plantilla, ya con cifras formateadas
  cifras: Record<string, number>;     // valores crudos usados (para la IA y para auditar)
  accion?: AccionRecomendacion;
  push: boolean;                      // ¿se puede mandar sola por Telegram?
  valor_ref: number;                  // para decidir si «cambió lo suficiente» y reemitir
}

// ---------- /puedo ----------
export interface ConsultaPuedo { monto: Pesos; descripcion: string; ahora: Date; categoria_id?: string; }
export interface Veredicto {
  decision: 'si' | 'espera' | 'no';
  titulo: string;                     // «Sí, cabe» / «Espera» / «Mejor no»
  razones: string[];                  // 1..4 frases con cifras; la primera es la decisiva
  regla_decisiva: string;             // id del paso de §4.3 (p1..p10)
  cifras: {
    monto: Pesos; libre_hoy: Pesos | null; restante_mes: Pesos | null; limite_hoy: Pesos | null;
    nuevo_limite: Pesos | null; presupuesto_cat: Pesos | null; restante_cat: Pesos | null;
    dias_restantes: number; retraso_meta_dias: number | null;
    // ---- Plata real y deudas (Fase B, 2026-10-09; solo se agregan campos). Sin cuentas de efectivo/banco, los de saldo valen null.
    saldo_total: Pesos | null;          // efectivo + banco ahora (= base_hoy.saldo_liquido); las cuentas de ahorro no cuentan
    saldo_tras: Pesos | null;           // saldo_total − monto (puede ser negativo)
    minimos_pendientes: Pesos;          // mínimos de deudas aún por pagar (base_hoy; sin cuentas, los que vencen de hoy a fin de mes)
    falta_minimos: Pesos | null;        // max(0, minimos_pendientes − saldo_tras): lo que faltaría para los mínimos tras comprar
    proximo_minimo: Pesos | null;       // mínimo del próximo vencimiento (m.saldos.proximo_vencimiento); null sin deudas con día de pago
    proximo_minimo_dias: number | null; // días hasta ese vencimiento (0 = hoy)
    colchon_dias: number | null;        // ⌊saldo_total ÷ gasto diario⌋ (gasto diario de m.saldos); null sin cuentas o sin gasto
    colchon_dias_tras: number | null;   // ⌊max(0, saldo_tras) ÷ gasto diario⌋
    // ---- Horizonte del próximo ingreso (2026-10-09; solo se agregan campos). Sin dia_ingreso: dias_nuevo_limite = dias_restantes, hasta_ingreso = null.
    dias_nuevo_limite: number;          // días en que se reparte la compra para nuevo_limite: dias_hasta_ingreso si manda el saldo, si no dr
    hasta_ingreso: ISODate | null;      // base_hoy.hasta cuando hay dia_ingreso y cuentas; minimos_pendientes ya es hasta esa fecha
  };
  categoria_id: string; esencial: boolean;
  regla_48h: boolean;                 // true = hay que agregar/retener en lista_espera
  lista_espera_id: number | null;     // lo llena quien persiste
}

// ---------- Bot ----------
export interface UpdateBot {
  update_id: number;
  chat_id: number | string;
  tipo: 'texto' | 'callback';
  texto?: string;                     // ≤ 4096
  callback_data?: string;             // ≤ 64 bytes
  callback_query_id?: string;         // ≤ 64
  message_id?: number;
}
export interface Boton { texto: string; callback_data?: string; url?: string; }
/** Contrato EXACTO con n8n: ver docs/BOT-UX.md §Contrato. */
export interface RespuestaBot {
  texto: string;                      // HTML de Telegram (b, i, u, s, code, pre, a); ≤ 4096. '' = no enviar mensaje
  botones?: Boton[][];                // inline_keyboard (debajo del mensaje)
  teclado?: string[][];               // menú fijo (ReplyKeyboardMarkup persistente); solo en mensajes nuevos sin `botones`
  quitar_teclado?: boolean;           // ReplyKeyboardRemove; solo en mensajes nuevos sin `botones`
  editar_message_id?: number;         // si viene: editMessageText en vez de sendMessage
  borrar_message_id?: number;         // deleteMessage de ese mensaje (con texto '' es lo único que se hace)
  answer_callback?: { texto?: string; alerta?: boolean };
}
export type NombreComando =
  | 'hoy' | 'semana' | 'mes' | 'ultimos' | 'categorias' | 'cat' | 'presupuesto' | 'ingreso' | 'meta'
  | 'puedo' | 'quiero' | 'suscripciones' | 'gasto' | 'deshacer' | 'pausa' | 'exportar' | 'pregunta'
  | 'panel' | 'ayuda' | 'menu';
export type ComandoBot =
  | { tipo: 'comando'; nombre: NombreComando; args: string }
  | { tipo: 'texto_libre'; texto: string }
  | { tipo: 'desconocido'; nombre: string };
/** Destinos de navegación `m:<dest>` (menú y panel «Más»). */
export const DESTINOS_MENU = ['hoy', 'mes', 'mas', 'ult', 'mov', 'rec', 'metas', 'subs', 'ing', 'ingk', 'pres', 'panel', 'pausa', 'pzoff', 'ayuda', 'pend', 'gasto', 'puedo', 'nmeta', 'cuentas', 'ing1'] as const;
export type DestinoMenu = (typeof DESTINOS_MENU)[number];
export type CallbackBot =
  | { accion: 'm'; dest: DestinoMenu }
  | { accion: 'k'; n: string; tecla: string } | { accion: 'c'; n: string; cat: string } | { accion: 'f'; n: string; op: string }
  | { accion: 'rm'; mov: number; cat: string } | { accion: 'pc'; mov: number; cat: string }
  | { accion: 'ni'; mov: number } | { accion: 'mv'; mov: number } | { accion: 'cn'; mov: number }
  | { accion: 'ps'; mov: number } | { accion: 'pi'; mov: number } | { accion: 'pu'; accion_id: number; mov: number }
  | { accion: 'bd' | 'bm' | 'bp' | 'be' | 'bq'; cat: string }
  | { accion: 'ah'; pct: number } | { accion: 'iu' }
  | { accion: 'me' | 'ma' | 'ms' | 'mp'; meta: number }
  | { accion: 'cat'; mov: number } | { accion: 'cs'; mov: number; cat: string }
  | { accion: 'ing'; mov: number } | { accion: 'gas'; mov: number } | { accion: 'int'; mov: number } | { accion: 'rev'; mov: number }
  | { accion: 'ign'; mov: number } | { accion: 'und'; accion_id: number }
  | { accion: 'dup'; mov: number } | { accion: 'ndp'; a: number; b: number } | { accion: 'vol'; mov: number }
  | { accion: 'sc'; rec: number } | { accion: 'sd'; rec: number }
  | { accion: 'ec'; item: number } | { accion: 'ed'; item: number } | { accion: 'e48'; item: number }
  | { accion: 'pz'; horas: number } | { accion: 'ok' };

// ---------- Puertos (I/O inyectado) ----------
export interface DescripcionDeshacer { accion_id: number; descripcion: string; }
export interface NuevoEvento { nivel: 'info' | 'aviso' | 'error'; tipo: string; detalle?: string; ref?: string; }
export class ErrorConflicto extends Error { constructor(public version_actual: number) { super('conflicto_version'); } }
export class ErrorUsuario extends Error { constructor(public codigo: string, mensaje: string) { super(mensaje); } }

/** Conversación en curso del bot (tabla `bot_estado`, una por chat, vence a los 15 min). */
export interface EstadoBot { flujo: string; datos: Record<string, unknown>; }

export interface AccesoDatos {
  instantanea(ahora: Date): Instantanea;
  ultimosMovimientos(n: number): Movimiento[];
  obtenerMovimiento(id: number): Movimiento | null;
  buscarMovimientos(f: FiltroMovimientos): PaginaMovimientos;
  crearMovimiento(nuevo: NuevoMovimiento, actor: Actor): Movimiento;
  editarMovimiento(id: number, cambios: CambiosMovimiento, actor: Actor): Movimiento;       // ErrorConflicto
  /** Con `aprender: false` solo cambia ese movimiento: no crea regla ni toca otros. Por defecto aprende (SPEC §1.4). */
  recategorizar(id: number, categoria_id: string, actor: Actor, opciones?: { aprender?: boolean }): { movimiento: Movimiento; aplicados_a: number };
  /** Última acción deshacible (no deshecha) que tocó ese movimiento; null si no hay. */
  ultimaAccionDe(movimiento_id: number): number | null;
  leerEstadoBot(chat_id: string, ahora: Date): EstadoBot | null;
  guardarEstadoBot(chat_id: string, estado: EstadoBot, ahora: Date): void;
  borrarEstadoBot(chat_id: string): void;
  borrarMovimiento(id: number, actor: Actor): { accion_id: number };
  deshacerUltima(actor: Actor, ahora: Date): DescripcionDeshacer | null;                    // ventana 24 h
  deshacer(accion_id: number, ahora: Date): DescripcionDeshacer | null;
  listarCategorias(): Categoria[];
  fijarPresupuesto(mes: Mes | '*', categoria_id: string | '*', monto: Pesos | null, actor: Actor): void;
  leerConfig(): ConfigPlata;
  fijarConfig<K extends keyof ConfigPlata>(clave: K, valor: ConfigPlata[K], actor: Actor): void;
  listarFijos(): GastoFijo[];
  guardarFijo(f: { nombre: string; monto: Pesos; dia_mes: number | null; patron: string | null; categoria_id?: string }, actor: Actor): GastoFijo;
  quitarFijo(nombre: string, actor: Actor): boolean;
  crearMeta(m: { nombre: string; objetivo: Pesos; fecha_objetivo: ISODate | null; emoji?: string }): Meta;
  buscarMetaPorNombre(nombre: string): MetaConAportes | null;
  aportarMeta(meta_id: number, monto: Pesos, fecha: ISODate, actor: Actor): AporteMeta;    // ErrorUsuario si deja saldo < 0
  cambiarEstadoMeta(meta_id: number, estado: Meta['estado']): Meta;
  agregarEspera(descripcion: string, monto: Pesos, categoria_id: string, ahora: Date): ItemEspera;
  actualizarEspera(id: number, accion: 'comprado' | 'descartado' | 'extender', ahora: Date): ItemEspera | null;
  marcarEsperaRecordada(ids: number[], ahora: Date): void;
  cambiarEstadoRecurrente(id: number, estado: 'confirmada' | 'descartada'): Recurrente | null;
  registrarEmisiones(recs: Recomendacion[], ahora: Date): void;
  silenciar(clave: string, hasta: InstanteISO): void;
  registrarEvento(e: NuevoEvento): void;
  /** Cuentas y deudas con las mismas validaciones que /api/cuentas y /api/deudas (ErrorUsuario si algo no cuadra). */
  crearCuenta(c: { nombre: string; tipo: TipoCuenta; saldo: Pesos }, ahora: Date): Cuenta;
  editarCuenta(id: number, c: { nombre?: string; tipo?: TipoCuenta; saldo?: Pesos }, ahora: Date): Cuenta;
  crearDeuda(d: { nombre: string; tipo: TipoDeuda; saldo: Pesos; tasa_ea: number; pago_minimo: Pesos; dia_pago: number | null }, ahora: Date): Deuda;
  editarDeuda(id: number, c: { nombre?: string; tipo?: TipoDeuda; saldo?: Pesos; tasa_ea?: number; pago_minimo?: Pesos; dia_pago?: number | null }, ahora: Date): Deuda;
}

export interface ClienteIA {
  disponible(): Promise<boolean>;
  chatJSON<T>(sistema: string, usuario: string, esquema: object, opts?: { timeoutMs?: number }): Promise<T | null>;
  chatTexto(sistema: string, usuario: string, opts?: { timeoutMs?: number; maxCaracteres?: number }): Promise<string | null>;
}
