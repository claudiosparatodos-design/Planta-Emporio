import { db, now, transaction } from './dbx.js';
import { HttpError, date, ids, int, oneOf, str, parseJson } from './http.js';
import { can, canViewProject, taskVisibilitySql } from './permissions.js';
import { logActivity, diff } from './activity.js';
import { notify } from './notify.js';
import { indexEntity } from './search.js';
import { emit } from './events.js';
import { STATUS_LABELS, runTaskAutomations } from './automations.js';
import { addDays, addMonths, today } from './workspace.js';
import { usersById } from './users.js';

export const STATUSES = ['idea', 'todo', 'in_progress', 'review', 'blocked', 'done'];
export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
export const PRIORITY_LABELS = { none: 'Sin prioridad', low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };

const FIELD_LABELS = {
  title: 'el título',
  description: 'la descripción',
  priority: 'la prioridad',
  start_date: 'la fecha de inicio',
  due_date: 'la fecha límite',
  estimate_minutes: 'el tiempo estimado',
  spent_minutes: 'el tiempo invertido',
  project_id: 'el proyecto',
  recurrence: 'la recurrencia',
  goal_id: 'el objetivo',
  parent_id: 'la tarea principal',
};

export function columnsOf(projectId) {
  return db.all('SELECT * FROM project_columns WHERE project_id = ? ORDER BY position, id', projectId);
}

function columnForStatus(projectId, status) {
  return db.get(
    'SELECT * FROM project_columns WHERE project_id = ? AND category = ? ORDER BY position, id LIMIT 1',
    projectId,
    status,
  );
}

function nextPosition(projectId, columnId) {
  const row = db.get(
    'SELECT MAX(position) AS m FROM tasks WHERE deleted_at IS NULL AND ' +
      (columnId ? 'column_id = ?' : projectId ? 'project_id = ? AND column_id IS NULL' : 'project_id IS NULL'),
    ...(columnId ? [columnId] : projectId ? [projectId] : []),
  );
  return (row?.m ?? 0) + 1024;
}

function validRecurrence(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const r = typeof value === 'string' ? parseJson(value, null) : value;
  if (!r || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) throw new HttpError(400, 'La recurrencia no es válida.');
  const interval = Math.max(1, Math.min(365, Number(r.interval) || 1));
  return JSON.stringify({ freq: r.freq, interval });
}

function checkAssignees(user, assigneeIds) {
  if (!assigneeIds) return;
  const others = assigneeIds.filter((id) => id !== user.id);
  if (others.length && !can(user, 'tasks.assign')) {
    throw new HttpError(403, 'No tienes permiso para asignar tareas a otros integrantes.');
  }
  for (const id of assigneeIds) {
    const u = db.get('SELECT status FROM users WHERE id = ?', id);
    if (!u || u.status !== 'active') throw new HttpError(400, 'Uno de los responsables no es un integrante activo.');
  }
}

function checkProject(user, projectId) {
  if (projectId == null) return null;
  const project = db.get('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', projectId);
  if (!project || !canViewProject(user, project)) throw new HttpError(400, 'El proyecto no existe o no tienes acceso.');
  return project;
}

