import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, now, transaction, getSetting, setSetting } from '../lib/dbx.js';
import { handler, HttpError, str } from '../lib/http.js';
import {
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  randomToken,
  requireAuth,
  sha256,
  userFromRequest,
  validatePassword,
  verifyPassword,
} from '../lib/auth.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { logActivity } from '../lib/activity.js';
import { publicUrl, workspaceInfo } from '../lib/workspace.js';
import { ensureGeneralChannel } from '../lib/chat.js';
import { AVATAR_COLORS } from '../lib/users.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_AUTH || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});

const userCount = () => db.get('SELECT COUNT(*) AS n FROM users').n;

router.get(
  '/status',
  handler((req, res) => {
    const user = userFromRequest(req);
    res.json({
      setupRequired: userCount() === 0,
      user: user ? meResponse(user) : null,
      workspace: workspaceInfo(),
      mailConfigured: mailConfigured(),
    });
  }),
);

/** Primer arranque: crea el espacio y la cuenta de administración. Solo funciona si no hay usuarios. */
router.post(
  '/setup',
  limiter,
  handler((req, res) => {
    const workspaceName = str(req.body.workspaceName, { field: 'Nombre de la empresa', max: 80 }) || 'Planta-Emporio';
    const name = str(req.body.name, { field: 'Nombre', required: true, max: 80 });
    const email = normalizeEmail(req.body.email);
    const currency = str(req.body.currency, { field: 'Moneda', max: 3 }) || 'MXN';
    validatePassword(req.body.password);
    const user = transaction(() => {
      if (userCount() > 0) throw new HttpError(409, 'El espacio ya fue configurado. Inicia sesión.');
      setSetting('workspace_name', workspaceName);
      setSetting('currency', currency.toUpperCase());
      const adminRole = db.get('SELECT id FROM roles WHERE is_system = 1');
      const id = db.insert('users', {
        name,
        email,
        password_hash: hashPassword(req.body.password),
        role_id: adminRole.id,
        avatar_color: AVATAR_COLORS[0],
        created_at: now(),
      });
      ensureGeneralChannel(id);
      logActivity({ actor: id, entityType: 'workspace', action: 'setup', summary: `creó el espacio ${workspaceName}` });
      return loadUser(id);
    });
    createSession(res, user.id, req.get('user-agent'));
    res.status(201).json({ user: meResponse(user) });
  }),
);

router.post(
  '/login',
  limiter,
  handler((req, res) => {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const row = db.get('SELECT id, password_hash, status FROM users WHERE email = ?', email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    if (row.status !== 'active') throw new HttpError(403, 'Tu cuenta está desactivada. Habla con un administrador.');
    createSession(res, row.id, req.get('user-agent'));
    res.json({ user: meResponse(loadUser(row.id)) });
  }),
);

router.post(
  '/logout',
  handler((req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  handler((req, res) => res.json({ user: meResponse(req.user) })),
);

router.post(
  '/change-password',
  requireAuth,
  limiter,
  handler((req, res) => {
    const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(req.body.current || ''), row.password_hash)) {
      throw new HttpError(400, 'La contraseña actual no es correcta.');
    }
    validatePassword(req.body.next);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), req.user.id);
    // Cierra las demás sesiones abiertas.
    db.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
    createSession(res, req.user.id, req.get('user-agent'));
    res.json({ ok: true });
  }),
);

// ───────── Invitaciones ─────────

function findInvitation(token) {
  const inv = db.get(
    `SELECT i.*, r.name AS role_name FROM invitations i JOIN roles r ON r.id = i.role_id WHERE i.token_hash = ?`,
    sha256(String(token)),
  );
  if (!inv || inv.revoked_at || inv.accepted_at || inv.expires_at < now()) {
    throw new HttpError(410, 'La invitación no es válida o ya expiró. Pide una nueva.');
  }
  return inv;
}

router.get(
  '/invite/:token',
  limiter,
  handler((req, res) => {
    const inv = findInvitation(req.params.token);
    res.json({ email: inv.email, name: inv.name, role: inv.role_name, workspace: workspaceInfo() });
  }),
);

