import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, int, notFound, oneOf, str, bool, parseJson } from '../lib/http.js';
import { canViewPage, canViewProject, pageVisibilitySql, requirePermission } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { blocksToText, indexEntity, unindexEntity } from '../lib/search.js';
import { relatedEntities, attachmentsOf } from '../lib/entities.js';
import { notify, findMentions } from '../lib/notify.js';
import { usersById } from '../lib/users.js';

const router = Router();
const SNAPSHOT_MINUTES = 10;

function getPage(user, id) {
  const page = db.get('SELECT * FROM pages WHERE id = ?', id);
  if (!canViewPage(user, page)) throw notFound('La página');
  return page;
}

function requireEdit(user, page) {
  requirePermission(user, 'docs.edit');
  if (page.visibility === 'private' && page.created_by !== user.id) throw new HttpError(403, 'Esta página es privada.');
}

function parseContent(value) {
  if (value === undefined) return undefined;
  const blocks = typeof value === 'string' ? parseJson(value, null) : value;
  if (!Array.isArray(blocks)) throw new HttpError(400, 'El contenido del documento no es válido.');
  const json = JSON.stringify(blocks);
  if (json.length > 4_000_000) throw new HttpError(413, 'El documento es demasiado grande.');
  return { json, text: blocksToText(blocks) };
}

const notifyPage = (page) =>
  emit(['pages'], { data: { pageId: page.id }, filter: (u) => canViewPage(u, page) });

router.get(
  '/',
  handler((req, res) => {
    const templates = bool(req.query.templates);
    const where = [pageVisibilitySql(req.user, 'pg'), `pg.is_template = ${templates ? 1 : 0}`];
    const params = [];
    if (req.query.project_id) {
      where.push('pg.project_id = ?');
      params.push(Number(req.query.project_id));
    }
    const rows = db.all(
      `SELECT pg.id, pg.parent_id, pg.title, pg.icon, pg.project_id, pg.visibility, pg.position, pg.template_category,
              pg.created_by, pg.updated_by, pg.created_at, pg.updated_at, substr(pg.content_text, 1, 180) AS preview
       FROM pages pg WHERE ${where.join(' AND ')} ORDER BY pg.position, pg.created_at`,
      ...params,
    );
    res.json(rows);
  }),
);

router.post(
  '/',
  handler((req, res) => {
    requirePermission(req.user, 'docs.edit');
    const b = req.body;
    const parentId = int(b.parent_id, { field: 'Página superior', min: 1 }) ?? null;
    let projectId = int(b.project_id, { field: 'Proyecto', min: 1 }) ?? null;
    if (parentId) {
      const parent = getPage(req.user, parentId);
      if (projectId == null) projectId = parent.project_id;
    }
    if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
    let content = parseContent(b.content) || { json: '[]', text: '' };
    let title = str(b.title, { field: 'El título', max: 200 }) ?? '';
    let icon = str(b.icon, { field: 'Ícono', max: 16 }) ?? null;
    const templateId = int(b.template_id, { field: 'Plantilla', min: 1 });
    if (templateId) {
      const tpl = getPage(req.user, templateId);
      if (!tpl.is_template) throw new HttpError(400, 'La página elegida no es una plantilla.');
      content = { json: tpl.content, text: tpl.content_text };
      if (!title) title = tpl.title;
      icon = icon ?? tpl.icon;
    }
    const ts = now();
    const max = db.get('SELECT MAX(position) AS m FROM pages WHERE parent_id IS ?', parentId).m || 0;
    const id = db.insert('pages', {
      parent_id: parentId,
      title,
      icon,
      content: content.json,
      content_text: content.text,
      project_id: projectId,
      visibility: oneOf(b.visibility, ['workspace', 'private'], 'Visibilidad') || 'workspace',
      is_template: bool(b.is_template) ? 1 : 0,
      template_category: str(b.template_category, { field: 'Categoría', max: 40 }) || null,
      position: max + 1024,
      created_by: req.user.id,
      updated_by: req.user.id,
      created_at: ts,
      updated_at: ts,
    });
    indexEntity('page', id, title, content.text);
    const page = db.get('SELECT * FROM pages WHERE id = ?', id);
    if (page.visibility === 'workspace') {
      logActivity({ actor: req.user, entityType: 'page', entityId: id, projectId, action: 'created', summary: `creó el documento «${title || 'Sin título'}»` });
    }
    notifyPage(page);
    res.status(201).json(page);
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const page = getPage(req.user, Number(req.params.id));
    const crumbs = [];
    let cur = page.parent_id;
    const guard = new Set();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const p = db.get('SELECT id, title, icon, parent_id, visibility, created_by, project_id, deleted_at FROM pages WHERE id = ?', cur);
      if (!p || !canViewPage(req.user, p)) break;
      crumbs.unshift({ id: p.id, title: p.title, icon: p.icon });
      cur = p.parent_id;
    }
    const children = db.all(
      `SELECT pg.id, pg.title, pg.icon, pg.updated_at FROM pages pg WHERE pg.parent_id = ? AND ${pageVisibilitySql(req.user, 'pg')} ORDER BY pg.position`,
      page.id,
    );
    const users = usersById([page.created_by, page.updated_by]);
    const project = page.project_id ? db.get('SELECT id, name, icon, color FROM projects WHERE id = ?', page.project_id) : null;
    // Páginas que mencionan a esta (enlaces internos dentro del contenido).
    const backlinks = db
      .all(
        `SELECT pg.id, pg.title, pg.icon FROM pages pg WHERE pg.id <> ? AND pg.content LIKE ? AND ${pageVisibilitySql(req.user, 'pg')} LIMIT 20`,
        page.id,
        `%/docs/${page.id}"%`,
      );
    res.json({
      ...page,
      content: parseJson(page.content, []),
      breadcrumbs: crumbs,
      children,
      project,
      created_by_user: users.get(page.created_by) || null,
      updated_by_user: users.get(page.updated_by) || null,
      related: relatedEntities(req.user, 'page', page.id).filter((r) => r.type !== 'file'),
      attachments: attachmentsOf(req.user, 'page', page.id),
      backlinks,
    });
  }),
);