/** Crea una tarea. Solo el título es obligatorio. */
export function createTask(user, input, { silent = false } = {}) {
  const title = str(input.title, { field: 'El título', required: true, max: 300 });
  const projectId = int(input.project_id, { field: 'Proyecto', min: 1 }) ?? null;
  const parentId = int(input.parent_id, { field: 'Tarea principal', min: 1 }) ?? null;
  const assigneeIds = ids(input.assignee_ids, 'Responsables') || [];
  const tagIds = ids(input.tag_ids, 'Etiquetas') || [];
  let status = oneOf(input.status, STATUSES, 'Estado');
  let columnId = int(input.column_id, { field: 'Columna', min: 1 }) ?? null;
  checkAssignees(user, assigneeIds);

  return transaction(() => {
    let project = checkProject(user, projectId);
    let parent = null;
    if (parentId) {
      parent = db.get('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', parentId);
      if (!parent) throw new HttpError(400, 'La tarea principal no existe.');
      if (!project && parent.project_id) project = checkProject(user, parent.project_id);
    }
    const pid = project?.id ?? null;
    if (pid) {
      let column = columnId ? db.get('SELECT * FROM project_columns WHERE id = ? AND project_id = ?', columnId, pid) : null;
      if (!column) column = columnForStatus(pid, status || 'todo') || columnsOf(pid)[0];
      columnId = column?.id ?? null;
      status = column?.category ?? status ?? 'todo';
    } else {
      columnId = null;
      status = status || 'todo';
    }
    const ts = now();
    const id = db.insert('tasks', {
      project_id: pid,
      column_id: parent ? null : columnId,
      parent_id: parent?.id ?? null,
      title,
      description: str(input.description, { field: 'La descripción', max: 20000, trim: false }) ?? '',
      status,
      priority: oneOf(input.priority, PRIORITIES, 'Prioridad') || 'none',
      position: input.position != null ? Number(input.position) : nextPosition(pid, parent ? null : columnId),
      start_date: date(input.start_date, 'Fecha de inicio') ?? null,
      due_date: date(input.due_date, 'Fecha límite') ?? null,
      estimate_minutes: int(input.estimate_minutes, { field: 'Tiempo estimado', min: 0 }) ?? null,
      recurrence: validRecurrence(input.recurrence) ?? null,
      recurrence_source_id: input.recurrence_source_id ?? null,
      goal_id: int(input.goal_id, { field: 'Objetivo', min: 1 }) ?? null,
      meeting_id: int(input.meeting_id, { field: 'Reunión', min: 1 }) ?? null,
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
      completed_at: status === 'done' ? ts : null,
      completed_by: status === 'done' ? user.id : null,
    });
    for (const uid of assigneeIds) db.run('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)', id, uid);
    for (const uid of new Set([user.id, ...assigneeIds])) db.run('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)', id, uid);
    for (const tid of tagIds) db.run('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)', id, tid);
    if (Array.isArray(input.checklist)) {
      input.checklist.forEach((text, i) => {
        const t = str(text, { field: 'Elemento', max: 500 });
        if (t) db.insert('checklist_items', { task_id: id, text: t, position: (i + 1) * 1024 });
      });
    }
    reindexTask(id);
    if (!silent) {
      logActivity({
        actor: user,
        entityType: 'task',
        entityId: id,
        projectId: pid,
        action: 'created',
        summary: parent ? `creó la subtarea «${title}»` : `creó la tarea «${title}»`,
      });
      notify({
        userIds: assigneeIds,
        type: 'assigned',
        title: `${user.name} te asignó «${title}»`,
        body: project ? `Proyecto: ${project.name}` : null,
        link: `/tasks/${id}`,
        actorId: user.id,
        entityType: 'task',
        entityId: id,
      });
      runTaskAutomations('task.created', id, user.id);
      emit(['tasks', 'projects', 'dashboard'], { data: { taskId: id, projectId: pid } });
    }
    return id;
  });
}

