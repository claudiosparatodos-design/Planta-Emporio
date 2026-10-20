import { db } from '../db/index.js';
import { HttpError } from './http.js';

/** Catálogo de permisos configurables por rol. */
export const PERMISSIONS = [
  { key: 'projects.create', label: 'Crear proyectos', group: 'Trabajo' },
  { key: 'projects.manage', label: 'Administrar todos los proyectos (editar, archivar, ver privados)', group: 'Trabajo' },
  { key: 'tasks.assign', label: 'Asignar tareas a otros integrantes', group: 'Trabajo' },
  { key: 'docs.edit', label: 'Crear y editar documentos', group: 'Trabajo' },
  { key: 'finance.view', label: 'Consultar toda la información financiera', group: 'Finanzas' },
  { key: 'finance.record', label: 'Registrar ingresos y gastos', group: 'Finanzas' },
  { key: 'finance.approve', label: 'Aprobar, anular movimientos y administrar presupuestos', group: 'Finanzas' },
  { key: 'members.manage', label: 'Invitar, desactivar y cambiar roles de integrantes', group: 'Administración' },
  { key: 'settings.manage', label: 'Modificar configuración, roles y automatizaciones', group: 'Administración' },
];

export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

export const DEFAULT_ROLES = [
  {
    name: 'Administrador',
    description: 'Acceso completo, incluida la configuración del espacio.',
    permissions: ALL_PERMISSIONS,
    is_system: 1,
  },
  {
    name: 'Socio',
    description: 'Gestiona proyectos y finanzas; no cambia la configuración.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'settings.manage' && p !== 'members.manage'),
    is_system: 0,
  },
  {
    name: 'Integrante',
    description: 'Trabaja en proyectos y documentos; registra sus gastos sin ver las finanzas completas.',
    permissions: ['projects.create', 'tasks.assign', 'docs.edit', 'finance.record'],
    is_system: 0,
  },
];

export function can(user, permission) {
  return Boolean(user && user.permissions && user.permissions.includes(permission));
}

export function requirePermission(user, permission) {
  if (!can(user, permission)) throw new HttpError(403, 'No tienes permiso para realizar esta acción.');
}

// ───────── Visibilidad de proyectos ─────────

/** Condición SQL que limita proyectos visibles. Usa el alias indicado. */
export function projectVisibilitySql(user, alias = 'p') {
  if (can(user, 'projects.manage')) return '1=1';
  return `(${alias}.visibility = 'workspace' OR ${alias}.owner_id = ${Number(user.id)} OR EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = ${alias}.id AND pm.user_id = ${Number(user.id)}))`;
}

/** Condición SQL para tareas: sin proyecto (visibles para todos) o en proyecto visible. */
export function taskVisibilitySql(user, alias = 't') {
  if (can(user, 'projects.manage')) return '1=1';
  return `(${alias}.project_id IS NULL OR EXISTS (SELECT 1 FROM projects vp WHERE vp.id = ${alias}.project_id
    AND ${projectVisibilitySql(user, 'vp')}))`;
}

export function canViewProject(user, projectOrId) {
  const project =
    typeof projectOrId === 'object' ? projectOrId : db.get('SELECT * FROM projects WHERE id = ?', projectOrId);
  if (!project) return false;
  if (can(user, 'projects.manage') || project.visibility === 'workspace') return true;
  if (project.owner_id === user.id) return true;
  return Boolean(db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', project.id, user.id));
}

export function canEditProject(user, project) {
  return can(user, 'projects.manage') || project.owner_id === user.id || project.created_by === user.id;
}

export function canViewTask(user, task) {
  if (!task) return false;
  return task.project_id == null || canViewProject(user, task.project_id);
}

export function canViewPage(user, page) {
  if (!page || page.deleted_at) return false;
  if (page.visibility === 'private' && page.created_by !== user.id) return false;
  if (page.project_id && !canViewProject(user, page.project_id)) return false;
  return true;
}

export function pageVisibilitySql(user, alias = 'pg') {
  const projectCheck = can(user, 'projects.manage')
    ? '1=1'
    : `(${alias}.project_id IS NULL OR EXISTS (SELECT 1 FROM projects vp WHERE vp.id = ${alias}.project_id AND ${projectVisibilitySql(user, 'vp')}))`;
  return `(${alias}.deleted_at IS NULL AND (${alias}.visibility = 'workspace' OR ${alias}.created_by = ${Number(user.id)}) AND ${projectCheck})`;
}

export function canViewFile(user, file) {
  if (!file || file.deleted_at) return false;
  if (file.uploaded_by === user.id) return true;
  if (file.visibility === 'private') return false;
  if (file.visibility === 'finance' && !can(user, 'finance.view')) return false;
  if (file.project_id && !canViewProject(user, file.project_id)) return false;
  return true;
}

export function canViewChannel(user, channel) {
  if (!channel) return false;
  if (channel.kind === 'dm') {
    return Boolean(db.get('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?', channel.id, user.id));
  }
  if (channel.kind === 'project') return canViewProject(user, channel.project_id);
  return true;
}
