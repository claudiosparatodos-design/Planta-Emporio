import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, int, notFound, str, bool } from '../lib/http.js';
import { can, canEditProject, canViewTask } from '../lib/permissions.js';
import { createTask, decorateTasks, listTasks, reindexTask, taskCard, updateTask } from '../lib/tasks.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { attachmentsOf, relatedEntities } from '../lib/entities.js';
import { unindexEntity } from '../lib/search.js';
import { usersById } from '../lib/users.js';

const router = Router();

function getTask(user, id) {
  const task = db.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!task || task.deleted_at || !canViewTask(user, task)) throw notFound('La tarea');
  return task;
}

const touched = (task) => emit(['tasks', 'dashboard'], { data: { taskId: task.id, projectId: task.project_id } });

router.get(
  '/',
  handler((req, res) => {
    const f = req.query;
    res.json(
      listTasks(req.user, {
        ...f,
        include_subtasks: bool(f.include_subtasks),
        include_done: bool(f.include_done),
        overdue: bool(f.overdue),
        has_due: bool(f.has_due),
        no_project: bool(f.no_project),
      }),
    );
  }),
);

router.post(
  '/',
  handler((req, res) => {
    const id = createTask(req.user, req.body);
    res.status(201).json(taskCard(id));
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const full = taskCard(task.id);
    const project = task.project_id ? db.get('SELECT id, name, icon, color, owner_id FROM projects WHERE id = ?', task.project_id) : null;
    const columns = task.project_id ? db.all('SELECT id, name, category FROM project_columns WHERE project_id = ? ORDER BY position, id', task.project_id) : [];
    const subtasks = decorateTasks(
      db.all('SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, id', task.id),
    );
    const parent = task.parent_id ? db.get('SELECT id, title, status FROM tasks WHERE id = ?', task.parent_id) : null;
    const checklist = db.all('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id', task.id);
    const dependsOn = db.all(
      `SELECT t.id, t.title, t.status, t.due_date FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
       WHERE d.task_id = ? AND t.deleted_at IS NULL`,
      task.id,
    );
    const blocking = db.all(
      `SELECT t.id, t.title, t.status, t.due_date FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on_id = ? AND t.deleted_at IS NULL`,
      task.id,
    );
    const links = db.all('SELECT * FROM task_links WHERE task_id = ? ORDER BY id', task.id);
    const watchers = db.all('SELECT user_id FROM task_watchers WHERE task_id = ?', task.id).map((r) => r.user_id);
    const meeting = task.meeting_id ? db.get('SELECT id, title, starts_at FROM meetings WHERE id = ?', task.meeting_id) : null;
    const goal = task.goal_id ? db.get('SELECT id, title FROM goals WHERE id = ?', task.goal_id) : null;
    res.json({
      ...full,
      project,
      columns,
      parent,
      subtasks,
      checklist,
      depends_on_tasks: dependsOn,
      blocking_tasks: blocking,
      links,
      watcher_ids: watchers,
      meeting,
      goal,
      attachments: attachmentsOf(req.user, 'task', task.id),
      related: relatedEntities(req.user, 'task', task.id).filter((r) => r.type !== 'file'),
      can_delete: task.created_by === req.user.id || can(req.user, 'projects.manage') || (project && canEditProject(req.user, project)),
    });
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    getTask(req.user, Number(req.params.id));
    updateTask(req.user, Number(req.params.id), req.body);
    res.json(taskCard(Number(req.params.id)));
  }),
);

/** Cambios en lote (p. ej. reordenar varias tarjetas). */
router.post(
  '/bulk',
  handler((req, res) => {
    const updates = Array.isArray(req.body.updates) ? req.body.updates.slice(0, 200) : [];
    transaction(() => {
      for (const u of updates) {
        getTask(req.user, Number(u.id));
        const { id, ...patch } = u;
        updateTask(req.user, Number(id), patch);
      }
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const project = task.project_id ? db.get('SELECT * FROM projects WHERE id = ?', task.project_id) : null;
    const allowed = task.created_by === req.user.id || can(req.user, 'projects.manage') || (project && canEditProject(req.user, project));
    if (!allowed) throw new HttpError(403, 'Solo quien creó la tarea o el responsable del proyecto puede eliminarla.');
    const ts = now();
    db.run('UPDATE tasks SET deleted_at = ? WHERE id = ? OR parent_id = ?', ts, task.id, task.id);
    unindexEntity('task', task.id);
    logActivity({ actor: req.user, entityType: 'task', entityId: task.id, projectId: task.project_id, action: 'deleted', summary: `envió a la papelera «${task.title}»` });
    emit(['tasks', 'projects', 'dashboard', 'trash']);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/duplicate',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const [full] = decorateTasks([task]);
    const checklist = db.all('SELECT text FROM checklist_items WHERE task_id = ? ORDER BY position', task.id).map((r) => r.text);
    const id = createTask(req.user, {
      title: `${task.title} (copia)`,
      description: task.description,
      project_id: task.project_id,
      column_id: task.column_id,
      priority: task.priority,
      due_date: task.due_date,
      start_date: task.start_date,
      estimate_minutes: task.estimate_minutes,
      assignee_ids: can(req.user, 'tasks.assign') ? full.assignee_ids : [],
      tag_ids: full.tags.map((t) => t.id),
      checklist,
    });
    res.status(201).json({ id });
  }),
);

// ───────── Lista de verificación ─────────
router.post(
  '/:id/checklist',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const text = str(req.body.text, { field: 'El elemento', required: true, max: 500 });
    const max = db.get('SELECT MAX(position) AS m FROM checklist_items WHERE task_id = ?', task.id).m || 0;
    const id = db.insert('checklist_items', { task_id: task.id, text, position: max + 1024 });
    reindexTask(task.id);
    touched(task);
    res.status(201).json(db.get('SELECT * FROM checklist_items WHERE id = ?', id));
  }),
);

