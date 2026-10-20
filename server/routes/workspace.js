import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, now, transaction, getSetting, setSetting, backupTo } from '../lib/dbx.js';
import { handler, HttpError, bool, date, datetime, ids, int, notFound, oneOf, str, parseJson } from '../lib/http.js';
import { can, canViewPage, canViewProject, projectVisibilitySql, requirePermission, taskVisibilitySql, canViewFile } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { findMentions, notify } from '../lib/notify.js';
import { searchIndex, indexEntity } from '../lib/search.js';
import { addLink, entitySummary, ENTITY_TYPES } from '../lib/entities.js';
import { usersById } from '../lib/users.js';
import { createTask, decorateTasks, reindexTask } from '../lib/tasks.js';
import { ACTIONS, TRIGGERS } from '../lib/automations.js';
import { obligationsWithStatus } from '../lib/finance.js';
import { recentActivity } from './dashboard.js';
import { workspaceInfo } from '../lib/workspace.js';
import { runBackup } from '../lib/scheduler.js';

const router = Router();

// ───────── Búsqueda global ─────────
const TYPE_ORDER = ['task', 'project', 'page', 'meeting', 'decision', 'goal', 'file', 'message'];

router.get(
  '/search',
  handler((req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ query: q, groups: [], members: [] });
    const hits = searchIndex(q, 300);
    const groups = new Map();
    for (const h of hits) {
      if (h.entity_type === 'message' && !TYPE_ORDER.includes('message')) continue;
      const list = groups.get(h.entity_type) || [];
      if (list.length >= 8) continue;
      const summary = entitySummary(req.user, h.entity_type, h.entity_id);
      if (!summary) continue;
      list.push({ ...summary, snippet: h.snippet && h.snippet.includes('[[') ? h.snippet : null });
      groups.set(h.entity_type, list);
    }
    const members = db
      .all("SELECT id, name, email, title, avatar_color, avatar_file_id FROM users WHERE status = 'active' AND (name LIKE ? OR email LIKE ?) LIMIT 5", `%${q}%`, `%${q}%`)
      .map((m) => ({ ...m, type: 'member', url: `/members/${m.id}`, title: m.name, subtitle: m.title || m.email }));
    res.json({
      query: q,
      groups: TYPE_ORDER.filter((t) => groups.has(t)).map((t) => ({ type: t, items: groups.get(t) })),
      members,
    });
  }),
);

// ───────── Notificaciones ─────────
router.get(
  '/notifications',
  handler((req, res) => {
    const unread = bool(req.query.unread);
    const rows = db.all(
      `SELECT * FROM notifications WHERE user_id = ? ${unread ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 200`,
      req.user.id,
    );
    const users = usersById(rows.map((r) => r.actor_id));
    const unreadCount = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n;
    res.json({ items: rows.map((r) => ({ ...r, actor: users.get(r.actor_id) || null })), unread: unreadCount });
  }),
);

