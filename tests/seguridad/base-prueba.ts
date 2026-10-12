// Base en memoria con SOLO las tablas que usa seguridad.ts, copiadas de SPEC §1.2.
// Permite probar A2 sin depender de db.ts (que construye otro agente en paralelo).
import { DatabaseSync } from 'node:sqlite';

export const ESQUEMA_SEGURIDAD = `
CREATE TABLE secretos (clave TEXT PRIMARY KEY CHECK (clave IN ('pin_hash')), valor TEXT NOT NULL CHECK (length(valor) <= 300),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))) STRICT;
CREATE TABLE sesiones (id_hash TEXT PRIMARY KEY CHECK (length(id_hash) = 64), creada_en TEXT NOT NULL, expira_en TEXT NOT NULL,
  ultima_actividad_en TEXT NOT NULL) STRICT, WITHOUT ROWID;
CREATE TABLE limites (clave TEXT PRIMARY KEY, fallos INTEGER NOT NULL DEFAULT 0, ventana_desde TEXT NOT NULL,
  fallos_24h INTEGER NOT NULL DEFAULT 0, ventana_24h_desde TEXT NOT NULL, bloqueado_hasta TEXT) STRICT, WITHOUT ROWID;
CREATE TABLE idempotencia (ruta TEXT NOT NULL, clave TEXT NOT NULL CHECK (length(clave) BETWEEN 8 AND 64), huella_cuerpo TEXT NOT NULL,
  estado_http INTEGER NOT NULL, respuesta TEXT NOT NULL, creado_en TEXT NOT NULL, PRIMARY KEY (ruta, clave)) STRICT, WITHOUT ROWID;
CREATE TABLE eventos (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  nivel TEXT NOT NULL CHECK (nivel IN ('info','aviso','error')), tipo TEXT NOT NULL CHECK (length(tipo) <= 40),
  detalle TEXT CHECK (detalle IS NULL OR length(detalle) <= 500), ref TEXT CHECK (ref IS NULL OR length(ref) <= 80)) STRICT;`;

export function baseDePrueba(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(ESQUEMA_SEGURIDAD);
  return db;
}

// Secretos sintéticos (no reales) compartidos por las pruebas de seguridad.
export const TOKEN_PRUEBA = 'tOk3n_de_prueba_sintetico_AAAAAAAAAAAAAAAAAAAAAAAA';
export const TOKEN_VIEJO_PRUEBA = 'tOk3n_viejo_sintetico_BBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
export const SECRETO_PRUEBA = 'secreto_de_sesion_sintetico_CCCCCCCCCCCCCCCCCCCCCC';
export const ENV_PRUEBA = {
  PLATA_TOKEN: TOKEN_PRUEBA,
  PLATA_SESION_SECRETO: SECRETO_PRUEBA,
  PLATA_TELEGRAM_CHAT_ID: '123456789',
};
