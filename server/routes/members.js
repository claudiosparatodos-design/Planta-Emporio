import { Router } from 'express';
import { db, now, transaction, getSetting } from '../lib/dbx.js';
import { handler, HttpError, int, notFound, oneOf, str, parseJson } from '../lib/http.js';
import { ALL_PERMISSIONS, PERMISSIONS, can, requirePermission, taskVisibilitySql, projectVisibilitySql } from '../lib/permissions.js';
import { randomToken, sha256, loadUser } from '../lib/auth.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { publicUrl } from '../lib/workspace.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { publicUser, AVATAR_COLORS } from '../lib/users.js';
import { NOTIFICATION_TYPES } from '../lib/notify.js';
import { createResetToken, meResponse, normalizeEmail } from './auth.js';

const router = Router();

router.get(
  '/',
  handler((req, res) => {
    const rows = db.all(
      `SELECT u.*, r.name AS role_name,
        (SELECT COUNT(*) FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
          WHERE ta.user_id = u.id AND t.status <> 'done' AND t.deleted_at IS NULL) AS open_tasks
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.status, u.name COLLATE NOCASE`,
    );
    res.json(rows.map((r) => ({ ...publicUser(r), open_tasks: r.open_tasks })));
  }),
);

router.get(
  '/catalog',
  handler((req, res) => {
    res.json({ permissions: PERMISSIONS, notificationTypes: NOTIFICATION_TYPES, avatarColors: AVATAR_COLORS });
  }),
);

// ───────── Perfil propio ─────────
router.patch(
  '/me',
  handler((req, res) => {
    const b = req.body;
    const prefs = b.prefs !== undefined ? mergePrefs(req.user.prefs, b.prefs) : undefined;
    db.update('users', req.user.id, {
      name: b.name !== undefined ? str(b.name, { field: 'Nombre', required: true, max: 80 }) : undefined,
      title: str(b.title, { field: 'Puesto', max: 80 }),
      phone: str(b.phone, { field: 'Teléfono', max: 40 }),
      avatar_color: oneOf(b.avatar_color, AVATAR_COLORS, 'Color'),
      avatar_file_id: int(b.avatar_file_id, { field: 'Foto' }),
      prefs,
    });
    emit(['members']);
    res.json({ user: meResponse(loadUser(req.user.id)) });
  }),
);

const PREF_KEYS = ['theme', 'notifications', 'dashboard', 'sidebar', 'taskView', 'homeTab', 'projectView', 'financePeriod'];

function mergePrefs(current, patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new HttpError(400, 'Preferencias inválidas.');
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!PREF_KEYS.includes(k)) continue;
    next[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(current[k] || {}), ...v } : v;
  }
  const size = JSON.stringify(next).length;
  if (size > 20_000) throw new HttpError(400, 'Preferencias demasiado grandes.');
  return next;
}

// ───────── Roles ─────────
router.get(
  '/roles',
  handler((req, res) => {
    const roles = db.all(
      'SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users FROM roles r ORDER BY r.is_system DESC, r.id',
    );
    res.json(roles.map((r) => ({ ...r, permissions: parseJson(r.permissions, []) })));
  }),
);

function cleanPermissions(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Permisos inválidos.');
  return [...new Set(list.filter((p) => ALL_PERMISSIONS.includes(p)))];
}

router.post(
  '/roles',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const id = db.insert('roles', {
      name: str(req.body.name, { field: 'Nombre del rol', required: true, max: 40 }),
      description: str(req.body.description, { field: 'Descripción', max: 200 }) || '',
      permissions: cleanPermissions(req.body.permissions || []),
      created_at: now(),
    });
    logActivity({ actor: req.user, entityType: 'role', entityId: id, action: 'created', summary: `creó el rol ${req.body.name}` });
    res.status(201).json({ id });
  }),
);

router.patch(
  '/roles/:id',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const role = db.get('SELECT * FROM roles WHERE id = ?', req.params.id);
    if (!role) throw notFound('El rol');
    if (role.is_system && req.body.permissions) {
      throw new HttpError(400, 'El rol Administrador siempre conserva todos los permisos.');
    }
    db.update('roles', role.id, {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'Nombre', required: true, max: 40 }) : undefined,
      description: str(req.body.description, { field: 'Descripción', max: 200 }),
      permissions: req.body.permissions ? cleanPermissions(req.body.permissions) : undefined,
    });
    logActivity({
      actor: req.user,
      entityType: 'role',
      entityId: role.id,
      action: 'updated',
      summary: `modificó los permisos del rol ${role.name}`,
      data: req.body.permissions ? { from: parseJson(role.permissions, []), to: req.body.permissions } : null,
    });
    emit(['members', 'me']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/roles/:id',
  handler((req, res) => {
    requirePermission(req.user, 'settings.manage');
    const role = db.get('SELECT * FROM roles WHERE id = ?', req.params.id);
    if (!role) throw notFound('El rol');
    if (role.is_system) throw new HttpError(400, 'No se puede eliminar el rol Administrador.');
    if (db.get('SELECT 1 FROM users WHERE role_id = ?', role.id) || db.get('SELECT 1 FROM invitations WHERE role_id = ? AND accepted_at IS NULL AND revoked_at IS NULL', role.id)) {
      throw new HttpError(400, 'Hay integrantes o invitaciones con este rol. Cámbialos antes de eliminarlo.');
    }
    db.run('DELETE FROM roles WHERE id = ?', role.id);
    res.json({ ok: true });
  }),
);

