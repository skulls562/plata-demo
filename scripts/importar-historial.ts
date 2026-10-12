// Importa el historial de avisos del banco desde Gmail por IMAP, en SOLO LECTURA, y lo manda a Plata (SPEC §5.4 lote).
// Uso: `npm run historial -- [--desde AAAA-MM-DD | --ultimos-dias N] [--dry-run]`   (por defecto: últimos 365 días)
//
// Entorno: IMAP_PASS (contraseña de aplicación) o IMAP_PASS_FILE (ruta a un archivo que la contiene);
//          PLATA_TOKEN (de .env.local; `npm run historial` lo carga); PLATA_URL (por defecto http://127.0.0.1:3010);
//          IMAP_USER o PLATA_IMAP_USER (OBLIGATORIO: tu correo);
//          PLATA_IMAP_HOST (por defecto imap.gmail.com).
// Nunca imprime la contraseña, el token ni datos del correo: solo conteos por mes.

import { readFileSync } from 'node:fs';
import { ClienteIMAP } from './historial/imap.ts';
import { bancoPermitido, dominioDe, mesDeCorreo, parsearCorreo } from './historial/mensaje.ts';
import type { AvisoHistorial } from './historial/mensaje.ts';

const DOMINIOS_BUSQUEDA = [
  'notificacionesbancolombia.com', 'achcolombia.com.co', 'wompi.co', 'wompi.com', 'rappicard.com', 'rappicard.co', 'rappi.com', 'didiglobal.com',
];
const ESTADOS = ['creado', 'duplicado', 'fusionado', 'ignorado', 'por_revisar'] as const;
type Estado = (typeof ESTADOS)[number];
const LOTE = 50;
const LIMITE_BYTES_LOTE = 1_800_000;   // el servidor acepta 2 MB

interface Opciones { desde: Date; dryRun: boolean }

function ayuda(): never {
  console.error('Uso: npm run historial -- [--desde AAAA-MM-DD | --ultimos-dias N] [--dry-run]');
  process.exit(2);
}

export function leerOpciones(args: string[], hoy = new Date()): Opciones {
  let desde: Date | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--desde') {
      const v = args[++i] ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) ayuda();
      desde = new Date(v + 'T00:00:00Z');
    } else if (a === '--ultimos-dias') {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 3650) ayuda();
      desde = new Date(hoy.getTime() - n * 86_400_000);
    } else ayuda();
  }
  return { desde: desde ?? new Date(hoy.getTime() - 365 * 86_400_000), dryRun };
}

/** Consulta X-GM-RAW: remitentes permitidos y fecha mínima (Gmail usa AAAA/MM/DD). */
export function consultaGmail(desde: Date): string {
  const f = desde.toISOString().slice(0, 10).replace(/-/g, '/');
  return `{${DOMINIOS_BUSQUEDA.map((d) => 'from:' + d).join(' ')}} after:${f}`;
}

function clave(): string {
  const directa = process.env.IMAP_PASS;
  if (directa) return directa;
  const ruta = process.env.IMAP_PASS_FILE;
  if (ruta) return readFileSync(ruta, 'utf8').trim();
  console.error('Falta IMAP_PASS o IMAP_PASS_FILE.');
  process.exit(2);
}

type Resumen = Record<Estado, number>;
const vacio = (): Resumen => ({ creado: 0, duplicado: 0, fusionado: 0, ignorado: 0, por_revisar: 0 });

