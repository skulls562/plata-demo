// Base de datos SQLite (node:sqlite): apertura con pragmas, migraciones, transacciones, respaldo y mantenimiento.
// SPEC §1 y §8.1. Sentencias preparadas siempre; nada de interpolar datos en SQL.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ISODate } from './tipos';

declare global {
  // eslint-disable-next-line no-var
  var __plataDB: DatabaseSync | undefined;
}

/** Instante en el formato de la base: ISO UTC sin milisegundos ('2026-10-06T18:59:00Z'). */
export function aInstanteISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * La migración `i` (base 0) lleva la base de user_version = i a i + 1.
 * NUNCA se edita una migración publicada: se agrega otra al final.
 */
export const MIGRACIONES: string[] = [
// ---- Migración 1 (SPEC §1.2 + semillas §1.4) ----
`
-- ===== Catálogos =====
CREATE TABLE categorias (
  id             TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 24 AND id NOT GLOB '*[^a-z0-9_]*'),
  nombre         TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  emoji          TEXT NOT NULL CHECK (length(emoji) BETWEEN 1 AND 8),
  es_gasto       INTEGER NOT NULL DEFAULT 1 CHECK (es_gasto IN (0,1)),
  esencial       INTEGER NOT NULL DEFAULT 0 CHECK (esencial IN (0,1)),
  cuenta_hormiga INTEGER NOT NULL DEFAULT 1 CHECK (cuenta_hormiga IN (0,1)),
  orden          INTEGER NOT NULL DEFAULT 100,
  sistema        INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0,1)),
  activa         INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1))
) STRICT;

INSERT INTO categorias (id, nombre, emoji, es_gasto, esencial, cuenta_hormiga, orden, sistema) VALUES
 ('mercado',       'Mercado',       '🛒', 1, 1, 1,  1, 0),
 ('comida',        'Comida',        '🍔', 1, 0, 1,  2, 0),
 ('transporte',    'Transporte',    '🚕', 1, 1, 1,  3, 0),
 ('suscripciones', 'Suscripciones', '📱', 1, 0, 0,  4, 0),
 ('salud',         'Salud',         '💊', 1, 1, 0,  5, 0),
 ('ocio',          'Ocio',          '🎟', 1, 0, 1,  6, 0),
 ('compras',       'Compras',       '🛍', 1, 0, 1,  7, 0),
 ('estudio',       'Estudio',       '🎓', 1, 1, 0,  8, 0),
 ('servicios',     'Servicios',     '🏠', 1, 1, 0,  9, 0),
 ('otros',         'Otros',         '📦', 1, 0, 1, 10, 0),
 ('ingresos',      'Ingresos',      '💰', 0, 0, 0, 90, 1),   -- sistema: entradas
 ('interno',       'Entre cuentas', '🔁', 0, 0, 0, 91, 1);   -- sistema: interno / pago de tarjeta

CREATE TABLE reglas_categoria (
  id             INTEGER PRIMARY KEY,
  patron         TEXT NOT NULL UNIQUE CHECK (length(patron) BETWEEN 2 AND 60 AND patron NOT GLOB '*[^a-z0-9 ]*'),
  categoria_id   TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE ON DELETE CASCADE,
  origen         TEXT NOT NULL CHECK (origen IN ('semilla','aprendida','manual')),
  aciertos       INTEGER NOT NULL DEFAULT 0,
  creada_en      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actualizada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;
-- Reglas semilla de §1.4 (origen = 'semilla'), ya normalizadas.
INSERT INTO reglas_categoria (patron, categoria_id, origen) VALUES
 ('d1','mercado','semilla'),
 ('ara','mercado','semilla'),
 ('exito','mercado','semilla'),
 ('carulla','mercado','semilla'),
 ('olimpica','mercado','semilla'),
 ('jumbo','mercado','semilla'),
 ('euro supermercado','mercado','semilla'),
 ('isimo','mercado','semilla'),
 ('surtimax','mercado','semilla'),
 ('super inter','mercado','semilla'),
 ('merqueo','mercado','semilla'),
 ('mercado','mercado','semilla'),
 ('supermercado','mercado','semilla'),
 ('oxxo','mercado','semilla'),
 ('justo y bueno','mercado','semilla'),
 ('colsubsidio mercado','mercado','semilla'),
 ('rappi','comida','semilla'),
 ('ifood','comida','semilla'),
 ('domicilios','comida','semilla'),
 ('mcdonalds','comida','semilla'),
 ('kfc','comida','semilla'),
 ('frisby','comida','semilla'),
 ('el corral','comida','semilla'),
 ('crepes','comida','semilla'),
 ('presto','comida','semilla'),
 ('juan valdez','comida','semilla'),
 ('starbucks','comida','semilla'),
 ('oma','comida','semilla'),
 ('dunkin','comida','semilla'),
 ('subway','comida','semilla'),
 ('burger','comida','semilla'),
 ('pizza','comida','semilla'),
 ('sushi','comida','semilla'),
 ('restaurante','comida','semilla'),
 ('panaderia','comida','semilla'),
 ('cafe','comida','semilla'),
 ('wok','comida','semilla'),
 ('qbano','comida','semilla'),
 ('piqueteadero','comida','semilla'),
 ('didi','transporte','semilla'),
 ('uber','transporte','semilla'),
 ('cabify','transporte','semilla'),
 ('indrive','transporte','semilla'),
 ('metro de medellin','transporte','semilla'),
 ('civica','transporte','semilla'),
 ('terpel','transporte','semilla'),
 ('primax','transporte','semilla'),
 ('texaco','transporte','semilla'),
 ('biomax','transporte','semilla'),
 ('esso','transporte','semilla'),
 ('peaje','transporte','semilla'),
 ('parqueadero','transporte','semilla'),
 ('gasolina','transporte','semilla'),
 ('tembici','transporte','semilla'),
 ('taxi','transporte','semilla'),
 ('netflix','suscripciones','semilla'),
 ('spotify','suscripciones','semilla'),
 ('disney','suscripciones','semilla'),
 ('hbo','suscripciones','semilla'),
 ('prime video','suscripciones','semilla'),
 ('amazon prime','suscripciones','semilla'),
 ('youtube','suscripciones','semilla'),
 ('apple com','suscripciones','semilla'),
 ('icloud','suscripciones','semilla'),
 ('google one','suscripciones','semilla'),
 ('google play','suscripciones','semilla'),
 ('chatgpt','suscripciones','semilla'),
 ('openai','suscripciones','semilla'),
 ('anthropic','suscripciones','semilla'),
 ('claude ai','suscripciones','semilla'),
 ('crunchyroll','suscripciones','semilla'),
 ('paramount','suscripciones','semilla'),
 ('deezer','suscripciones','semilla'),
 ('canva','suscripciones','semilla'),
 ('microsoft','suscripciones','semilla'),
 ('xbox','suscripciones','semilla'),
 ('playstation','suscripciones','semilla'),
 ('adobe','suscripciones','semilla'),
 ('notion','suscripciones','semilla'),
 ('github','suscripciones','semilla'),
 ('drogueria','salud','semilla'),
 ('farmacia','salud','semilla'),
 ('cruz verde','salud','semilla'),
 ('farmatodo','salud','semilla'),
 ('pasteur','salud','semilla'),
 ('la rebaja','salud','semilla'),
 ('clinica','salud','semilla'),
 ('laboratorio','salud','semilla'),
 ('odontolog','salud','semilla'),
 ('optica','salud','semilla'),
 ('eps','salud','semilla'),
 ('sura','salud','semilla'),
 ('colsanitas','salud','semilla'),
 ('medico','salud','semilla'),
 ('cine','ocio','semilla'),
 ('cinecolombia','ocio','semilla'),
 ('procinal','ocio','semilla'),
 ('cinemark','ocio','semilla'),
 ('tuboleta','ocio','semilla'),
 ('eticket','ocio','semilla'),
 ('steam','ocio','semilla'),
 ('epic games','ocio','semilla'),
 ('teatro','ocio','semilla'),
 ('concierto','ocio','semilla'),
 ('bar','ocio','semilla'),
 ('discoteca','ocio','semilla'),
 ('parque','ocio','semilla'),
 ('falabella','compras','semilla'),
 ('mercadolibre','compras','semilla'),
 ('mercado libre','compras','semilla'),
 ('amazon','compras','semilla'),
 ('temu','compras','semilla'),
 ('shein','compras','semilla'),
 ('zara','compras','semilla'),
 ('arturo calle','compras','semilla'),
 ('koaj','compras','semilla'),
 ('studio f','compras','semilla'),
 ('homecenter','compras','semilla'),
 ('alkosto','compras','semilla'),
 ('ktronix','compras','semilla'),
 ('dafiti','compras','semilla'),
 ('adidas','compras','semilla'),
 ('nike','compras','semilla'),
 ('tennis','compras','semilla'),
 ('flamingo','compras','semilla'),
 ('pepe ganga','compras','semilla'),
 ('universidad','estudio','semilla'),
 ('eafit','estudio','semilla'),
 ('udea','estudio','semilla'),
 ('upb','estudio','semilla'),
 ('unal','estudio','semilla'),
 ('coursera','estudio','semilla'),
 ('udemy','estudio','semilla'),
 ('platzi','estudio','semilla'),
 ('panamericana','estudio','semilla'),
 ('libreria','estudio','semilla'),
 ('icetex','estudio','semilla'),
 ('epm','servicios','semilla'),
 ('une','servicios','semilla'),
 ('tigo','servicios','semilla'),
 ('claro','servicios','semilla'),
 ('movistar','servicios','semilla'),
 ('wom','servicios','semilla'),
 ('etb','servicios','semilla'),
 ('vanti','servicios','semilla'),
 ('aseo','servicios','semilla'),
 ('administracion','servicios','semilla'),
 ('arriendo','servicios','semilla'),
 ('internet','servicios','semilla'),
 ('energia','servicios','semilla'),
 ('acueducto','servicios','semilla');

-- ===== Configuración =====
CREATE TABLE config (            -- solo valores que Jero cambió; los demás salen de CONFIG_POR_DEFECTO
  clave          TEXT PRIMARY KEY CHECK (length(clave) <= 40),
  valor          TEXT NOT NULL CHECK (json_valid(valor) AND length(valor) <= 4096),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

CREATE TABLE secretos (          -- separado de config: GET /api/config nunca lo toca
  clave TEXT PRIMARY KEY CHECK (clave IN ('pin_hash')),
  valor TEXT NOT NULL CHECK (length(valor) <= 300),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

CREATE TABLE gastos_fijos (
  id           INTEGER PRIMARY KEY,
  nombre       TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  nombre_norm  TEXT NOT NULL UNIQUE,
  monto        INTEGER NOT NULL CHECK (monto > 0 AND monto <= 1000000000),
  dia_mes      INTEGER CHECK (dia_mes IS NULL OR dia_mes BETWEEN 1 AND 31),
  patron       TEXT CHECK (patron IS NULL OR (length(patron) BETWEEN 2 AND 60 AND patron NOT GLOB '*[^a-z0-9 ]*')),
  categoria_id TEXT NOT NULL DEFAULT 'servicios' REFERENCES categorias(id) ON UPDATE CASCADE,
  activo       INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  creado_en    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

-- Presupuestos: mes = 'AAAA-MM' o '*' (todos los meses); categoria_id = id o '*' (total del gasto variable).
-- Se usan centinelas en vez de NULL porque en SQLite UNIQUE/PK no impide filas repetidas con NULL.
CREATE TABLE presupuestos (
  mes          TEXT NOT NULL CHECK (mes = '*' OR (mes GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND date(mes || '-01') IS (mes || '-01'))),
  categoria_id TEXT NOT NULL,
  monto        INTEGER NOT NULL CHECK (monto > 0 AND monto <= 10000000000),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (mes, categoria_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER presupuestos_cat_ins BEFORE INSERT ON presupuestos
  WHEN NEW.categoria_id <> '*' AND NOT EXISTS (SELECT 1 FROM categorias WHERE id = NEW.categoria_id AND es_gasto = 1)
  BEGIN SELECT RAISE(ABORT, 'categoria_invalida'); END;
CREATE TRIGGER presupuestos_cat_upd BEFORE UPDATE OF categoria_id ON presupuestos
  WHEN NEW.categoria_id <> '*' AND NOT EXISTS (SELECT 1 FROM categorias WHERE id = NEW.categoria_id AND es_gasto = 1)
  BEGIN SELECT RAISE(ABORT, 'categoria_invalida'); END;
-- Borrar presupuesto = DELETE de la fila (monto 0 no se guarda).

-- ===== Recurrentes (resultado persistido de suscripciones.ts) =====
CREATE TABLE recurrentes (
  id             INTEGER PRIMARY KEY,
  comercio_norm  TEXT NOT NULL UNIQUE,
  nombre         TEXT NOT NULL CHECK (length(nombre) <= 120),
  categoria_id   TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE,
  clase          TEXT NOT NULL CHECK (clase IN ('suscripcion','fijo','habito')),
  periodo        TEXT NOT NULL CHECK (periodo IN ('semanal','quincenal','mensual','bimestral','trimestral','semestral','anual')),
  monto_tipico   INTEGER NOT NULL CHECK (monto_tipico > 0),
  monto_anterior INTEGER CHECK (monto_anterior IS NULL OR monto_anterior > 0),
  ocurrencias    INTEGER NOT NULL CHECK (ocurrencias >= 2),
  primer_cobro   TEXT NOT NULL CHECK (date(primer_cobro) IS primer_cobro),
  ultimo_cobro   TEXT NOT NULL CHECK (date(ultimo_cobro) IS ultimo_cobro),
  proximo_cobro  TEXT CHECK (proximo_cobro IS NULL OR date(proximo_cobro) IS proximo_cobro),
  activa         INTEGER NOT NULL CHECK (activa IN (0,1)),
  estado         TEXT NOT NULL DEFAULT 'detectada' CHECK (estado IN ('detectada','confirmada','descartada')),
  costo_anual    INTEGER NOT NULL CHECK (costo_anual >= 0),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

-- ===== Movimientos =====
CREATE TABLE movimientos (
  id               INTEGER PRIMARY KEY,
  fecha            TEXT NOT NULL CHECK (date(fecha) IS fecha),
  hora             TEXT CHECK (hora IS NULL OR (hora GLOB '[0-2][0-9]:[0-5][0-9]' AND hora < '24:00')),
  banco            TEXT NOT NULL CHECK (banco IN ('bancolombia','wompi','pse','rappicard','didi','nequi','efectivo','otro')),
  tipo             TEXT NOT NULL CHECK (tipo IN ('compra','pago','retiro','transferencia','ingreso','reverso','pago_tarjeta','interno')),
  sentido          TEXT NOT NULL CHECK (sentido IN ('salida','entrada')),
  monto            INTEGER NOT NULL CHECK (monto > 0 AND monto <= 10000000000),
  comercio         TEXT NOT NULL CHECK (length(comercio) BETWEEN 1 AND 120),
  comercio_norm    TEXT NOT NULL CHECK (length(comercio_norm) <= 120),
  categoria_id     TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE,
  categoria_fuente TEXT NOT NULL CHECK (categoria_fuente IN ('regla','aprendida','manual','ia','defecto')),
  computa          INTEGER NOT NULL DEFAULT 1 CHECK (computa IN (0,1)),
  fijo_id          INTEGER REFERENCES gastos_fijos(id) ON DELETE SET NULL,
  recurrente_id    INTEGER REFERENCES recurrentes(id) ON DELETE SET NULL,
  medio            TEXT CHECK (medio IS NULL OR medio IN ('debito','credito','cuenta','pse','efectivo','otro')),
  origen           TEXT NOT NULL CHECK (origen IN ('aviso','manual','historial')),
  confianza        TEXT NOT NULL CHECK (confianza IN ('regla','ia','manual')),
  verificado       INTEGER NOT NULL DEFAULT 0 CHECK (verificado IN (0,1)),   -- DKIM/DMARC del correo
  ref_correo       TEXT UNIQUE,            -- NULL solo si origen = 'manual'
  ref_secundaria   TEXT UNIQUE,            -- aviso de pasarela fusionado (Wompi/PSE) con este movimiento
  huella           TEXT NOT NULL,
  huella_seq       INTEGER NOT NULL DEFAULT 0 CHECK (huella_seq >= 0),
  nota             TEXT CHECK (nota IS NULL OR length(nota) <= 280),
  creado_en        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actualizado_en   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  borrado_en       TEXT,                   -- borrado lógico («ignorar»); fuera de todo cálculo
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ( (tipo IN ('ingreso','reverso') AND sentido = 'entrada')
       OR (tipo IN ('compra','pago','retiro','transferencia','pago_tarjeta') AND sentido = 'salida')
       OR  tipo = 'interno' ),
  CHECK (tipo NOT IN ('pago_tarjeta','interno') OR computa = 0),
  CHECK ((origen = 'manual') = (ref_correo IS NULL)),
  UNIQUE (huella, huella_seq)
) STRICT;
-- Los índices parciales solo se usan si la consulta repite literalmente «borrado_en IS NULL».
CREATE INDEX idx_mov_fecha     ON movimientos (fecha, hora, id)       WHERE borrado_en IS NULL;
CREATE INDEX idx_mov_comercio  ON movimientos (comercio_norm, fecha)  WHERE borrado_en IS NULL;
CREATE INDEX idx_mov_categoria ON movimientos (categoria_id, fecha)   WHERE borrado_en IS NULL;
CREATE INDEX idx_mov_monto     ON movimientos (monto, fecha)          WHERE borrado_en IS NULL;
CREATE INDEX idx_mov_creado    ON movimientos (creado_en);

-- Libro de TODOS los correos procesados (incluidos ignorados y por revisar): idempotencia de /api/avisos.
CREATE TABLE avisos_procesados (
  ref_correo     TEXT PRIMARY KEY CHECK (length(ref_correo) BETWEEN 8 AND 80),
  estado         TEXT NOT NULL CHECK (estado IN ('creado','fusionado','ignorado','por_revisar')),
  motivo         TEXT CHECK (motivo IS NULL OR length(motivo) <= 40),
  banco          TEXT,
  movimiento_id  INTEGER REFERENCES movimientos(id),
  por_revisar_id INTEGER REFERENCES por_revisar(id),
  procesado_en   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

CREATE TABLE por_revisar (
  id                INTEGER PRIMARY KEY,
  ref_correo        TEXT NOT NULL UNIQUE,
  remitente_dominio TEXT NOT NULL CHECK (length(remitente_dominio) <= 120),
  banco             TEXT,
  asunto            TEXT NOT NULL CHECK (length(asunto) <= 200),     -- enmascarado
  texto             TEXT NOT NULL CHECK (length(texto) <= 4000),     -- enmascarado y recortado
  fecha_correo      TEXT NOT NULL,                                   -- instante ISO UTC
  motivo            TEXT NOT NULL CHECK (motivo IN ('formato_desconocido','ia_no_disponible','ia_invalida',
                                       'monto_no_verificado','autenticacion_fallida','fecha_invalida')),
  intentos          INTEGER NOT NULL DEFAULT 0,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelto','descartado')),
  movimiento_id     INTEGER REFERENCES movimientos(id),
  creado_en         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  resuelto_en       TEXT
) STRICT;
CREATE INDEX idx_revisar_estado ON por_revisar (estado, creado_en);

-- ===== Metas y lista de espera =====
CREATE TABLE metas (
  id             INTEGER PRIMARY KEY,
  nombre         TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  nombre_norm    TEXT NOT NULL,
  emoji          TEXT NOT NULL DEFAULT '🎯' CHECK (length(emoji) <= 8),
  objetivo       INTEGER NOT NULL CHECK (objetivo > 0 AND objetivo <= 10000000000),
  fecha_objetivo TEXT CHECK (fecha_objetivo IS NULL OR date(fecha_objetivo) IS fecha_objetivo),
  estado         TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','pausada','cumplida','cancelada')),
  prioridad      INTEGER NOT NULL DEFAULT 100,
  creada_en      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cumplida_en    TEXT
) STRICT;
CREATE UNIQUE INDEX idx_metas_nombre_viva ON metas (nombre_norm) WHERE estado IN ('activa','pausada');

CREATE TABLE aportes_meta (
  id        INTEGER PRIMARY KEY,
  meta_id   INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  fecha     TEXT NOT NULL CHECK (date(fecha) IS fecha),
  monto     INTEGER NOT NULL CHECK (monto <> 0 AND abs(monto) <= 10000000000),  -- negativo = retiro
  nota      TEXT CHECK (nota IS NULL OR length(nota) <= 140),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;
CREATE INDEX idx_aportes_meta ON aportes_meta (meta_id, fecha);

CREATE TABLE lista_espera (
  id               INTEGER PRIMARY KEY,
  descripcion      TEXT NOT NULL CHECK (length(descripcion) BETWEEN 1 AND 80),
  descripcion_norm TEXT NOT NULL,
  monto            INTEGER NOT NULL CHECK (monto > 0),
  categoria_id     TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE,
  creado_en        TEXT NOT NULL,
  disponible_en    TEXT NOT NULL,          -- creado_en + 48 h
  estado           TEXT NOT NULL DEFAULT 'esperando' CHECK (estado IN ('esperando','comprado','descartado')),
  recordado_en     TEXT,
  cerrado_en       TEXT
) STRICT;
CREATE INDEX idx_espera_estado ON lista_espera (estado, disponible_en);

-- ===== Cálculo persistido =====
CREATE TABLE dias (                      -- foto de cada día cerrado (para rachas); no se recalcula
  fecha        TEXT PRIMARY KEY CHECK (date(fecha) IS fecha),
  limite       INTEGER,                  -- NULL si ese día no había base de cálculo
  gastado      INTEGER NOT NULL CHECK (gastado >= 0),
  bajo_limite  INTEGER CHECK (bajo_limite IS NULL OR bajo_limite IN (0,1)),
  modo         TEXT NOT NULL,
  calculado_en TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE emisiones (                 -- deduplicación/cooldown de recomendaciones enviadas
  clave            TEXT PRIMARY KEY CHECK (length(clave) <= 120),
  regla            TEXT NOT NULL,
  severidad        TEXT NOT NULL CHECK (severidad IN ('info','aviso','alerta')),
  valor_ref        REAL,
  primera_en       TEXT NOT NULL,
  ultima_en        TEXT NOT NULL,
  veces            INTEGER NOT NULL DEFAULT 1,
  silenciada_hasta TEXT
) STRICT, WITHOUT ROWID;

-- ===== Bitácora, deshacer, sistema =====
CREATE TABLE eventos (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  nivel   TEXT NOT NULL CHECK (nivel IN ('info','aviso','error')),
  tipo    TEXT NOT NULL CHECK (length(tipo) <= 40),
  detalle TEXT CHECK (detalle IS NULL OR length(detalle) <= 500),   -- siempre enmascarado
  ref     TEXT CHECK (ref IS NULL OR length(ref) <= 80)
) STRICT;
CREATE INDEX idx_eventos_ts   ON eventos (ts);
CREATE INDEX idx_eventos_tipo ON eventos (tipo, ts);

CREATE TABLE acciones (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actor       TEXT NOT NULL CHECK (actor IN ('bot','panel','n8n','sistema')),
  tipo        TEXT NOT NULL CHECK (tipo IN ('crear_movimiento','editar_movimiento','recategorizar','borrar_movimiento',
                                            'fijar_presupuesto','fijar_config','aporte_meta','guardar_fijo','quitar_fijo')),
  entidad_id  INTEGER,
  antes       TEXT NOT NULL CHECK (json_valid(antes) AND length(antes) <= 65536),
  descripcion TEXT NOT NULL CHECK (length(descripcion) <= 200),
  deshecha_en TEXT
) STRICT;
CREATE INDEX idx_acciones_vivas ON acciones (ts) WHERE deshecha_en IS NULL;

CREATE TABLE latidos (
  flujo     TEXT PRIMARY KEY CHECK (flujo IN ('ingesta','bot','reportes','historial')),
  ultimo_en TEXT NOT NULL,
  detalle   TEXT CHECK (detalle IS NULL OR length(detalle) <= 200)
) STRICT, WITHOUT ROWID;

CREATE TABLE sesiones (
  id_hash             TEXT PRIMARY KEY CHECK (length(id_hash) = 64),   -- sha256 hex del id de sesión
  creada_en           TEXT NOT NULL,
  expira_en           TEXT NOT NULL,
  ultima_actividad_en TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE limites (                   -- límite de intentos de PIN (clave 'pin')
  clave             TEXT PRIMARY KEY,
  fallos            INTEGER NOT NULL DEFAULT 0,
  ventana_desde     TEXT NOT NULL,
  fallos_24h        INTEGER NOT NULL DEFAULT 0,
  ventana_24h_desde TEXT NOT NULL,
  bloqueado_hasta   TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE bot_updates (               -- idempotencia de /api/bot (reintentos de n8n)
  update_id   INTEGER PRIMARY KEY,
  recibido_en TEXT NOT NULL,
  respuesta   TEXT NOT NULL CHECK (json_valid(respuesta))
) STRICT;

CREATE TABLE idempotencia (              -- cabecera Idempotency-Key en POST de la API
  ruta          TEXT NOT NULL,
  clave         TEXT NOT NULL CHECK (length(clave) BETWEEN 8 AND 64),
  huella_cuerpo TEXT NOT NULL,           -- sha256 hex del cuerpo
  estado_http   INTEGER NOT NULL,
  respuesta     TEXT NOT NULL,
  creado_en     TEXT NOT NULL,
  PRIMARY KEY (ruta, clave)
) STRICT, WITHOUT ROWID;
`,
// ---- Migración 2 (calidad de datos: categorías por tipo y reglas semilla de comercios colombianos frecuentes) ----
`
-- Solo agrega. INSERT OR IGNORE: nunca pisa categorías ni reglas que Jero ya tenga (manual/aprendida).
INSERT OR IGNORE INTO categorias (id, nombre, emoji, es_gasto, esencial, cuenta_hormiga, orden, sistema) VALUES
 ('transferencias', 'Transferencias', '💸', 1, 0, 0, 11, 0),
 ('deudas',         'Deudas / financiero', '🏦', 1, 1, 0, 12, 0),
 ('efectivo',       'Efectivo', '💵', 1, 0, 0, 13, 0);

INSERT OR IGNORE INTO reglas_categoria (patron, categoria_id, origen) VALUES
 ('gopass','transporte','semilla'),
 ('eds','transporte','semilla'),
 ('parking','transporte','semilla'),
 ('pon tu precio','transporte','semilla'),
 ('lubritodo','transporte','semilla'),
 ('lubricentro','transporte','semilla'),
 ('estacion de servicio','transporte','semilla'),
 ('s publicas de medellin','servicios','semilla'),
 ('empresas publicas','servicios','semilla'),
 ('comunicacion celular','servicios','semilla'),
 ('comcel','servicios','semilla'),
 ('univers','estudio','semilla'),
 ('univ pontificia','estudio','semilla'),
 ('novaventa','compras','semilla'),
 ('dollarcity','compras','semilla'),
 ('miniso','compras','semilla'),
 ('hym','compras','semilla'),
 ('h y m','compras','semilla'),
 ('alkomprar','compras','semilla'),
 ('recanto','comida','semilla'),
 ('taco factory','comida','semilla'),
 ('coffee lab','comida','semilla'),
 ('sabor llanero','comida','semilla'),
 ('sabor y tradicion','comida','semilla'),
 ('mcdonal','comida','semilla'),
 ('papa john','comida','semilla'),
 ('kokoriko','comida','semilla'),
 ('heladeria','comida','semilla'),
 ('taqueria','comida','semilla'),
 ('dim sum','comida','semilla'),
 ('cocorollo','comida','semilla'),
 ('mesa de abuela','comida','semilla'),
 ('pastelitos','comida','semilla'),
 ('fit and fat food','comida','semilla'),
 ('long hang','comida','semilla'),
 ('mimos','comida','semilla'),
 ('rapipharma','salud','semilla'),
 ('pharma','salud','semilla'),
 ('farma','salud','semilla'),
 ('el faro de la marini','mercado','semilla'),
 ('superoriente','mercado','semilla'),
 ('fruver','mercado','semilla'),
 ('airbnb','ocio','semilla'),
 ('despegar','ocio','semilla'),
 ('multiplex','ocio','semilla'),
 ('eneba','ocio','semilla'),
 ('g2a','ocio','semilla'),
 ('ticketing','ocio','semilla'),
 ('alcanos','servicios','semilla'),
 ('banco davivienda','deudas','semilla'),
 ('davivienda','deudas','semilla'),
 ('hdi','deudas','semilla'),
 ('financiacion','deudas','semilla');
`,
// ---- Migración 3 (decisión de Jero, 2026-10-09: una transferencia no es gasto por defecto) ----
`
-- Las transferencias (incluidas llaves Bre-B y «Transferencia a cuenta») dejan de contar como gasto: computa = 0.
-- Cuenta como gasto solo si Jero la marca (panel «Cuenta como gasto» o botón «Fue un gasto» del bot), que pone computa = 1.
-- Los retiros de cajero siguen contando; los ingresos no cambian.
-- ¿Cómo se distingue una marca de Jero? Hasta esta migración NO existía forma de marcar una transferencia como gasto
-- (computa valía 1 para todas), así que ninguna marca explícita de computa puede existir. Se usa como señal conservadora
-- de «Jero ya la revisó» el que él haya puesto la categoría a mano (categoria_fuente = 'manual'): esas se respetan.
-- Tampoco se tocan las ligadas a un gasto fijo (p. ej. el arriendo pagado por transferencia): si no, el fijo quedaría «sin pagar».
-- Desde ahora, un 1 en computa de una transferencia es siempre una decisión de Jero (el valor nuevo por defecto es 0).
UPDATE movimientos
   SET computa = 0, version = version + 1, actualizado_en = strftime('%Y-%m-%dT%H:%M:%SZ','now')
 WHERE tipo = 'transferencia' AND computa = 1 AND categoria_fuente <> 'manual' AND fijo_id IS NULL;
`,
// ---- Migración 4 (bot sin comandos: estado de conversación, docs/BOT-UX.md) ----
`
-- Una conversación por chat (teclado numérico, preguntas de seguimiento). Vence a los 15 min; solo agrega.
CREATE TABLE bot_estado (
  chat_id   TEXT PRIMARY KEY CHECK (length(chat_id) BETWEEN 1 AND 24),
  flujo     TEXT NOT NULL CHECK (length(flujo) BETWEEN 1 AND 24),
  datos     TEXT NOT NULL CHECK (json_valid(datos)),
  expira_en TEXT NOT NULL
) STRICT, WITHOUT ROWID;
`,
// ---- Migración 5 (rediseño 2026-10-09: saldo en cuentas y deudas con tasa, mínimo y día de pago) ----
`
-- Solo agrega tablas nuevas; no toca datos existentes. Montos en pesos enteros, tasa en % efectivo anual.
CREATE TABLE cuentas (
  id             INTEGER PRIMARY KEY,
  nombre         TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  nombre_norm    TEXT NOT NULL UNIQUE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('efectivo','banco','ahorro')),
  saldo          INTEGER NOT NULL CHECK (saldo >= 0 AND saldo <= 10000000000),
  creado_en      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;

CREATE TABLE deudas (
  id             INTEGER PRIMARY KEY,
  nombre         TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  nombre_norm    TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('tarjeta','prestamo','otra')),
  saldo          INTEGER NOT NULL CHECK (saldo >= 0 AND saldo <= 10000000000),
  tasa_ea        REAL NOT NULL CHECK (tasa_ea >= 0 AND tasa_ea <= 1000),
  pago_minimo    INTEGER NOT NULL CHECK (pago_minimo >= 0 AND pago_minimo <= 10000000000),
  dia_pago       INTEGER CHECK (dia_pago IS NULL OR dia_pago BETWEEN 1 AND 31),
  activa         INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
  creado_en      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) STRICT;
CREATE UNIQUE INDEX idx_deudas_nombre_viva ON deudas (nombre_norm) WHERE activa = 1;
`,
// ---- Migración 6 (Fase B, 2026-10-09: categoría «Viajes» para hotel, hospedaje, vuelos y reservas) ----
`
-- Solo agrega y reasigna SEMILLAS. INSERT OR IGNORE: no pisa una categoría ni una regla manual/aprendida que ya exista.
-- No es esencial ni cuenta como hormiga. No recategoriza movimientos viejos (los de airbnb siguen en ocio).
-- «tiquete» y «pasaje» solos NO se agregan: en Medellín nombran el tiquete del metro y el pasaje del bus (transporte).
INSERT OR IGNORE INTO categorias (id, nombre, emoji, es_gasto, esencial, cuenta_hormiga, orden, sistema) VALUES
 ('viajes', 'Viajes', '✈️', 1, 0, 0, 14, 0);

-- airbnb y despegar eran semillas de ocio (migración 2): pasan a viajes solo si siguen siendo semilla.
UPDATE reglas_categoria
   SET categoria_id = 'viajes', actualizada_en = strftime('%Y-%m-%dT%H:%M:%SZ','now')
 WHERE patron IN ('airbnb','despegar') AND origen = 'semilla' AND categoria_id = 'ocio';

INSERT OR IGNORE INTO reglas_categoria (patron, categoria_id, origen) VALUES
 ('hotel','viajes','semilla'),
 ('hostal','viajes','semilla'),
 ('hostel','viajes','semilla'),
 ('hospedaje','viajes','semilla'),
 ('alojamiento','viajes','semilla'),
 ('booking','viajes','semilla'),
 ('expedia','viajes','semilla'),
 ('reserva','viajes','semilla'),
 ('vuelo','viajes','semilla'),
 ('aerolinea','viajes','semilla'),
 ('avianca','viajes','semilla'),
 ('latam','viajes','semilla'),
 ('wingo','viajes','semilla'),
 ('tiquete aereo','viajes','semilla'),
 ('tiquetes aereos','viajes','semilla'),
 ('pasaje aereo','viajes','semilla'),
 ('pasajes aereos','viajes','semilla');
`,
];

