// POST /api/vault/exportar { mes } (token o sesión): escribe la nota mensual en <PLATA_VAULT_FINANZAS>/Plata/AAAA-MM.md.
// Sobrescribe (idempotente). Responde la ruta RELATIVA, nunca la absoluta. SPEC §5.7, §7.9.
import { api, armarNotaMensual, objeto, RE_MES, validacion } from '@/lib/api';
import { mesDe } from '@/lib/formato';
import { ErrorHTTP, LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { escribirNotaMensual } from '@/lib/vault';

export const POST = api('token_o_sesion', async (req, c) => {
  const cuerpo = objeto(await leerJSON(req, LIMITES_CUERPO.defecto), ['mes']);
  const mes = cuerpo.mes;
  if (typeof mes !== 'string' || !RE_MES.test(mes)) validacion('mes debe ser AAAA-MM', 'mes');
  if ((mes as string) > mesDe(c.hoy)) validacion('mes no puede ser futuro', 'mes');
  const dir = c.entorno.dir_finanzas;
  if (!dir) throw new ErrorHTTP(422, 'vault_no_configurado', 'Falta PLATA_VAULT_FINANZAS');

  const { bytes } = await escribirNotaMensual(dir, mes as string, armarNotaMensual(c, mes as string));
  return respuestaJSON({ ruta: `Finanzas/Plata/${mes}.md`, bytes });
});
