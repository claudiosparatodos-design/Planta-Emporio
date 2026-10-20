import { db } from './dbx.js';

export const AVATAR_COLORS = ['green', 'blue', 'purple', 'orange', 'pink', 'teal', 'brown', 'red', 'yellow'];

export const USER_FIELDS =
  'u.id, u.name, u.email, u.title, u.avatar_color, u.avatar_file_id, u.status, u.role_id, u.last_seen_at, u.created_at';

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    avatar_color: row.avatar_color,
    avatar_file_id: row.avatar_file_id,
    status: row.status,
    role_id: row.role_id,
    role_name: row.role_name,
    last_seen_at: row.last_seen_at,
  };
}

/** Usuarios (activos y desactivados) por id, con datos mínimos para mostrar. */
export function usersById(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = db.all(
    `SELECT id, name, avatar_color, avatar_file_id, status FROM users WHERE id IN (${list.map(() => '?').join(',')})`,
    ...list,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export function activeUserIds() {
  return db.all("SELECT id FROM users WHERE status = 'active'").map((r) => r.id);
}

export function userIdsWithPermission(permission) {
  return db
    .all("SELECT u.id, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'active'")
    .filter((r) => JSON.parse(r.permissions).includes(permission))
    .map((r) => r.id);
}