/** Aplica las migraciones pendientes, cada una en su transacción. Devuelve el user_version final. */
export function migrar(db: DatabaseSync): number {
  const fila = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = Number(fila.user_version);
  if (version > MIGRACIONES.length) {
    throw new Error(`La base está en una versión más nueva (${version}) que la app (${MIGRACIONES.length})`);
  }
  while (version < MIGRACIONES.length) {
    const siguiente = version + 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRACIONES[version]);
      // PRAGMA no admite parámetros; `siguiente` es un entero que sale del propio bucle.
      db.exec('PRAGMA user_version = ' + String(siguiente));
      db.exec('COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
    version = siguiente;
  }
  return version;
}

/** Abre (y migra) la base. Esta edición pública usa la base sintética por defecto. Tests: ':memory:'. */
export function abrirDB(ruta?: string): DatabaseSync {
  const destino = ruta ?? process.env.PLATA_DB_PATH ?? path.join('data', 'panel-dev.db');
  if (destino !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ destino)), { recursive: true });
  const db = new DatabaseSync(destino, { enableForeignKeyConstraints: true });
  db.exec(
    'PRAGMA journal_mode = WAL;' +
      'PRAGMA synchronous = NORMAL;' +
      'PRAGMA busy_timeout = 5000;' +
      'PRAGMA foreign_keys = ON;' +
      'PRAGMA trusted_schema = OFF;' +
      'PRAGMA temp_store = MEMORY;',
  );
  db.enableDefensive?.(true); // bloquea escrituras peligrosas al esquema; nunca se habilitan extensiones
  migrar(db);
  return db;
}