/** Actualiza campos de una tarea, sincronizando columna ↔ estado y registrando el historial. */
export function updateTask(user, taskId, input) {
  return transaction(() => {
    const task = db.get('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', taskId);
    if (!task) throw new HttpError(404, 'La tarea no existe.');
    const patch = {
      title: input.title !== undefined ? str(input.title, { field: 'El título', required: true, max: 300 }) : undefined,
      description: str(input.description, { field: 'La descripción', max: 20000, trim: false }),
      priority: oneOf(input.priority, PRIORITIES, 'Prioridad'),
      start_date: date(input.start_date, 'Fecha de inicio'),
      due_date: date(input.due_date, 'Fecha límite'),
      estimate_minutes: int(input.estimate_minutes, { field: 'Tiempo estimado', min: 0 }),
      spent_minutes: input.spent_minutes !== undefined ? int(input.spent_minutes, { field: 'Tiempo invertido', min: 0 }) ?? 0 : undefined,
      recurrence: validRecurrence(input.recurrence),
      goal_id: int(input.goal_id, { field: 'Objetivo', min: 1 }),
      position: input.position !== undefined ? Number(input.position) : undefined,
    };
    if (patch.position !== undefined && !Number.isFinite(patch.position)) throw new HttpError(400, 'Posición inválida.');

    // Proyecto
    let projectId = task.project_id;
    if (input.project_id !== undefined) {
      projectId = int(input.project_id, { field: 'Proyecto', min: 1 }) ?? null;
      checkProject(user, projectId);
      if (projectId !== task.project_id) {
        patch.project_id = projectId;
        db.run('UPDATE tasks SET project_id = ? WHERE parent_id = ?', projectId, task.id);
      }
    }
    if (input.parent_id !== undefined) {
      const parentId = int(input.parent_id, { field: 'Tarea principal', min: 1 }) ?? null;
      if (parentId === task.id) throw new HttpError(400, 'Una tarea no puede ser subtarea de sí misma.');
      patch.parent_id = parentId;
    }

    // Columna / estado
    let status = task.status;
    let columnId = task.column_id;
    const wantColumn = input.column_id !== undefined ? int(input.column_id, { field: 'Columna', min: 1 }) : undefined;
    const wantStatus = oneOf(input.status, STATUSES, 'Estado');
    if (projectId && !task.parent_id) {
      if (wantColumn) {
        const col = db.get('SELECT * FROM project_columns WHERE id = ? AND project_id = ?', wantColumn, projectId);
        if (!col) throw new HttpError(400, 'La columna no pertenece al proyecto.');
        columnId = col.id;
        status = col.category;
      } else if (wantStatus) {
        status = wantStatus;
        const current = columnId ? db.get('SELECT * FROM project_columns WHERE id = ?', columnId) : null;
        if (!current || current.category !== wantStatus || current.project_id !== projectId) {
          columnId = columnForStatus(projectId, wantStatus)?.id ?? columnId;
        }
      } else if (patch.project_id !== undefined) {
        columnId = (columnForStatus(projectId, status) || columnsOf(projectId)[0])?.id ?? null;
        if (columnId) status = db.get('SELECT category FROM project_columns WHERE id = ?', columnId).category;
      }
    } else {
      columnId = null;
      if (wantStatus) status = wantStatus;
    }
    if (columnId !== task.column_id) patch.column_id = columnId;
    if (patch.column_id !== undefined && patch.position === undefined) patch.position = nextPosition(projectId, columnId);
    const statusChanged = status !== task.status;
    if (statusChanged) {
      patch.status = status;
      patch.completed_at = status === 'done' ? now() : null;
      patch.completed_by = status === 'done' ? user.id : null;
    }

    // Responsables
    let addedAssignees = [];
    if (input.assignee_ids !== undefined) {
      const next = ids(input.assignee_ids, 'Responsables');
      const current = db.all('SELECT user_id FROM task_assignees WHERE task_id = ?', task.id).map((r) => r.user_id);
      const added = next.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !next.includes(id));
      if (added.concat(removed).some((id) => id !== user.id) && !can(user, 'tasks.assign')) {
        throw new HttpError(403, 'No tienes permiso para asignar tareas a otros integrantes.');
      }
      checkAssignees(user, added);
      for (const id of removed) db.run('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?', task.id, id);
      for (const id of added) {
        db.run('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)', task.id, id);
        db.run('INSERT OR IGNORE INTO task_watchers (task_id, user_id) VALUES (?, ?)', task.id, id);
      }
      addedAssignees = added;
      if (added.length || removed.length) {
        const names = usersById([...added, ...removed]);
        const parts = [];
        if (added.length) parts.push(`asignó a ${added.map((id) => names.get(id)?.name).join(', ')}`);
        if (removed.length) parts.push(`quitó a ${removed.map((id) => names.get(id)?.name).join(', ')}`);
        logActivity({ actor: user, entityType: 'task', entityId: task.id, projectId, action: 'assigned', summary: `${parts.join(' y ')} en «${task.title}»` });
      }
    }
    if (input.tag_ids !== undefined) {
      const next = ids(input.tag_ids, 'Etiquetas');
      db.run('DELETE FROM task_tags WHERE task_id = ?', task.id);
      for (const tid of next) db.run('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)', task.id, tid);
    }

    patch.updated_at = now();
    db.update('tasks', task.id, patch);

    // Historial
    const changes = diff(task, patch, Object.keys(FIELD_LABELS));
    if (statusChanged) {
      logActivity({
        actor: user,
        entityType: 'task',
        entityId: task.id,
        projectId,
        action: status === 'done' ? 'completed' : 'status',
        summary:
          status === 'done'
            ? `completó «${task.title}»`
            : `movió «${task.title}» de ${STATUS_LABELS[task.status]} a ${STATUS_LABELS[status]}`,
        data: { status: { from: task.status, to: status } },
      });
    }
    const fieldNames = Object.keys(changes).filter((f) => f !== 'position');
    if (fieldNames.length) {
      logActivity({
        actor: user,
        entityType: 'task',
        entityId: task.id,
        projectId,
        action: 'updated',
        summary: `cambió ${fieldNames.map((f) => FIELD_LABELS[f]).join(', ')} de «${patch.title || task.title}»`,
        data: changes,
      });
    }

    if (addedAssignees.length) {
      notify({
        userIds: addedAssignees,
        type: 'assigned',
        title: `${user.name} te asignó «${patch.title || task.title}»`,
        link: `/tasks/${task.id}`,
        actorId: user.id,
        entityType: 'task',
        entityId: task.id,
      });
    }
    if (statusChanged) {
      runTaskAutomations('task.status_changed', task.id, user.id, { from: task.status, to: status });
      if (status === 'done') spawnRecurrence(user, task.id);
    }
    reindexTask(task.id);
    emit(['tasks', 'projects', 'dashboard'], { data: { taskId: task.id, projectId } });
    return task.id;
  });
}

