// POST /api/alertas/pendientes {} (token, n8n cada hora): evalúa las reglas, aplica cooldown/pausa/horario y devuelve
// los mensajes a enviar. Marca emisiones y recordatorios de la lista de espera al responder. También hace el
// mantenimiento diario (purgas, recurrentes, respaldo). SPEC §4.2, §5.7.
import fs from 'node:fs';
import path from 'node:path';
import { api } from '@/lib/api';
import { formatearRecomendacion } from '@/lib/bot';
import { refrescarRecurrentes } from '@/lib/datos';
import { mantenimiento, respaldar } from '@/lib/db';
import { LIMITES_CUERPO, leerJSON, respuestaJSON } from '@/lib/http';
import { calcularMetricas } from '@/lib/metricas';
import { evaluarReglas, filtrarParaPush } from '@/lib/recomendar';

export const POST = api('token', async (req, c) => {
  await leerJSON(req, LIMITES_CUERPO.defecto);

  // Tareas de mantenimiento: si fallan no deben tumbar las alertas.
  try {
    mantenimiento(c.db, c.ahora);
    refrescarRecurrentes(c.db, c.hoy);
    const archivo = (c.db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find((d) => d.name === 'main')?.file;
    if (archivo) {
      const dir = path.join(path.dirname(archivo), 'respaldos');
      if (!fs.existsSync(path.join(dir, `plata-${c.hoy}.db`))) respaldar(c.db, dir, c.hoy);
    }
  } catch (e) {
    c.datos.registrarEvento({ nivel: 'error', tipo: 'mantenimiento_fallido', detalle: e instanceof Error ? e.message : 'error' });
  }

  const inst = c.datos.instantanea(c.ahora);
  const recs = evaluarReglas(inst, calcularMetricas(inst));
  const { enviar, suprimidas } = filtrarParaPush(recs, inst.emisiones, c.ahora, inst.config);

  if (enviar.length > 0) {
    c.datos.registrarEmisiones(enviar, c.ahora);
    const items = enviar
      .filter((r) => r.regla === 'espera_lista')
      .map((r) => Number(r.id.slice('espera_lista:'.length)))
      .filter((n) => Number.isInteger(n));
    if (items.length) c.datos.marcarEsperaRecordada(items, c.ahora);
  }
  return respuestaJSON({
    respuestas: enviar.map(formatearRecomendacion),
    enviadas: enviar.map((r) => r.id),
    suprimidas,
  });
});
