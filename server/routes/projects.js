import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, date, ids, int, notFound, oneOf, str, parseJson } from '../lib/http.js';
import { can, canEditProject, canViewProject, projectVisibilitySql, requirePermission } from '../lib/permissions.js';
import { logActivity, diff } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { notify } from '../lib/notify.js';
import { indexEntity, unindexEntity } from '../lib/search.js';
import { ensureProjectChannel } from '../lib/chat.js';
import { createTask, columnsOf, PRIORITIES } from '../lib/tasks.js';
import { DEFAULT_COLUMNS } from '../db/seed.js';
import { addDays, today } from '../lib/workspace.js';
import { attachmentsOf, relatedEntities } from '../lib/entities.js';

const router = Router();
const STATUSES = ['planning', 'active', 'paused', 'completed', 'archived'];
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'];
const CATEGORIES = ['idea', 'todo', 'in_progress', 'review', 'blocked', 'done'];

export function projectStats(projectIds) {
  if (!projectIds.length) return new Map();
  const rows = db.all(
    `SELECT project_id,
       COUNT(*) AS total,
       SUM(status = 'done') AS done,
       SUM(status = 'blocked') AS blocked,
       SUM(status <> 'done' AND due_date IS NOT NULL AND due_date < ?) AS overdue
     FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND project_id IN (${projectIds.map(() => '?').join(',')})
     GROUP BY project_id`,
    today(),
    ...projectIds,
  );
  return new Map(rows.map((r) => [r.project_id, { total: r.total, done: r.done || 0, blocked: r.blocked || 0, overdue: r.overdue || 0 }]));
}

function decorate(rows) {
  if (!rows.length) return [];
  const idsList = rows.map((r) => r.id);
  const marks = idsList.map(() => '?').join(',');
  const stats = projectStats(idsList);
  const members = db.all(`SELECT project_id, user_id FROM project_members WHERE project_id IN (${marks})`, ...idsList);
  const tags = db.all(
    `SELECT pt.project_id, t.id, t.name, t.color FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.project_id IN (${marks})`,
    ...idsList,
  );
  return rows.map((p) => {
    const s = stats.get(p.id) || { total: 0, done: 0, blocked: 0, overdue: 0 };
    return {
      ...p,
      stats: s,
      progress: s.total ? Math.round((s.done / s.total) * 100) : 0,
      member_ids: members.filter((m) => m.project_id === p.id).map((m) => m.user_id),
      tags: tags.filter((t) => t.project_id === p.id).map(({ id, name, color }) => ({ id, name, color })),
    };
  });
}

function getProject(user, id) {
  const p = db.get('SELECT * FROM projects WHERE id = ?', id);
  if (!p || p.deleted_at || !canViewProject(user, p)) throw notFound('El proyecto');
  return p;
}

function requireEdit(user, project) {
  if (!canEditProject(user, project)) {
    throw new HttpError(403, 'Solo el responsable del proyecto o un administrador de proyectos puede hacer este cambio.');
  }
}

function reindex(id) {
  const p = db.get('SELECT * FROM projects WHERE id = ?', id);
  indexEntity('project', id, p.name, [p.description, p.objective, p.expected_result].join('\n'));
}

router.get(
  '/',
  handler((req, res) => {
    const where = ['p.deleted_at IS NULL', projectVisibilitySql(req.user, 'p')];
    const params = [];
    if (req.query.status) {
      const list = String(req.query.status).split(',').filter((s) => STATUSES.includes(s));
      if (list.length) where.push(`p.status IN (${list.map((s) => `'${s}'`).join(',')})`);
    }
    if (req.query.mine) {
      where.push('(p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))');
      params.push(req.user.id, req.user.id);
    }
    if (req.query.goal_id) {
      where.push('p.goal_id = ?');
      params.push(Number(req.query.goal_id));
    }
    const rows = db.all(
      `SELECT p.* FROM projects p WHERE ${where.join(' AND ')}
       ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
       p.updated_at DESC`,
      ...params,
    );
    res.json(decorate(rows));
  }),
);