/** Al completar una tarea recurrente, crea la siguiente ocurrencia (una sola vez). */
function spawnRecurrence(user, taskId) {
  const task = db.get('SELECT * FROM tasks WHERE id = ?', taskId);
  const rec = parseJson(task.recurrence, null);
  if (!rec) return null;
  if (db.get('SELECT 1 FROM tasks WHERE recurrence_source_id = ? AND deleted_at IS NULL', task.id)) return null;
  const base = task.due_date || today();
  const step = (d) => {
    const n = rec.interval || 1;
    if (rec.freq === 'daily') return addDays(d, n);
    if (rec.freq === 'weekly') return addDays(d, 7 * n);
    if (rec.freq === 'monthly') return addMonths(d, n);
    return addMonths(d, 12 * n);
  };
  let due = step(base);
  while (due < today()) due = step(due); // no crear ocurrencias ya vencidas
  const offset = task.start_date && task.due_date ? (Date.parse(task.due_date) - Date.parse(task.start_date)) / 864e5 : null;
  const assignees = db.all('SELECT user_id FROM task_assignees WHERE task_id = ?', task.id).map((r) => r.user_id);
  const tags = db.all('SELECT tag_id FROM task_tags WHERE task_id = ?', task.id).map((r) => r.tag_id);
  const checklist = db.all('SELECT text FROM checklist_items WHERE task_id = ? ORDER BY position', task.id).map((r) => r.text);
  const creator = { ...user, permissions: [...(user.permissions || []), 'tasks.assign'] }; // la recurrencia conserva responsables
  const id = createTask(
    creator,
    {
      title: task.title,
      description: task.description,
      project_id: task.project_id,
      priority: task.priority,
      status: 'todo',
      due_date: due,
      start_date: offset != null ? addDays(due, -offset) : null,
      estimate_minutes: task.estimate_minutes,
      recurrence: task.recurrence,
      recurrence_source_id: task.id,
      goal_id: task.goal_id,
      assignee_ids: assignees,
      tag_ids: tags,
      checklist,
    },
    { silent: true },
  );
  logActivity({
    actor: user,
    entityType: 'task',
    entityId: id,
    projectId: task.project_id,
    action: 'recurrence',
    summary: `programó la siguiente repetición de «${task.title}» para el ${due}`,
  });
  return id;
}

export function reindexTask(id) {
  const t = db.get('SELECT title, description FROM tasks WHERE id = ?', id);
  if (!t) return;
  const items = db.all('SELECT text FROM checklist_items WHERE task_id = ?', id).map((r) => r.text);
  indexEntity('task', id, t.title, [t.description, ...items].join('\n'));
}

const CARD_SELECT = `SELECT t.*, p.name AS project_name, p.color AS project_color, p.icon AS project_icon,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status = 'done') AS subtask_done,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id) AS checklist_count,
  (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS checklist_done,
  (SELECT COUNT(*) FROM comments c WHERE c.entity_type = 'task' AND c.entity_id = t.id AND c.deleted_at IS NULL) AS comment_count,
  (SELECT COUNT(*) FROM links l WHERE l.a_type = 'task' AND l.a_id = t.id AND l.b_type = 'file') AS attachment_count,
  (SELECT COUNT(*) FROM task_dependencies d JOIN tasks dt ON dt.id = d.depends_on_id
     WHERE d.task_id = t.id AND dt.status <> 'done' AND dt.deleted_at IS NULL) AS open_dependencies
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`;

/** Tarjeta completa de una tarea (con contadores), sin validar permisos. */
export function taskCard(id) {
  return decorateTasks(db.all(`${CARD_SELECT} WHERE t.id = ?`, id))[0] || null;
}