/**
 * Guarda cambios. Si se envía base_version y no coincide con la versión actual,
 * responde 409 para no sobrescribir el trabajo de otra persona.
 */
router.patch(
  '/:id',
  handler((req, res) => {
    const b = req.body;
    const result = transaction(() => {
      const page = getPage(req.user, Number(req.params.id));
      requireEdit(req.user, page);
      const content = parseContent(b.content);
      const title = b.title !== undefined ? str(b.title, { field: 'El título', max: 200 }) ?? '' : undefined;
      const changesBody = content !== undefined || title !== undefined;
      if (changesBody && b.base_version !== undefined && Number(b.base_version) !== page.version) {
        const editor = usersById([page.updated_by]).get(page.updated_by);
        throw new HttpError(409, `${editor?.name || 'Otra persona'} guardó cambios en esta página mientras editabas.`, {
          version: page.version,
          updated_by: editor?.name,
          updated_at: page.updated_at,
        });
      }
      let parentId;
      if (b.parent_id !== undefined) {
        parentId = int(b.parent_id, { field: 'Página superior', min: 1 }) ?? null;
        // Evitar ciclos en la jerarquía.
        let cur = parentId;
        while (cur) {
          if (cur === page.id) throw new HttpError(400, 'No puedes mover una página dentro de sí misma.');
          cur = db.get('SELECT parent_id FROM pages WHERE id = ?', cur)?.parent_id;
        }
        if (parentId) getPage(req.user, parentId);
      }
      let projectId;
      if (b.project_id !== undefined) {
        projectId = int(b.project_id, { field: 'Proyecto', min: 1 }) ?? null;
        if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
      }
      const visibility = oneOf(b.visibility, ['workspace', 'private'], 'Visibilidad');
      if (visibility && visibility !== page.visibility && page.created_by !== req.user.id) {
        throw new HttpError(403, 'Solo quien creó la página puede cambiar su visibilidad.');
      }
      // Instantánea de la versión anterior para poder restaurarla.
      if (changesBody) {
        const last = db.get('SELECT * FROM page_versions WHERE page_id = ? ORDER BY id DESC LIMIT 1', page.id);
        const old = !last || Date.now() - Date.parse(last.created_at) > SNAPSHOT_MINUTES * 60_000 || last.user_id !== page.updated_by;
        if (old && page.content !== '[]') {
          db.insert('page_versions', { page_id: page.id, version: page.version, title: page.title, content: page.content, user_id: page.updated_by, created_at: page.updated_at });
        }
      }
      db.update('pages', page.id, {
        title,
        icon: b.icon !== undefined ? str(b.icon, { field: 'Ícono', max: 16 }) || null : undefined,
        content: content?.json,
        content_text: content?.text,
        parent_id: parentId,
        project_id: projectId,
        visibility,
        template_category: b.template_category !== undefined ? str(b.template_category, { field: 'Categoría', max: 40 }) || null : undefined,
        position: b.position !== undefined ? Number(b.position) : undefined,
        version: changesBody ? page.version + 1 : undefined,
        updated_by: changesBody ? req.user.id : undefined,
        updated_at: changesBody ? now() : undefined,
      });
      const updated = db.get('SELECT * FROM pages WHERE id = ?', page.id);
      indexEntity('page', page.id, updated.title, updated.content_text);
      if (content) {
        // Menciones nuevas en el documento
        const before = new Set(findMentions(page.content));
        const mentioned = findMentions(content.json).filter((id) => !before.has(id));
        if (mentioned.length && updated.visibility === 'workspace') {
          notify({ userIds: mentioned, type: 'mention', title: `${req.user.name} te mencionó en «${updated.title || 'Sin título'}»`, link: `/docs/${page.id}`, actorId: req.user.id, entityType: 'page', entityId: page.id });
        }
        const lastLog = db.get("SELECT created_at, actor_id FROM activity WHERE entity_type = 'page' AND entity_id = ? ORDER BY id DESC LIMIT 1", page.id);
        const recent = lastLog && lastLog.actor_id === req.user.id && Date.now() - Date.parse(lastLog.created_at) < 30 * 60_000;
        if (!recent && updated.visibility === 'workspace') {
          logActivity({ actor: req.user, entityType: 'page', entityId: page.id, projectId: updated.project_id, action: 'edited', summary: `editó el documento «${updated.title || 'Sin título'}»` });
        }
      }
      return updated;
    });
    notifyPage(result);
    res.json({ id: result.id, version: result.version, updated_at: result.updated_at });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const page = getPage(req.user, Number(req.params.id));
    requireEdit(req.user, page);
    const ts = now();
    // Envía a la papelera la página y sus subpáginas.
    const all = [page.id];
    for (let i = 0; i < all.length; i++) {
      for (const c of db.all('SELECT id FROM pages WHERE parent_id = ? AND deleted_at IS NULL', all[i])) all.push(c.id);
    }
    for (const id of all) {
      db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', ts, id);
      unindexEntity('page', id);
    }
    logActivity({ actor: req.user, entityType: 'page', entityId: page.id, projectId: page.project_id, action: 'deleted', summary: `envió a la papelera «${page.title || 'Sin título'}»${all.length > 1 ? ` y ${all.length - 1} subpágina(s)` : ''}` });
    emit(['pages', 'trash']);
    res.json({ ok: true, count: all.length });
  }),
);