/** Singleton para Next (sobrevive al HMR). */
export function obtenerDB(): DatabaseSync {
  if (!globalThis.__plataDB) globalThis.__plataDB = abrirDB();
  return globalThis.__plataDB;
}

let contadorSavepoints = 0;

/**
 * BEGIN IMMEDIATE / COMMIT / ROLLBACK. `fn` es síncrona (nunca esperar red dentro de una transacción).
 * Si ya hay una transacción abierta sobre esta conexión, usa un SAVEPOINT (anidamiento seguro).
 */
export function enTransaccion<T>(db: DatabaseSync, fn: () => T): T {
  const anidada = db.isTransaction;
  const sp = 'sp_' + String(++contadorSavepoints);
  db.exec(anidada ? 'SAVEPOINT ' + sp : 'BEGIN IMMEDIATE');
  try {
    const r = fn();
    if (r instanceof Promise) throw new Error('enTransaccion: fn debe ser síncrona');
    db.exec(anidada ? 'RELEASE ' + sp : 'COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec(anidada ? 'ROLLBACK TO ' + sp + '; RELEASE ' + sp : 'ROLLBACK');
    throw e;
  }
}

const RE_RESPALDO = /^plata-\d{4}-\d{2}-\d{2}\.db$/;
const RESPALDOS_A_CONSERVAR = 14;

/** VACUUM INTO `<dir>/plata-AAAA-MM-DD.db` y conserva los 14 más recientes. Devuelve la ruta creada. */
export function respaldar(db: DatabaseSync, dirRespaldos: string, hoy: ISODate): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new Error('respaldar: fecha inválida');
  fs.mkdirSync(dirRespaldos, { recursive: true });
  const destino = path.resolve(/*turbopackIgnore: true*/ dirRespaldos, `plata-${hoy}.db`);
  if (fs.existsSync(destino)) fs.rmSync(destino); // VACUUM INTO falla si el archivo existe
  db.prepare('VACUUM INTO ?').run(destino);
  const archivos = fs.readdirSync(dirRespaldos).filter((f) => RE_RESPALDO.test(f)).sort();
  for (const viejo of archivos.slice(0, Math.max(0, archivos.length - RESPALDOS_A_CONSERVAR))) {
    fs.rmSync(path.join(/*turbopackIgnore: true*/ dirRespaldos, viejo), { force: true });
  }
  return destino;
}

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/**
 * Purgas de retención (§8.1): eventos 90 d, bot_updates 7 d, idempotencia 24 h, por_revisar cerrados 180 d,
 * sesiones vencidas. Corre como mucho una vez cada 20 h (lo recuerda con un evento 'mantenimiento').
 */
