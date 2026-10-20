import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, date, int, notFound, oneOf, str } from '../lib/http.js';
import { projectVisibilitySql, taskVisibilitySql } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { indexEntity, unindexEntity } from '../lib/search.js';

const router = Router();
const STATUSES = ['on_track', 'at_risk', 'off_track', 'achieved', 'dropped'];

function krProgress(kr) {
  const span = kr.target_value - kr.start_value;
  if (span === 0) return kr.current_value >= kr.target_value ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((kr.current_value - kr.start_value) / span) * 100)));
}

/** Progreso: promedio de indicadores; si no hay, avance de tareas de los proyectos vinculados. */
function decorate(user, goals) {
  return goals.map((g) => {
    const krs = db.all('SELECT * FROM key_results WHERE goal_id = ? ORDER BY position, id', g.id).map((k) => ({ ...k, progress: krProgress(k) }));
    const projects = db.all(
      `SELECT p.id, p.name, p.icon, p.color, p.status FROM projects p WHERE p.goal_id = ? AND p.deleted_at IS NULL AND ${projectVisibilitySql(user, 'p')}`,
      g.id,
    );
    const taskStats = db.get(
      `SELECT COUNT(*) AS total, SUM(t.status = 'done') AS done FROM tasks t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NULL AND ${taskVisibilitySql(user, 't')}
       AND (t.goal_id = ? OR t.project_id IN (SELECT id FROM projects WHERE goal_id = ? AND deleted_at IS NULL))`,
      g.id,
      g.id,
    );
    const taskProgress = taskStats.total ? Math.round(((taskStats.done || 0) / taskStats.total) * 100) : 0;
    const progress = krs.length ? Math.round(krs.reduce((s, k) => s + k.progress, 0) / krs.length) : taskProgress;
    return {
      ...g,
      key_results: krs,
      projects,
      task_stats: { total: taskStats.total, done: taskStats.done || 0 },
      progress,
      progress_source: krs.length ? 'key_results' : 'tasks',
    };
  });
}

function getGoal(id) {
  const g = db.get('SELECT * FROM goals WHERE id = ? AND deleted_at IS NULL', id);
  if (!g) throw notFound('El objetivo');
  return g;
}

router.get(
  '/',
  handler((req, res) => {
    const rows = db.all(
      `SELECT g.*, u.name AS owner_name FROM goals g LEFT JOIN users u ON u.id = g.owner_id WHERE g.deleted_at IS NULL
       ORDER BY CASE g.status WHEN 'achieved' THEN 1 WHEN 'dropped' THEN 2 ELSE 0 END, g.target_date IS NULL, g.target_date`,
    );
    res.json(decorate(req.user, rows));
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const g = getGoal(Number(req.params.id));
    const [full] = decorate(req.user, [g]);
    const tasks = db.all(
      `SELECT t.id, t.title, t.status, t.due_date FROM tasks t WHERE t.goal_id = ? AND t.deleted_at IS NULL AND ${taskVisibilitySql(req.user, 't')}`,
      g.id,
    );
    res.json({ ...full, tasks });
  }),
);

function readInput(b, creating) {
  return {
    title: creating || b.title !== undefined ? str(b.title, { field: 'El objetivo', required: true, max: 200 }) : undefined,
    description: str(b.description, { field: 'La descripción', max: 5000, trim: false }),
    period: str(b.period, { field: 'El periodo', max: 40 }),
    owner_id: int(b.owner_id, { field: 'Responsable', min: 1 }),
    start_date: date(b.start_date, 'Fecha de inicio'),
    target_date: date(b.target_date, 'Fecha objetivo'),
    status: oneOf(b.status, STATUSES, 'Estado'),
  };
}

router.post(
  '/',
  handler((req, res) => {
    const data = readInput(req.body, true);
    const id = transaction(() => {
      const ts = now();
      const gid = db.insert('goals', { ...data, owner_id: data.owner_id ?? req.user.id, created_by: req.user.id, created_at: ts, updated_at: ts });
      (Array.isArray(req.body.key_results) ? req.body.key_results : []).forEach((kr, i) => insertKr(gid, kr, i, req.user));
      indexEntity('goal', gid, data.title, data.description || '');
      logActivity({ actor: req.user, entityType: 'goal', entityId: gid, action: 'created', summary: `definió el objetivo «${data.title}»` });
      return gid;
    });
    emit(['goals', 'dashboard']);
    res.status(201).json({ id });
  }),
);