router.post(
  '/notifications/read',
  handler((req, res) => {
    if (req.body.all) db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), req.user.id);
    else {
      for (const id of ids(req.body.ids, 'Notificaciones') || []) {
        db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', now(), id, req.user.id);
      }
    }
    emit(['notifications'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

// ───────── Comentarios ─────────
const COMMENTABLE = ['task', 'project', 'page', 'meeting', 'decision', 'transaction', 'goal'];

function checkEntity(user, type, id) {
  if (!COMMENTABLE.includes(type)) throw new HttpError(400, 'Tipo de elemento no válido.');
  const summary = entitySummary(user, type, id);
  if (!summary) throw notFound('El elemento');
  return summary;
}

router.get(
  '/comments',
  handler((req, res) => {
    const type = String(req.query.entity_type);
    const id = Number(req.query.entity_id);
    checkEntity(req.user, type, id);
    const rows = db.all(
      'SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY id',
      type,
      id,
    );
    const users = usersById(rows.map((r) => r.user_id));
    res.json(rows.map((r) => ({ ...r, user: users.get(r.user_id) || null })));
  }),
);

router.post(
  '/comments',
  handler((req, res) => {
    const type = String(req.body.entity_type);
    const id = int(req.body.entity_id, { field: 'Elemento', min: 1, nullable: false });
    const summary = checkEntity(req.user, type, id);
    const body = str(req.body.body, { field: 'El comentario', required: true, max: 10000 });
    const cid = db.insert('comments', { entity_type: type, entity_id: id, user_id: req.user.id, body, created_at: now() });
    const where = `«${summary.title}»`;
    const mentioned = findMentions(body).filter((uid) => entitySummary({ ...req.user, id: uid, permissions: permsOf(uid) }, type, id));
    notify({ userIds: mentioned, type: 'mention', title: `${req.user.name} te mencionó en ${where}`, body: body.slice(0, 160), link: summary.url, actorId: req.user.id, entityType: type, entityId: id });
    let followers = [];
    if (type === 'task') {
      db.run('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)', id, req.user.id);
      followers = db.all('SELECT user_id FROM task_watchers WHERE task_id = ?', id).map((r) => r.user_id);
    } else if (type === 'page') followers = [db.get('SELECT created_by FROM pages WHERE id = ?', id)?.created_by];
    else if (type === 'project') followers = [db.get('SELECT owner_id FROM projects WHERE id = ?', id)?.owner_id];
    else if (type === 'decision') {
      followers = [db.get('SELECT proposed_by FROM decisions WHERE id = ?', id)?.proposed_by, ...db.all('SELECT user_id FROM decision_approvers WHERE decision_id = ?', id).map((r) => r.user_id)];
    } else if (type === 'transaction') followers = [db.get('SELECT created_by FROM fin_transactions WHERE id = ?', id)?.created_by];
    else if (type === 'meeting') followers = db.all('SELECT user_id FROM meeting_participants WHERE meeting_id = ?', id).map((r) => r.user_id);
    notify({
      userIds: followers.filter((u) => u && !mentioned.includes(u)),
      type: 'comment',
      title: `${req.user.name} comentó en ${where}`,
      body: body.slice(0, 160),
      link: summary.url,
      actorId: req.user.id,
      entityType: type,
      entityId: id,
    });
    if (type !== 'transaction') {
      logActivity({ actor: req.user, entityType: type, entityId: id, projectId: summary.project_id ?? null, action: 'commented', summary: `comentó en ${where}` });
    }
    emit(['comments', type === 'task' ? 'tasks' : type + 's'], { data: { entityType: type, entityId: id } });
    res.status(201).json({ id: cid });
  }),
);

function permsOf(userId) {
  const row = db.get('SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', userId);
  return row ? JSON.parse(row.permissions) : [];
}

router.patch(
  '/comments/:id',
  handler((req, res) => {
    const c = db.get('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!c) throw notFound('El comentario');
    if (c.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes editar tus comentarios.');
    db.update('comments', c.id, { body: str(req.body.body, { field: 'El comentario', required: true, max: 10000 }), edited_at: now() });
    emit(['comments']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/comments/:id',
  handler((req, res) => {
    const c = db.get('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!c) throw notFound('El comentario');
    if (c.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes eliminar tus comentarios.');
    db.update('comments', c.id, { deleted_at: now() });
    emit(['comments']);
    res.json({ ok: true });
  }),
);

// ───────── Relaciones entre elementos ─────────
router.post(
  '/links',
  handler((req, res) => {
    const aType = oneOf(req.body.a_type, ENTITY_TYPES, 'Elemento');
    const bType = oneOf(req.body.b_type, ENTITY_TYPES, 'Elemento');
    const aId = int(req.body.a_id, { field: 'Elemento', min: 1, nullable: false });
    const bId = int(req.body.b_id, { field: 'Elemento', min: 1, nullable: false });
    const a = entitySummary(req.user, aType, aId);
    const b = entitySummary(req.user, bType, bId);
    if (!a || !b) throw notFound('El elemento');
    const id = addLink(aType, aId, bType, bId, req.user.id);
    logActivity({ actor: req.user, entityType: aType, entityId: aId, projectId: a.project_id ?? null, action: 'linked', summary: `vinculó «${a.title}» con «${b.title}»` });
    emit(['tasks', 'pages', 'projects', 'meetings', 'decisions', 'files', 'links']);
    res.status(201).json({ id });
  }),
);

router.delete(
  '/links/:id',
  handler((req, res) => {
    const l = db.get('SELECT * FROM links WHERE id = ?', req.params.id);
    if (!l) throw notFound('El vínculo');
    if (!entitySummary(req.user, l.a_type, l.a_id) || !entitySummary(req.user, l.b_type, l.b_id)) throw notFound('El vínculo');
    db.run('DELETE FROM links WHERE id = ?', l.id);
    emit(['tasks', 'pages', 'projects', 'meetings', 'decisions', 'files', 'links']);
    res.json({ ok: true });
  }),
);

/** Busca elementos para vincular (selector rápido). */
router.get(
  '/entities/search',
  handler((req, res) => {
    const q = String(req.query.q || '').trim();
    const types = String(req.query.types || 'task,project,page,meeting,decision,goal').split(',');
    let items = [];
    if (q.length >= 1) {
      items = searchIndex(q, 120)
        .filter((h) => types.includes(h.entity_type))
        .map((h) => entitySummary(req.user, h.entity_type, h.entity_id))
        .filter(Boolean);
    } else {
      // Sin texto: elementos recientes.
      const recent = [];
      if (types.includes('page')) recent.push(...db.all('SELECT id FROM pages WHERE deleted_at IS NULL AND is_template = 0 ORDER BY updated_at DESC LIMIT 6').map((r) => ['page', r.id]));
      if (types.includes('task')) recent.push(...db.all('SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6').map((r) => ['task', r.id]));
      if (types.includes('project')) recent.push(...db.all('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 4').map((r) => ['project', r.id]));
      items = recent.map(([t, id]) => entitySummary(req.user, t, id)).filter(Boolean);
    }
    res.json(items.slice(0, 20));
  }),
);

// ───────── Favoritos ─────────
router.get(
  '/favorites',
  handler((req, res) => {
    const rows = db.all('SELECT * FROM favorites WHERE user_id = ? ORDER BY position, created_at', req.user.id);
    const items = rows
      .map((f) => {
        if (f.entity_type === 'view') {
          const v = db.get('SELECT * FROM saved_views WHERE id = ? AND (user_id = ? OR shared = 1)', f.entity_id, req.user.id);
          return v ? { type: 'view', id: v.id, title: v.name, url: `/tasks?view=${v.id}` } : null;
        }
        return entitySummary(req.user, f.entity_type, f.entity_id);
      })
      .filter(Boolean);
    res.json(items);
  }),
);

router.post(
  '/favorites',
  handler((req, res) => {
    const type = oneOf(req.body.entity_type, [...ENTITY_TYPES, 'view'], 'Elemento');
    const id = int(req.body.entity_id, { field: 'Elemento', min: 1, nullable: false });
    const existing = db.get('SELECT 1 FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?', req.user.id, type, id);
    const want = req.body.favorite === undefined ? !existing : bool(req.body.favorite);
    if (want && !existing) {
      if (type !== 'view' && !entitySummary(req.user, type, id)) throw notFound('El elemento');
      const max = db.get('SELECT MAX(position) AS m FROM favorites WHERE user_id = ?', req.user.id).m || 0;
      db.insert('favorites', { user_id: req.user.id, entity_type: type, entity_id: id, position: max + 1, created_at: now() });
    } else if (!want && existing) {
      db.run('DELETE FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?', req.user.id, type, id);
    }
    emit(['favorites'], { userIds: [req.user.id] });
    res.json({ favorite: want });
  }),
);

// ───────── Vistas guardadas ─────────
router.get(
  '/views',
  handler((req, res) => {
    const rows = db.all('SELECT v.*, u.name AS owner_name FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.user_id = ? OR v.shared = 1 ORDER BY v.created_at', req.user.id);
    res.json(rows.map((r) => ({ ...r, config: parseJson(r.config, {}), mine: r.user_id === req.user.id })));
  }),
);

router.post(
  '/views',
  handler((req, res) => {
    const cfg = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
    if (JSON.stringify(cfg).length > 5000) throw new HttpError(400, 'La vista es demasiado grande.');
    const id = db.insert('saved_views', {
      user_id: req.user.id,
      name: str(req.body.name, { field: 'El nombre', required: true, max: 60 }),
      config: cfg,
      shared: bool(req.body.shared) ? 1 : 0,
      created_at: now(),
    });
    emit(['views']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/views/:id',
  handler((req, res) => {
    const v = db.get('SELECT * FROM saved_views WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!v) throw notFound('La vista');
    db.update('saved_views', v.id, {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 60 }) : undefined,
      config: req.body.config && typeof req.body.config === 'object' ? req.body.config : undefined,
      shared: req.body.shared !== undefined ? (bool(req.body.shared) ? 1 : 0) : undefined,
    });
    emit(['views']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/views/:id',
  handler((req, res) => {
    db.run('DELETE FROM saved_views WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    db.run("DELETE FROM favorites WHERE entity_type = 'view' AND entity_id = ?", req.params.id);
    emit(['views', 'favorites']);
    res.json({ ok: true });
  }),
);

// ───────── Bandeja de entrada (captura rápida) ─────────
router.get(
  '/inbox',
  handler((req, res) => {
    const done = bool(req.query.processed);
    res.json(
      db.all(
        `SELECT * FROM inbox_items WHERE user_id = ? AND processed_at IS ${done ? 'NOT NULL' : 'NULL'} ORDER BY id DESC LIMIT 200`,
        req.user.id,
      ),
    );
  }),
);

router.post(
  '/inbox',
  handler((req, res) => {
    const id = db.insert('inbox_items', {
      user_id: req.user.id,
      title: str(req.body.title, { field: 'El texto', required: true, max: 500 }),
      notes: str(req.body.notes, { field: 'Las notas', max: 5000, trim: false }) || '',
      created_at: now(),
    });
    emit(['inbox'], { userIds: [req.user.id] });
    res.status(201).json({ id });
  }),
);

router.patch(
  '/inbox/:id',
  handler((req, res) => {
    const item = db.get('SELECT * FROM inbox_items WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!item) throw notFound('El elemento');
    db.update('inbox_items', item.id, {
      title: req.body.title !== undefined ? str(req.body.title, { field: 'El texto', required: true, max: 500 }) : undefined,
      notes: str(req.body.notes, { field: 'Las notas', max: 5000, trim: false }),
      processed_at: req.body.processed === undefined ? undefined : req.body.processed ? now() : null,
      result_type: req.body.processed === false ? null : undefined,
    });
    emit(['inbox'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

router.delete(
  '/inbox/:id',
  handler((req, res) => {
    db.run('DELETE FROM inbox_items WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    emit(['inbox'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

/** Convierte una captura en tarea, nota o recordatorio. */
router.post(
  '/inbox/:id/convert',
  handler((req, res) => {
    const item = db.get('SELECT * FROM inbox_items WHERE id = ? AND user_id = ? AND processed_at IS NULL', req.params.id, req.user.id);
    if (!item) throw notFound('El elemento');
    const to = oneOf(req.body.to, ['task', 'page', 'reminder'], 'Destino');
    let resultId;
    let url;
    transaction(() => {
      if (to === 'task') {
        resultId = createTask(req.user, { title: req.body.title || item.title, description: item.notes, project_id: req.body.project_id, assignee_ids: req.body.assignee_ids, due_date: req.body.due_date, priority: req.body.priority });
        url = `/tasks/${resultId}`;
      } else if (to === 'page') {
        requirePermission(req.user, 'docs.edit');
        const ts = now();
        const content = item.notes ? JSON.stringify(item.notes.split('\n').map((line) => ({ type: 'paragraph', content: line }))) : '[]';
        resultId = db.insert('pages', { title: item.title, content, content_text: item.notes, project_id: int(req.body.project_id, { min: 1 }) ?? null, created_by: req.user.id, updated_by: req.user.id, created_at: ts, updated_at: ts, position: Date.now() });
        indexEntity('page', resultId, item.title, item.notes);
        url = `/docs/${resultId}`;
      } else {
        const at = datetime(req.body.remind_at, 'La fecha del recordatorio');
        if (!at) throw new HttpError(400, 'Indica cuándo recordártelo.');
        resultId = db.insert('reminders', { user_id: req.user.id, title: item.title, remind_at: at, created_at: now() });
        url = '/inbox';
      }
      db.update('inbox_items', item.id, { processed_at: now(), result_type: to, result_id: resultId });
    });
    emit(['inbox', 'pages', 'reminders', 'dashboard'], { userIds: [req.user.id] });
    res.json({ type: to, id: resultId, url });
  }),
);

// ───────── Recordatorios personales ─────────
router.get(
  '/reminders',
  handler((req, res) => {
    res.json(db.all('SELECT * FROM reminders WHERE user_id = ? AND (done_at IS NULL OR done_at > ?) ORDER BY remind_at', req.user.id, new Date(Date.now() - 7 * 864e5).toISOString()));
  }),
);

router.post(
  '/reminders',
  handler((req, res) => {
    const at = datetime(req.body.remind_at, 'La fecha del recordatorio');
    if (!at) throw new HttpError(400, 'Indica cuándo recordártelo.');
    const type = req.body.entity_type ? oneOf(req.body.entity_type, ENTITY_TYPES, 'Elemento') : null;
    const eid = int(req.body.entity_id, { min: 1 }) ?? null;
    if (type && !entitySummary(req.user, type, eid)) throw notFound('El elemento');
    const id = db.insert('reminders', { user_id: req.user.id, title: str(req.body.title, { field: 'El recordatorio', required: true, max: 300 }), remind_at: at, entity_type: type, entity_id: eid, created_at: now() });
    emit(['reminders', 'dashboard'], { userIds: [req.user.id] });
    res.status(201).json({ id });
  }),
);

router.patch(
  '/reminders/:id',
  handler((req, res) => {
    const r = db.get('SELECT * FROM reminders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!r) throw notFound('El recordatorio');
    const at = datetime(req.body.remind_at, 'La fecha');
    db.update('reminders', r.id, {
      title: req.body.title !== undefined ? str(req.body.title, { field: 'El recordatorio', required: true, max: 300 }) : undefined,
      remind_at: at,
      notified_at: at ? null : undefined,
      done_at: req.body.done === undefined ? undefined : req.body.done ? now() : null,
    });
    emit(['reminders', 'dashboard'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

router.delete(
  '/reminders/:id',
  handler((req, res) => {
    db.run('DELETE FROM reminders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    emit(['reminders', 'dashboard'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

// ───────── Etiquetas ─────────
const TAG_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'];
router.get('/tags', handler((req, res) => res.json(db.all('SELECT * FROM tags ORDER BY name COLLATE NOCASE'))));
router.post(
  '/tags',
  handler((req, res) => {
    const name = str(req.body.name, { field: 'La etiqueta', required: true, max: 40 });
    const existing = db.get('SELECT * FROM tags WHERE name = ?', name);
    if (existing) return res.json(existing);
    const id = db.insert('tags', { name, color: oneOf(req.body.color, TAG_COLORS, 'Color') || TAG_COLORS[(db.get('SELECT COUNT(*) AS n FROM tags').n + 4) % TAG_COLORS.length] });
    emit(['tags']);
    res.status(201).json(db.get('SELECT * FROM tags WHERE id = ?', id));
  }),
);
router.patch(
  '/tags/:id',
  handler((req, res) => {
    db.update('tags', Number(req.params.id), {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'La etiqueta', required: true, max: 40 }) : undefined,
      color: oneOf(req.body.color, TAG_COLORS, 'Color'),
    });
    emit(['tags', 'tasks', 'projects']);
    res.json({ ok: true });
  }),
);
router.delete(
  '/tags/:id',
  handler((req, res) => {
    db.run('DELETE FROM tags WHERE id = ?', req.params.id);
    emit(['tags', 'tasks', 'projects']);
    res.json({ ok: true });
  }),
);

// ───────── Plantillas de proyecto ─────────
router.get(
  '/templates',
  handler((req, res) => {
    const rows = db.all("SELECT t.*, u.name AS created_by_name FROM templates t LEFT JOIN users u ON u.id = t.created_by WHERE t.kind = 'project' ORDER BY t.is_builtin DESC, t.name");
    res.json(rows.map((r) => {
      const s = parseJson(r.structure, {});
      return { ...r, structure: undefined, task_count: (s.tasks || []).length, columns: (s.columns || []).map((c) => c.name), tasks_preview: (s.tasks || []).slice(0, 6).map((t) => t.title) };
    }));
  }),
);
router.delete(
  '/templates/:id',
  handler((req, res) => {
    const t = db.get('SELECT * FROM templates WHERE id = ?', req.params.id);
    if (!t) throw notFound('La plantilla');
    if (t.created_by !== req.user.id && !can(req.user, 'settings.manage')) throw new HttpError(403, 'Solo quien creó la plantilla puede eliminarla.');
    db.run('DELETE FROM templates WHERE id = ?', t.id);
    emit(['templates']);
    res.json({ ok: true });
  }),
);

// ───────── Actividad ─────────
router.get(
  '/activity',
  handler((req, res) => {
    const where = ['1=1'];
    const params = [];
    if (req.query.entity_type) {
      where.push('entity_type = ?');
      params.push(String(req.query.entity_type));
    }
    if (req.query.entity_id) {
      where.push('entity_id = ?');
      params.push(Number(req.query.entity_id));
    }
    if (req.query.project_id) {
      where.push('project_id = ?');
      params.push(Number(req.query.project_id));
    }
    if (req.query.actor_id) {
      where.push('actor_id = ?');
      params.push(Number(req.query.actor_id));
    }
    if (req.query.before) {
      where.push('id < ?');
      params.push(Number(req.query.before));
    }
    res.json(recentActivity(req.user, Math.min(Number(req.query.limit) || 50, 200), where.join(' AND '), params));
  }),
);

// ───────── Papelera ─────────
router.get(
  '/trash',
  handler((req, res) => {
    const manage = can(req.user, 'projects.manage');
    const mineOr = (col) => (manage ? '1=1' : `${col} = ${Number(req.user.id)}`);
    const items = [
      ...db.all(`SELECT 'project' AS type, id, name AS title, deleted_at FROM projects p WHERE deleted_at IS NOT NULL AND (${mineOr('owner_id')} OR ${mineOr('created_by')})`),
      ...db.all(`SELECT 'task' AS type, t.id, t.title, t.deleted_at FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.deleted_at IS NOT NULL AND t.parent_id IS NULL AND (p.id IS NULL OR p.deleted_at IS NULL) AND (${mineOr('t.created_by')} OR p.owner_id = ${Number(req.user.id)})`),
      ...db.all(`SELECT 'page' AS type, pg.id, pg.title, pg.deleted_at FROM pages pg WHERE pg.deleted_at IS NOT NULL AND (pg.parent_id IS NULL OR pg.parent_id NOT IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL)) AND (${mineOr('pg.created_by')} OR (pg.visibility = 'workspace' AND ${can(req.user, 'docs.edit') ? 1 : 0}))`),
      ...db.all(`SELECT 'file' AS type, id, name AS title, deleted_at FROM files WHERE deleted_at IS NOT NULL AND ${mineOr('uploaded_by')}`),
      ...db.all(`SELECT 'meeting' AS type, id, title, deleted_at FROM meetings WHERE deleted_at IS NOT NULL AND ${mineOr('created_by')}`),
    ];
    items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
    res.json({ items, can_purge: can(req.user, 'settings.manage') });
  }),
);

const TRASH_TABLES = { project: 'projects', task: 'tasks', page: 'pages', file: 'files', meeting: 'meetings' };

router.post(
  '/trash/restore',
  handler((req, res) => {
    const type = oneOf(req.body.type, Object.keys(TRASH_TABLES), 'Tipo');
    const id = int(req.body.id, { min: 1, nullable: false });
    const table = TRASH_TABLES[type];
    const row = db.get(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, id);
    if (!row) throw notFound('El elemento');
    const manage = can(req.user, 'projects.manage');
    const owner = row.created_by ?? row.uploaded_by ?? row.owner_id;
    if (!manage && owner !== req.user.id && !(type === 'page' && can(req.user, 'docs.edit') && row.visibility === 'workspace')) {
      throw new HttpError(403, 'No puedes restaurar este elemento.');
    }
    transaction(() => {
      if (type === 'page') {
        // Restaura la página y las subpáginas eliminadas al mismo tiempo.
        const stamp = row.deleted_at;
        const all = [id];
        for (let i = 0; i < all.length; i++) {
          for (const c of db.all('SELECT id FROM pages WHERE parent_id = ? AND deleted_at = ?', all[i], stamp)) all.push(c.id);
        }
        for (const pid of all) {
          db.run('UPDATE pages SET deleted_at = NULL WHERE id = ?', pid);
          const p = db.get('SELECT title, content_text FROM pages WHERE id = ?', pid);
          indexEntity('page', pid, p.title, p.content_text);
        }
        const parent = row.parent_id ? db.get('SELECT deleted_at FROM pages WHERE id = ?', row.parent_id) : null;
        if (parent?.deleted_at) db.run('UPDATE pages SET parent_id = NULL WHERE id = ?', id);
      } else if (type === 'task') {
        db.run('UPDATE tasks SET deleted_at = NULL WHERE (id = ? OR parent_id = ?) AND deleted_at = ?', id, id, row.deleted_at);
        reindexTask(id);
      } else {
        db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, id);
        if (type === 'project') indexEntity('project', id, row.name, [row.description, row.objective].join('\n'));
        if (type === 'file') indexEntity('file', id, row.name, '');
        if (type === 'meeting') indexEntity('meeting', id, row.title, [row.objective, row.agenda, row.notes].join('\n'));
      }
    });
    logActivity({ actor: req.user, entityType: type, entityId: id, projectId: type === 'project' ? id : row.project_id ?? null, action: 'restored', summary: `restauró «${row.title ?? row.name}» de la papelera` });
    emit(['trash', 'projects', 'tasks', 'pages', 'files', 'meetings', 'dashboard', 'chat']);
    res.json({ ok: true });
  }),
);

/** Eliminación definitiva (solo administración). Los archivos se borran del disco. */
router.post(
  '/trash/purge',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const type = oneOf(req.body.type, Object.keys(TRASH_TABLES), 'Tipo');
    const id = int(req.body.id, { min: 1, nullable: false });
    const table = TRASH_TABLES[type];
    const row = db.get(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, id);
    if (!row) throw notFound('El elemento');
    transaction(() => {
      if (type === 'file') {
        fs.rmSync(path.join(config.uploadsDir, path.basename(row.stored_name)), { force: true });
        db.run("DELETE FROM links WHERE b_type = 'file' AND b_id = ?", id);
        db.run('UPDATE users SET avatar_file_id = NULL WHERE avatar_file_id = ?', id);
      }
      if (type === 'project') {
        if (db.get('SELECT 1 FROM fin_transactions WHERE project_id = ?', id)) {
          // Los movimientos financieros se conservan; solo pierden la referencia.
          db.run('UPDATE fin_transactions SET project_id = NULL WHERE project_id = ?', id);
        }
        db.run('UPDATE fin_obligations SET project_id = NULL WHERE project_id = ?', id);
        db.run('UPDATE fin_budgets SET project_id = NULL WHERE project_id = ?', id);
      }
      if (type === 'task') db.run('UPDATE checklist_items SET done_by = NULL WHERE task_id = ?', id);
      db.run(`DELETE FROM ${table} WHERE id = ?`, id);
      db.run('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', type, id);
    });
    logActivity({ actor: req.user, entityType: type, entityId: null, action: 'purged', summary: `eliminó definitivamente «${row.title ?? row.name}»` });
    emit(['trash']);
    res.json({ ok: true });
  }),
);

// ───────── Configuración del espacio ─────────
router.get(
  '/settings',
  handler((req, res) => {
    res.json({
      ...workspaceInfo(),
      approval_threshold_cents: getSetting('approval_threshold_cents', null),
      payment_methods: getSetting('payment_methods', []),
      contribution_types: getSetting('contribution_types', []),
      mail_configured: Boolean(config.smtp),
      public_url: config.publicUrl || null,
      max_file_mb: config.maxFileMb,
      storage_quota_mb: config.storageQuotaMb,
    });
  }),
);

router.patch(
  '/settings',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const b = req.body;
    const changes = [];
    if (b.name !== undefined) { setSetting('workspace_name', str(b.name, { field: 'El nombre', required: true, max: 80 })); changes.push('el nombre'); }
    if (b.currency !== undefined) {
      const c = str(b.currency, { field: 'La moneda', required: true, max: 3 }).toUpperCase();
      try { new Intl.NumberFormat('es', { style: 'currency', currency: c }); } catch { throw new HttpError(400, 'La moneda no es válida (usa un código como MXN o USD).'); }
      setSetting('currency', c);
      changes.push('la moneda');
    }
    if (b.timezone !== undefined) {
      try { new Intl.DateTimeFormat('es', { timeZone: b.timezone }); } catch { throw new HttpError(400, 'La zona horaria no es válida.'); }
      setSetting('timezone', b.timezone);
      changes.push('la zona horaria');
    }
    if (b.approval_threshold_cents !== undefined) {
      const v = b.approval_threshold_cents === null || b.approval_threshold_cents === '' ? null : Number(b.approval_threshold_cents);
      if (v !== null && (!Number.isSafeInteger(v) || v <= 0)) throw new HttpError(400, 'El umbral no es válido.');
      setSetting('approval_threshold_cents', v);
      changes.push('el umbral de aprobación');
    }
    for (const key of ['payment_methods', 'contribution_types']) {
      if (b[key] !== undefined) {
        if (!Array.isArray(b[key])) throw new HttpError(400, 'Lista inválida.');
        setSetting(key, [...new Set(b[key].map((s) => str(s, { max: 60 })).filter(Boolean))].slice(0, 30));
        changes.push(key === 'payment_methods' ? 'los métodos de pago' : 'los tipos de aportación');
      }
    }
    if (b.onboarding_dismissed !== undefined) setSetting('onboarding_dismissed', bool(b.onboarding_dismissed));
    if (changes.length) logActivity({ actor: req.user, entityType: 'workspace', action: 'settings', summary: `cambió ${changes.join(', ')} del espacio` });
    emit(['settings', 'me', 'finance', 'dashboard']);
    res.json({ ok: true });
  }),
);

// ───────── Automatizaciones ─────────
router.get(
  '/automations',
  handler((req, res) => {
    const rows = db.all('SELECT * FROM automations ORDER BY is_builtin DESC, id');
    res.json({
      rules: rows.map((r) => ({ ...r, conditions: parseJson(r.conditions, {}), action_config: parseJson(r.action_config, {}) })),
      triggers: TRIGGERS,
      actions: ACTIONS,
      can_manage: can(req.user, 'settings.manage'),
    });
  }),
);

function readRule(b) {
  const trigger = oneOf(b.trigger, Object.keys(TRIGGERS), 'Disparador');
  const action = oneOf(b.action, Object.keys(ACTIONS), 'Acción');
  const conditions = typeof b.conditions === 'object' && b.conditions ? b.conditions : {};
  const cfg = typeof b.action_config === 'object' && b.action_config ? b.action_config : {};
  if (cfg.targets && !Array.isArray(cfg.targets)) throw new HttpError(400, 'Destinatarios inválidos.');
  if (JSON.stringify(conditions).length + JSON.stringify(cfg).length > 2000) throw new HttpError(400, 'Regla demasiado grande.');
  return { trigger, action, conditions, action_config: cfg };
}

router.post(
  '/automations',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const r = readRule(req.body);
    if (!r.trigger || !r.action) throw new HttpError(400, 'Elige un disparador y una acción.');
    if (!['task.status_changed', 'task.created'].includes(r.trigger)) throw new HttpError(400, 'Por ahora las reglas personalizadas se basan en cambios de tareas.');
    const id = db.insert('automations', { name: str(req.body.name, { field: 'El nombre', required: true, max: 120 }), ...r, enabled: 1, created_by: req.user.id, created_at: now() });
    logActivity({ actor: req.user, entityType: 'automation', entityId: id, action: 'created', summary: `creó la automatización «${req.body.name}»` });
    emit(['automations']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/automations/:id',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const rule = db.get('SELECT * FROM automations WHERE id = ?', req.params.id);
    if (!rule) throw notFound('La automatización');
    const r = rule.is_builtin ? {} : readRule(req.body);
    db.update('automations', rule.id, {
      name: req.body.name !== undefined && !rule.is_builtin ? str(req.body.name, { field: 'El nombre', required: true, max: 120 }) : undefined,
      enabled: req.body.enabled !== undefined ? (bool(req.body.enabled) ? 1 : 0) : undefined,
      trigger: r.trigger,
      action: r.action,
      // En las reglas incluidas solo se puede ajustar la anticipación (días/minutos).
      conditions:
        req.body.conditions === undefined
          ? undefined
          : rule.is_builtin
            ? { ...parseJson(rule.conditions, {}), ...pickNumbers(req.body.conditions || {}) }
            : r.conditions,
      action_config: req.body.action_config !== undefined && !rule.is_builtin ? r.action_config : undefined,
    });
    if (req.body.enabled !== undefined) {
      logActivity({ actor: req.user, entityType: 'automation', entityId: rule.id, action: 'toggled', summary: `${bool(req.body.enabled) ? 'activó' : 'desactivó'} la automatización «${rule.name}»` });
    }
    emit(['automations']);
    res.json({ ok: true });
  }),
);

function pickNumbers(c) {
  const out = {};
  for (const k of ['days_before', 'minutes_before']) if (c[k] !== undefined) out[k] = Math.max(0, Math.min(10080, Number(c[k]) || 0));
  return out;
}

router.delete(
  '/automations/:id',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const rule = db.get('SELECT * FROM automations WHERE id = ?', req.params.id);
    if (!rule) throw notFound('La automatización');
    if (rule.is_builtin) throw new HttpError(400, 'Las automatizaciones incluidas se pueden desactivar, pero no eliminar.');
    db.run('DELETE FROM automations WHERE id = ?', rule.id);
    emit(['automations']);
    res.json({ ok: true });
  }),
);

// ───────── Respaldos ─────────
router.get(
  '/backups',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    fs.mkdirSync(config.backupsDir, { recursive: true });
    const files = fs
      .readdirSync(config.backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ name: f, size: fs.statSync(path.join(config.backupsDir, f)).size, created_at: fs.statSync(path.join(config.backupsDir, f)).mtime.toISOString() }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json(files);
  }),
);

router.post(
  '/backups',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const name = runBackup('manual');
    logActivity({ actor: req.user, entityType: 'workspace', action: 'backup', summary: 'creó un respaldo de la base de datos' });
    res.status(201).json({ name });
  }),
);

router.get(
  '/backups/:name',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const name = path.basename(String(req.params.name));
    const file = path.join(config.backupsDir, name);
    if (!name.endsWith('.db') || !fs.existsSync(file)) throw notFound('El respaldo');
    logActivity({ actor: req.user, entityType: 'workspace', action: 'backup_download', summary: 'descargó un respaldo de la base de datos' });
    res.download(file, name);
  }),
);

// ───────── Calendario ─────────
router.get(
  '/calendar',
  handler((req, res) => {
    const from = date(req.query.from, 'Desde');
    const to = date(req.query.to, 'Hasta');
    if (!from || !to) throw new HttpError(400, 'Indica el rango de fechas.');
    const u = req.user;
    const projectFilter = req.query.project_id ? 'AND t.project_id = ?' : '';
    const pParams = req.query.project_id ? [Number(req.query.project_id)] : [];
    const assigneeFilter = req.query.mine ? `AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ${Number(u.id)})` : '';
    const tasks = decorateTasks(
      db.all(
        `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NULL) AND ${taskVisibilitySql(u, 't')}
         AND ((t.due_date BETWEEN ? AND ?) OR (t.start_date BETWEEN ? AND ?) OR (t.start_date < ? AND t.due_date > ?)) ${projectFilter} ${assigneeFilter}`,
        from, to, from, to, from, to, ...pParams,
      ),
    );
    const meetings = db
      .all(
        `SELECT m.*, (SELECT GROUP_CONCAT(user_id) FROM meeting_participants mp WHERE mp.meeting_id = m.id) AS participants
         FROM meetings m WHERE m.deleted_at IS NULL AND m.status <> 'cancelled' AND substr(m.starts_at, 1, 10) BETWEEN ? AND ? ${req.query.project_id ? 'AND m.project_id = ?' : ''}`,
        addDaysIso(from, -1), addDaysIso(to, 1), ...pParams,
      )
      .filter((m) => !m.project_id || canViewProject(u, m.project_id))
      .map((m) => ({ ...m, participant_ids: m.participants ? m.participants.split(',').map(Number) : [] }));
    let obligations = [];
    if (can(u, 'finance.view') || can(u, 'finance.record')) {
      const scope = can(u, 'finance.view') ? '1=1' : `(o.created_by = ${Number(u.id)} OR o.member_id = ${Number(u.id)})`;
      obligations = obligationsWithStatus(`${scope} AND o.cancelled_at IS NULL AND o.due_date BETWEEN ? AND ?`, [from, to]).filter((o) => o.status !== 'paid');
    }
    const projects = db.all(
      `SELECT p.id, p.name, p.color, p.icon, p.due_date, p.start_date FROM projects p WHERE p.deleted_at IS NULL AND p.due_date BETWEEN ? AND ? AND ${projectVisibilitySql(u, 'p')}`,
      from, to,
    );
    const reminders = db.all('SELECT * FROM reminders WHERE user_id = ? AND done_at IS NULL AND substr(remind_at, 1, 10) BETWEEN ? AND ?', u.id, from, to);
    res.json({ tasks, meetings, obligations, projects, reminders });
  }),
);

function addDaysIso(d, n) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export default router;