export function mantenimiento(db: DatabaseSync, ahora: Date): void {
  const t = (ms: number) => aInstanteISO(new Date(ahora.getTime() - ms));
  const ahoraISO = aInstanteISO(ahora);

  const ultimo = db
    .prepare("SELECT 1 AS x FROM eventos WHERE tipo = 'mantenimiento' AND ts > ? LIMIT 1")
    .get(t(20 * HORA_MS));
  if (ultimo) return;

  enTransaccion(db, () => {
    db.prepare('DELETE FROM eventos WHERE ts < ?').run(t(90 * DIA_MS));
    db.prepare('DELETE FROM bot_updates WHERE recibido_en < ?').run(t(7 * DIA_MS));
    db.prepare('DELETE FROM idempotencia WHERE creado_en < ?').run(t(DIA_MS));
    db.prepare('DELETE FROM bot_estado WHERE expira_en <= ?').run(ahoraISO);
    // por_revisar cerrados hace > 180 días: primero se suelta la referencia del libro de avisos.
    const lim = t(180 * DIA_MS);
    db.prepare(
      `UPDATE avisos_procesados SET por_revisar_id = NULL WHERE por_revisar_id IN
         (SELECT id FROM por_revisar WHERE estado IN ('resuelto','descartado') AND COALESCE(resuelto_en, creado_en) < ?)`,
    ).run(lim);
    db.prepare(
      "DELETE FROM por_revisar WHERE estado IN ('resuelto','descartado') AND COALESCE(resuelto_en, creado_en) < ?",
    ).run(lim);
    db.prepare('DELETE FROM sesiones WHERE expira_en <= ? OR ultima_actividad_en < ?').run(ahoraISO, t(7 * DIA_MS));
    db.prepare('DELETE FROM limites WHERE bloqueado_hasta IS NULL AND ventana_24h_desde < ?').run(t(DIA_MS));
    db.prepare("INSERT INTO eventos (ts, nivel, tipo) VALUES (?, 'info', 'mantenimiento')").run(ahoraISO);
  });
  try {
    db.exec('PRAGMA optimize');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // no es crítico (p. ej. base en memoria)
  }
}
