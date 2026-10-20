import { Router } from 'express';
import { db, now, transaction } from '../lib/dbx.js';
import { handler, HttpError, ids, int, notFound, str } from '../lib/http.js';
import { canViewChannel, canViewFile } from '../lib/permissions.js';
import { emit } from '../lib/events.js';
import { notify, findMentions } from '../lib/notify.js';
import { indexEntity, unindexEntity, searchIndex } from '../lib/search.js';
import { addLink, fileView } from '../lib/entities.js';
import { usersById } from '../lib/users.js';

const router = Router();

function getChannel(user, id) {
  const c = db.get('SELECT * FROM channels WHERE id = ?', id);
  if (!c || !canViewChannel(user, c)) throw notFound('La conversación');
  if (c.kind === 'project') {
    const p = db.get('SELECT deleted_at FROM projects WHERE id = ?', c.project_id);
    if (!p || p.deleted_at) throw notFound('La conversación');
  }
  return c;
}

const channelAudience = (channel) => (u) => canViewChannel(u, channel);

router.get(
  '/channels',
  handler((req, res) => {
    const all = db.all(
      `SELECT c.*, p.icon AS project_icon, p.color AS project_color, p.status AS project_status,
        (SELECT MAX(id) FROM messages m WHERE m.channel_id = c.id AND m.deleted_at IS NULL) AS last_id
       FROM channels c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.archived_at IS NULL AND (c.kind <> 'project' OR p.deleted_at IS NULL)`,
    );
    const visible = all.filter((c) => canViewChannel(req.user, c));
    const reads = new Map(
      db.all('SELECT channel_id, last_read_id FROM channel_members WHERE user_id = ?', req.user.id).map((r) => [r.channel_id, r.last_read_id]),
    );
    const dmMembers = db.all(
      `SELECT cm.channel_id, cm.user_id FROM channel_members cm JOIN channels c ON c.id = cm.channel_id WHERE c.kind = 'dm'`,
    );
    const users = usersById(dmMembers.map((m) => m.user_id));
    const out = visible.map((c) => {
      const lastRead = reads.get(c.id) || 0;
      const unread = c.last_id && c.last_id > lastRead
        ? db.get('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id > ? AND user_id <> ? AND deleted_at IS NULL', c.id, lastRead, req.user.id).n
        : 0;
      const last = c.last_id ? db.get('SELECT m.body, m.created_at, m.user_id FROM messages m WHERE m.id = ?', c.last_id) : null;
      let name = c.name;
      let other = null;
      if (c.kind === 'dm') {
        const otherId = dmMembers.find((m) => m.channel_id === c.id && m.user_id !== req.user.id)?.user_id;
        other = users.get(otherId) || null;
        name = other?.name || 'Mensaje directo';
      }
      return { id: c.id, kind: c.kind, name, description: c.description, project_id: c.project_id, project_icon: c.project_icon, project_color: c.project_color, project_status: c.project_status, other_user: other, unread, last_message: last, last_id: c.last_id || 0 };
    });
    const order = { general: 0, topic: 1, project: 2, dm: 3 };
    out.sort((a, b) => order[a.kind] - order[b.kind] || (b.last_id - a.last_id) || a.name.localeCompare(b.name));
    res.json(out);
  }),
);