function insertKr(goalId, kr, i, user) {
  const n = (v, field, def) => {
    if (v === undefined || v === null || v === '') return def;
    const x = Number(v);
    if (!Number.isFinite(x)) throw new HttpError(400, `${field} no es un número válido.`);
    return x;
  };
  return db.insert('key_results', {
    goal_id: goalId,
    title: str(kr.title, { field: 'El indicador', required: true, max: 200 }),
    unit: str(kr.unit, { field: 'La unidad', max: 20 }) || '',
    start_value: n(kr.start_value, 'Valor inicial', 0),
    target_value: n(kr.target_value, 'Meta', 100),
    current_value: n(kr.current_value, 'Valor actual', n(kr.start_value, 'Valor inicial', 0)),
    position: (i + 1) * 1024,
    updated_by: user.id,
    updated_at: now(),
  });
}

router.patch(
  '/:id',
  handler((req, res) => {
    const g = getGoal(Number(req.params.id));
    const data = readInput(req.body, false);
    db.update('goals', g.id, { ...data, updated_at: now() });
    const updated = getGoal(g.id);
    indexEntity('goal', g.id, updated.title, updated.description);
    if (data.status && data.status !== g.status) {
      logActivity({ actor: req.user, entityType: 'goal', entityId: g.id, action: 'status', summary: `actualizó el estado del objetivo «${g.title}»` });
    }
    emit(['goals', 'dashboard']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const g = getGoal(Number(req.params.id));
    db.run('UPDATE goals SET deleted_at = ? WHERE id = ?', now(), g.id);
    db.run('UPDATE projects SET goal_id = NULL WHERE goal_id = ?', g.id);
    db.run('UPDATE tasks SET goal_id = NULL WHERE goal_id = ?', g.id);
    unindexEntity('goal', g.id);
    logActivity({ actor: req.user, entityType: 'goal', entityId: g.id, action: 'deleted', summary: `eliminó el objetivo «${g.title}»` });
    emit(['goals', 'projects', 'dashboard']);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/key-results',
  handler((req, res) => {
    const g = getGoal(Number(req.params.id));
    const count = db.get('SELECT COUNT(*) AS n FROM key_results WHERE goal_id = ?', g.id).n;
    const id = insertKr(g.id, req.body, count, req.user);
    emit(['goals', 'dashboard']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/key-results/:krId',
  handler((req, res) => {
    const kr = db.get('SELECT * FROM key_results WHERE id = ?', req.params.krId);
    if (!kr) throw notFound('El indicador');
    const g = getGoal(kr.goal_id);
    const num = (v, field) => {
      if (v === undefined) return undefined;
      const x = Number(v);
      if (!Number.isFinite(x)) throw new HttpError(400, `${field} no es un número válido.`);
      return x;
    };
    const current = num(req.body.current_value, 'Valor actual');
    db.update('key_results', kr.id, {
      title: req.body.title !== undefined ? str(req.body.title, { field: 'El indicador', required: true, max: 200 }) : undefined,
      unit: str(req.body.unit, { field: 'La unidad', max: 20 }),
      start_value: num(req.body.start_value, 'Valor inicial'),
      target_value: num(req.body.target_value, 'Meta'),
      current_value: current,
      updated_by: req.user.id,
      updated_at: now(),
    });
    if (current !== undefined && current !== kr.current_value) {
      logActivity({ actor: req.user, entityType: 'goal', entityId: g.id, action: 'progress', summary: `actualizó «${kr.title}» a ${current}${kr.unit ? ` ${kr.unit}` : ''}` });
    }
    emit(['goals', 'dashboard']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/key-results/:krId',
  handler((req, res) => {
    const kr = db.get('SELECT * FROM key_results WHERE id = ?', req.params.krId);
    if (!kr) throw notFound('El indicador');
    db.run('DELETE FROM key_results WHERE id = ?', kr.id);
    emit(['goals', 'dashboard']);
    res.json({ ok: true });
  }),
);

export default router;
