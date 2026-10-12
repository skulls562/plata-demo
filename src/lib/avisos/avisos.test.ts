// Pruebas puras de avisos: remitentes, texto plano, referencias, parsers y fixtures sintéticos (SPEC §8.2).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_POR_DEFECTO } from '../config';
import { parsearBancolombia } from './bancolombia';
import {
  ajustarTipo, buscarFusion, fechaHoraDeCorreo, huella, refCorreo, textoPlano, validarAvisoCrudo,
} from './comun';
import { interpretarAviso } from './index';
import { parsearPSE } from './pse';
import { bancoPorDominio, dominioRemitente, verificarAutenticacion } from './remitentes';
import { parsearWompi } from './wompi';
import { ErrorUsuario } from '../tipos';
import type { AvisoCrudo, DatosAviso, Movimiento } from '../tipos';

const AHORA = new Date('2026-10-15T17:00:00Z');   // 12:00 en Bogotá

interface Fixture {
  descripcion: string;
  aviso: AvisoCrudo;
  esperado: Record<string, unknown>;
  autenticacion?: 'pasa' | 'falla' | 'desconocido';
}
const dirFx = path.resolve(process.cwd(), 'tests/fixtures/avisos');
const fixtures = fs.readdirSync(dirFx).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ nombre: f.replace(/\.json$/, ''), fx: JSON.parse(fs.readFileSync(path.join(dirFx, f), 'utf8')) as Fixture }));

describe('fixtures sintéticos', () => {
  it('hay fixtures y ninguno trae dígitos largos reales (solo *0000 y similares)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(25);
    for (const { nombre, fx } of fixtures) {
      // La inyección de prompt es intencional: el número largo (inventado) es justo lo que el ataque intenta colar.
      if (nombre === 'rappicard-inyeccion') continue;
      const sinPermitidos = fx.aviso.text
        .replace(/\$\s?[\d.,]+/g, '').replace(/COP\s*\$?\s*[\d.,]+/g, '').replace(/\d{2}\/\d{2}\/\d{4}/g, '')
        .replace(/0{4,}/g, '');
      expect(/\d{5,}/.test(sinPermitidos), nombre).toBe(false);
    }
  });

  for (const { nombre, fx } of fixtures) {
    it(`interpretarAviso: ${nombre}`, () => {
      if ('remitente_permitido' in fx.esperado) {
        const d = dominioRemitente(fx.aviso.from);
        expect(d !== null && bancoPorDominio(d) !== null).toBe(fx.esperado.remitente_permitido);
        expect(interpretarAviso(fx.aviso, AHORA)).toEqual({ estado: 'ignorado', motivo: 'remitente_no_permitido' });
        return;
      }
      expect(interpretarAviso(fx.aviso, AHORA)).toEqual(fx.esperado);
    });

    if (fx.autenticacion) {
      it(`autenticación: ${nombre}`, () => {
        expect(verificarAutenticacion(fx.aviso.auth_results, dominioRemitente(fx.aviso.from)!)).toBe(fx.autenticacion);
      });
    }
  }

  it('todos los fixtures con auth_results válida del banco pasan la verificación', () => {
    for (const { nombre, fx } of fixtures) {
      if (fx.autenticacion || !fx.aviso.auth_results) continue;
      const d = dominioRemitente(fx.aviso.from);
      if (!d || !bancoPorDominio(d)) continue;
      expect(verificarAutenticacion(fx.aviso.auth_results, d), nombre).toBe('pasa');
    }
  });
});

