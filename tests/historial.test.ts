// Pruebas del importador de historial: parser de correos, cliente IMAP (tramas) y opciones. Todo sintético.
import { describe, expect, it } from 'vitest';
import { extraerFetch, finDeRespuesta } from '../scripts/historial/imap.ts';
import {
  bancoPermitido, decodificarPalabras, dominioDe, enmascarar, mesDeCorreo, parsearCorreo, textoPlano,
} from '../scripts/historial/mensaje.ts';
import { consultaGmail, leerOpciones } from '../scripts/importar-historial.ts';
import { textoPlano as textoPlanoApp } from '@/lib/avisos/comun';
import { bancoPorDominio } from '@/lib/avisos/remitentes';

const AUTH = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@ayn.notificacionesbancolombia.com;\r\n       spf=pass; dmarc=pass\r\n';
const BASE =
  'Received: por mi servidor\r\n' + AUTH +
  'Authentication-Results: falso.example; dkim=pass\r\n' +
  'From: =?UTF-8?Q?Bancolombia_Alertas?= <alertas@ayn.notificacionesbancolombia.com>\r\n' +
  'Subject: =?UTF-8?B?QWxlcnRhcyB5IE5vdGlmaWNhY2lvbmVz?=\r\n' +
  'Date: Tue, 06 Oct 2026 13:59:40 -0500\r\n' +
  'Message-ID: <abc123@ayn.notificacionesbancolombia.com>\r\n';

describe('parsearCorreo', () => {
  it('multipart: prefiere text/plain, decodifica quoted-printable UTF-8 y no usa adjuntos', () => {
    const raw = BASE + 'Content-Type: multipart/alternative; boundary="XX"\r\n\r\n' +
      '--XX\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML que no debe usarse</p>\r\n' +
      '--XX\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' +
      'Bancolombia: Compraste $14.730,00 en TIENDA D1 con tu T.Deb *0000, el 06/10/2026 a las 13:59. Cr=C3=A9dito=\r\n =20fin\r\n' +
      '--XX\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=a.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nQUJD\r\n' +
      '--XX--\r\n';
    const a = parsearCorreo(raw)!;
    expect(a.text).toBe('Bancolombia: Compraste $14.730,00 en TIENDA D1 con tu T.Deb *0000, el 06/10/2026 a las 13:59. Crédito fin');
    expect(a.from).toBe('Bancolombia Alertas <alertas@ayn.notificacionesbancolombia.com>');
    expect(a.subject).toBe('Alertas y Notificaciones');
    expect(a.date).toBe('Tue, 06 Oct 2026 13:59:40 -0500');
    expect(a.message_id).toBe('<abc123@ayn.notificacionesbancolombia.com>');
  });

  it('auth_results es SOLO el primer bloque (el de mx.google.com), desplegado en una línea', () => {
    const a = parsearCorreo(BASE + 'Content-Type: text/plain\r\n\r\nhola\r\n')!;
    expect(a.auth_results).toBe('mx.google.com; dkim=pass header.i=@ayn.notificacionesbancolombia.com; spf=pass; dmarc=pass');
    expect(a.auth_results).not.toContain('falso.example');
  });

  it('solo HTML en base64: quita etiquetas con el criterio de la app', () => {
    const html = '<html><style>p{x:1}</style><body><p>Pago aprobado</p><table><tr><td>Valor</td><td>$25.000</td></tr></table>&nbsp;Ñandú</body></html>';
    const raw = BASE + 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n') + '\r\n';
    const a = parsearCorreo(raw)!;
    expect(a.text).toBe(textoPlanoApp(html));
    expect(a.text).toContain('Pago aprobado');
    expect(a.text).toContain('Valor $25.000');
    expect(a.text).not.toContain('<');
  });

  it('charset latin1 y cuerpo sin codificar', () => {
    const cuerpo = Buffer.concat([Buffer.from(BASE + 'Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nCompra en Caf'), Buffer.from([0xe9]), Buffer.from('\r\n')]);
    expect(parsearCorreo(cuerpo)!.text).toBe('Compra en Café');
  });

  it('enmascara secuencias de 8+ dígitos en cuerpo y asunto, y deja montos, fechas y horas', () => {
    const raw = BASE.replace('=?UTF-8?B?QWxlcnRhcyB5IE5vdGlmaWNhY2lvbmVz?=', 'Ref 123456789012') +
      'Content-Type: text/plain\r\n\r\nCuenta 12345678901 por $1.250.000,00 el 06/10/2026 13:59 *0000 ref 98765432\r\n';
    const a = parsearCorreo(raw)!;
    expect(a.text).toBe('Cuenta *******8901 por $1.250.000,00 el 06/10/2026 13:59 *0000 ref ****5432');
    expect(a.subject).toBe('Ref ********9012');
    expect(a.text).not.toMatch(/\d{8}/);
  });

  it('no enmascara el Message-ID (la deduplicación con el flujo en vivo depende de él)', () => {
    const raw = BASE.replace('abc123', '12345678901234') + 'Content-Type: text/plain\r\n\r\nx\r\n';
    expect(parsearCorreo(raw)!.message_id).toBe('<12345678901234@ayn.notificacionesbancolombia.com>');
  });

  it('devuelve null sin cuerpo de texto o sin remitente', () => {
    expect(parsearCorreo(BASE + 'Content-Type: image/png\r\n\r\nAAAA\r\n')).toBeNull();
    expect(parsearCorreo('Subject: x\r\nContent-Type: text/plain\r\n\r\nhola\r\n')).toBeNull();
  });

  it('tolera un mensaje recortado (sin boundary de cierre)', () => {
    const raw = BASE + 'Content-Type: multipart/alternative; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\nTexto cortado a med';
    expect(parsearCorreo(raw)!.text).toBe('Texto cortado a med');
  });
});

