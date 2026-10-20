import { db, now } from './dbx.js';
import { emit } from './events.js';
import { can } from './permissions.js';

/** Registra un cambio en la bitácora (historial por entidad + actividad del equipo + auditoría). */
export function logActivity({ actor, entityType, entityId, projectId = null, action, summary, data = null }) {
  db.insert('activity', {
    actor_id: actor?.id ?? actor ?? null,
    entity_type: entityType,
    entity_id: entityId ?? null,
    project_id: projectId,
    action,
    summary,
    data: data ? JSON.stringify(data) : null,
    created_at: now(),
  });
  emit(['activity'], entityType === 'transaction' ? { filter: (u) => can(u, 'finance.view') } : {});
}

/** Calcula las diferencias campo a campo para el historial. */
export function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    if (after[f] === undefined) continue;
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (String(a) !== String(b)) changes[f] = { from: a, to: b };
  }
  return changes;
}