router.post(
  '/invite/:token',
  limiter,
  handler((req, res) => {
    const name = str(req.body.name, { field: 'Nombre', required: true, max: 80 });
    validatePassword(req.body.password);
    const userId = transaction(() => {
      const inv = findInvitation(req.params.token);
      if (db.get('SELECT 1 FROM users WHERE email = ?', inv.email)) {
        throw new HttpError(409, 'Ya existe una cuenta con este correo. Inicia sesión.');
      }
      const count = db.get('SELECT COUNT(*) AS n FROM users').n;
      const id = db.insert('users', {
        name,
        email: inv.email,
        password_hash: hashPassword(req.body.password),
        role_id: inv.role_id,
        avatar_color: AVATAR_COLORS[count % AVATAR_COLORS.length],
        created_at: now(),
      });
      db.run('UPDATE invitations SET accepted_at = ?, accepted_user_id = ? WHERE id = ?', now(), id, inv.id);
      logActivity({ actor: id, entityType: 'user', entityId: id, action: 'joined', summary: `se unió al espacio` });
      return id;
    });
    createSession(res, userId, req.get('user-agent'));
    res.status(201).json({ user: meResponse(loadUser(userId)) });
  }),
);

// ───────── Recuperación de contraseña ─────────

export function createResetToken(userId, createdBy) {
  const token = randomToken();
  db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now(), userId);
  db.insert('password_resets', {
    user_id: userId,
    token_hash: sha256(token),
    created_by: createdBy,
    created_at: now(),
    expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  });
  return token;
}

router.post(
  '/forgot',
  limiter,
  handler(async (req, res) => {
    const email = String(req.body.email || '').trim();
    if (!mailConfigured()) {
      return res.json({
        mailConfigured: false,
        message:
          'El envío de correos no está configurado. Pide a un administrador que genere un enlace de recuperación desde Integrantes.',
      });
    }
    const user = db.get("SELECT id, name, email FROM users WHERE email = ? AND status = 'active'", email);
    if (user) {
      const token = createResetToken(user.id, null);
      await sendMail({
        to: user.email,
        subject: `Recupera tu acceso a ${getSetting('workspace_name')}`,
        text: `Hola ${user.name}:\n\nPara crear una nueva contraseña abre este enlace (válido por 2 horas):\n${publicUrl(req)}/reset/${token}\n\nSi no lo pediste, ignora este mensaje.`,
      });
    }
    // Misma respuesta exista o no la cuenta, para no revelar correos registrados.
    res.json({ mailConfigured: true, message: 'Si el correo está registrado, recibirás un enlace en unos minutos.' });
  }),
);

function findReset(token) {
  const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(String(token)));
  if (!row || row.used_at || row.expires_at < now()) {
    throw new HttpError(410, 'El enlace de recuperación no es válido o ya expiró.');
  }
  return row;
}

router.get(
  '/reset/:token',
  limiter,
  handler((req, res) => {
    const row = findReset(req.params.token);
    const user = db.get('SELECT name, email FROM users WHERE id = ?', row.user_id);
    res.json({ name: user.name, email: user.email });
  }),
);

router.post(
  '/reset/:token',
  limiter,
  handler((req, res) => {
    validatePassword(req.body.password);
    const userId = transaction(() => {
      const row = findReset(req.params.token);
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.password), row.user_id);
      db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', now(), row.id);
      db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
      return row.user_id;
    });
    const user = loadUser(userId);
    if (user.status !== 'active') throw new HttpError(403, 'Tu cuenta está desactivada.');
    createSession(res, userId, req.get('user-agent'));
    res.json({ user: meResponse(user) });
  }),
);

export function meResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    title: user.title,
    phone: user.phone,
    avatar_color: user.avatar_color,
    avatar_file_id: user.avatar_file_id,
    role_id: user.role_id,
    role_name: user.role_name,
    is_admin: user.is_admin,
    permissions: user.permissions,
    prefs: user.prefs,
  };
}

function normalizeEmail(value) {
  const email = str(value, { field: 'Correo', required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El correo no es válido.');
  return email;
}
export { normalizeEmail };

export default router;