router.post(
  '/channels',
  handler((req, res) => {
    const id = db.insert('channels', {
      kind: 'topic',
      name: str(req.body.name, { field: 'El nombre', required: true, max: 60 }),
      description: str(req.body.description, { field: 'La descripción', max: 200 }) || '',
      created_by: req.user.id,
      created_at: now(),
    });
    emit(['chat']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/channels/:id',
  handler((req, res) => {
    const c = getChannel(req.user, Number(req.params.id));
    if (c.kind !== 'topic') throw new HttpError(400, 'Solo se pueden editar los canales de tema.');
    db.update('channels', c.id, {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 60 }) : undefined,
      description: str(req.body.description, { field: 'La descripción', max: 200 }),
      archived_at: req.body.archived ? now() : undefined,
    });
    emit(['chat']);
    res.json({ ok: true });
  }),
);

/** Obtiene o crea la conversación directa con otro integrante. */
router.post(
  '/dm',
  handler((req, res) => {
    const otherId = int(req.body.user_id, { field: 'Integrante', min: 1, nullable: false });
    if (otherId === req.user.id) throw new HttpError(400, 'Elige a otro integrante.');
    const other = db.get("SELECT id, name FROM users WHERE id = ? AND status = 'active'", otherId);
    if (!other) throw new HttpError(400, 'El integrante no existe.');
    const key = [req.user.id, otherId].sort((a, b) => a - b).join(':');
    const id = transaction(() => {
      const existing = db.get('SELECT id FROM channels WHERE dm_key = ?', key);
      if (existing) return existing.id;
      const cid = db.insert('channels', { kind: 'dm', name: 'Mensaje directo', dm_key: key, created_by: req.user.id, created_at: now() });
      db.run('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?), (?, ?)', cid, req.user.id, cid, otherId);
      return cid;
    });
    emit(['chat'], { userIds: [req.user.id, otherId] });
    res.json({ id });
  }),
);

function decorateMessages(user, rows) {
  if (!rows.length) return [];
  const users = usersById(rows.map((r) => r.user_id));
  const idsList = rows.map((r) => r.id);
  const files = db.all(
    `SELECT l.a_id AS message_id, f.* FROM links l JOIN files f ON f.id = l.b_id
     WHERE l.a_type = 'message' AND l.b_type = 'file' AND l.a_id IN (${idsList.map(() => '?').join(',')}) AND f.deleted_at IS NULL`,
    ...idsList,
  );
  const replyIds = rows.map((r) => r.reply_to_id).filter(Boolean);
  const replies = replyIds.length
    ? new Map(
        db.all(`SELECT id, user_id, body, deleted_at FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`, ...replyIds).map((r) => [r.id, r]),
      )
    : new Map();
  const replyUsers = usersById([...replies.values()].map((r) => r.user_id));
  return rows.map((m) => {
    const reply = m.reply_to_id ? replies.get(m.reply_to_id) : null;
    return {
      id: m.id,
      channel_id: m.channel_id,
      user_id: m.user_id,
      user: users.get(m.user_id) || null,
      body: m.deleted_at ? '' : m.body,
      deleted: Boolean(m.deleted_at),
      reply_to: reply ? { id: reply.id, user_name: replyUsers.get(reply.user_id)?.name, body: reply.deleted_at ? 'Mensaje eliminado' : reply.body.slice(0, 160) } : null,
      created_at: m.created_at,
      edited_at: m.edited_at,
      attachments: m.deleted_at ? [] : files.filter((f) => f.message_id === m.id && canViewFile(user, f)).map(fileView),
    };
  });
}

router.get(
  '/channels/:id/messages',
  handler((req, res) => {
    const c = getChannel(req.user, Number(req.params.id));
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const before = int(req.query.before, { field: 'Cursor', min: 1 });
    const around = int(req.query.around, { field: 'Mensaje', min: 1 });
    let rows;
    if (around) {
      rows = db.all(
        `SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND id <= ? ORDER BY id DESC LIMIT 25)
         UNION SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id LIMIT 25) ORDER BY id`,
        c.id, around, c.id, around,
      );
    } else {
      rows = db
        .all(
          `SELECT * FROM messages WHERE channel_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
          ...(before ? [c.id, before, limit] : [c.id, limit]),
        )
        .reverse();
    }
    const member = db.get('SELECT last_read_id FROM channel_members WHERE channel_id = ? AND user_id = ?', c.id, req.user.id);
    res.json({ messages: decorateMessages(req.user, rows), has_more: rows.length >= limit && !around, last_read_id: member?.last_read_id || 0 });
  }),
);

router.post(
  '/channels/:id/messages',
  handler((req, res) => {
    const c = getChannel(req.user, Number(req.params.id));
    const body = str(req.body.body, { field: 'El mensaje', max: 8000, trim: false })?.trim() || '';
    const fileIds = ids(req.body.file_ids, 'Archivos') || [];
    if (!body && !fileIds.length) throw new HttpError(400, 'Escribe un mensaje o adjunta un archivo.');
    const replyTo = int(req.body.reply_to_id, { field: 'Respuesta', min: 1 }) ?? null;
    if (replyTo && !db.get('SELECT 1 FROM messages WHERE id = ? AND channel_id = ?', replyTo, c.id)) {
      throw new HttpError(400, 'El mensaje al que respondes no existe.');
    }
    const id = transaction(() => {
      const mid = db.insert('messages', { channel_id: c.id, user_id: req.user.id, body, reply_to_id: replyTo, created_at: now() });
      for (const fid of fileIds) {
        const f = db.get('SELECT * FROM files WHERE id = ?', fid);
        if (!f || f.uploaded_by !== req.user.id) throw new HttpError(400, 'Solo puedes adjuntar archivos que tú subiste.');
        addLink('message', mid, 'file', fid, req.user.id);
      }
      db.run(
        `INSERT INTO channel_members (channel_id, user_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
        c.id, req.user.id, mid,
      );
      indexEntity('message', mid, '', body);
      return mid;
    });
    // Notificaciones: menciones y mensajes directos.
    const where = c.kind === 'dm' ? 'un mensaje directo' : `#${c.name}`;
    const mentioned = findMentions(body).filter((uid) => {
      const u = db.get('SELECT id FROM users WHERE id = ?', uid);
      return u && canViewChannel({ id: uid, permissions: permissionsOf(uid) }, c);
    });
    notify({ userIds: mentioned, type: 'mention', title: `${req.user.name} te mencionó en ${where}`, body: body.slice(0, 140), link: `/chat/${c.id}?m=${id}`, actorId: req.user.id, entityType: 'message', entityId: id });
    if (c.kind === 'dm') {
      const others = db.all('SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id <> ?', c.id, req.user.id).map((r) => r.user_id);
      notify({ userIds: others.filter((u) => !mentioned.includes(u)), type: 'message', title: `Mensaje de ${req.user.name}`, body: body.slice(0, 140) || 'Archivo adjunto', link: `/chat/${c.id}?m=${id}`, actorId: req.user.id, entityType: 'message', entityId: id });
    }
    if (replyTo) {
      const original = db.get('SELECT user_id FROM messages WHERE id = ?', replyTo);
      if (original && !mentioned.includes(original.user_id) && c.kind !== 'dm') {
        notify({ userIds: [original.user_id], type: 'mention', title: `${req.user.name} respondió a tu mensaje en ${where}`, body: body.slice(0, 140), link: `/chat/${c.id}?m=${id}`, actorId: req.user.id, entityType: 'message', entityId: id });
      }
    }
    emit(['chat'], { filter: channelAudience(c), data: { channelId: c.id } });
    const [message] = decorateMessages(req.user, [db.get('SELECT * FROM messages WHERE id = ?', id)]);
    res.status(201).json(message);
  }),
);

function permissionsOf(userId) {
  const row = db.get('SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', userId);
  return row ? JSON.parse(row.permissions) : [];
}

router.patch(
  '/messages/:id',
  handler((req, res) => {
    const m = db.get('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m || m.deleted_at) throw notFound('El mensaje');
    const c = getChannel(req.user, m.channel_id);
    if (m.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes editar tus propios mensajes.');
    const body = str(req.body.body, { field: 'El mensaje', required: true, max: 8000 });
    db.update('messages', m.id, { body, edited_at: now() });
    indexEntity('message', m.id, '', body);
    emit(['chat'], { filter: channelAudience(c), data: { channelId: c.id } });
    res.json({ ok: true });
  }),
);

router.delete(
  '/messages/:id',
  handler((req, res) => {
    const m = db.get('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m || m.deleted_at) throw notFound('El mensaje');
    const c = getChannel(req.user, m.channel_id);
    if (m.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes eliminar tus propios mensajes.');
    db.update('messages', m.id, { deleted_at: now() });
    unindexEntity('message', m.id);
    emit(['chat'], { filter: channelAudience(c), data: { channelId: c.id } });
    res.json({ ok: true });
  }),
);

router.post(
  '/channels/:id/read',
  handler((req, res) => {
    const c = getChannel(req.user, Number(req.params.id));
    const last = int(req.body.last_id, { field: 'Mensaje', min: 0 }) ?? db.get('SELECT MAX(id) AS m FROM messages WHERE channel_id = ?', c.id).m ?? 0;
    db.run(
      `INSERT INTO channel_members (channel_id, user_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
      c.id, req.user.id, last,
    );
    emit(['chat-unread'], { userIds: [req.user.id] });
    res.json({ ok: true });
  }),
);

router.get(
  '/search',
  handler((req, res) => {
    const hits = searchIndex(String(req.query.q || ''), 300).filter((h) => h.entity_type === 'message');
    const rows = hits
      .map((h) => db.get('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL', h.entity_id))
      .filter(Boolean)
      .filter((m) => {
        const c = db.get('SELECT * FROM channels WHERE id = ?', m.channel_id);
        return c && canViewChannel(req.user, c);
      })
      .slice(0, 50);
    const channels = new Map(db.all('SELECT id, name, kind FROM channels').map((c) => [c.id, c]));
    res.json(decorateMessages(req.user, rows).map((m) => ({ ...m, channel_name: channels.get(m.channel_id)?.kind === 'dm' ? 'Mensaje directo' : channels.get(m.channel_id)?.name })));
  }),
);

export default router;
