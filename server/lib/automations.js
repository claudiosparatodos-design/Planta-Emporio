import { db, now } from './dbx.js';
import { notify } from './notify.js';
import { parseJson } from './http.js';
import { userIdsWithPermission } from './users.js';

export const STATUS_LABELS = {
  idea: 'Idea',
  todo: 'Por hacer',
  in_progress: 'En progreso',
  review: 'En revisión',
  blocked: 'Bloqueado',
  done: 'Terminado',
};

export const TRIGGERS = {
  'task.status_changed': 'Una tarea cambia de estado',
  'task.created': 'Se crea una tarea',
  'task.due_soon': 'Se acerca la fecha límite de una tarea',
  'obligation.due_soon': 'Se acerca el vencimiento de un pago o cobro',
  'meeting.upcoming': 'Se acerca una reunión',
};

export const ACTIONS = {
  notify: 'Enviar notificación',
  assign: 'Asignar a un integrante',
  set_priority: 'Cambiar prioridad',
};

export function enabledRules(trigger) {
  return db
    .all('SELECT * FROM automations WHERE enabled = 1 AND trigger = ?', trigger)
    .map((r) => ({ ...r, conditions: parseJson(r.conditions, {}), action_config: parseJson(r.action_config, {}) }));
}

function markRun(rule) {
  db.run('UPDATE automations SET run_count = run_count + 1, last_run_at = ? WHERE id = ?', now(), rule.id);
}

function taskContext(taskId) {
  const task = db.get(
    'SELECT t.*, p.name AS project_name, p.owner_id AS project_owner_id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?',
    taskId,
  );
  if (!task) return null;
  task.assignee_ids = db.all('SELECT user_id FROM task_assignees WHERE task_id = ?', taskId).map((r) => r.user_id);
  task.watcher_ids = db.all('SELECT user_id FROM task_watchers WHERE task_id = ?', taskId).map((r) => r.user_id);
  return task;
}

function resolveTargets(targets = [], task) {
  const ids = [];
  for (const t of targets) {
    if (t === 'assignees') ids.push(...task.assignee_ids);
    else if (t === 'project_owner' && task.project_owner_id) ids.push(task.project_owner_id);
    else if (t === 'creator' && task.created_by) ids.push(task.created_by);
    else if (t === 'watchers') ids.push(...task.watcher_ids);
    else if (String(t).startsWith('user:')) ids.push(Number(String(t).slice(5)));
  }
  return ids;
}

function matches(rule, task, extra = {}) {
  const c = rule.conditions;
  if (c.project_id && Number(c.project_id) !== task.project_id) return false;
  if (c.to && c.to !== extra.to) return false;
  if (c.from && c.from !== extra.from) return false;
  if (c.priority && c.priority !== task.priority) return false;
  return true;
}

/**
 * Ejecuta las reglas de tareas. Las acciones de una regla no disparan otras reglas
 * (evita cascadas y comportamientos inesperados).
 */
export function runTaskAutomations(trigger, taskId, actorId, extra = {}) {
  const rules = enabledRules(trigger);
  if (!rules.length) return;
  const task = taskContext(taskId);
  if (!task || task.deleted_at) return;
  for (const rule of rules) {
    if (!matches(rule, task, extra)) continue;
    const cfg = rule.action_config;
    if (rule.action === 'notify') {
      const label = STATUS_LABELS[extra.to] || '';
      const title =
        trigger === 'task.status_changed'
          ? `«${task.title}» pasó a ${label}`
          : trigger === 'task.created'
            ? `Nueva tarea: «${task.title}»`
            : `«${task.title}»`;
      notify({
        userIds: resolveTargets(cfg.targets, task),
        type: 'task_status',
        title,
        body: cfg.message || (task.project_name ? `Proyecto: ${task.project_name}` : null),
        link: `/tasks/${task.id}`,
        actorId,
        entityType: 'task',
        entityId: task.id,
      });
    } else if (rule.action === 'assign' && cfg.user_id) {
      db.run('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)', task.id, Number(cfg.user_id));
      db.run('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)', task.id, Number(cfg.user_id));
      notify({
        userIds: [Number(cfg.user_id)],
        type: 'assigned',
        title: `Te asignaron «${task.title}» (automatización)`,
        link: `/tasks/${task.id}`,
        actorId,
        entityType: 'task',
        entityId: task.id,
      });
    } else if (rule.action === 'set_priority' && cfg.priority) {
      db.run('UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?', cfg.priority, now(), task.id);
    }
    markRun(rule);
  }
}

export { taskContext, resolveTargets, markRun, userIdsWithPermission };
