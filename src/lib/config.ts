// Configuración de Plata: valores por defecto, validación y mezcla con lo guardado (SPEC §8.1). Todo PURO.
import { normalizarComercio } from './formato';
import { ErrorUsuario } from './tipos';
import type { ConfigPlata, HoraHM } from './tipos';
import { paqueteActivo } from './paises';

export const CONFIG_POR_DEFECTO: ConfigPlata = {
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
  patrones_pago_tarjeta: [...paqueteActivo().patrones_pago_tarjeta],
  patrones_interno: [...paqueteActivo().patrones_interno],
  minutos_fusion: 30,
  minutos_duplicado: 10,
  max_push_por_evaluacion: 3,
  tutorial_visto: false,
  estrategia_deudas: 'avalancha',
  pago_deudas_mensual: null,
  dia_ingreso: null,
};

const CLAVES = Object.keys(CONFIG_POR_DEFECTO) as (keyof ConfigPlata)[];

function invalido(clave: string, mensaje: string): never {
  throw new ErrorUsuario('validacion', `${clave}: ${mensaje}`);
}

function entero(clave: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    invalido(clave, `debe ser un entero entre ${min} y ${max}`);
  }
  return v;
}

function numero(clave: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    invalido(clave, `debe ser un número entre ${min} y ${max}`);
  }
  return v;
}

function hora(clave: string, v: unknown): HoraHM {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) invalido(clave, 'hora inválida, usa HH:MM');
  return v;
}

function rangoHoras(clave: string, v: unknown): { desde: HoraHM; hasta: HoraHM } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) invalido(clave, 'debe tener desde y hasta');
  const o = v as Record<string, unknown>;
  const desde = hora(clave + '.desde', o.desde);
  const hasta = hora(clave + '.hasta', o.hasta);
  if (desde === hasta) invalido(clave, 'desde y hasta no pueden ser iguales');
  return { desde, hasta };
}

function patrones(clave: string, v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 20) invalido(clave, 'máximo 20 patrones');
  const salida: string[] = [];
  for (const p of v) {
    if (typeof p !== 'string') invalido(clave, 'cada patrón debe ser texto');
    const n = normalizarComercio(p);
    if (n.length < 2 || n.length > 60) invalido(clave, 'cada patrón debe tener entre 2 y 60 caracteres útiles');
    if (!salida.includes(n)) salida.push(n);
  }
  return salida;
}

const RE_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Valida y normaliza un valor de configuración. Lanza ErrorUsuario('validacion', …). */
export function validarValorConfig<K extends keyof ConfigPlata>(clave: K, valor: unknown): ConfigPlata[K] {
  const k: keyof ConfigPlata = clave;
  let r: ConfigPlata[keyof ConfigPlata];
  switch (k) {
    case 'ingreso_mensual':
      r = valor === null ? null : entero(k, valor, 0, 10_000_000_000);
      break;
    case 'pct_ahorro':
      r = numero(k, valor, 0, 80);
      break;
    case 'umbral_gasto_alto':
      r = entero(k, valor, 10_000, 100_000_000);
      break;
    case 'umbral_hormiga':
      r = entero(k, valor, 1_000, 200_000);
      break;
    case 'umbral_impulso':
      r = entero(k, valor, 10_000, 100_000_000);
      break;
    case 'horas_espera_impulso':
      r = entero(k, valor, 1, 336);
      break;
    case 'nocturno':
    case 'horario_push':
      r = rangoHoras(k, valor);
      break;
    case 'pausa_hasta': {
      if (valor === null) {
        r = null;
        break;
      }
      if (typeof valor !== 'string' || !RE_INSTANTE.test(valor) || Number.isNaN(new Date(valor).getTime())) {
        invalido(k, 'debe ser un instante ISO UTC con Z o null');
      }
      r = new Date(valor).toISOString().replace(/\.\d{3}Z$/, 'Z');
      break;
    }
    case 'semaforo': {
      if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) invalido(k, 'debe ser un objeto');
      const o = valor as Record<string, unknown>;
      const s = {
        dia_amarillo: numero(k + '.dia_amarillo', o.dia_amarillo, 0.1, 3),
        dia_rojo: numero(k + '.dia_rojo', o.dia_rojo, 0.1, 3),
        mes_amarillo: numero(k + '.mes_amarillo', o.mes_amarillo, 0.1, 3),
        mes_rojo: numero(k + '.mes_rojo', o.mes_rojo, 0.1, 3),
      };
      if (s.dia_amarillo >= s.dia_rojo || s.mes_amarillo >= s.mes_rojo) invalido(k, 'amarillo debe ser menor que rojo');
      r = s;
      break;
    }
    case 'patrones_pago_tarjeta':
    case 'patrones_interno':
      r = patrones(k, valor);
      break;
    case 'minutos_fusion':
      r = entero(k, valor, 5, 120);
      break;
    case 'minutos_duplicado':
      r = entero(k, valor, 1, 60);
      break;
    case 'max_push_por_evaluacion':
      r = entero(k, valor, 1, 10);
      break;
    case 'tutorial_visto':
      if (typeof valor !== 'boolean') invalido(k, 'debe ser true o false');
      r = valor;
      break;
    case 'estrategia_deudas':
      if (valor !== 'avalancha' && valor !== 'bola_nieve') invalido(k, 'debe ser "avalancha" o "bola_nieve"');
      r = valor;
      break;
    case 'pago_deudas_mensual':
      r = valor === null ? null : entero(k, valor, 1, 10_000_000_000);
      break;
    case 'dia_ingreso':
      r = valor === null ? null : entero(k, valor, 1, 31);
      break;
    default:
      return invalido(String(clave), 'clave de configuración desconocida');
  }
  return r as ConfigPlata[K];
}

/** Defaults + filas guardadas. Ignora claves desconocidas o valores inválidos (la base nunca debe romper la app). */
export function mezclarConfig(filas: { clave: string; valor: string }[]): ConfigPlata {
  const cfg = structuredClone(CONFIG_POR_DEFECTO) as unknown as Record<string, unknown>;
  for (const f of filas) {
    if (!(CLAVES as string[]).includes(f.clave)) continue;
    try {
      cfg[f.clave] = validarValorConfig(f.clave as keyof ConfigPlata, JSON.parse(f.valor));
    } catch {
      // JSON roto o valor fuera de rango: se queda el valor por defecto
    }
  }
  return cfg as unknown as ConfigPlata;
}
