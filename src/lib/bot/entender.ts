// Entiende lo que Jero escribe sin comandos: «café 8000», «8k café», «gasté 20 mil en la tienda», «recibí 500k»,
// «puedo comprar unos tenis de 200k», «tengo 1,2 millones en Bancolombia», «debo 3 millones en la tarjeta…»,
// un número suelto o un botón del menú fijo. Todo PURO.
import { normalizarTexto, parsearMonto } from '../formato';
import type { DestinoMenu } from '../tipos';
import { SUFIJOS_MONTO } from './comun';

export type Entendido =
  | { tipo: 'menu'; dest: DestinoMenu | 'menu' | 'deshacer' }
  | { tipo: 'gasto'; monto: number; desc: string }
  | { tipo: 'ingreso'; monto: number; desc: string }
  | { tipo: 'puedo'; monto: number; desc: string }
  | { tipo: 'futuro'; monto: number; desc: string }                      // «voy a gastar 450 mil en un hotel»: ¿ya lo pagó o es consulta?
  | { tipo: 'saldo'; monto: number; nombre: string }                     // «tengo 1,2 millones en Bancolombia»
  | { tipo: 'deuda'; monto: number; nombre: string; minimo?: number; dia?: number; tasa?: number }
  | { tipo: 'pago_minimo'; nombre: string; monto?: number }              // «pagué el mínimo de la tarjeta»
  | { tipo: 'mi_ingreso'; monto: number }                                // «mi ingreso es 3 millones»
  | { tipo: 'dia_ingreso'; dia: number }                                 // «me entra el 20», «mi sueldo llega el día 30»
  | { tipo: 'monto'; monto: number }
  | { tipo: 'pregunta' }
  | { tipo: 'nada' };

/** Etiquetas del menú fijo (ya normalizadas: sin emoji, tildes ni signos). */
const ETIQUETAS: Record<string, DestinoMenu | 'menu' | 'deshacer'> = {
  'mis cuentas': 'cuentas', 'mis deudas': 'cuentas', cuentas: 'cuentas', deudas: 'cuentas', 'mis saldos': 'cuentas', saldos: 'cuentas',
  hoy: 'hoy', mes: 'mes', gasto: 'gasto', ingreso: 'ing1', 'puedo comprar': 'puedo', mas: 'mas', ayuda: 'ayuda', menu: 'menu', ultimos: 'ult', deshacer: 'deshacer',
};

/** ¿El texto es un botón del menú fijo (o una palabra equivalente)? Tolera mayúsculas, emoji y el contador de «Pendientes (3)». */
export function etiquetaMenu(texto: string): DestinoMenu | 'menu' | 'deshacer' | null {
  const t = normalizarTexto(texto);
  if (!t) return null;
  if (/^pendientes( \d+)?$/.test(t)) return 'pend';
  if (/^(ver |mostrar |muestrame |dime |como van |como estan )?(mis )?(cuentas|deudas|saldos)( y (cuentas|deudas|saldos))?$/.test(t)) return 'cuentas';
  return ETIQUETAS[t] ?? null;
}

