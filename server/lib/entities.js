import { db } from './dbx.js';
import { can, canViewChannel, canViewFile, canViewPage, canViewProject, canViewTask } from './permissions.js';

export const ENTITY_TYPES = ['task', 'project', 'page', 'meeting', 'decision', 'file', 'goal', 'transaction', 'message', 'channel'];

/** Devuelve un resumen visible de una entidad o null si no existe o el usuario no puede verla. */
export function entitySummary(user, type, id) {
  switch (type) {
    case 'task': {
      const t = db.get(
        'SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?',
        id,
      );
      if (!t || t.deleted_at || !canViewTask(user, t)) return null;
      return { type, id, title: t.title, subtitle: t.project_name || 'Sin proyecto', status: t.status, due_date: t.due_date, url: `/tasks/${id}`, project_id: t.project_id };
    }
    case 'project': {
      const p = db.get('SELECT * FROM projects WHERE id = ?', id);
      if (!p || p.deleted_at || !canViewProject(user, p)) return null;
      return { type, id, title: p.name, icon: p.icon, color: p.color, subtitle: 'Proyecto', status: p.status, url: `/projects/${id}`, project_id: id };
    }
    case 'page': {
      const pg = db.get('SELECT * FROM pages WHERE id = ?', id);
      if (!canViewPage(user, pg)) return null;
      return { type, id, title: pg.title || 'Sin título', icon: pg.icon, subtitle: pg.is_template ? 'Plantilla' : 'Documento', url: `/docs/${id}`, project_id: pg.project_id };
    }
    case 'meeting': {
      const m = db.get('SELECT * FROM meetings WHERE id = ?', id);
      if (!m || m.deleted_at || (m.project_id && !canViewProject(user, m.project_id))) return null;
      return { type, id, title: m.title, subtitle: 'Reunión', starts_at: m.starts_at, url: `/meetings/${id}`, project_id: m.project_id };
    }
    case 'decision': {
      const d = db.get('SELECT * FROM decisions WHERE id = ?', id);
      if (!d || d.deleted_at || (d.project_id && !canViewProject(user, d.project_id))) return null;
      return { type, id, title: d.title, subtitle: 'Decisión', status: d.status, url: `/decisions/${id}`, project_id: d.project_id };
    }
    case 'file': {
      const f = db.get('SELECT * FROM files WHERE id = ?', id);
      if (!canViewFile(user, f)) return null;
      return { type, id, title: f.name, subtitle: 'Archivo', mime: f.mime, size: f.size, url: `/files?file=${id}`, project_id: f.project_id };
    }
    case 'goal': {
      const g = db.get('SELECT * FROM goals WHERE id = ?', id);
      if (!g || g.deleted_at) return null;
      return { type, id, title: g.title, subtitle: g.period ? `Objetivo · ${g.period}` : 'Objetivo', status: g.status, url: `/goals/${id}` };
    }
    case 'transaction': {
      const tx = db.get('SELECT * FROM fin_transactions WHERE id = ?', id);
      if (!tx) return null;
      if (!can(user, 'finance.view') && tx.created_by !== user.id && tx.member_id !== user.id) return null;
      return { type, id, title: tx.concept, subtitle: 'Movimiento financiero', amount_cents: tx.amount_cents, kind: tx.kind, url: `/finance/movements?tx=${id}` };
    }
    case 'message': {
      const m = db.get('SELECT m.*, c.kind, c.project_id, c.name AS channel_name FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = ?', id);
      if (!m || m.deleted_at || !canViewChannel(user, { id: m.channel_id, kind: m.kind, project_id: m.project_id })) return null;
      return { type, id, title: m.body.slice(0, 120), subtitle: m.kind === 'dm' ? 'Mensaje directo' : `#${m.channel_name}`, url: `/chat/${m.channel_id}?m=${id}` };
    }
    case 'channel': {
      const c = db.get('SELECT * FROM channels WHERE id = ?', id);
      if (!c || !canViewChannel(user, c)) return null;
      return { type, id, title: c.name, subtitle: 'Canal', url: `/chat/${id}` };
    }
    default:
      return null;
  }
}

/** Relaciones genéricas de una entidad (ambas direcciones), filtradas por permisos. */
export function relatedEntities(user, type, id) {
  const rows = db.all(
    `SELECT id AS link_id, b_type AS type, b_id AS eid FROM links WHERE a_type = ? AND a_id = ?
     UNION ALL SELECT id AS link_id, a_type AS type, a_id AS eid FROM links WHERE b_type = ? AND b_id = ?`,
    type,
    id,
    type,
    id,
  );
  const out = [];
  for (const r of rows) {
    const summary = entitySummary(user, r.type, r.eid);
    if (summary) out.push({ ...summary, link_id: r.link_id });
  }
  return out;
}

export function addLink(aType, aId, bType, bId, userId) {
  if (aType === bType && aId === bId) return;
  const exists = db.get(
    `SELECT id FROM links WHERE (a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?)
     OR (a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?)`,
    aType, aId, bType, bId, bType, bId, aType, aId,
  );
  if (exists) return exists.id;
  return db.insert('links', { a_type: aType, a_id: aId, b_type: bType, b_id: bId, created_by: userId, created_at: new Date().toISOString() });
}

export function removeLinksFor(type, id) {
  db.run('DELETE FROM links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)', type, id, type, id);
}

/** Archivos adjuntos (vinculados) a una entidad. */
export function attachmentsOf(user, type, id) {
  const rows = db.all(
    `SELECT f.*, u.name AS uploaded_by_name FROM links l JOIN files f ON f.id = l.b_id LEFT JOIN users u ON u.id = f.uploaded_by
     WHERE l.a_type = ? AND l.a_id = ? AND l.b_type = 'file' AND f.deleted_at IS NULL ORDER BY f.created_at`,
    type,
    id,
  );
  return rows.filter((f) => canViewFile(user, f)).map(fileView);
}

export function fileView(f) {
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    visibility: f.visibility,
    folder_id: f.folder_id,
    project_id: f.project_id,
    uploaded_by: f.uploaded_by,
    uploaded_by_name: f.uploaded_by_name,
    created_at: f.created_at,
  };
}