// ───────── Invitaciones ─────────
router.get(
  '/invitations',
  handler((req, res) => {
    requirePermission(req.user, 'members.manage');
    const rows = db.all(
      `SELECT i.id, i.email, i.name, i.role_id, r.name AS role_name, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
              u.name AS invited_by_name
       FROM invitations i JOIN roles r ON r.id = i.role_id LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC`,
    );
    res.json(rows.map((r) => ({ ...r, expired: r.expires_at < now() })));
  }),
);

router.post(
  '/invitations',
  handler(async (req, res) => {
    requirePermission(req.user, 'members.manage');
    const email = normalizeEmail(req.body.email);
    const roleId = int(req.body.role_id, { field: 'Rol', min: 1, nullable: false });
    const role = db.get('SELECT * FROM roles WHERE id = ?', roleId);
    if (!role) throw new HttpError(400, 'El rol no existe.');
    if (role.is_system && !req.user.is_admin) throw new HttpError(403, 'Solo un administrador puede invitar administradores.');
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Esa persona ya tiene cuenta.');
    const token = randomToken();
    transaction(() => {
      db.run('UPDATE invitations SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL', now(), email);
      db.insert('invitations', {
        email,
        name: str(req.body.name, { field: 'Nombre', max: 80 }) || null,
        role_id: roleId,
        token_hash: sha256(token),
        invited_by: req.user.id,
        created_at: now(),
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
    });
    const link = `${publicUrl(req)}/invite/${token}`;
    let mail = { sent: false, reason: 'not_configured' };
    if (mailConfigured()) {
      mail = await sendMail({
        to: email,
        subject: `${req.user.name} te invitó a ${getSetting('workspace_name')}`,
        text: `Hola:\n\n${req.user.name} te invitó al espacio de trabajo de ${getSetting('workspace_name')}.\nCrea tu cuenta con este enlace (válido 7 días):\n${link}`,
      });
    }
    logActivity({ actor: req.user, entityType: 'user', action: 'invited', summary: `invitó a ${email} como ${role.name}` });
    res.status(201).json({ link, emailSent: mail.sent, expiresInDays: 7 });
  }),
);

router.delete(
  '/invitations/:id',
  handler((req, res) => {
    requirePermission(req.user, 'members.manage');
    db.run('UPDATE invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL', now(), req.params.id);
    res.json({ ok: true });
  }),
);

// ───────── Perfil de un integrante ─────────
router.get(
  '/:id',
  handler((req, res) => {
    const row = db.get(
      'SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
      req.params.id,
    );
    if (!row) throw notFound('El integrante');
    const tasks = db.all(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, p.name AS project_name
       FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id LEFT JOIN projects p ON p.id = t.project_id
       WHERE ta.user_id = ? AND t.deleted_at IS NULL AND t.status <> 'done' AND ${taskVisibilitySql(req.user, 't')}
       ORDER BY t.due_date IS NULL, t.due_date LIMIT 50`,
      row.id,
    );
    const projects = db.all(
      `SELECT p.id, p.name, p.icon, p.color, p.status FROM projects p
       WHERE p.deleted_at IS NULL AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))
       AND ${projectVisibilitySql(req.user, 'p')} ORDER BY p.name`,
      row.id,
      row.id,
    );
    res.json({ ...publicUser(row), phone: row.phone, tasks, projects });
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    requirePermission(req.user, 'members.manage');
    const target = loadUser(Number(req.params.id));
    if (!target) throw notFound('El integrante');
    const roleId = int(req.body.role_id, { field: 'Rol', min: 1 });
    const status = oneOf(req.body.status, ['active', 'disabled'], 'Estado');
    transaction(() => {
      if (roleId !== undefined) {
        const role = db.get('SELECT * FROM roles WHERE id = ?', roleId);
        if (!role) throw new HttpError(400, 'El rol no existe.');
        if ((role.is_system || target.is_admin) && !req.user.is_admin) {
          throw new HttpError(403, 'Solo un administrador puede cambiar roles de administración.');
        }
      }
      if (status === 'disabled' && target.id === req.user.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
      if (status === 'disabled' && target.is_admin && !req.user.is_admin) {
        throw new HttpError(403, 'Solo un administrador puede desactivar a otro administrador.');
      }
      db.update('users', target.id, {
        role_id: roleId,
        status,
        title: str(req.body.title, { field: 'Puesto', max: 80 }),
      });
      const admins = db.get(
        "SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_system = 1 AND u.status = 'active'",
      ).n;
      if (admins === 0) throw new HttpError(400, 'Debe existir al menos un administrador activo.');
      if (status === 'disabled') db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
    });
    const parts = [];
    if (roleId !== undefined && roleId !== target.role_id) parts.push('cambió el rol');
    if (status && status !== target.status) parts.push(status === 'disabled' ? 'desactivó la cuenta' : 'reactivó la cuenta');
    if (parts.length) {
      logActivity({ actor: req.user, entityType: 'user', entityId: target.id, action: 'updated', summary: `${parts.join(' y ')} de ${target.name}` });
    }
    emit(['members', 'me']);
    res.json({ ok: true });
  }),
);

/** Genera un enlace de recuperación para un integrante (útil si no hay correo configurado). */
router.post(
  '/:id/reset-link',
  handler((req, res) => {
    requirePermission(req.user, 'members.manage');
    const target = loadUser(Number(req.params.id));
    if (!target) throw notFound('El integrante');
    if (target.is_admin && !req.user.is_admin) throw new HttpError(403, 'Solo un administrador puede hacerlo.');
    const token = createResetToken(target.id, req.user.id);
    logActivity({ actor: req.user, entityType: 'user', entityId: target.id, action: 'reset_link', summary: `generó un enlace de recuperación para ${target.name}` });
    res.json({ link: `${publicUrl(req)}/reset/${token}`, expiresInHours: 2 });
  }),
);

export default router;