// ───────── Lectura ─────────

/** Lista de tarjetas de tareas con responsables, etiquetas y contadores. */
export function listTasks(user, filters = {}) {
  const where = ['t.deleted_at IS NULL', taskVisibilitySql(user, 't'), "(p.id IS NULL OR p.deleted_at IS NULL)"];
  const params = [];
  if (filters.project_id) {
    where.push('t.project_id = ?');
    params.push(Number(filters.project_id));
  }
  if (filters.no_project) where.push('t.project_id IS NULL');
  if (!filters.include_subtasks) where.push('t.parent_id IS NULL');
  if (filters.assignee) {
    const ids = String(filters.assignee).split(',').map((v) => (v === 'me' ? user.id : v === 'none' ? 0 : Number(v)));
    const real = ids.filter((v) => v > 0);
    const parts = [];
    if (real.length) parts.push(`EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id IN (${real.map(() => '?').join(',')}))`);
    if (ids.includes(0)) parts.push('NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)');
    if (parts.length) {
      where.push(`(${parts.join(' OR ')})`);
      params.push(...real);
    }
  }
  if (filters.created_by) {
    where.push('t.created_by = ?');
    params.push(filters.created_by === 'me' ? user.id : Number(filters.created_by));
  }
  if (filters.status) {
    const list = String(filters.status).split(',').filter((s) => STATUSES.includes(s));
    if (list.length) where.push(`t.status IN (${list.map((s) => `'${s}'`).join(',')})`);
  } else if (!filters.include_done) {
    // Por defecto se muestran también las terminadas recientemente (14 días).
    where.push(`(t.status <> 'done' OR t.completed_at >= ?)`);
    params.push(new Date(Date.now() - 14 * 864e5).toISOString());
  }
  if (filters.priority) {
    const list = String(filters.priority).split(',').filter((s) => PRIORITIES.includes(s));
    if (list.length) where.push(`t.priority IN (${list.map((s) => `'${s}'`).join(',')})`);
  }
  if (filters.tag) {
    const list = String(filters.tag).split(',').map(Number).filter(Boolean);
    if (list.length) {
      where.push(`EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag_id IN (${list.map(() => '?').join(',')}))`);
      params.push(...list);
    }
  }
  if (filters.due_from) {
    where.push('t.due_date >= ?');
    params.push(filters.due_from);
  }
  if (filters.due_to) {
    where.push('t.due_date <= ?');
    params.push(filters.due_to);
  }
  if (filters.overdue) {
    where.push("t.due_date < ? AND t.status <> 'done'");
    params.push(today());
  }
  if (filters.has_due) where.push('t.due_date IS NOT NULL');
  if (filters.goal_id) {
    where.push('t.goal_id = ?');
    params.push(Number(filters.goal_id));
  }
  if (filters.meeting_id) {
    where.push('t.meeting_id = ?');
    params.push(Number(filters.meeting_id));
  }
  if (filters.q) {
    where.push('t.title LIKE ?');
    params.push(`%${String(filters.q).slice(0, 100)}%`);
  }
  const limit = Math.min(Number(filters.limit) || 1000, 2000);
  const rows = db.all(
    `${CARD_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY t.position, t.id LIMIT ${limit}`,
    ...params,
  );
  return decorateTasks(rows);
}

export function decorateTasks(rows) {
  if (!rows.length) return [];
  const idList = rows.map((r) => r.id);
  const marks = idList.map(() => '?').join(',');
  const assignees = db.all(`SELECT task_id, user_id FROM task_assignees WHERE task_id IN (${marks})`, ...idList);
  const tags = db.all(
    `SELECT tt.task_id, g.id, g.name, g.color FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id IN (${marks})`,
    ...idList,
  );
  const deps = db.all(`SELECT task_id, depends_on_id FROM task_dependencies WHERE task_id IN (${marks})`, ...idList);
  const byTask = (list, key = 'task_id') => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };
  const a = byTask(assignees);
  const g = byTask(tags);
  const d = byTask(deps);
  return rows.map((r) => ({
    ...r,
    recurrence: parseJson(r.recurrence, null),
    assignee_ids: (a.get(r.id) || []).map((x) => x.user_id),
    tags: (g.get(r.id) || []).map((x) => ({ id: x.id, name: x.name, color: x.color })),
    depends_on: (d.get(r.id) || []).map((x) => x.depends_on_id),
  }));
}