function readProjectInput(b, creating) {
  return {
    name: creating || b.name !== undefined ? str(b.name, { field: 'El nombre', required: true, max: 120 }) : undefined,
    description: str(b.description, { field: 'La descripción', max: 10000, trim: false }),
    objective: str(b.objective, { field: 'El objetivo', max: 2000 }),
    expected_result: str(b.expected_result, { field: 'El resultado esperado', max: 2000 }),
    owner_id: int(b.owner_id, { field: 'Responsable', min: 1 }),
    status: oneOf(b.status, STATUSES, 'Estado'),
    priority: oneOf(b.priority, PRIORITIES, 'Prioridad'),
    start_date: date(b.start_date, 'Fecha de inicio'),
    due_date: date(b.due_date, 'Fecha objetivo'),
    color: oneOf(b.color, COLORS, 'Color'),
    icon: str(b.icon, { field: 'Ícono', max: 16 }),
    visibility: oneOf(b.visibility, ['workspace', 'members'], 'Visibilidad'),
    goal_id: int(b.goal_id, { field: 'Objetivo', min: 1 }),
  };
}

router.post(
  '/',
  handler((req, res) => {
    requirePermission(req.user, 'projects.create');
    const data = readProjectInput(req.body, true);
    const memberIds = ids(req.body.member_ids, 'Integrantes') || [];
    const tagIds = ids(req.body.tag_ids, 'Etiquetas') || [];
    const templateId = int(req.body.template_id, { field: 'Plantilla', min: 1 });
    const template = templateId ? db.get("SELECT * FROM templates WHERE id = ? AND kind = 'project'", templateId) : null;
    if (templateId && !template) throw new HttpError(400, 'La plantilla no existe.');
    const structure = template ? parseJson(template.structure, {}) : {};

    const id = transaction(() => {
      const ts = now();
      const ownerId = data.owner_id || req.user.id;
      const pid = db.insert('projects', {
        ...data,
        objective: data.objective ?? structure.objective ?? '',
        icon: data.icon ?? template?.icon ?? null,
        owner_id: ownerId,
        created_by: req.user.id,
        created_at: ts,
        updated_at: ts,
      });
      for (const uid of new Set([req.user.id, ownerId, ...memberIds])) {
        db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', pid, uid);
      }
      for (const tid of tagIds) db.run('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', pid, tid);
      const cols = structure.columns?.length ? structure.columns : DEFAULT_COLUMNS;
      cols.forEach((c, i) =>
        db.insert('project_columns', { project_id: pid, name: c.name, category: c.category, position: (i + 1) * 1024, color: c.color || null }),
      );
      // Estructura de tareas de la plantilla (sin responsables: se asignan después).
      const startBase = data.start_date || today();
      for (const t of structure.tasks || []) {
        createTask(
          req.user,
          {
            title: t.title,
            description: t.description || '',
            project_id: pid,
            status: t.category || 'todo',
            priority: t.priority || 'none',
            checklist: t.checklist,
            recurrence: t.recurrence || null,
            due_date: t.dueInDays != null ? addDays(startBase, t.dueInDays) : null,
          },
          { silent: true },
        );
      }
      ensureProjectChannel({ id: pid, name: data.name }, req.user.id);
      reindex(pid);
      logActivity({
        actor: req.user,
        entityType: 'project',
        entityId: pid,
        projectId: pid,
        action: 'created',
        summary: template ? `creó el proyecto «${data.name}» con la plantilla ${template.name}` : `creó el proyecto «${data.name}»`,
      });
      return pid;
    });
    notify({
      userIds: [...memberIds, data.owner_id].filter(Boolean),
      type: 'project',
      title: `${req.user.name} te agregó al proyecto «${data.name}»`,
      link: `/projects/${id}`,
      actorId: req.user.id,
      entityType: 'project',
      entityId: id,
    });
    emit(['projects', 'tasks', 'chat', 'dashboard']);
    res.status(201).json({ id });
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    const [full] = decorate([p]);
    const pages = db.all(
      `SELECT id, title, icon, updated_at FROM pages WHERE project_id = ? AND deleted_at IS NULL AND is_template = 0
       AND (visibility = 'workspace' OR created_by = ?) ORDER BY updated_at DESC`,
      p.id,
      req.user.id,
    );
    const channel = db.get('SELECT id FROM channels WHERE project_id = ?', p.id);
    const goal = p.goal_id ? db.get('SELECT id, title FROM goals WHERE id = ?', p.goal_id) : null;
    const meetings = db.all(
      'SELECT id, title, starts_at, status FROM meetings WHERE project_id = ? AND deleted_at IS NULL ORDER BY starts_at DESC LIMIT 20',
      p.id,
    );
    const files = db.all('SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND deleted_at IS NULL', p.id)[0].n;
    res.json({
      ...full,
      columns: columnsOf(p.id),
      pages,
      meetings,
      channel_id: channel?.id ?? null,
      goal,
      file_count: files,
      attachments: attachmentsOf(req.user, 'project', p.id),
      related: relatedEntities(req.user, 'project', p.id).filter((r) => r.type !== 'file'),
      can_edit: canEditProject(req.user, p),
    });
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    const data = readProjectInput(req.body, false);
    if (data.status === 'completed' && p.status !== 'completed') data.completed_at = now();
    if (data.status && data.status !== 'completed') data.completed_at = null;
    transaction(() => {
      db.update('projects', p.id, { ...data, updated_at: now() });
      if (req.body.member_ids !== undefined) {
        const next = ids(req.body.member_ids, 'Integrantes');
        const current = db.all('SELECT user_id FROM project_members WHERE project_id = ?', p.id).map((r) => r.user_id);
        db.run('DELETE FROM project_members WHERE project_id = ?', p.id);
        const owner = data.owner_id || p.owner_id;
        for (const uid of new Set([...next, owner].filter(Boolean))) {
          db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', p.id, uid);
        }
        const added = next.filter((uid) => !current.includes(uid));
        notify({
          userIds: added,
          type: 'project',
          title: `${req.user.name} te agregó al proyecto «${data.name || p.name}»`,
          link: `/projects/${p.id}`,
          actorId: req.user.id,
          entityType: 'project',
          entityId: p.id,
        });
      } else if (data.owner_id) {
        db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', p.id, data.owner_id);
      }
      if (req.body.tag_ids !== undefined) {
        db.run('DELETE FROM project_tags WHERE project_id = ?', p.id);
        for (const tid of ids(req.body.tag_ids, 'Etiquetas')) db.run('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', p.id, tid);
      }
      if (data.name) ensureProjectChannel({ id: p.id, name: data.name });
      const changes = diff(p, data, ['name', 'status', 'priority', 'owner_id', 'start_date', 'due_date', 'objective', 'expected_result', 'visibility', 'goal_id']);
      const labels = { name: 'el nombre', status: 'el estado', priority: 'la prioridad', owner_id: 'el responsable', start_date: 'la fecha de inicio', due_date: 'la fecha objetivo', objective: 'el objetivo', expected_result: 'el resultado esperado', visibility: 'la visibilidad', goal_id: 'el objetivo vinculado' };
      if (Object.keys(changes).length) {
        logActivity({
          actor: req.user,
          entityType: 'project',
          entityId: p.id,
          projectId: p.id,
          action: 'updated',
          summary: `cambió ${Object.keys(changes).map((k) => labels[k]).join(', ')} de «${p.name}»`,
          data: changes,
        });
      }
      reindex(p.id);
    });
    emit(['projects', 'dashboard', 'chat']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    db.run('UPDATE projects SET deleted_at = ? WHERE id = ?', now(), p.id);
    unindexEntity('project', p.id);
    logActivity({ actor: req.user, entityType: 'project', entityId: p.id, projectId: p.id, action: 'deleted', summary: `envió a la papelera el proyecto «${p.name}»` });
    emit(['projects', 'tasks', 'dashboard', 'trash', 'chat']);
    res.json({ ok: true });
  }),
);

// ───────── Columnas del tablero ─────────
router.post(
  '/:id/columns',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    const max = db.get('SELECT MAX(position) AS m FROM project_columns WHERE project_id = ?', p.id).m || 0;
    const id = db.insert('project_columns', {
      project_id: p.id,
      name: str(req.body.name, { field: 'El nombre de la columna', required: true, max: 60 }),
      category: oneOf(req.body.category, CATEGORIES, 'Tipo de columna') || 'todo',
      position: max + 1024,
      color: oneOf(req.body.color, COLORS, 'Color') || null,
    });
    logActivity({ actor: req.user, entityType: 'project', entityId: p.id, projectId: p.id, action: 'column', summary: `agregó la columna «${req.body.name}» en «${p.name}»` });
    emit(['projects', 'tasks']);
    res.status(201).json(db.get('SELECT * FROM project_columns WHERE id = ?', id));
  }),
);

