// «Actualizar Gmail»: trae ahora los avisos recientes del banco, sin esperar al lector de n8n.
// Reutiliza el importador de historial (solo lectura, IMAP): `scripts/importar-historial.ts --ultimos-dias N`.
// Es idempotente: los avisos que ya estaban se cuentan como duplicados y no se vuelven a anotar.
// La contraseña de aplicación vive en un archivo FUERA del proyecto (IMAP_PASS_FILE, ver `npm run gmail-clave`); nunca se imprime.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export interface ResumenSync { creado: number; duplicado: number; fusionado: number; ignorado: number; por_revisar: number }
export interface ResultadoSync {
  ok: boolean;
  codigo: 'ok' | 'sin_configurar' | 'ocupado' | 'espera' | 'rechazado' | 'error';
  mensaje: string;
  correos?: number;
  resumen?: ResumenSync;
}
export interface EstadoSync { configurado: boolean; falta: string | null }

const DIAS_POR_DEFECTO = 7;
const ESPERA_ENTRE_PULSOS_MS = 15_000;
const LIMITE_MS = 150_000;
let enCurso: Promise<ResultadoSync> | null = null;
let ultimoFin = 0;

/** Ruta del archivo con la contraseña de aplicación: IMAP_PASS_FILE o `~/.plata/gmail.txt`. */
export function rutaClaveGmail(env: Record<string, string | undefined> = process.env): string {
  return (env.IMAP_PASS_FILE?.trim() || `${homedir().replace(/\\/g, '/')}/.plata/gmail.txt`);
}

export function estadoSync(env: Record<string, string | undefined> = process.env): EstadoSync {
  const user = (env.PLATA_IMAP_USER ?? env.IMAP_USER ?? '').trim();
  if (!user) return { configurado: false, falta: 'tu correo (PLATA_IMAP_USER)' };
  if (!existsSync(rutaClaveGmail(env))) return { configurado: false, falta: 'la contraseña de aplicación de Gmail' };
  return { configurado: true, falta: null };
}

const AYUDA_CONFIGURAR = 'Déjalo listo una sola vez: en la carpeta de Plata corre «npm run gmail-clave» y pega tu contraseña de aplicación de Google. Después reinicia Plata.';

function leerResumen(salida: string): { correos?: number; resumen?: ResumenSync } {
  const correos = /Correos encontrados[^:]*:\s*(\d+)/.exec(salida);
  const t = /TOTAL\s+creado=(\d+)\s+duplicado=(\d+)\s+fusionado=(\d+)\s+ignorado=(\d+)\s+por_revisar=(\d+)/.exec(salida);
  return {
    ...(correos ? { correos: Number(correos[1]) } : {}),
    ...(t ? { resumen: { creado: +t[1], duplicado: +t[2], fusionado: +t[3], ignorado: +t[4], por_revisar: +t[5] } } : {}),
  };
}

function frase(r: ResumenSync, correos: number | undefined): string {
  const nuevos = r.creado + r.fusionado;
  if (nuevos === 0 && r.por_revisar === 0) return correos === 0 ? 'No hay correos nuevos del banco en estos días.' : `Todo al día: ya tenía los ${r.duplicado + r.ignorado} avisos que encontré.`;
  const partes = [`${nuevos} ${nuevos === 1 ? 'movimiento nuevo' : 'movimientos nuevos'}`];
  if (r.por_revisar) partes.push(`${r.por_revisar} por revisar`);
  if (r.duplicado) partes.push(`${r.duplicado} ya estaban`);
  return `Listo: ${partes.join(', ')}.`;
}

function ejecutar(dias: number, env: Record<string, string | undefined>): Promise<ResultadoSync> {
  return new Promise((resolver) => {
    const user = (env.PLATA_IMAP_USER ?? env.IMAP_USER ?? '').trim();
    const hijo = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/importar-historial.ts', '--ultimos-dias', String(dias)],
      { cwd: process.cwd(), windowsHide: true, env: { ...(env as NodeJS.ProcessEnv), IMAP_USER: user, IMAP_PASS_FILE: rutaClaveGmail(env), PLATA_URL: `http://127.0.0.1:${env.PORT || 3010}` } },
    );
    let salida = '';
    let error = '';
    const reloj = setTimeout(() => { hijo.kill(); }, LIMITE_MS);
    hijo.stdout.on('data', (d: Buffer) => { salida += d.toString(); });
    hijo.stderr.on('data', (d: Buffer) => { error += d.toString(); });
    hijo.on('error', () => { clearTimeout(reloj); resolver({ ok: false, codigo: 'error', mensaje: 'No pude arrancar la revisión del correo.' }); });
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (codigo === 0) {
        const { correos, resumen } = leerResumen(salida);
        if (resumen) return resolver({ ok: true, codigo: 'ok', mensaje: frase(resumen, correos), correos, resumen });
        return resolver({ ok: true, codigo: 'ok', mensaje: 'Revisé el correo, sin novedades.', correos });
      }
      const detalle = (error.split('\n').find((l) => l.startsWith('Error:')) ?? '').slice(0, 200);
      if (/auth|credencial|login|invalid|password|contrase/i.test(detalle)) {
        return resolver({ ok: false, codigo: 'rechazado', mensaje: 'Gmail rechazó la contraseña de aplicación. Crea una nueva en tu cuenta de Google y vuelve a correr «npm run gmail-clave».' });
      }
      resolver({ ok: false, codigo: 'error', mensaje: detalle ? `No pude revisar el correo. ${detalle.replace(/^Error:\s*/, '')}` : 'No pude revisar el correo. Intenta otra vez en un momento.' });
    });
  });
}

/** Revisa Gmail ahora. Una sola revisión a la vez y una pausa corta entre pulsos para no saturar a Gmail. */
export function sincronizarCorreo(dias = DIAS_POR_DEFECTO, env: Record<string, string | undefined> = process.env): Promise<ResultadoSync> {
  const e = estadoSync(env);
  if (!e.configurado) return Promise.resolve({ ok: false, codigo: 'sin_configurar', mensaje: `Falta ${e.falta}. ${AYUDA_CONFIGURAR}` });
  if (enCurso) return enCurso;
  if (Date.now() - ultimoFin < ESPERA_ENTRE_PULSOS_MS) return Promise.resolve({ ok: false, codigo: 'espera', mensaje: 'Acabo de revisar el correo. Espera unos segundos.' });
  enCurso = ejecutar(dias, env).finally(() => { enCurso = null; ultimoFin = Date.now(); });
  return enCurso;
}

const g = globalThis as typeof globalThis & { __plataSyncAuto?: NodeJS.Timeout };

/** Revisión periódica propia, como red de seguridad si el lector de n8n se queda mudo. Solo si PLATA_SYNC_AUTO_MIN (5 a 120) está definido. */
export function iniciarSyncAutomatico(env: Record<string, string | undefined> = process.env): void {
  const min = Number(env.PLATA_SYNC_AUTO_MIN ?? 0);
  if (!Number.isFinite(min) || min < 5 || min > 120 || g.__plataSyncAuto) return;
  const correr = () => { if (estadoSync(env).configurado) void sincronizarCorreo(2, env).catch(() => undefined); };
  g.__plataSyncAuto = setInterval(correr, min * 60_000);
  g.__plataSyncAuto.unref();
  setTimeout(correr, 60_000).unref();
}
