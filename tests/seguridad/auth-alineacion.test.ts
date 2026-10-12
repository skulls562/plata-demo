// I2 · Alineación DKIM/DMARC (SPEC §7.6, NOTAS-FRENTE-A «Autenticación»): un `dkim=pass` o `dmarc=pass` solo
// verifica el aviso si el dominio firmante es de la lista blanca y del MISMO banco que el remitente. Antes bastaba
// con que el firmante fuera un «padre» cualquiera del remitente, incluido un sufijo público («com», «co», «com.co»).
import { describe, expect, it } from 'vitest';
import { verificarAutenticacion } from '@/lib/avisos/remitentes';

const BANCO = 'ayn.notificacionesbancolombia.com';

describe('verificarAutenticacion: firmante alineado y de la lista blanca', () => {
  it('rechaza un firmante que es un sufijo público padre del remitente', () => {
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=com', BANCO)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.i=@com', BANCO)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dmarc=pass header.from=com', BANCO)).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=com.co', 'achcolombia.com.co')).toBe('desconocido');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=co', 'wompi.co')).toBe('desconocido');
  });

  it('sigue aceptando al banco real (mismo dominio, padre o hijo de la lista blanca)', () => {
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=notificacionesbancolombia.com', BANCO)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=ayn.notificacionesbancolombia.com', BANCO)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dmarc=pass header.from=ayn.notificacionesbancolombia.com', BANCO)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dmarc=pass (p=REJECT)', BANCO)).toBe('pasa');
    expect(verificarAutenticacion('mx.google.com; dkim=pass header.d=wompi.co', 'notificaciones.wompi.co')).toBe('pasa');
  });

  it('un dkim=fail sin pass alineado sigue siendo falla', () => {
    expect(verificarAutenticacion('mx.google.com; dkim=fail header.d=com; dkim=pass header.d=com', BANCO)).toBe('falla');
  });
});