router.post(
  '/:id/duplicate',
  handler((req, res) => {
    requirePermission(req.user, 'docs.edit');
    const page = getPage(req.user, Number(req.params.id));
    const ts = now();
    const asTemplate = bool(req.body.as_template);
    const id = db.insert('pages', {
      parent_id: asTemplate ? null : page.parent_id,
      title: asTemplate ? page.title : `${page.title || 'Sin título'} (copia)`,
      icon: page.icon,
      content: page.content,
      content_text: page.content_text,
      project_id: asTemplate ? null : page.project_id,
      visibility: page.visibility,
      is_template: asTemplate ? 1 : page.is_template,
      template_category: asTemplate ? str(req.body.template_category, { max: 40 }) || 'General' : page.template_category,
      position: page.position + 1,
      created_by: req.user.id,
      updated_by: req.user.id,
      created_at: ts,
      updated_at: ts,
    });
    indexEntity('page', id, page.title, page.content_text);
    emit(['pages']);
    res.status(201).json({ id });
  }),
);

router.get(
  '/:id/versions',
  handler((req, res) => {
    const page = getPage(req.user, Number(req.params.id));
    const rows = db.all('SELECT id, version, title, user_id, created_at, length(content) AS size FROM page_versions WHERE page_id = ? ORDER BY id DESC LIMIT 100', page.id);
    const users = usersById(rows.map((r) => r.user_id));
    res.json(rows.map((r) => ({ ...r, user: users.get(r.user_id) || null })));
  }),
);

router.get(
  '/:id/versions/:versionId',
  handler((req, res) => {
    const page = getPage(req.user, Number(req.params.id));
    const v = db.get('SELECT * FROM page_versions WHERE id = ? AND page_id = ?', req.params.versionId, page.id);
    if (!v) throw notFound('La versión');
    res.json({ ...v, content: parseJson(v.content, []) });
  }),
);

router.post(
  '/:id/versions/:versionId/restore',
  handler((req, res) => {
    const page = getPage(req.user, Number(req.params.id));
    requireEdit(req.user, page);
    const v = db.get('SELECT * FROM page_versions WHERE id = ? AND page_id = ?', req.params.versionId, page.id);
    if (!v) throw notFound('La versión');
    transaction(() => {
      db.insert('page_versions', { page_id: page.id, version: page.version, title: page.title, content: page.content, user_id: page.updated_by, created_at: page.updated_at });
      const text = blocksToText(parseJson(v.content, []));
      db.update('pages', page.id, { title: v.title, content: v.content, content_text: text, version: page.version + 1, updated_by: req.user.id, updated_at: now() });
      indexEntity('page', page.id, v.title, text);
    });
    logActivity({ actor: req.user, entityType: 'page', entityId: page.id, projectId: page.project_id, action: 'restored_version', summary: `restauró una versión anterior de «${page.title || 'Sin título'}»` });
    notifyPage(page);
    res.json({ ok: true });
  }),
);

export default router;
