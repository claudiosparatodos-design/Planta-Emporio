import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, int, notFound, oneOf, str } from '../lib/http.js';
import { can, canViewFile, canViewProject } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { indexEntity, unindexEntity } from '../lib/search.js';
import { addLink, entitySummary, fileView, ENTITY_TYPES } from '../lib/entities.js';
import { deleteFileRemote, fetchFileRemote, storeFileRemote } from '../lib/mirror.js';

const router = Router();
fs.mkdirSync(config.uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`),
  }),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 10 },
});

// Tipos que el navegador puede mostrar sin riesgo. El resto siempre se descarga.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm))$/;

const usedBytes = () => db.get('SELECT COALESCE(SUM(size), 0) AS n FROM files').n;

function getFile(user, id) {
  const f = db.get('SELECT f.*, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = ?', id);
  if (!canViewFile(user, f)) throw notFound('El archivo');
  return f;
}

function fixName(name) {
  // multer entrega el nombre en latin1; se recupera UTF-8 (acentos, ñ).
  try {
    const utf = Buffer.from(name, 'latin1').toString('utf8');
    return utf.includes('�') ? name : utf;
  } catch {
    return name;
  }
}

router.get(
  '/',
  handler((req, res) => {
    const where = ['f.deleted_at IS NULL'];
    const params = [];
    if (req.query.folder_id !== undefined && !req.query.q) {
      if (req.query.folder_id === 'root' || req.query.folder_id === '') where.push('f.folder_id IS NULL');
      else {
        where.push('f.folder_id = ?');
        params.push(Number(req.query.folder_id));
      }
    }
    if (req.query.project_id) {
      where.push('f.project_id = ?');
      params.push(Number(req.query.project_id));
    }
    if (req.query.q) {
      where.push('f.name LIKE ?');
      params.push(`%${String(req.query.q).slice(0, 100)}%`);
    }
    if (req.query.kind === 'image') where.push("f.mime LIKE 'image/%'");
    if (req.query.kind === 'pdf') where.push("f.mime = 'application/pdf'");
    const rows = db.all(
      `SELECT f.*, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT 500`,
      ...params,
    );
    res.json(rows.filter((f) => canViewFile(req.user, f)).map(fileView));
  }),
);

router.get(
  '/storage',
  handler((req, res) => {
    res.json({ used: usedBytes(), quota: config.storageQuotaMb * 1024 * 1024, maxFile: config.maxFileMb * 1024 * 1024 });
  }),
);

router.post(
  '/',
  upload.array('files', 10),
  handler(async (req, res) => {
    const files = req.files || [];
    const cleanup = () =>
      files.forEach((f) => {
        fs.rm(f.path, { force: true }, () => {});
        deleteFileRemote(path.basename(f.path)).catch(() => {});
      });
    try {
      if (!files.length) throw new HttpError(400, 'No se recibió ningún archivo.');
      const incoming = files.reduce((s, f) => s + f.size, 0);
      if (usedBytes() + incoming > config.storageQuotaMb * 1024 * 1024) {
        throw new HttpError(413, 'Se alcanzó el límite de almacenamiento del espacio. Elimina archivos que ya no necesites.');
      }
      const folderId = int(req.body.folder_id, { field: 'Carpeta', min: 1 }) ?? null;
      if (folderId && !db.get('SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NULL', folderId)) throw new HttpError(400, 'La carpeta no existe.');
      const projectId = int(req.body.project_id, { field: 'Proyecto', min: 1 }) ?? null;
      if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
      let visibility = oneOf(req.body.visibility || 'workspace', ['workspace', 'finance', 'private'], 'Visibilidad');
      const linkType = req.body.link_type ? oneOf(req.body.link_type, ENTITY_TYPES, 'Vínculo') : null;
      const linkId = int(req.body.link_id, { field: 'Vínculo', min: 1 }) ?? null;
      if (linkType) {
        if (!linkId || !entitySummary(req.user, linkType, linkId)) throw new HttpError(400, 'El elemento a vincular no existe.');
        if (linkType === 'transaction') visibility = 'finance'; // los comprobantes son información financiera
      }
      // Con respaldo en Turso, el archivo se guarda allí antes de confirmar la subida.
      try {
        for (const f of files) await storeFileRemote(path.basename(f.path), f.path);
      } catch (err) {
        console.error('[turso] Error al guardar archivo:', err.message);
        throw new HttpError(503, 'No se pudo guardar el archivo de forma permanente. Intenta de nuevo en un momento.');
      }
      const created = transaction(() =>
        files.map((f) => {
          const name = fixName(f.originalname).slice(0, 200);
          const id = db.insert('files', {
            folder_id: folderId,
            project_id: projectId,
            name,
            stored_name: path.basename(f.path),
            mime: (f.mimetype || 'application/octet-stream').slice(0, 120),
            size: f.size,
            visibility,
            uploaded_by: req.user.id,
            created_at: now(),
          });
          if (linkType) addLink(linkType, linkId, 'file', id, req.user.id);
          indexEntity('file', id, name, '');
          if (visibility === 'workspace') {
            logActivity({ actor: req.user, entityType: 'file', entityId: id, projectId, action: 'uploaded', summary: `subió el archivo «${name}»` });
          }
          return id;
        }),
      );
      emit(['files', 'tasks', 'pages', 'chat', 'finance', 'meetings', 'projects']);
      res.status(201).json(created.map((id) => fileView(getFile(req.user, id))));
    } catch (err) {
      cleanup();
      throw err;
    }
  }),
);

router.get(
  '/:id',
  handler((req, res) => {
    const f = getFile(req.user, Number(req.params.id));
    const links = db
      .all("SELECT a_type, a_id FROM links WHERE b_type = 'file' AND b_id = ?", f.id)
      .map((l) => entitySummary(req.user, l.a_type, l.a_id))
      .filter(Boolean);
    res.json({ ...fileView(f), linked: links, can_edit: f.uploaded_by === req.user.id || can(req.user, 'projects.manage') });
  }),
);

/** Contenido del archivo. Solo después de validar sesión y permisos. */
router.get(
  '/:id/raw',
  handler(async (req, res) => {
    const f = getFile(req.user, Number(req.params.id));
    const full = path.join(config.uploadsDir, path.basename(f.stored_name));
    if (!fs.existsSync(full) && !(await fetchFileRemote(path.basename(f.stored_name), full))) {
      throw new HttpError(404, 'El archivo ya no está disponible en el servidor.');
    }
    const inline = !req.query.download && INLINE_TYPES.test(f.mime);
    res.set({
      'Content-Type': inline ? f.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    // El visor de PDF del navegador no funciona dentro de un sandbox; el resto se aísla por completo.
    if (f.mime === 'application/pdf') res.removeHeader('Content-Security-Policy');
    else res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.sendFile(full);
  }),
);

router.patch(
  '/:id',
  handler((req, res) => {
    const f = getFile(req.user, Number(req.params.id));
    if (f.uploaded_by !== req.user.id && !can(req.user, 'projects.manage')) throw new HttpError(403, 'Solo quien subió el archivo puede modificarlo.');
    const name = req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 200 }) : undefined;
    const folderId = req.body.folder_id !== undefined ? int(req.body.folder_id, { field: 'Carpeta', min: 1 }) : undefined;
    const visibility = oneOf(req.body.visibility, ['workspace', 'finance', 'private'], 'Visibilidad');
    const projectId = req.body.project_id !== undefined ? int(req.body.project_id, { field: 'Proyecto', min: 1 }) : undefined;
    if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
    db.update('files', f.id, { name, folder_id: folderId, visibility, project_id: projectId });
    if (name) indexEntity('file', f.id, name, '');
    emit(['files']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  handler((req, res) => {
    const f = getFile(req.user, Number(req.params.id));
    if (f.uploaded_by !== req.user.id && !can(req.user, 'projects.manage')) throw new HttpError(403, 'Solo quien subió el archivo puede eliminarlo.');
    db.run('UPDATE files SET deleted_at = ? WHERE id = ?', now(), f.id);
    unindexEntity('file', f.id);
    logActivity({ actor: req.user, entityType: 'file', entityId: f.id, projectId: f.project_id, action: 'deleted', summary: `envió a la papelera el archivo «${f.name}»` });
    emit(['files', 'tasks', 'pages', 'trash', 'meetings', 'projects']);
    res.json({ ok: true });
  }),
);

// ───────── Carpetas ─────────
router.get(
  '/folders/all',
  handler((req, res) => {
    res.json(
      db.all(
        `SELECT fo.*, (SELECT COUNT(*) FROM files f WHERE f.folder_id = fo.id AND f.deleted_at IS NULL) AS file_count
         FROM folders fo WHERE fo.deleted_at IS NULL ORDER BY fo.name COLLATE NOCASE`,
      ),
    );
  }),
);

router.post(
  '/folders',
  handler((req, res) => {
    const parentId = int(req.body.parent_id, { field: 'Carpeta superior', min: 1 }) ?? null;
    const id = db.insert('folders', {
      name: str(req.body.name, { field: 'El nombre', required: true, max: 80 }),
      parent_id: parentId,
      created_by: req.user.id,
      created_at: now(),
    });
    emit(['files']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/folders/:id',
  handler((req, res) => {
    const folder = db.get('SELECT * FROM folders WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!folder) throw notFound('La carpeta');
    db.update('folders', folder.id, { name: str(req.body.name, { field: 'El nombre', required: true, max: 80 }) });
    emit(['files']);
    res.json({ ok: true });
  }),
);

router.delete(
  '/folders/:id',
  handler((req, res) => {
    const folder = db.get('SELECT * FROM folders WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!folder) throw notFound('La carpeta');
    if (db.get('SELECT 1 FROM files WHERE folder_id = ? AND deleted_at IS NULL', folder.id) || db.get('SELECT 1 FROM folders WHERE parent_id = ? AND deleted_at IS NULL', folder.id)) {
      throw new HttpError(400, 'La carpeta no está vacía. Mueve o elimina su contenido primero.');
    }
    db.run('UPDATE folders SET deleted_at = ? WHERE id = ?', now(), folder.id);
    emit(['files']);
    res.json({ ok: true });
  }),
);

export default router;
