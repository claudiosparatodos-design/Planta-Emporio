import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Paperclip, Trash2, Download, FileText, Image as ImageIcon, File, Link2, X, Star, Pencil, Upload, Plus, Film } from 'lucide-react';
import { api, fileUrl, qs, uploadFiles } from '../lib/api.js';
import { useAction, useActiveMembers, useIsFavorite, useMe, useMemberMap } from '../lib/hooks.js';
import { fileSize, timeAgo, fmtDateTime } from '../lib/format.js';
import { Avatar, Button, IconButton, Progress, EmptyState, Loading } from './ui.jsx';
import { Modal, Popover, useConfirm, useToast } from './overlay.jsx';
import { EntityIcon, EntitySearch } from './pickers.jsx';

/** Convierte "@Nombre" en resaltado y URLs en enlaces. */
export function RichText({ text }) {
  const members = useActiveMembers();
  const parts = useMemo(() => {
    if (!text) return [];
    const names = members.flatMap((m) => [m.name, m.name.split(' ')[0]]).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mention = names.length ? `@(?:${names.join('|')})` : '@\\S+';
    const re = new RegExp(`(${mention}|https?://[^\\s]+)`, 'giu');
    return text.split(re);
  }, [text, members]);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^https?:\/\//i.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>;
        if (p.startsWith('@') && i % 2 === 1) return <span key={i} className="mention-tag">{p}</span>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Campo de texto con autocompletado de menciones (@). */
export function MentionTextarea({ value, onChange, onSubmit, placeholder, autoFocus, textareaRef, onPaste, minHeight }) {
  const members = useActiveMembers();
  const localRef = useRef(null);
  const ref = textareaRef || localRef;
  const [query, setQuery] = useState(null);
  const [focus, setFocus] = useState(0);
  const matches = query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const update = (text, caret) => {
    onChange(text);
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)@([\p{L}\p{N}]*)$/u);
    setQuery(m ? m[2] : null);
    setFocus(0);
  };
  const insert = (member) => {
    const el = ref.current;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}]*)$/u, `@${member.name.split(' ')[0]} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };
  const onKeyDown = (e) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => (f + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => (f - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[focus]); return; }
      if (e.key === 'Escape') { setQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && onSubmit && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };
  const resize = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={minHeight ? { minHeight } : undefined}
        onChange={(e) => { update(e.target.value, e.target.selectionStart); resize(e.target); }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {matches.length > 0 && (
        <div className="menu mention-menu" style={{ position: 'absolute' }}>
          {matches.map((m, i) => (
            <button key={m.id} type="button" className={`menu-item ${i === focus ? 'focused' : ''}`} onMouseDown={(e) => { e.preventDefault(); insert(m); }}>
              <Avatar user={m} size="sm" />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Comments({ entityType, entityId }) {
  const me = useMe();
  const members = useMemberMap();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const key = ['comments', entityType, entityId];
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => api.get(`/comments${qs({ entity_type: entityType, entity_id: entityId })}`) });
  const add = useAction((body) => api.post('/comments', { entity_type: entityType, entity_id: entityId, body }), { invalidate: ['comments', 'tasks'], onSuccess: () => setText('') });
  const edit = useAction(({ id, body }) => api.patch(`/comments/${id}`, { body }), { invalidate: ['comments'], onSuccess: () => setEditing(null) });
  const remove = useAction((id) => api.del(`/comments/${id}`), { invalidate: ['comments', 'tasks'] });
  const submit = () => text.trim() && !add.isPending && add.mutate(text.trim());

  return (
    <div>
      {isLoading ? <Loading /> : data.map((c) => (
        <div key={c.id} className="comment">
          <Avatar user={members.get(c.user_id) || c.user} size="md" />
          <div className="comment-body">
            <div className="comment-head">
              <span className="name">{c.user?.name}</span>
              <span className="faint tiny" title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}{c.edited_at ? ' · editado' : ''}</span>
              {c.user_id === me.id && editing?.id !== c.id && (
                <span style={{ marginLeft: 'auto', display: 'flex' }}>
                  <IconButton icon={Pencil} size="xs" label="Editar" onClick={() => setEditing({ id: c.id, body: c.body })} />
                  <IconButton icon={Trash2} size="xs" label="Eliminar" onClick={async () => (await confirm({ title: '¿Eliminar comentario?', confirmLabel: 'Eliminar', danger: true })) && remove.mutate(c.id)} />
                </span>
              )}
            </div>
            {editing?.id === c.id ? (
              <div className="composer mt-1">
                <MentionTextarea value={editing.body} onChange={(b) => setEditing({ ...editing, body: b })} onSubmit={() => edit.mutate(editing)} autoFocus />
                <div className="composer-bar">
                  <span className="spacer" />
                  <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  <Button size="xs" variant="primary" loading={edit.isPending} onClick={() => edit.mutate(editing)}>Guardar</Button>
                </div>
              </div>
            ) : (
              <div className="comment-text"><RichText text={c.body} /></div>
            )}
          </div>
        </div>
      ))}
      <div className="flex mt-2" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Avatar user={me} size="md" />
        <div className="composer" style={{ flex: 1 }}>
          <MentionTextarea value={text} onChange={setText} onSubmit={submit} placeholder="Escribe un comentario… usa @ para mencionar" />
          <div className="composer-bar">
            <span className="faint tiny hide-sm">Enter para enviar · Shift+Enter nueva línea</span>
            <span className="spacer" />
            <Button size="xs" variant="primary" icon={Send} disabled={!text.trim()} loading={add.isPending} onClick={submit}>Comentar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityList({ items = [], compact, showEntity }) {
  const members = useMemberMap();
  if (!items.length) return <p className="faint small" style={{ padding: '6px 0' }}>Sin actividad todavía.</p>;
  return (
    <div>
      {items.map((a) => (
        <div key={a.id} className="activity-item">
          <span className="activity-dot"><Avatar user={members.get(a.actor_id) || a.actor} size="xs" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="who">{a.actor?.name || 'Sistema'}</span> {a.summary}
            {!compact && a.data && <ChangeDetails data={a.data} />}
          </div>
          <span className="when" title={fmtDateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

function ChangeDetails({ data }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v && typeof v === 'object' && 'from' in v && 'to' in v);
  if (!entries.length) return null;
  const fmt = (k, v) => {
    if (v === null || v === '') return 'vacío';
    if (k.endsWith('_cents')) return (Number(v) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    return String(v).slice(0, 60);
  };
  return (
    <div className="tiny faint" style={{ marginTop: 2 }}>
      {entries.slice(0, 4).map(([k, v]) => (
        <div key={k}>{fmt(k, v.from)} → {fmt(k, v.to)}</div>
      ))}
    </div>
  );
}

// ───────── Archivos adjuntos ─────────
export function fileKind(mime = '') {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/plain')) return 'text';
  return 'other';
}

export function FileIcon({ mime, size = 20 }) {
  const k = fileKind(mime);
  if (k === 'image') return <ImageIcon size={size} />;
  if (k === 'pdf' || k === 'text') return <FileText size={size} />;
  if (k === 'video') return <Film size={size} />;
  return <File size={size} />;
}

export function FilePreview({ file, onClose }) {
  const kind = fileKind(file.mime);
  const { data: text } = useQuery({
    queryKey: ['file-text', file.id],
    queryFn: () => fetch(fileUrl(file.id)).then((r) => r.text()),
    enabled: kind === 'text',
  });
  return (
    <Modal
      size="xl"
      title={file.name}
      onClose={onClose}
      footer={
        <>
          <span className="left faint small">{fileSize(file.size)}{file.uploaded_by_name ? ` · subido por ${file.uploaded_by_name}` : ''} · {fmtDateTime(file.created_at)}</span>
          <a className="btn" href={fileUrl(file.id, true)}><Download size={15} /> Descargar</a>
        </>
      }
    >
      {kind === 'image' && <img className="preview-img" src={fileUrl(file.id)} alt={file.name} />}
      {kind === 'pdf' && <iframe className="preview-frame" src={fileUrl(file.id)} title={file.name} />}
      {kind === 'video' && <video src={fileUrl(file.id)} controls style={{ width: '100%', maxHeight: '70vh' }} />}
      {kind === 'text' && <pre className="preview-text">{text ?? 'Cargando…'}</pre>}
      {kind === 'other' && (
        <EmptyState icon={File} title="Vista previa no disponible">Este tipo de archivo se descarga para abrirlo en su programa.</EmptyState>
      )}
    </Modal>
  );
}

export function AttachmentGrid({ files = [], onRemove }) {
  const [preview, setPreview] = useState(null);
  if (!files.length) return null;
  return (
    <>
      <div className="attach-grid">
        {files.map((f) => (
          <div key={f.id} className="attach" onClick={() => setPreview(f)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPreview(f)}>
            <div className="thumb">{fileKind(f.mime) === 'image' ? <img src={fileUrl(f.id)} alt="" loading="lazy" /> : <FileIcon mime={f.mime} size={26} />}</div>
            <div className="info">
              <div className="name" title={f.name}>{f.name}</div>
              <div className="meta">{fileSize(f.size)}</div>
            </div>
            {onRemove && (
              <IconButton icon={X} size="xs" label="Quitar" className="" style={{ position: 'absolute', top: 4, right: 4, background: 'var(--bg-elevated)' }} onClick={(e) => { e.stopPropagation(); onRemove(f); }} />
            )}
          </div>
        ))}
      </div>
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

/** Zona para adjuntar archivos a un elemento (tarea, documento, reunión, movimiento…). */
export function Attachments({ entityType, entityId, files = [], projectId, visibility, compact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [over, setOver] = useState(false);
  const upload = async (list) => {
    if (!list?.length) return;
    setProgress(0);
    try {
      await uploadFiles([...list], { link_type: entityType, link_id: entityId, project_id: projectId, visibility }, setProgress);
      toast.success(list.length > 1 ? `${list.length} archivos adjuntados` : 'Archivo adjuntado');
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e);
    }
    setProgress(null);
  };
  const remove = async (f) => {
    if (!(await confirm({ title: `¿Enviar «${f.name}» a la papelera?`, message: 'Podrás restaurarlo desde la papelera.', confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.del(`/files/${f.id}`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
    >
      <AttachmentGrid files={files} onRemove={remove} />
      <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      {progress !== null ? (
        <div className="upload-progress"><Paperclip size={14} /> Subiendo… <Progress value={progress * 100} thin /></div>
      ) : compact ? (
        <Button size="xs" variant="ghost" icon={Paperclip} onClick={() => input.current.click()} style={{ marginTop: files.length ? 8 : 0 }}>Adjuntar archivo</Button>
      ) : (
        <div className={`dropzone ${over ? 'over' : ''}`} style={{ marginTop: files.length ? 8 : 0 }} onClick={() => input.current.click()} role="button" tabIndex={0}>
          <Upload size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Arrastra archivos aquí o <span className="link">elige desde tu equipo</span>
        </div>
      )}
    </div>
  );
}

/** Elementos vinculados (documentos, tareas, reuniones…) con opción de agregar. */
export function RelatedItems({ entityType, entityId, items = [], types }) {
  const [anchor, setAnchor] = useState(null);
  const add = useAction((target) => api.post('/links', { a_type: entityType, a_id: entityId, b_type: target.type, b_id: target.id }), { invalidate: ['tasks', 'pages', 'projects', 'meetings', 'decisions'] });
  const remove = useAction((linkId) => api.del(`/links/${linkId}`), { invalidate: ['tasks', 'pages', 'projects', 'meetings', 'decisions'] });
  return (
    <div className="related">
      {items.map((it) => (
        <div key={`${it.type}-${it.id}`} className="related-item">
          <EntityIcon item={it} />
          <Link to={it.url} className="truncate" style={{ flex: 1 }}>{it.title}</Link>
          <span className="faint tiny hide-sm">{it.subtitle}</span>
          {it.link_id && <IconButton icon={X} size="xs" label="Quitar vínculo" onClick={() => remove.mutate(it.link_id)} />}
        </div>
      ))}
      <div>
        <Button size="xs" variant="ghost" icon={Link2} onClick={(e) => setAnchor(e.currentTarget)}>Vincular</Button>
      </div>
      <Popover anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} width={340}>
        <EntitySearch types={types} exclude={[{ type: entityType, id: entityId }, ...items]} onPick={(it) => { add.mutate(it); setAnchor(null); }} />
      </Popover>
    </div>
  );
}

export function FavoriteButton({ type, id }) {
  const fav = useIsFavorite(type, id);
  const toggle = useAction(() => api.post('/favorites', { entity_type: type, entity_id: id }), { invalidate: ['favorites'] });
  return (
    <IconButton
      icon={Star}
      label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
      active={fav}
      onClick={() => toggle.mutate()}
      style={fav ? { color: 'var(--m-yellow)' } : undefined}
    />
  );
}

export function SectionAdd({ onClick, label = 'Agregar' }) {
  return <Button size="xs" variant="ghost" icon={Plus} onClick={onClick}>{label}</Button>;
}