const MIN_MONTO = 1000;
// «¿Puedo…?» ya no va anclado al inicio: sirve «oye, ¿puedo…», «tengo 450k, ¿puedo reservar…?», «voy a gastar X… ¿puedo?».
const RE_RELLENO = /^(oye|oiga|ey|hey|hola|buenas|buenos dias|buenas tardes|buenas noches|disculpa|mira|una pregunta|dime|a ver|por favor|porfa)\b[ ,]*/;
const RE_PUEDO_ANCLADO = /^(puedo|podre|podria|me puedo|me alcanza|me da para|alcanza para|me conviene|vale la pena|deberia comprar|sera que (me )?(puedo|alcanza|da))\b/;
const RE_PUEDO = /\b(puedo|podre|podria|me da para|me alcanza|alcanza para|me conviene|vale la pena|deberia (comprar|gastar|reservar|pagar))\b/;
const RE_NO_PUEDO = /\b(no|tampoco|ya no) (me )?(puedo|podre|podria|alcanza|da para|conviene)\b/;
const RE_Y_SI = /^(y |pero |que tal )?si (me )?(gasto|compro|reservo|pago|separo|aparto|voy a (gastar|comprar|reservar|pagar))\b/;
const RE_FUTURO = /^(voy a|quiero|pienso|planeo|estoy pensando en|ando pensando en|me gustaria|tengo pensado) (gastar|gastarme|comprar|comprarme|reservar|pagar|apartar|separar)\b/;
const RE_PASADO = /^(gaste|pague|compre|recibi|me pagaron|saque|me consignaron|cobre)\b/;
const RE_SALDO = /^((ahora |actualmente |ya )?tengo|hay|me quedan?|(mi |el )?saldo\b|en [a-z0-9 ]{2,30} (tengo|hay|me quedan?))/;
const RE_DEUDA = /^(debo|adeudo|tengo una deuda|tengo un prestamo|mi deuda|mis deudas)\b/;
const RE_MI_INGRESO = /^(mi (ingreso|sueldo|salario)|mis ingresos son|ingreso (mensual|al mes)|gano\b.*\b(al mes|mensual))/;
// «me entra el 20», «me pagan el 15 de cada mes», «mi sueldo llega el día 30»: día del mes (1-31) en que entra el ingreso.
const RE_DIA_INGRESO = /^(?:me (?:entra|entran|pagan|paga|llega|llegan|cae|caen|consignan|depositan|transfieren)|(?:mi |el )?(?:sueldo|salario|ingreso|pago|quincena|plata) (?:me )?(?:llega|entra|cae|es|me pagan|me consignan))\b.*?\b(?:el|dia|los)(?: dia)? (\d{1,2})\b(?! ?(?:k|mil|m|mm|millon|millones|lucas|palo|palos)\b)/;
const RE_PAGO_MINIMO = /^(ya )?(pague|abone|abono|page|cancele) (el )?(pago )?minimo\b/;
const RE_INGRESO = /^(recibi|me pagaron|me pago|me llego|me llegaron|me consignaron|me consigno|me depositaron|me entro|me entraron|me transfirieron|cobre|ingreso|entrada)\b/;
// «mamá me dio 200 mil», «de mi tío me llegaron 50k», «me pasaron 30 mil»: alguien le dio plata (en cualquier parte de la frase).
const RE_INGRESO_DAR = /\bme (dio|dieron|regalo|regalaron|presto|prestaron|pasaron|mando|mandaron|envio|enviaron|giro|giraron|abono|abonaron|consigno|consignaron|deposito|depositaron|transfirio|transfirieron|pagaron|ingresaron)\b/;
// Cobros y cuentas por pagar que se parecen a un ingreso pero son gasto: «me pasaron la cuenta de 50 mil».
const RE_NO_INGRESO = /\b(cuenta de cobro|la cuenta|factura|recibo|cobro|cobraron|cobran|cobrar|multa|le (di|pase|mande|envie|gire|consigne|transferi|preste))\b/;
const esIngreso = (norm: string) => !RE_NO_INGRESO.test(norm) && (RE_INGRESO.test(norm) || RE_INGRESO_DAR.test(norm));
const RE_PREGUNTA =/^(cuanto|cuantos|cuantas|que|como|donde|cual|cuales|cuando|quien|por que|en que|a que|para que|dime|muestrame|explicame)\b/;

