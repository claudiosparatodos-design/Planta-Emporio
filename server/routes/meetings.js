import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, datetime, ids, int, notFound, oneOf, str } from '../lib/http.js';
import { canViewProject } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { notify } from '../lib/notify.js';
import { indexEntity, unindexEntity } from '../lib/search.js';
import { createTask, listTasks } from '../lib/tasks.js';
import { relatedEntities, attachmentsOf } from '../lib/entities.js';

const router = Router();

function getMeeting(user, id) {
  const m = db.get('SELECT * FROM meetings WHERE id = ?', id);
  if (!m || m.deleted_at || (m.project_id && !canViewProject(user, m.project_id))) throw notFound('La reunión');
  return m;
}

function reindex(id) {
  const m = db.get('SELECT * FROM meetings WHERE id = ?', id);
  indexEntity('meeting', id, m.title, [m.objective, m.agenda, m.notes, m.location].join('\n'));
}

function participants(ids) {
  if (!ids.length) return new Map();
  const rows = db.all(`SELECT meeting_id, user_id FROM meeting_participants WHERE meeting_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.meeting_id)) m.set(r.meeting_id, []);
    m.get(r.meeting_id).push(r.user_id);
  }
  return m;
}

router.get(
  '/',
  handler((req, res) => {
    const where = ['m.deleted_at IS NULL'];
    const params = [];
    if (req.query.from) {
      where.push('m.starts_at >= ?');
      params.push(new Date(String(req.query.from)).toISOString());
    }
    if (req.query.to) {
      where.push('m.starts_at <= ?');
      params.push(new Date(String(req.query.to)).toISOString());
    }
    if (req.query.project_id) {
      where.push('m.project_id = ?');
      params.push(Number(req.query.project_id));
    }
    const rows = db
      .all(
        `SELECT m.*, p.name AS project_name,
          (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id AND t.deleted_at IS NULL) AS action_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.meeting_id = m.id AND t.deleted_at IS NULL AND t.status <> 'done') AS open_actions,
          (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id AND d.deleted_at IS NULL) AS decision_count
         FROM meetings m LEFT JOIN projects p ON p.id = m.project_id WHERE ${where.join(' AND ')} ORDER BY m.starts_at DESC LIMIT 500`,
        ...params,
      )
      .filter((m) => !m.project_id || canViewProject(req.user, m.project_id));
    const parts = participants(rows.map((r) => r.id));
    res.json(rows.map((r) => ({ ...r, participant_ids: parts.get(r.id) || [] })));
  }),
);

function readInput(b, creating) {
  return {
    title: creating || b.title !== undefined ? str(b.title, { field: 'El título', required: true, max: 200 }) : undefined,
    starts_at: creating || b.starts_at !== undefined ? datetime(b.starts_at, 'La fecha y hora') : undefined,
    ends_at: datetime(b.ends_at, 'La hora de término'),
    location: str(b.location, { field: 'El lugar', max: 300 }),
    objective: str(b.objective, { field: 'El objetivo', max: 2000 }),
    agenda: str(b.agenda, { field: 'La agenda', max: 20000, trim: false }),
    notes: str(b.notes, { field: 'Las notas', max: 100000, trim: false }),
    status: oneOf(b.status, ['scheduled', 'done', 'cancelled'], 'Estado'),
    project_id: int(b.project_id, { field: 'Proyecto', min: 1 }),
  };
}

router.post(
  '/',
  handler((req, res) => {
    const data = readInput(req.body, true);
    if (!data.starts_at) throw new HttpError(400, 'La fecha y hora es obligatoria.');
    if (data.ends_at && data.ends_at < data.starts_at) throw new HttpError(400, 'La hora de término debe ser posterior al inicio.');
    if (data.project_id && !canViewProject(req.user, data.project_id)) throw new HttpError(400, 'El proyecto no existe.');
    const people = ids(req.body.participant_ids, 'Participantes') || [];
    const id = transaction(() => {
      const ts = now();
      const mid = db.insert('meetings', { ...data, created_by: req.user.id, created_at: ts, updated_at: ts });
      for (const uid of new Set([req.user.id, ...people])) db.run('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)', mid, uid);
      reindex(mid);
      logActivity({ actor: req.user, entityType: 'meeting', entityId: mid, projectId: data.project_id ?? null, action: 'created', summary: `programó la reunión «${data.title}»` });
      return mid;
    });
    notify({
      userIds: people,
      type: 'meeting',
      title: `${req.user.name} te invitó a «${data.title}»`,
      body: new Date(data.starts_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
      link: `/meetings/${id}`,
      actorId: req.user.id,
      entityType: 'meeting',
      entityId: id,
    });
    emit(['meetings', 'dashboard', 'calendar']);
    res.status(201).json({ id });
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const m = getMeeting(req.user, Number(req.params.id));
    const decisions = db.all('SELECT * FROM decisions WHERE meeting_id = ? AND deleted_at IS NULL ORDER BY id', m.id);
    res.json({
      ...m,
      project: m.project_id ? db.get('SELECT id, name, icon, color FROM projects WHERE id = ?', m.project_id) : null,
      participant_ids: participants([m.id]).get(m.id) || [],
      actions: listTasks(req.user, { meeting_id: m.id, include_done: true, include_subtasks: true }),
      decisions,
      related: relatedEntities(req.user, 'meeting', m.id).filter((r) => r.type !== 'file'),
      attachments: attachmentsOf(req.user, 'meeting', m.id),
    });
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    const m = getMeeting(req.user, Number(req.params.id));
    const data = readInput(req.body, false);
    if (data.project_id && !canViewProject(req.user, data.project_id)) throw new HttpError(400, 'El proyecto no existe.');
    transaction(() => {
      db.update('meetings', m.id, { ...data, updated_at: now() });
      if (req.body.participant_ids !== undefined) {
        const next = ids(req.body.participant_ids, 'Participantes');
        const current = participants([m.id]).get(m.id) || [];
        db.run('DELETE FROM meeting_participants WHERE meeting_id = ?', m.id);
        for (const uid of next) db.run('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)', m.id, uid);
        notify({ userIds: next.filter((u) => !current.includes(u)), type: 'meeting', title: `${req.user.name} te invitó a «${data.title || m.title}»`, link: `/meetings/${m.id}`, actorId: req.user.id, entityType: 'meeting', entityId: m.id });
      }
      reindex(m.id);
    });
    if (data.status === 'done' && m.status !== 'done') {
      logActivity({ actor: req.user, entityType: 'meeting', entityId: m.id, projectId: m.project_id, action: 'completed', summary: `cerró la reunión «${m.title}»` });
    } else if (data.starts_at && data.starts_at !== m.starts_at) {
      logActivity({ actor: req.user, entityType: 'meeting', entityId: m.id, projectId: m.project_id, action: 'rescheduled', summary: `reprogramó la reunión «${m.title}»` });
    }
    emit(['meetings', 'dashboard', 'calendar']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const m = getMeeting(req.user, Number(req.params.id));
    if (m.created_by !== req.user.id && !req.user.permissions.includes('projects.manage')) {
      throw new HttpError(403, 'Solo quien programó la reunión puede eliminarla.');
    }
    db.run('UPDATE meetings SET deleted_at = ? WHERE id = ?', now(), m.id);
    unindexEntity('meeting', m.id);
    logActivity({ actor: req.user, entityType: 'meeting', entityId: m.id, projectId: m.project_id, action: 'deleted', summary: `eliminó la reunión «${m.title}»` });
    emit(['meetings', 'dashboard', 'calendar', 'trash']);
    res.json({ ok: true });
  }),
);

/** Crea un acuerdo (tarea) que surge de la reunión. */
router.post(
  '/:id/actions',
  handler((req, res) => {
    const m = getMeeting(req.user, Number(req.params.id));
    const id = createTask(req.user, { ...req.body, meeting_id: m.id, project_id: req.body.project_id ?? m.project_id });
    res.status(201).json({ id });
  }),
);

export default router;
