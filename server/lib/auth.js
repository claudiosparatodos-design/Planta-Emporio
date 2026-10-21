import crypto from 'node:crypto';
import { db, now } from './dbx.js';
import { config } from '../config.js';
import { HttpError, parseJson } from './http.js';

const SESSION_COOKIE = 'pe_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  }
  if (password.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.');
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * remember=false (equipos prestados o compartidos): la cookie se borra al cerrar el navegador
 * y la sesión caduca en el servidor a las 12 horas aunque el navegador siga abierto.
 */
export function createSession(res, userId, userAgent = '', { remember = true } = {}) {
  const token = randomToken();
  const expires = new Date(Date.now() + (remember ? config.sessionDays * 864e5 : 12 * 3600e3));
  db.insert('sessions', {
    id: sha256(token),
    user_id: userId,
    user_agent: String(userAgent).slice(0, 300),
    created_at: now(),
    last_used_at: now(),
    expires_at: expires.toISOString(),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production && !process.env.INSECURE_COOKIES,
    ...(remember ? { expires } : {}),
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Carga al usuario (con sus permisos) a partir de su id. */
export function loadUser(id) {
  const row = db.get(
    `SELECT u.*, r.name AS role_name, r.permissions AS role_permissions, r.is_system AS role_is_system
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    id,
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    phone: row.phone,
    avatar_color: row.avatar_color,
    avatar_file_id: row.avatar_file_id,
    status: row.status,
    role_id: row.role_id,
    role_name: row.role_name,
    is_admin: Boolean(row.role_is_system),
    permissions: parseJson(row.role_permissions, []),
    prefs: parseJson(row.prefs, {}),
    created_at: row.created_at,
  };
}

export function userFromRequest(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const session = db.get('SELECT * FROM sessions WHERE id = ?', sha256(token));
  if (!session || session.expires_at < now()) return null;
  const user = loadUser(session.user_id);
  if (!user || user.status !== 'active') return null;
  // Actualiza "último uso" como máximo una vez por minuto.
  if (Date.now() - Date.parse(session.last_used_at) > 60_000) {
    db.run('UPDATE sessions SET last_used_at = ? WHERE id = ?', now(), session.id);
    db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now(), user.id);
  }
  return user;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return next(new HttpError(401, 'Tu sesión expiró. Inicia sesión de nuevo.'));
  req.user = user;
  next();
}

/** Defensa CSRF adicional: las mutaciones deben venir de la aplicación (cabecera personalizada). */
export function requireClientHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-pe-client') !== '1') return next(new HttpError(403, 'Solicitud no permitida.'));
  next();
}