router.patch(
  '/checklist/:itemId',
  handler((req, res) => {
    const item = db.get('SELECT * FROM checklist_items WHERE id = ?', req.params.itemId);
    if (!item) throw notFound('El elemento');
    const task = getTask(req.user, item.task_id);
    const done = bool(req.body.done);
    db.update('checklist_items', item.id, {
      text: req.body.text !== undefined ? str(req.body.text, { field: 'El elemento', required: true, max: 500 }) : undefined,
      done,
      done_by: done === undefined ? undefined : done ? req.user.id : null,
      done_at: done === undefined ? undefined : done ? now() : null,
      position: req.body.position !== undefined ? Number(req.body.position) : undefined,
    });
    if (done !== undefined && done !== Boolean(item.done)) {
      logActivity({
        actor: req.user,
        entityType: 'task',
        entityId: task.id,
        projectId: task.project_id,
        action: 'checklist',
        summary: `${done ? 'marcó' : 'desmarcó'} «${item.text}» en «${task.title}»`,
      });
    }
    reindexTask(task.id);
    touched(task);
    res.json(db.get('SELECT * FROM checklist_items WHERE id = ?', item.id));
  }),
);

router.delete(
  '/checklist/:itemId',
  handler((req, res) => {
    const item = db.get('SELECT * FROM checklist_items WHERE id = ?', req.params.itemId);
    if (!item) throw notFound('El elemento');
    const task = getTask(req.user, item.task_id);
    db.run('DELETE FROM checklist_items WHERE id = ?', item.id);
    reindexTask(task.id);
    touched(task);
    res.json({ ok: true });
  }),
);

// ───────── Dependencias ─────────
function wouldCycle(taskId, dependsOnId) {
  // ¿dependsOn depende (directa o indirectamente) de taskId?
  const seen = new Set();
  const stack = [dependsOnId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const r of db.all('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?', cur)) stack.push(r.depends_on_id);
  }
  return false;
}

router.post(
  '/:id/dependencies',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const other = getTask(req.user, int(req.body.depends_on_id, { field: 'Tarea', min: 1, nullable: false }));
    if (other.id === task.id) throw new HttpError(400, 'Una tarea no puede depender de sí misma.');
    if (wouldCycle(task.id, other.id)) throw new HttpError(400, 'Esa dependencia crearía un ciclo.');
    db.run('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)', task.id, other.id);
    logActivity({ actor: req.user, entityType: 'task', entityId: task.id, projectId: task.project_id, action: 'dependency', summary: `indicó que «${task.title}» depende de «${other.title}»` });
    touched(task);
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  '/:id/dependencies/:otherId',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    db.run('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', task.id, Number(req.params.otherId));
    touched(task);
    res.json({ ok: true });
  }),
);

// ───────── Enlaces externos ─────────
router.post(
  '/:id/links',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const url = str(req.body.url, { field: 'El enlace', required: true, max: 2000 });
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'El enlace debe comenzar con http:// o https://');
    const id = db.insert('task_links', {
      task_id: task.id,
      url,
      title: str(req.body.title, { field: 'Título', max: 200 }) || null,
      created_by: req.user.id,
      created_at: now(),
    });
    touched(task);
    res.status(201).json(db.get('SELECT * FROM task_links WHERE id = ?', id));
  }),
);

router.delete(
  '/links/:linkId',
  handler((req, res) => {
    const link = db.get('SELECT * FROM task_links WHERE id = ?', req.params.linkId);
    if (!link) throw notFound('El enlace');
    const task = getTask(req.user, link.task_id);
    db.run('DELETE FROM task_links WHERE id = ?', link.id);
    touched(task);
    res.json({ ok: true });
  }),
);

// ───────── Seguimiento y tiempo ─────────
router.post(
  '/:id/watch',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    if (bool(req.body.watch) === false) db.run('DELETE FROM task_watchers WHERE task_id = ? AND user_id = ?', task.id, req.user.id);
    else db.run('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)', task.id, req.user.id);
    touched(task);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/time',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const minutes = int(req.body.minutes, { field: 'Minutos', min: 1, max: 24 * 60, nullable: false });
    db.run('UPDATE tasks SET spent_minutes = spent_minutes + ?, updated_at = ? WHERE id = ?', minutes, now(), task.id);
    logActivity({ actor: req.user, entityType: 'task', entityId: task.id, projectId: task.project_id, action: 'time', summary: `registró ${minutes} min en «${task.title}»` });
    touched(task);
    res.json({ ok: true });
  }),
);

router.get(
  '/:id/history',
  handler((req, res) => {
    const task = getTask(req.user, Number(req.params.id));
    const rows = db.all(
      "SELECT * FROM activity WHERE entity_type = 'task' AND entity_id = ? ORDER BY id DESC LIMIT 200",
      task.id,
    );
    const users = usersById(rows.map((r) => r.actor_id));
    res.json(rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, actor: users.get(r.actor_id) || null })));
  }),
);

export default router;