router.patch(
  '/:id/columns/:columnId',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    const col = db.get('SELECT * FROM project_columns WHERE id = ? AND project_id = ?', req.params.columnId, p.id);
    if (!col) throw notFound('La columna');
    const category = oneOf(req.body.category, CATEGORIES, 'Tipo de columna');
    transaction(() => {
      db.update('project_columns', col.id, {
        name: req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 60 }) : undefined,
        category,
        position: req.body.position !== undefined ? Number(req.body.position) : undefined,
        color: req.body.color !== undefined ? oneOf(req.body.color, COLORS, 'Color') || null : undefined,
      });
      if (category && category !== col.category) {
        // Las tareas de la columna adoptan el nuevo estado.
        const ts = now();
        db.run(
          `UPDATE tasks SET status = ?, updated_at = ?, completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, ?) ELSE NULL END
           WHERE column_id = ? AND deleted_at IS NULL`,
          category, ts, category, ts, col.id,
        );
      }
    });
    emit(['projects', 'tasks']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/columns/:columnId',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    const col = db.get('SELECT * FROM project_columns WHERE id = ? AND project_id = ?', req.params.columnId, p.id);
    if (!col) throw notFound('La columna');
    const cols = columnsOf(p.id);
    if (cols.length <= 1) throw new HttpError(400, 'El tablero necesita al menos una columna.');
    const targetId = int(req.query.move_to, { field: 'Columna destino', min: 1 }) ?? cols.find((c) => c.id !== col.id).id;
    const target = cols.find((c) => c.id === targetId && c.id !== col.id);
    if (!target) throw new HttpError(400, 'La columna destino no es válida.');
    transaction(() => {
      db.run(
        `UPDATE tasks SET column_id = ?, status = ?, updated_at = ? WHERE column_id = ?`,
        target.id, target.category, now(), col.id,
      );
      db.run('DELETE FROM project_columns WHERE id = ?', col.id);
    });
    logActivity({ actor: req.user, entityType: 'project', entityId: p.id, projectId: p.id, action: 'column', summary: `eliminó la columna «${col.name}» (tareas movidas a «${target.name}»)` });
    emit(['projects', 'tasks']);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/columns-order',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requireEdit(req.user, p);
    const order = ids(req.body.ids, 'Orden');
    transaction(() => {
      order.forEach((cid, i) => db.run('UPDATE project_columns SET position = ? WHERE id = ? AND project_id = ?', (i + 1) * 1024, cid, p.id));
    });
    emit(['projects', 'tasks']);
    res.json({ ok: true });
  }),
);

