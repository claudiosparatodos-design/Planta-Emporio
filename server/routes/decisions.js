import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, bool, ids, int, notFound, oneOf, str } from '../lib/http.js';
import { can, canViewProject } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { notify } from '../lib/notify.js';
import { indexEntity, unindexEntity } from '../lib/search.js';
import { relatedEntities } from '../lib/entities.js';

const router = Router();

function getDecision(user, id) {
  const d = db.get('SELECT * FROM decisions WHERE id = ?', id);
  if (!d || d.deleted_at || (d.project_id && !canViewProject(user, d.project_id))) throw notFound('La decisión');
  return d;
}

function approversOf(idsList) {
  if (!idsList.length) return new Map();
  const rows = db.all(
    `SELECT da.*, u.name FROM decision_approvers da JOIN users u ON u.id = da.user_id WHERE da.decision_id IN (${idsList.map(() => '?').join(',')})`,
    ...idsList,
  );
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.decision_id)) m.set(r.decision_id, []);
    m.get(r.decision_id).push({ user_id: r.user_id, name: r.name, response: r.response, comment: r.comment, responded_at: r.responded_at });
  }
  return m;
}

const STATUS_TEXT = { approved: 'aprobada', rejected: 'rechazada', superseded: 'reemplazada', proposed: 'propuesta' };