// Palabras que sobran al inicio o al final de la descripción.
const SOBRA_INICIO = new Set([
  'puedo', 'podria', 'podre', 'comprar', 'comprarme', 'gastar', 'gastarme', 'me', 'alcanza', 'da', 'para', 'conviene', 'vale', 'la', 'pena', 'deberia', 'sera', 'que',
  'reservar', 'reserva', 'reservarme', 'oye', 'oiga', 'ey', 'hey', 'hola', 'voy', 'quiero', 'pienso', 'planeo', 'estoy', 'ando', 'pensando', 'gustaria', 'tengo',
  'y', 'si', 'pero', 'tal', 'gasto', 'compro', 'reservo', 'separo', 'aparto', 'apartar', 'separar', 'pagar',
  'gaste', 'pague', 'compre', 'cobraron', 'saque', 'recibi', 'pagaron', 'pago', 'llego', 'llegaron', 'consignaron', 'consigno', 'depositaron', 'entro',
  'entraron', 'transfirieron', 'cobre', 'ingreso', 'entrada', 'en', 'de', 'por', 'a', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'como', 'del',
  'dio', 'dieron', 'regalo', 'regalaron', 'presto', 'prestaron', 'pasaron', 'mando', 'mandaron', 'envio', 'enviaron', 'giro', 'giraron', 'abono', 'abonaron',
  'deposito', 'transfirio', 'ingresaron',
]);
const SOBRA_FINAL = new Set(['me', 'dio', 'dieron', 'regalo', 'regalaron', 'presto', 'prestaron', 'pasaron', 'mando', 'mandaron', 'envio', 'enviaron', 'giro', 'giraron',
  'abono', 'abonaron', 'consignaron', 'depositaron', 'transfirieron', 'pagaron', 'ingresaron', 'puedo', 'podre', 'podria', 'de', 'en', 'por', 'con', 'a', 'para', 'del', 'como', 'es', 'son', 'fue', 'pesos', 'cop']);

const limpiaToken = (t: string) => t.replace(/^[¿¡("']+|[?!.,;:)"']+$/g, '');

interface Hallado { monto: number; desde: number; hasta: number }

/** Busca el primer monto (≥ $1.000) en los tokens; acepta «20 mil» y «1,5 millones» en dos palabras. */
export function hallarMonto(tokens: string[]): Hallado | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!/^\$?\d/.test(t)) continue;
    const sig = tokens[i + 1];
    const dos = sig && SUFIJOS_MONTO.test(sig) ? `${t} ${sig}` : null;
    for (const [txt, hasta] of dos ? [[dos, i + 2], [t, i + 1]] as [string, number][] : [[t, i + 1]] as [string, number][]) {
      const r = parsearMonto(txt);
      if (r.ok && r.valor >= MIN_MONTO) return { monto: r.valor, desde: i, hasta };
    }
  }
  return null;
}