async function enviarLote(base: string, token: string, avisos: AvisoHistorial[]): Promise<Estado[]> {
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(`${base}/api/avisos/lote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ avisos, origen: 'historial' }),
        signal: AbortSignal.timeout(600_000),
      });
      if (r.status === 429 && intento < 5) { await new Promise((f) => setTimeout(f, 10_000)); continue; }
      if (!r.ok) throw new Error(`la API respondió ${r.status}`);
      const j = (await r.json()) as { resultados: Array<{ estado: Estado }> };
      return j.resultados.map((x) => x.estado);
    } catch (e) {
      if (intento >= 3) throw new Error(`lote fallido: ${(e as Error).message}`);
      await new Promise((f) => setTimeout(f, 5_000));
    }
  }
}

async function main(): Promise<number> {
  const op = leerOpciones(process.argv.slice(2));
  const base = (process.env.PLATA_URL?.trim() || 'http://127.0.0.1:3010').replace(/\/$/, '');
  const token = process.env.PLATA_TOKEN?.trim() ?? '';
  if (!op.dryRun && token === '') {
    console.error('Falta PLATA_TOKEN (usa `npm run historial`, que lee .env.local).');
    return 2;
  }
  const usuario = (process.env.PLATA_IMAP_USER ?? process.env.IMAP_USER ?? '').trim();
  if (!/^[^s@]+@[^s@]+$/.test(usuario)) {
    console.error('Falta tu correo: define PLATA_IMAP_USER (o IMAP_USER) en la terminal. Ver .env.example.');
    return 2;
  }
  const pass = clave();
  const imap = new ClienteIMAP(process.env.PLATA_IMAP_HOST?.trim() || undefined);
  const porMes = new Map<string, Resumen>();
  const mes = (m: string) => { if (!porMes.has(m)) porMes.set(m, vacio()); return porMes.get(m)!; };
  const leidos = new Map<string, number>();   // mes → correos válidos (dry-run)
  let sinTexto = 0;
  let fueraLista = 0;
  let total = 0;

  try {
    await imap.conectar();
    await imap.login(usuario, pass);
    const carpeta = await imap.carpetaTodos();
    await imap.examinar(carpeta);   // EXAMINE = solo lectura
    const uids = await imap.buscarGmail(consultaGmail(op.desde));
    console.log(`Correos encontrados desde ${op.desde.toISOString().slice(0, 10)}: ${uids.length}${op.dryRun ? ' (dry-run: no se envía nada)' : ''}`);

    let pendientes: Array<{ aviso: AvisoHistorial; mes: string }> = [];
    let bytes = 0;
    const vaciar = async () => {
      if (pendientes.length === 0) return;
      const estados = await enviarLote(base, token, pendientes.map((p) => p.aviso));
      estados.forEach((e, i) => { mes(pendientes[i].mes)[e] += 1; });
      pendientes = [];
      bytes = 0;
    };

    for (let i = 0; i < uids.length; i += 20) {
      for (const m of await imap.traer(uids.slice(i, i + 20))) {
        const aviso = parsearCorreo(m.raw);
        if (!aviso) { sinTexto++; continue; }
        const dom = dominioDe(aviso.from);
        if (!dom || !bancoPermitido(dom)) { fueraLista++; continue; }
        total++;
        const mm = mesDeCorreo(aviso.date);
        if (op.dryRun) { leidos.set(mm, (leidos.get(mm) ?? 0) + 1); continue; }
        const tam = JSON.stringify(aviso).length;
        if (pendientes.length >= LOTE || bytes + tam > LIMITE_BYTES_LOTE) await vaciar();
        pendientes.push({ aviso, mes: mm });
        bytes += tam;
      }
    }
    if (!op.dryRun) await vaciar();
  } catch (e) {
    console.error('Error:', (e as Error).message);
    return 1;
  } finally {
    await imap.cerrar();
  }

  console.log(`Válidos: ${total} · sin texto: ${sinTexto} · remitente fuera de la lista: ${fueraLista}`);
  if (op.dryRun) {
    for (const [m, n] of [...leidos].sort()) console.log(`${m}  listos para enviar: ${n}`);
  } else {
    const suma = vacio();
    for (const [m, r] of [...porMes].sort()) {
      console.log(`${m}  ${ESTADOS.map((e) => `${e}=${r[e]}`).join(' ')}`);
      for (const e of ESTADOS) suma[e] += r[e];
    }
    console.log(`TOTAL  ${ESTADOS.map((e) => `${e}=${suma[e]}`).join(' ')}`);
  }
  return 0;
}

// Solo se ejecuta como script (las pruebas importan las funciones sin lanzar nada).
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().then((c) => process.exit(c));
}