router.get(
  '/',
  handler((req, res) => {
    const where = ['d.deleted_at IS NULL'];
    const params = [];
    if (req.query.status) {
      where.push('d.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.q) {
      where.push('(d.title LIKE ? OR d.description LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    if (req.query.mine_pending) {
      where.push("EXISTS (SELECT 1 FROM decision_approvers da WHERE da.decision_id = d.id AND da.user_id = ? AND da.response = 'pending') AND d.status = 'proposed'");
      params.push(req.user.id);
    }
    const rows = db
      .all(
        `SELECT d.*, p.name AS project_name, m.title AS meeting_title, u.name AS proposed_by_name
         FROM decisions d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN meetings m ON m.id = d.meeting_id
         LEFT JOIN users u ON u.id = d.proposed_by WHERE ${where.join(' AND ')} ORDER BY COALESCE(d.decided_at, d.created_at) DESC LIMIT 500`,
        ...params,
      )
      .filter((d) => !d.project_id || canViewProject(req.user, d.project_id));
    const apps = approversOf(rows.map((r) => r.id));
    res.json(rows.map((r) => ({ ...r, approvers: apps.get(r.id) || [] })));
  }),
);

router.post(
  '/',
  handler((req, res) => {
    const title = str(req.body.title, { field: 'La decisión', required: true, max: 300 });
    const description = str(req.body.description, { field: 'La descripción', max: 10000, trim: false }) || '';
    const meetingId = int(req.body.meeting_id, { field: 'Reunión', min: 1 }) ?? null;
    const projectId = int(req.body.project_id, { field: 'Proyecto', min: 1 }) ?? null;
    if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
    const approvers = (ids(req.body.approver_ids, 'Aprobadores') || []).filter((id) => db.get("SELECT 1 FROM users WHERE id = ? AND status = 'active'", id));
    // "Registrar como decidida" solo es posible sin aprobadores y es una confirmación explícita de quien la registra.
    const recordDecided = bool(req.body.record_as_decided) && approvers.length === 0;
    const id = transaction(() => {
      const ts = now();
      const did = db.insert('decisions', {
        title,
        description,
        meeting_id: meetingId,
        project_id: projectId,
        status: recordDecided ? 'approved' : 'proposed',
        decided_at: recordDecided ? ts : null,
        proposed_by: req.user.id,
        created_at: ts,
        updated_at: ts,
      });
      for (const uid of approvers) db.run('INSERT OR IGNORE INTO decision_approvers (decision_id, user_id) VALUES (?, ?)', did, uid);
      indexEntity('decision', did, title, description);
      logActivity({
        actor: req.user,
        entityType: 'decision',
        entityId: did,
        projectId,
        action: recordDecided ? 'decided' : 'proposed',
        summary: recordDecided ? `registró la decisión «${title}»` : `propuso la decisión «${title}»`,
      });
      return did;
    });
    notify({
      userIds: approvers,
      type: 'decision',
      title: `${req.user.name} pide tu aprobación: «${title}»`,
      link: `/decisions/${id}`,
      actorId: req.user.id,
      entityType: 'decision',
      entityId: id,
    });
    emit(['decisions', 'dashboard', 'meetings']);
    res.status(201).json({ id });
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const d = getDecision(req.user, Number(req.params.id));
    res.json({
      ...d,
      approvers: approversOf([d.id]).get(d.id) || [],
      project: d.project_id ? db.get('SELECT id, name, icon FROM projects WHERE id = ?', d.project_id) : null,
      meeting: d.meeting_id ? db.get('SELECT id, title, starts_at FROM meetings WHERE id = ?', d.meeting_id) : null,
      proposed_by_user: db.get('SELECT id, name, avatar_color FROM users WHERE id = ?', d.proposed_by),
      related: relatedEntities(req.user, 'decision', d.id),
    });
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    const d = getDecision(req.user, Number(req.params.id));
    if (d.proposed_by !== req.user.id && !can(req.user, 'projects.manage')) {
      throw new HttpError(403, 'Solo quien propuso la decisión puede editarla.');
    }
    const status = oneOf(req.body.status, ['superseded'], 'Estado');
    if (d.status !== 'proposed' && (req.body.title !== undefined || req.body.description !== undefined)) {
      throw new HttpError(400, 'Una decisión ya resuelta no se puede editar. Regístrala como reemplazada y crea una nueva.');
    }
    db.update('decisions', d.id, {
      title: req.body.title !== undefined ? str(req.body.title, { field: 'La decisión', required: true, max: 300 }) : undefined,
      description: str(req.body.description, { field: 'La descripción', max: 10000, trim: false }),
      status,
      updated_at: now(),
    });
    if (status) logActivity({ actor: req.user, entityType: 'decision', entityId: d.id, projectId: d.project_id, action: 'superseded', summary: `marcó como reemplazada la decisión «${d.title}»` });
    const updated = db.get('SELECT * FROM decisions WHERE id = ?', d.id);
    indexEntity('decision', d.id, updated.title, updated.description);
    emit(['decisions']);
    res.json({ ok: true });
  }),
);

/** Respuesta de un aprobador. La decisión se resuelve cuando todos aprueban o alguien la rechaza. */
router.post(
  '/:id/respond',
  handler((req, res) => {
    const d = getDecision(req.user, Number(req.params.id));
    if (d.status !== 'proposed') throw new HttpError(400, 'Esta decisión ya fue resuelta.');
    const response = oneOf(req.body.response, ['approved', 'rejected'], 'Respuesta');
    if (!response) throw new HttpError(400, 'Indica si apruebas o rechazas.');
    const row = db.get('SELECT * FROM decision_approvers WHERE decision_id = ? AND user_id = ?', d.id, req.user.id);
    if (!row) throw new HttpError(403, 'No eres aprobador de esta decisión.');
    let finalStatus = null;
    transaction(() => {
      db.run(
        'UPDATE decision_approvers SET response = ?, comment = ?, responded_at = ? WHERE decision_id = ? AND user_id = ?',
        response, str(req.body.comment, { field: 'Comentario', max: 1000 }) || null, now(), d.id, req.user.id,
      );
      const all = db.all('SELECT response FROM decision_approvers WHERE decision_id = ?', d.id);
      if (all.some((a) => a.response === 'rejected')) finalStatus = 'rejected';
      else if (all.every((a) => a.response === 'approved')) finalStatus = 'approved';
      if (finalStatus) db.update('decisions', d.id, { status: finalStatus, decided_at: now(), updated_at: now() });
      logActivity({
        actor: req.user,
        entityType: 'decision',
        entityId: d.id,
        projectId: d.project_id,
        action: response,
        summary: `${response === 'approved' ? 'aprobó' : 'rechazó'} la decisión «${d.title}»${finalStatus ? ` (queda ${STATUS_TEXT[finalStatus]})` : ''}`,
      });
    });
    if (finalStatus) {
      const people = db.all('SELECT user_id FROM decision_approvers WHERE decision_id = ?', d.id).map((r) => r.user_id);
      notify({ userIds: [d.proposed_by, ...people], type: 'decision', title: `La decisión «${d.title}» quedó ${STATUS_TEXT[finalStatus]}`, link: `/decisions/${d.id}`, actorId: req.user.id, entityType: 'decision', entityId: d.id });
    }
    emit(['decisions', 'dashboard', 'meetings']);
    res.json({ ok: true, status: finalStatus || 'proposed' });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const d = getDecision(req.user, Number(req.params.id));
    if (d.status !== 'proposed') throw new HttpError(400, 'Las decisiones resueltas se conservan como registro. Puedes marcarlas como reemplazadas.');
    if (d.proposed_by !== req.user.id && !can(req.user, 'projects.manage')) throw new HttpError(403, 'Solo quien propuso la decisión puede retirarla.');
    db.run('UPDATE decisions SET deleted_at = ? WHERE id = ?', now(), d.id);
    unindexEntity('decision', d.id);
    logActivity({ actor: req.user, entityType: 'decision', entityId: d.id, projectId: d.project_id, action: 'withdrawn', summary: `retiró la propuesta «${d.title}»` });
    emit(['decisions', 'dashboard']);
    res.json({ ok: true });
  }),
);

export default router;