function descripcion(tokens: string[], h: Hallado): string {
  let resto = [...tokens.slice(0, h.desde), ...tokens.slice(h.hasta)];
  while (resto.length && SOBRA_INICIO.has(normalizarTexto(resto[0]))) resto = resto.slice(1);
  while (resto.length && SOBRA_FINAL.has(normalizarTexto(resto[resto.length - 1]))) resto = resto.slice(0, -1);
  return resto.join(' ').trim();
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// Palabras que sobran alrededor del nombre de una cuenta o deuda.
const SOBRA_NOMBRE = new Set([
  'tengo', 'hay', 'me', 'quedan', 'queda', 'mi', 'mis', 'saldo', 'el', 'la', 'las', 'los', 'un', 'una', 'en', 'de', 'del', 'con', 'ahora', 'actualmente', 'ya',
  'total', 'hoy', 'cuenta', 'cuentas', 'pesos', 'cop', 'debo', 'adeudo', 'deuda', 'prestamo', 'a', 'al', 'ea', 'tasa', 'son', 'es',
]);
function recortaNombre(toks: string[]): string {
  let r = [...toks];
  while (r.length && SOBRA_NOMBRE.has(normalizarTexto(r[0]))) r = r.slice(1);
  while (r.length && SOBRA_NOMBRE.has(normalizarTexto(r[r.length - 1]))) r = r.slice(0, -1);
  return cap(r.join(' ').trim()).slice(0, 40);
}

/** Tipo de cuenta que se deduce del nombre; null = ambiguo (el bot pregunta efectivo / banco / ahorro). */
export function tipoDeCuentaPorNombre(nombre: string): 'efectivo' | 'banco' | 'ahorro' | null {
  const n = normalizarTexto(nombre);
  if (!n) return null;
  if (/\b(efectivo|billetera|cash|monedero|en mano|caja)\b/.test(n)) return 'efectivo';
  if (/\b(cdt|fondo|inversion|inversiones|fiducia|colchon|alcancia|ahorro programado)\b/.test(n) || /^ahorros?$/.test(n)) return 'ahorro';
  if (/\b(banco|bancolombia|davivienda|nequi|daviplata|bbva|nu|nubank|lulo|bogota|popular|av villas|avvillas|colpatria|scotiabank|itau|falabella|rappipay|corriente|debito|movii|dale|pibank|cuenta)\b/.test(n)) return 'banco';
  return null;
}

/** Tipo de deuda que se deduce del nombre. */
export function tipoDeDeudaPorNombre(nombre: string): 'tarjeta' | 'prestamo' | 'otra' {
  const n = normalizarTexto(nombre);
  if (/\b(tarjeta|visa|master|mastercard|amex|rotativo)\b/.test(n)) return 'tarjeta';
  if (/\b(prestamo|hipoteca|libranza|credito|carro|moto|vehiculo|icetex|estudio|cuota)\b/.test(n)) return 'prestamo';
  return 'otra';
}

const PALABRAS_DIA = new Set(['pago', 'pagar', 'paga', 'vence', 'vencimiento', 'corte', 'dia']);
const RELLENO_DIA = new Set(['el', 'los', 'dia', 'de', 'cada', 'mes', 'del']);
const CORTE_NOMBRE = new Set(['pago', 'pagar', 'vence', 'vencimiento', 'tasa', 'corte', 'minimo']);

/** «debo 3 millones en la tarjeta, mínimo 150k, pago el 15 (28%)»: monto, nombre y, si vienen, mínimo, día de pago y tasa. */
function parsearDeuda(tokens: string[]): Extract<Entendido, { tipo: 'deuda' }> | null {
  const ntok = tokens.map(normalizarTexto);
  const quitar = new Set<number>();
  let minimo: number | undefined;
  let dia: number | undefined;
  let tasa: number | undefined;

  const iMin = ntok.indexOf('minimo');
  if (iMin >= 0) {
    let j = iMin + 1;
    while (j < tokens.length && ['de', 'es', 'son', 'seria', 'del', 'a'].includes(ntok[j])) j++;
    const hm = hallarMonto(tokens.slice(j, j + 3));
    if (hm && hm.desde === 0) { minimo = hm.monto; for (let k = iMin; k < j + hm.hasta; k++) quitar.add(k); }
  }
  for (let i = 0; i < tokens.length && dia === undefined; i++) {
    if (!PALABRAS_DIA.has(ntok[i]) || quitar.has(i)) continue;
    for (let k = i + 1; k <= i + 3 && k < tokens.length; k++) {
      if (/^\d{1,2}$/.test(tokens[k]) && Number(tokens[k]) >= 1 && Number(tokens[k]) <= 31) {
        dia = Number(tokens[k]);
        for (let q = i; q <= k; q++) quitar.add(q);
        break;
      }
      if (!RELLENO_DIA.has(ntok[k])) break;
    }
  }
  tokens.forEach((t, i) => {
    const m = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
    if (m && tasa === undefined) { tasa = Number(m[1].replace(',', '.')); quitar.add(i); }
  });

  const rest = tokens.filter((_, i) => !quitar.has(i));
  const h = hallarMonto(rest);
  if (!h) return null;
  const despues: string[] = [];
  for (const t of rest.slice(h.hasta)) { if (CORTE_NOMBRE.has(normalizarTexto(t))) break; despues.push(t); }
  const nombre = recortaNombre([...rest.slice(0, h.desde), ...despues]) || 'Deuda';
  return {
    tipo: 'deuda', monto: h.monto, nombre,
    ...(minimo !== undefined ? { minimo } : {}), ...(dia !== undefined ? { dia } : {}), ...(tasa !== undefined ? { tasa } : {}),
  };
}

export function entender(texto: string): Entendido {
  const crudo = (texto ?? '').trim();
  if (!crudo) return { tipo: 'nada' };
  const menu = etiquetaMenu(crudo);
  if (menu) return { tipo: 'menu', dest: menu };

  const tokens = crudo.split(/\s+/).map(limpiaToken).filter(Boolean);
  const norm = normalizarTexto(crudo);
  const n2 = norm.replace(RE_RELLENO, '');
  const h = hallarMonto(tokens);
  const esConsulta = crudo.includes('?') || crudo.startsWith('¿');

  // 1) «¿Puedo…?» se evalúa antes que gasto o ingreso, en cualquier parte de la frase.
  if (h) {
    const puedo = !RE_NO_PUEDO.test(norm)
      && (RE_PUEDO_ANCLADO.test(n2) || RE_PUEDO.test(norm) && !RE_PREGUNTA.test(n2) && !RE_PASADO.test(n2));
    if (puedo || RE_Y_SI.test(n2)) return { tipo: 'puedo', monto: h.monto, desc: descripcion(tokens, h) };
  }

  // 2) Control de cuentas, deudas e ingreso por texto (una frase con «?» es una pregunta, no una orden).
  if (!esConsulta) {
    if (RE_PAGO_MINIMO.test(n2)) {
      const i = tokens.findIndex((t) => normalizarTexto(t) === 'minimo');
      const resto = tokens.slice(i + 1);
      const hm = hallarMonto(resto);
      const nombre = recortaNombre(hm ? [...resto.slice(0, hm.desde), ...resto.slice(hm.hasta)] : resto);
      return { tipo: 'pago_minimo', nombre, ...(hm ? { monto: hm.monto } : {}) };
    }
    const di = RE_DIA_INGRESO.exec(n2);
    if (!h && di && Number(di[1]) >= 1 && Number(di[1]) <= 31) return { tipo: 'dia_ingreso', dia: Number(di[1]) };
    if (h && RE_MI_INGRESO.test(n2)) return { tipo: 'mi_ingreso', monto: h.monto };
    if (h && RE_DEUDA.test(n2)) {
      const d = parsearDeuda(tokens);
      if (d) return d;
    }
    if (h && RE_SALDO.test(n2) && !RE_PASADO.test(n2)) {
      const nombre = recortaNombre([...tokens.slice(0, h.desde), ...tokens.slice(h.hasta)]);
      if (!/^(para|que|por|pero|y|si|porque)\b/.test(normalizarTexto(nombre))) return { tipo: 'saldo', monto: h.monto, nombre };
    }
  }

  if (esConsulta || RE_PREGUNTA.test(norm)) return { tipo: 'pregunta' };
  if (!h) return { tipo: 'nada' };

  // 3) Un plan a futuro («voy a gastar 450 mil en un hotel») no se anota solo: se pregunta si ya lo pagó.
  if (RE_FUTURO.test(n2)) return { tipo: 'futuro', monto: h.monto, desc: descripcion(tokens, h) };
  if (esIngreso(norm)) return { tipo: 'ingreso', monto: h.monto, desc: descripcion(tokens, h) };
  const desc = descripcion(tokens, h);
  // Solo un número («80000»): no se sabe qué es.
  if (!desc && tokens.length === (h.hasta - h.desde)) return { tipo: 'monto', monto: h.monto };
  return { tipo: 'gasto', monto: h.monto, desc };
}