describe('remitentes', () => {
  it('dominioRemitente', () => {
    expect(dominioRemitente('Bancolombia <x@ayn.notificacionesbancolombia.com>')).toBe('ayn.notificacionesbancolombia.com');
    expect(dominioRemitente('x@Wompi.CO')).toBe('wompi.co');
    expect(dominioRemitente('"a@bancolombia.com" <x@evil.test>')).toBe('evil.test');
    expect(dominioRemitente('sin arroba')).toBeNull();
    expect(dominioRemitente('')).toBeNull();
    expect(dominioRemitente('x@a..b')).toBeNull();
    expect(dominioRemitente('x@' + 'a'.repeat(400))).toBeNull();
  });

  it('bancoPorDominio: lista blanca por sufijo exacto', () => {
    expect(bancoPorDominio('ayn.notificacionesbancolombia.com')).toBe('bancolombia');
    expect(bancoPorDominio('notificacionesbancolombia.com')).toBe('bancolombia');
    expect(bancoPorDominio('achcolombia.com.co')).toBe('pse');
    expect(bancoPorDominio('pagos.achcolombia.com.co')).toBe('pse');
    expect(bancoPorDominio('wompi.co')).toBe('wompi');
    expect(bancoPorDominio('mail.wompi.com')).toBe('wompi');
    expect(bancoPorDominio('mail.rappicard.co')).toBe('rappicard');
    expect(bancoPorDominio('rappicard.com')).toBe('rappicard');
    expect(bancoPorDominio('notificaciones.rappi.com')).toBe('rappicard');
    expect(bancoPorDominio('didiglobal.com')).toBe('didi');
    expect(bancoPorDominio('mail.didiglobal.com')).toBe('didi');
  });

  it('bancoPorDominio rechaza imitaciones', () => {
    for (const d of [
      'bancolombia.com.atacante.co', 'notificacionesbancolombia.com.evil.co', 'xnotificacionesbancolombia.com',
      'wompi.co.evil.com', 'evilwompi.co', 'rappicard.evil.com', 'rappicard.co.evil.com', 'didiglobal.com.evil.co', 'gmail.com', '',
    ]) {
      expect(bancoPorDominio(d), d).toBeNull();
    }
  });

  it('verificarAutenticacion', () => {
    const d = 'ayn.notificacionesbancolombia.com';
    expect(verificarAutenticacion(undefined, d)).toBe('desconocido');
    expect(verificarAutenticacion('', d)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dmarc=pass (p=REJECT)', d)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.i=@notificacionesbancolombia.com', d)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=otro-dominio.com', d)).toBe('desconocido');
    // Solo se cree al primer bloque y solo si lo escribió mx.google.com
    expect(verificarAutenticacion('evil.example.com; dmarc=pass', d)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; spf=pass\nauthentication-results: x; dmarc=pass', d)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dmarc=fail', d)).toBe('falla');
    expect(verificarAutenticacion('mx.google.com; dkim=fail; spf=pass', d)).toBe('falla');
    expect(verificarAutenticacion('mx.google.com; dkim=fail; dkim=pass header.i=@ayn.notificacionesbancolombia.com', d)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; spf=pass', d)).toBe('desconocido');
  });
});

describe('validarAvisoCrudo', () => {
  const base = { from: 'a@b.co', subject: 's', date: 'd', text: 't' };
  it('acepta y limpia', () => {
    expect(validarAvisoCrudo({ ...base, extra: 1, message_id: ' <x@y> ', auth_results: '' })).toEqual({
      ...base, message_id: ' <x@y> ',
    });
  });
  it('rechaza con ErrorUsuario', () => {
    for (const x of [null, [], 'x', {}, { ...base, from: 5 }, { ...base, from: '  ' }, { ...base, text: 'a'.repeat(200_001) },
      { ...base, subject: 'a'.repeat(501) }, { ...base, message_id: 'a'.repeat(999) }, { ...base, auth_results: 'a'.repeat(4001) },
      { ...base, date: undefined }]) {
      expect(() => validarAvisoCrudo(x)).toThrow(ErrorUsuario);
    }
  });
});

