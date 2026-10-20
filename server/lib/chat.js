import { db, now } from './dbx.js';

export function ensureGeneralChannel(createdBy = null) {
  const existing = db.get("SELECT id FROM channels WHERE kind = 'general'");
  if (existing) return existing.id;
  return db.insert('channels', {
    kind: 'general',
    name: 'General',
    description: 'Conversación de todo el equipo',
    created_by: createdBy,
    created_at: now(),
  });
}

export function ensureProjectChannel(project, createdBy = null) {
  const existing = db.get('SELECT id FROM channels WHERE project_id = ?', project.id);
  if (existing) {
    db.run('UPDATE channels SET name = ? WHERE id = ?', project.name, existing.id);
    return existing.id;
  }
  return db.insert('channels', {
    kind: 'project',
    name: project.name,
    description: 'Conversación del proyecto',
    project_id: project.id,
    created_by: createdBy,
    created_at: now(),
  });
}