/** Guarda la estructura del proyecto como plantilla reutilizable. */
router.post(
  '/:id/save-template',
  handler((req, res) => {
    const p = getProject(req.user, Number(req.params.id));
    requirePermission(req.user, 'projects.create');
    const cols = columnsOf(p.id);
    const tasks = db.all(
      'SELECT id, title, description, status, priority, recurrence FROM tasks WHERE project_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY position',
      p.id,
    );
    const structure = {
      objective: p.objective,
      columns: cols.map((c) => ({ name: c.name, category: c.category, color: c.color })),
      tasks: tasks.map((t) => ({
        title: t.title,
        description: t.description,
        category: t.status === 'done' ? 'todo' : t.status,
        priority: t.priority,
        recurrence: parseJson(t.recurrence, null),
        checklist: db.all('SELECT text FROM checklist_items WHERE task_id = ? ORDER BY position', t.id).map((r) => r.text),
      })),
    };
    const id = db.insert('templates', {
      kind: 'project',
      name: str(req.body.name, { field: 'El nombre', max: 120 }) || `Plantilla de ${p.name}`,
      description: str(req.body.description, { field: 'La descripción', max: 500 }) || '',
      icon: p.icon,
      structure,
      created_by: req.user.id,
      created_at: now(),
    });
    emit(['templates']);
    res.status(201).json({ id });
  }),
);

export default router;
