// GET /api/cuentas y POST /api/cuentas (sesión): cuentas con saldo (efectivo, banco, ahorro). Migración 5.
import { api, objeto } from '@/lib/api';
import { LIMITES_CUERPO, conIdempotencia, leerJSON, respuestaJSON } from '@/lib/http';
import { crearCuenta, listarCuentas } from '@/lib/panel';

export const GET = api('sesion', async (_req, c) => {
  const items = listarCuentas(c.db);
  return respuestaJSON({ items, saldo_total: items.reduce((s, x) => s + x.saldo, 0) });
});

export const POST = api('sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['nombre', 'tipo', 'saldo']);
  return conIdempotencia(req, '/api/cuentas', cuerpo, async () =>
    respuestaJSON(crearCuenta(c.db, { nombre: cuerpo.nombre, tipo: cuerpo.tipo, saldo: cuerpo.saldo }, c.ahora), 201));
});