describe('textoPlano', () => {
  it('quita etiquetas, decodifica entidades y conserva saltos de bloque', () => {
    expect(textoPlano('<p>Hola &amp; adiós</p><p>Valor:&nbsp;$5.000 &#x41; &#66; &Ntilde;</p>')).toBe('Hola & adiós\nValor: $5.000 A B Ñ');
  });
  it('descarta script, style y comentarios', () => {
    expect(textoPlano('a<style>p{x:1}</style>b<script>alert(1)</script>c<!-- oculto -->d')).toBe('abcd');
  });
  it('un «<» suelto es texto', () => {
    expect(textoPlano('si 3 < 5 y 7 > 2')).toBe('si 3 < 5 y 7 > 2');
  });
  it('no decodifica dos veces ni inventa entidades', () => {
    expect(textoPlano('&amp;lt; &inventada;')).toBe('&lt; &inventada;');
  });
  it('quita caracteres invisibles y colapsa espacios', () => {
    expect(textoPlano('a​  b\t\tc\r\n\r\n\r\nd')).toBe('a b c\n\nd'.replace('\n\n', '\n'));
  });
  it('recorta a 20 000', () => {
    expect(textoPlano('x'.repeat(50_000)).length).toBe(20_000);
  });
  it('200 KB (texto, HTML y etiquetas sin cerrar) en < 50 ms cada uno', () => {
    const casos = [
      'Compraste $14.730,00 en TIENDA '.repeat(7000),
      '<p>Compraste $14.730,00</p>'.repeat(8000),
      '<script>'.repeat(25_000),
      '<a '.repeat(60_000),
      '&amp;'.repeat(40_000),
      '$'.repeat(200_000),
    ];
    for (const c of casos) {
      const t0 = performance.now();
      const plano = textoPlano(c);
      parsearBancolombia('x', plano, { fecha: '2026-10-06', hora: '10:00' });
      parsearPSE('PSE - Transacción Aprobada', plano, { fecha: '2026-10-06', hora: '10:00' });
      parsearWompi('Transacción APROBADA en X', plano, { fecha: '2026-10-06', hora: '10:00' });
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});

describe('refCorreo y huella', () => {
  const a: AvisoCrudo = { from: 'f', subject: 's', date: 'd', text: 'hola   mundo' };
  it('con message_id: mid: + hash sin <> ni mayúsculas', () => {
    const r1 = refCorreo({ ...a, message_id: '<ABC@x.com>' });
    expect(r1).toMatch(/^mid:[0-9a-f]{64}$/);
    expect(refCorreo({ ...a, message_id: ' abc@x.com ' })).toBe(r1);
    expect(r1).not.toContain('abc@x.com');
  });
  it('sin message_id: h: + hash estable que ignora espacios del texto', () => {
    const r = refCorreo(a);
    expect(r).toMatch(/^h:[0-9a-f]{64}$/);
    expect(refCorreo({ ...a, text: 'hola mundo' })).toBe(r);
    expect(refCorreo({ ...a, text: 'otro' })).not.toBe(r);
    expect(r.length).toBeGreaterThanOrEqual(8);
    expect(r.length).toBeLessThanOrEqual(80);
  });
  it('huella', () => {
    expect(huella({ fecha: '2026-10-06', hora: '13:59', monto: 14730, banco: 'bancolombia' }, 'tienda d1')).toBe(
      '2026-10-06|13:59|14730|tienda d1|bancolombia',
    );
    expect(huella({ fecha: '2026-10-06', hora: null, monto: 1, banco: 'wompi' }, 'x')).toBe('2026-10-06|--:--|1|x|wompi');
  });
});

describe('ajustarTipo', () => {
  const d = (over: Partial<DatosAviso> = {}): DatosAviso => ({
    banco: 'bancolombia', tipo: 'pago', sentido: 'salida', monto: 1000, comercio: 'x', fecha: '2026-10-06', hora: '10:00',
    medio: null, confianza: 'regla', ...over,
  });
  it('pago a RappiCard no cuenta', () => {
    expect(ajustarTipo(d(), 'rappicard', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'pago_tarjeta', computa: false });
    expect(ajustarTipo(d(), 'pago tc abril', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'pago_tarjeta', computa: false });
  });
  it('pago a un bolsillo propio es interno', () => {
    expect(ajustarTipo(d({ tipo: 'transferencia' }), 'bolsillo viaje', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'interno', computa: false });
  });
  it('una transferencia (Bre-B, a cuenta) nace sin contar como gasto; el retiro y la compra sí cuentan', () => {
    expect(ajustarTipo(d({ tipo: 'transferencia' }), 'transferencia a cuenta', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'transferencia', computa: false });
    expect(ajustarTipo(d({ tipo: 'transferencia' }), 'juan perez', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'transferencia', computa: false });
    expect(ajustarTipo(d({ tipo: 'retiro' }), 'cajero upb1', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'retiro', computa: true });
  });
  it('compras en Rappi (comida) siguen contando', () => {
    expect(ajustarTipo(d({ tipo: 'compra' }), 'rappi restaurante', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'compra', computa: true });
  });
  it('una entrada no se reclasifica', () => {
    expect(ajustarTipo(d({ tipo: 'ingreso', sentido: 'entrada' }), 'bolsillo', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'ingreso', computa: true });
  });
  it('si la IA ya dijo pago_tarjeta, no computa', () => {
    expect(ajustarTipo(d({ tipo: 'pago_tarjeta' }), 'cualquiera', CONFIG_POR_DEFECTO)).toEqual({ tipo: 'pago_tarjeta', computa: false });
  });
});

describe('buscarFusion', () => {
  const mov = (over: Partial<Movimiento> = {}): Movimiento => ({
    id: 1, fecha: '2026-10-06', hora: '14:00', banco: 'bancolombia', tipo: 'compra', sentido: 'salida', monto: 129900,
    comercio: 'X', comercio_norm: 'x', categoria_id: 'otros', categoria_fuente: 'defecto', computa: true, fijo_id: null,
    recurrente_id: null, medio: 'debito', origen: 'aviso', confianza: 'regla', verificado: true, ref_correo: 'mid:1',
    nota: null, creado_en: '2026-10-06T19:00:00Z', actualizado_en: '2026-10-06T19:00:00Z', version: 1, ...over,
  });
  const nuevo = (over: Partial<DatosAviso> = {}): DatosAviso => ({
    banco: 'wompi', tipo: 'pago', sentido: 'salida', monto: 129900, comercio: 'TIENDA', fecha: '2026-10-06', hora: '14:12',
    medio: null, confianza: 'regla', ...over,
  });

  it('wompi + bancolombia a 12 min → fusionar', () => {
    const r = buscarFusion(nuevo(), [mov()], 30);
    expect(r.accion).toBe('fusionar');
    expect(r.con?.id).toBe(1);
  });
  it('cruza la medianoche', () => {
    const r = buscarFusion(nuevo({ fecha: '2026-10-07', hora: '00:05' }), [mov({ fecha: '2026-10-06', hora: '23:55' })], 30);
    expect(r.accion).toBe('fusionar');
  });
  it('fuera de la ventana → ninguna', () => {
    expect(buscarFusion(nuevo({ hora: '14:45' }), [mov()], 30).accion).toBe('ninguna');
    expect(buscarFusion(nuevo({ hora: '14:30' }), [mov()], 30).accion).toBe('fusionar');   // justo 30 min
  });
  it('monto, sentido o banco distinto → ninguna', () => {
    expect(buscarFusion(nuevo({ monto: 1 }), [mov()], 30).accion).toBe('ninguna');
    expect(buscarFusion(nuevo({ sentido: 'entrada', tipo: 'ingreso' }), [mov()], 30).accion).toBe('ninguna');
    expect(buscarFusion(nuevo({ banco: 'bancolombia' }), [mov()], 30).accion).toBe('ninguna');
    expect(buscarFusion(nuevo(), [mov({ origen: 'manual' })], 30).accion).toBe('ninguna');
  });
  it('Rappi + DiDi (ninguna pasarela) → marcar, no fusionar', () => {
    const r = buscarFusion(nuevo({ banco: 'didi' }), [mov({ banco: 'rappicard' })], 30);
    expect(r.accion).toBe('marcar');
    expect(r.con?.id).toBe(1);
  });
  it('wompi + pse → marcar', () => {
    expect(buscarFusion(nuevo({ banco: 'pse' }), [mov({ banco: 'wompi' })], 30).accion).toBe('marcar');
  });
  it('sin hora en alguno: misma fecha pero solo se marca', () => {
    expect(buscarFusion(nuevo({ hora: null }), [mov()], 30).accion).toBe('marcar');
    expect(buscarFusion(nuevo({ hora: null, fecha: '2026-10-08' }), [mov()], 30).accion).toBe('ninguna');
  });
  it('elige el candidato más cercano en el tiempo', () => {
    const r = buscarFusion(nuevo(), [mov({ id: 1, hora: '14:00' }), mov({ id: 2, hora: '14:10' })], 30);
    expect(r.con?.id).toBe(2);
  });
});

describe('fechaHoraDeCorreo', () => {
  it('convierte a Bogotá', () => {
    expect(fechaHoraDeCorreo('Tue, 06 Oct 2026 23:30:00 -0500', AHORA)).toEqual({ fecha: '2026-10-06', hora: '23:30' });
    expect(fechaHoraDeCorreo('2026-10-07T04:30:00Z', AHORA)).toEqual({ fecha: '2026-10-06', hora: '23:30' });
  });
  it('ilegible → ahora', () => {
    expect(fechaHoraDeCorreo('???', AHORA)).toEqual({ fecha: '2026-10-15', hora: '12:00' });
  });
});

describe('parsers: casos adicionales', () => {
  const fc = { fecha: '2026-10-06', hora: '10:00' };
  const dato = (texto: string) => {
    const r = parsearBancolombia('x', texto, fc);
    if (r.estado !== 'leido') throw new Error('no se leyó: ' + JSON.stringify(r));
    return r.datos;
  };
  it('12:30 a. m. es 00:30 y 12:30 p. m. es 12:30', () => {
    expect(dato('Compraste $1.000,00 en TIENDA con tu T.Deb *0000, el 06/10/2026 a las 12:30 a. m.').hora).toBe('00:30');
    expect(dato('Compraste $1.000,00 en TIENDA con tu T.Deb *0000, el 06/10/2026 a las 12:30 p. m.').hora).toBe('12:30');
    expect(dato('Compraste $1.000,00 en TIENDA con tu T.Deb *0000, el 06/10/2026 a las 21:30').hora).toBe('21:30');
  });
  it('fecha imposible en el cuerpo → la del correo', () => {
    expect(dato('Compraste $1.000,00 en TIENDA con tu T.Deb *0000, el 31/02/2026 a las 10:00').fecha).toBe('2026-10-06');
  });
  it('sin comercio reconocible usa un nombre genérico', () => {
    expect(dato('Retiraste $100.000,00').comercio).toBe('Retiro');
    expect(dato('Transferiste $100.000,00').comercio).toBe('Transferencia');
    expect(dato('Compraste $5.000,00').comercio).toBe('Compra');
    expect(dato('Recibiste $5.000,00').comercio).toBe('Ingreso');
  });
  it('enmascara dígitos largos en el comercio', () => {
    expect(dato('Pagaste $50.000,00 a CONVENIO 123456789 con tu cuenta *0000, el 06/10/2026.').comercio).toBe('CONVENIO [num]');
  });
  it('monto ilegible → necesita IA', () => {
    expect(parsearBancolombia('x', 'Compraste $abc en X', fc)).toEqual({ estado: 'necesita_ia', banco: 'bancolombia' });
    expect(parsearBancolombia('x', 'Compraste $1.2.3 en X', fc)).toEqual({ estado: 'necesita_ia', banco: 'bancolombia' });
  });
  it('un texto con saltos de línea también se lee', () => {
    expect(dato('Bancolombia:\nCompraste $5.000,00\nen TIENDA con tu T.Deb *0000,\nel 06/10/2026 a las 10:00.').comercio).toBe('TIENDA');
  });
  it('Wompi: asunto que no coincide → IA; sin ref', () => {
    expect(parsearWompi('Hola', 'COP $5.000', fc)).toEqual({ estado: 'necesita_ia', banco: 'wompi' });
  });
  it('Wompi: respaldo con el primer $', () => {
    const r = parsearWompi('Transacción APROBADA en TIENDA', 'Pagaste $52.300 hoy', fc);
    expect(r).toMatchObject({ estado: 'leido', datos: { monto: 52300 } });
  });
  it('PSE: monto con «Total» y comercio con «Convenio»', () => {
    const r = parsearPSE('PSE - Transacción Aprobada', 'Total pagado: $12.000\nConvenio: ACUEDUCTO PRUEBA', fc);
    expect(r).toMatchObject({ estado: 'leido', datos: { monto: 12000, comercio: 'ACUEDUCTO PRUEBA', medio: 'pse' } });
  });
});
