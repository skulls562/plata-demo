// Cliente IMAP mínimo de SOLO LECTURA sobre node:tls (sin dependencias).
// Solo emite LOGIN, LIST, EXAMINE, UID SEARCH, UID FETCH ... BODY.PEEK[] y LOGOUT. Nunca SELECT, STORE ni EXPUNGE.
// La contraseña nunca se registra: los errores llevan solo el estado (NO/BAD) y el código del comando.
import tls from 'node:tls';

export interface MensajeCrudo { uid: number; raw: Buffer }

const CRLF = Buffer.from('\r\n');

/** Posición justo después de la línea con etiqueta `tag`, saltando literales {n}; -1 si aún no llegó. */
export function finDeRespuesta(buf: Buffer, tag: string): number {
  let pos = 0;
  while (pos < buf.length) {
    const eol = buf.indexOf(CRLF, pos);
    if (eol === -1) return -1;
    const linea = buf.toString('latin1', pos, eol);
    const lit = /\{(\d+)\}$/.exec(linea);
    if (lit) {
      pos = eol + 2 + Number(lit[1]);
      if (pos > buf.length) return -1;
      continue;   // el resto de la línea (tras el literal) se lee como línea normal
    }
    if (linea.startsWith(tag + ' ')) return eol + 2;
    pos = eol + 2;
  }
  return -1;
}

/** Extrae los literales de las líneas `* n FETCH (... BODY[] {n}`; el UID puede ir antes o después del literal. */
export function extraerFetch(buf: Buffer): MensajeCrudo[] {
  const out: MensajeCrudo[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const eol = buf.indexOf(CRLF, pos);
    if (eol === -1) break;
    const linea = buf.toString('latin1', pos, eol);
    const lit = /\{(\d+)\}$/.exec(linea);
    if (lit && /^\* \d+ FETCH/.test(linea)) {
      const n = Number(lit[1]);
      const ini = eol + 2;
      const raw = buf.subarray(ini, ini + n);
      const finLinea = buf.indexOf(CRLF, ini + n);
      const cola = finLinea === -1 ? '' : buf.toString('latin1', ini + n, finLinea);
      const uid = /UID (\d+)/.exec(linea) ?? /UID (\d+)/.exec(cola);
      out.push({ uid: uid ? Number(uid[1]) : 0, raw: Buffer.from(raw) });
      pos = finLinea === -1 ? buf.length : finLinea + 2;
      continue;
    }
    pos = eol + 2;
  }
  return out;
}

const comillas = (s: string) => '"' + s.replace(/[\\"]/g, '\\$&') + '"';

export class ClienteIMAP {
  private socket!: tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private esperando: (() => void) | null = null;
  private error: Error | null = null;
  private cerrado = false;
  private n = 0;

  private host: string;
  private puerto: number;

  constructor(host = process.env.PLATA_IMAP_HOST?.trim() || 'imap.gmail.com', puerto = 993) {
    this.host = host;
    this.puerto = puerto;
  }

  async conectar(): Promise<void> {
    await new Promise<void>((ok, fallo) => {
      this.socket = tls.connect({ host: this.host, port: this.puerto, servername: this.host }, () => ok());
      this.socket.setTimeout(60_000, () => this.socket.destroy(new Error('IMAP: tiempo agotado')));
      this.socket.on('error', (e) => { this.error = e; this.esperando?.(); fallo(e); });
      this.socket.on('close', () => { this.cerrado = true; this.esperando?.(); });
      this.socket.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.esperando?.(); });
    });
    await this.esperar(() => this.buf.includes(CRLF));   // saludo «* OK ...»
    this.buf = Buffer.alloc(0);
  }

  private esperar(listo: () => boolean): Promise<void> {
    return new Promise((ok, fallo) => {
      const revisar = () => {
        if (listo()) { this.esperando = null; ok(); return; }
        if (this.error) { this.esperando = null; fallo(new Error('IMAP: error de conexión')); return; }
        if (this.cerrado) { this.esperando = null; fallo(new Error('IMAP: conexión cerrada')); return; }
      };
      this.esperando = revisar;
      revisar();
    });
  }

  /** Ejecuta un comando y devuelve toda la respuesta (sin la línea etiquetada). Los errores citan solo el verbo, nunca los argumentos (LOGIN lleva la clave). */
  private async cmd(texto: string): Promise<Buffer> {
    const tag = 'a' + ++this.n;
    this.socket.write(`${tag} ${texto}\r\n`);
    let fin = -1;
    await this.esperar(() => (fin = finDeRespuesta(this.buf, tag)) !== -1);
    const resp = this.buf.subarray(0, fin);
    this.buf = Buffer.from(this.buf.subarray(fin));
    const ultima = resp.toString('latin1', resp.lastIndexOf(CRLF, resp.length - 3) + 2, resp.length - 2);
    const estado = ultima.slice(tag.length + 1).split(' ')[0];
    if (estado !== 'OK') throw new Error(`IMAP: ${texto.split(' ')[0]} devolvió ${estado}`);
    return resp;
  }

  async login(usuario: string, clave: string): Promise<void> {
    await this.cmd(`LOGIN ${comillas(usuario)} ${comillas(clave)}`);
  }

  /** Carpeta marcada \All (Todos los mensajes, el nombre depende del idioma de la cuenta); si no hay, INBOX. */
  async carpetaTodos(): Promise<string> {
    const r = (await this.cmd('LIST "" "*"')).toString('latin1');
    for (const l of r.split('\r\n')) {
      const m = /^\* LIST \(([^)]*)\) "[^"]*" (.+)$/.exec(l);
      if (m && /\\All\b/i.test(m[1])) return m[2].replace(/^"|"$/g, '');
    }
    return 'INBOX';
  }

  /** Abre en SOLO LECTURA. */
  async examinar(carpeta: string): Promise<void> {
    await this.cmd(`EXAMINE ${comillas(carpeta)}`);
  }

  async buscarGmail(consulta: string): Promise<number[]> {
    const r = (await this.cmd(`UID SEARCH X-GM-RAW ${comillas(consulta)}`)).toString('latin1');
    const m = /\* SEARCH([\d ]*)/.exec(r);
    return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : [];
  }

  /** Descarga los mensajes completos sin marcarlos como leídos (BODY.PEEK). `maxBytes` recorta cada mensaje. */
  async traer(uids: number[], maxBytes = 250_000): Promise<MensajeCrudo[]> {
    if (uids.length === 0) return [];
    return extraerFetch(await this.cmd(`UID FETCH ${uids.join(',')} (UID BODY.PEEK[]<0.${maxBytes}>)`));
  }

  async cerrar(): Promise<void> {
    try { if (!this.cerrado) await this.cmd('LOGOUT'); } catch { /* se cierra igual */ }
    this.socket?.destroy();
  }
}
