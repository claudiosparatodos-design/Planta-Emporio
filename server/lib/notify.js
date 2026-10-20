import { db, now } from './dbx.js';
import { emit } from './events.js';
import { parseJson } from './http.js';

/** Tipos de notificación configurables por cada integrante. */
export const NOTIFICATION_TYPES = [
  { key: 'assigned', label: 'Me asignan una tarea' },
  { key: 'mention', label: 'Alguien me menciona' },
  { key: 'comment', label: 'Comentan en una tarea que sigo' },
  { key: 'task_status', label: 'Cambios de estado (bloqueos, revisión, terminado)' },
  { key: 'due_soon', label: 'Se acerca una fecha límite' },
  { key: 'message', label: 'Mensajes directos' },
  { key: 'decision', label: 'Decisiones que requieren mi aprobación' },
  { key: 'finance', label: 'Aprobaciones, pagos y cobros' },
  { key: 'meeting', label: 'Reuniones' },
  { key: 'reminder', label: 'Mis recordatorios' },
  { key: 'project', label: 'Me agregan a un proyecto' },
];

/**
 * Crea notificaciones respetando las preferencias de cada persona.
 * Nunca notifica al autor de la acción.
 */
export function notify({ userIds, type, title, body = null, link = null, actorId = null, entityType = null, entityId = null }) {
  const unique = [...new Set((userIds || []).filter(Boolean))].filter((id) => id !== actorId);
  const delivered = [];
  for (const userId of unique) {
    const user = db.get("SELECT id, prefs, status FROM users WHERE id = ?", userId);
    if (!user || user.status !== 'active') continue;
    const prefs = parseJson(user.prefs, {});
    if (prefs.notifications && prefs.notifications[type] === false) continue;
    db.insert('notifications', {
      user_id: userId,
      type,
      title,
      body,
      link,
      actor_id: actorId,
      entity_type: entityType,
      entity_id: entityId,
      created_at: now(),
    });
    delivered.push(userId);
  }
  if (delivered.length) emit(['notifications'], { userIds: delivered });
  return delivered;
}

/** Busca menciones "@Nombre" en un texto y devuelve ids de usuarios activos mencionados. */
export function findMentions(text) {
  if (!text || !text.includes('@')) return [];
  const users = db.all("SELECT id, name FROM users WHERE status = 'active'");
  const lower = text.toLowerCase();
  const found = [];
  for (const u of users) {
    const full = `@${u.name.toLowerCase()}`;
    const first = `@${u.name.split(' ')[0].toLowerCase()}`;
    if (matchesWord(lower, full) || matchesWord(lower, first)) found.push(u.id);
  }
  // Menciones explícitas generadas por el editor: @[Nombre](user:ID)
  for (const m of text.matchAll(/\(user:(\d+)\)/g)) found.push(Number(m[1]));
  return [...new Set(found)];
}

function matchesWord(text, token) {
  let i = text.indexOf(token);
  while (i !== -1) {
    const next = text[i + token.length];
    if (next === undefined || !/[\p{L}\p{N}]/u.test(next)) return true;
    i = text.indexOf(token, i + 1);
  }
  return false;
}