describe('utilidades', () => {
  it('RFC 2047 con palabras consecutivas y Q', () => {
    expect(decodificarPalabras('=?utf-8?Q?Cr=C3=A9dito_?= =?utf-8?Q?aprobado?=')).toBe('Crédito aprobado');
  });
  it('enmascarar', () => {
    expect(enmascarar('1234567 12345678')).toBe('1234567 ****5678');
  });
  it('mesDeCorreo usa hora de Bogotá', () => {
    expect(mesDeCorreo('Wed, 01 Oct 2026 02:30:00 +0000')).toBe('2026-09');
    expect(mesDeCorreo('Tue, 06 Oct 2026 13:59:40 -0500')).toBe('2026-10');
    expect(mesDeCorreo('basura')).toBe('sin-fecha');
  });
  it('lista blanca y texto plano coinciden con los de la app', () => {
    for (const d of ['ayn.notificacionesbancolombia.com', 'achcolombia.com.co', 'wompi.co', 'hello.rappicard.co', 'co.didiglobal.com', 'hello.rappi.com.co', 'evil.com', 'xwompi.co', 'notificacionesbancolombia.com.evil.io']) {
      expect(bancoPermitido(d)).toBe(bancoPorDominio(d));
    }
    for (const t of ['<p>Hola &amp; adiós</p><p>Valor:&nbsp;$5.000</p>', 'a<style>p{x:1}</style>b<script>1</script>c', 'si 3 < 5', 'a  b\t\tc\r\n\r\n\r\nd', 'x'.repeat(30_000)]) {
      expect(textoPlano(t)).toBe(textoPlanoApp(t));
    }
    expect(dominioDe('"a@evil.com" <x@wompi.co>')).toBe('wompi.co');
  });
});

describe('IMAP: tramas', () => {
  const literal = 'a1 OK dentro del literal\r\nmás texto';
  const trama = Buffer.from(
    `* 1 FETCH (UID 77 BODY[]<0> {${Buffer.byteLength(literal)}}\r\n${literal})\r\n` +
    `* 2 FETCH (BODY[] {5}\r\nhola!  UID 88)\r\n` +
    `a1 OK Success\r\n`);

  it('finDeRespuesta salta literales aunque contengan una línea que parece la etiquetada', () => {
    expect(finDeRespuesta(trama, 'a1')).toBe(trama.length);
    expect(finDeRespuesta(trama.subarray(0, trama.length - 5), 'a1')).toBe(-1);
    expect(finDeRespuesta(Buffer.from('* 1 FETCH (BODY[] {100}\r\nabc'), 'a1')).toBe(-1);
  });

  it('extraerFetch recupera literales y UID (antes o después del literal)', () => {
    const m = extraerFetch(trama);
    expect(m).toHaveLength(2);
    expect(m[0].uid).toBe(77);
    expect(m[0].raw.toString()).toBe(literal);
    expect(m[1].uid).toBe(88);
    expect(m[1].raw.toString()).toBe('hola!');
  });

  it('cuenta bytes, no caracteres (UTF-8)', () => {
    const cuerpo = 'Crédito ñ';
    const t = Buffer.from(`* 1 FETCH (UID 5 BODY[] {${Buffer.byteLength(cuerpo)}}\r\n${cuerpo})\r\na2 OK\r\n`);
    expect(finDeRespuesta(t, 'a2')).toBe(t.length);
    expect(extraerFetch(t)[0].raw.toString('utf8')).toBe(cuerpo);
  });
});

describe('opciones del script', () => {
  const hoy = new Date('2026-10-09T12:00:00Z');
  it('por defecto 365 días; --ultimos-dias y --desde; --dry-run', () => {
    expect(leerOpciones([], hoy).desde.toISOString().slice(0, 10)).toBe('2025-10-09');
    expect(leerOpciones(['--ultimos-dias', '14', '--dry-run'], hoy)).toMatchObject({ dryRun: true });
    expect(leerOpciones(['--ultimos-dias', '14'], hoy).desde.toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(leerOpciones(['--desde', '2026-01-31'], hoy).desde.toISOString().slice(0, 10)).toBe('2026-01-31');
  });
  it('consulta X-GM-RAW con todos los remitentes y fecha', () => {
    const q = consultaGmail(new Date('2026-09-25T00:00:00Z'));
    expect(q).toContain('after:2026/09/25');
    for (const d of ['notificacionesbancolombia.com', 'achcolombia.com.co', 'wompi.co', 'rappicard', 'didiglobal.com']) expect(q).toContain('from:' + d);
  });
});
