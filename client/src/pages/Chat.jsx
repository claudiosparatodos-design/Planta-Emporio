import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, Plus, Search, Send, Paperclip, Reply, Pencil, Trash2, X, ArrowLeft, MessageSquare, FolderKanban, ChevronDown } from 'lucide-react';
import { api, fileUrl, qs, uploadFiles } from '../lib/api.js';
import { cap, fmtDate, fmtTime, timeAgo, fileSize } from '../lib/format.js';
import { useAction, useActiveMembers, useDebounced, useIsMobile, useMe, useMemberMap } from '../lib/hooks.js';
import { Avatar, Button, EmptyState, IconButton, Loading, Spinner, Progress } from '../components/ui.jsx';
import { Modal, Popover, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { AttachmentGrid, MentionTextarea, RichText, fileKind } from '../components/collab.jsx';
import { OptionList } from '../components/pickers.jsx';

export default function Chat() {
  const { id } = useParams();
  const cid = id ? Number(id) : null;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: channels = [], isLoading } = useQuery({ queryKey: ['chat', 'channels'], queryFn: () => api.get('/chat/channels') });
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [dmAnchor, setDmAnchor] = useState(null);
  const members = useActiveMembers();
  const me = useMe();

  // En escritorio abre el canal general por defecto.
  useEffect(() => {
    if (!cid && !isMobile && channels.length) navigate(`/chat/${channels[0].id}`, { replace: true });
  }, [cid, isMobile, channels, navigate]);

  const openDm = async (userId) => {
    setDmAnchor(null);
    const { id: dmId } = await api.post('/chat/dm', { user_id: userId });
    navigate(`/chat/${dmId}`);
  };
  const current = channels.find((c) => c.id === cid);
  const groups = [
    { label: 'Canales', items: channels.filter((c) => c.kind === 'general' || c.kind === 'topic') },
    { label: 'Proyectos', items: channels.filter((c) => c.kind === 'project') },
    { label: 'Mensajes directos', items: channels.filter((c) => c.kind === 'dm') },
  ];

  return (
    <>
      {(!cid || !isMobile) && <Topbar crumbs={[{ label: 'Chat' }]} actions={<IconButton icon={Search} label="Buscar mensajes" onClick={() => setSearching(true)} />} />}
      <div className="content" style={{ overflow: 'hidden' }}>
        <div className={`chat-layout ${cid ? 'has-channel' : ''}`}>
          <aside className="chat-list">
            <div className="chat-list-scroll">
              {isLoading ? <Loading /> : groups.map((g) => (
                <div key={g.label} className="sb-group" style={{ marginTop: 10 }}>
                  <div className="sb-group-title" style={{ opacity: 1 }}>
                    {g.label}
                    {g.label === 'Canales' && <button className="icon-btn xs" aria-label="Nuevo canal" onClick={() => setCreating(true)} style={{ opacity: 1 }}><Plus size={13} /></button>}
                    {g.label === 'Mensajes directos' && <button className="icon-btn xs" aria-label="Nuevo mensaje directo" onClick={(e) => setDmAnchor(e.currentTarget)} style={{ opacity: 1 }}><Plus size={13} /></button>}
                  </div>
                  {g.items.map((c) => (
                    <Link key={c.id} to={`/chat/${c.id}`} className={`chat-channel ${c.id === cid ? 'active' : ''} ${c.unread ? 'unread' : ''}`}>
                      {c.kind === 'dm' ? <Avatar user={c.other_user} size="sm" /> : c.kind === 'project' ? <span style={{ width: 20, textAlign: 'center' }}>{c.project_icon || '📁'}</span> : <Hash size={16} className="faint" />}
                      <span className="ch-name">{c.name}</span>
                      {c.unread > 0 && <span className="sb-badge">{c.unread}</span>}
                    </Link>
                  ))}
                  {!g.items.length && g.label === 'Mensajes directos' && <p className="faint tiny" style={{ padding: '2px 8px' }}>Escribe en privado a un integrante con +</p>}
                </div>
              ))}
            </div>
          </aside>
          <section className="chat-main">
            {current ? <ChannelView key={current.id} channel={current} onBack={() => navigate('/chat')} /> : !isMobile && <EmptyState icon={MessageSquare} title="Elige una conversación" />}
          </section>
        </div>
      </div>
      {creating && <NewChannelModal onClose={() => setCreating(false)} />}
      {searching && <SearchModal onClose={() => setSearching(false)} />}
      <Popover anchor={dmAnchor} open={Boolean(dmAnchor)} onClose={() => setDmAnchor(null)} width={260}>
        <OptionList
          options={members.filter((m) => m.id !== me.id).map((m) => ({ value: m.id, label: m.name, render: () => (<><Avatar user={m} size="sm" /><span>{m.name}</span></>) }))}
          onSelect={openDm}
          placeholder="¿Con quién?"
        />
      </Popover>
    </>
  );
}

function ChannelView({ channel, onBack }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const members = useMemberMap();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const highlight = Number(params.get('m')) || null;
  const scroller = useRef(null);
  const textRef = useRef(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pending, setPending] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const fileInput = useRef(null);
  const lastReadRef = useRef(null);

  const query = useInfiniteQuery({
    queryKey: ['chat', 'messages', channel.id],
    queryFn: ({ pageParam }) => api.get(`/chat/channels/${channel.id}/messages${qs({ before: pageParam })}`),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.has_more ? last.messages[0]?.id : undefined),
  });
  const messages = useMemo(() => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.messages) : []), [query.data]);
  if (query.data && lastReadRef.current === null) lastReadRef.current = query.data.pages[0].last_read_id;
  const lastId = messages[messages.length - 1]?.id;

  // Marca como leído y baja al final cuando llegan mensajes nuevos.
  useEffect(() => {
    if (!lastId) return;
    api.post(`/chat/channels/${channel.id}/read`, { last_id: lastId }).then(() => qc.invalidateQueries({ queryKey: ['chat', 'channels'] })).catch(() => {});
  }, [lastId, channel.id, qc]);
  const prevCount = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages.length) return;
    const first = prevCount.current === 0;
    if (first && highlight) {
      el.querySelector(`[data-mid="${highlight}"]`)?.scrollIntoView({ block: 'center' });
    } else if (first || atBottom || messages[messages.length - 1]?.user_id === me.id) {
      el.scrollTop = el.scrollHeight;
    }
    prevCount.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const onScroll = () => {
    const el = scroller.current;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (el.scrollTop < 60 && query.hasNextPage && !query.isFetchingNextPage) {
      const h = el.scrollHeight;
      query.fetchNextPage().then(() => requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h; }));
    }
  };

  const send = useAction(
    (body) => api.post(`/chat/channels/${channel.id}/messages`, body),
    {
      onSuccess: () => {
        setText('');
        setReplyTo(null);
        setPending([]);
        qc.invalidateQueries({ queryKey: ['chat', 'messages', channel.id] });
      },
    },
  );
  const submit = () => {
    if (editing) {
      if (!text.trim()) return;
      api.patch(`/chat/messages/${editing.id}`, { body: text.trim() }).then(() => { setEditing(null); setText(''); qc.invalidateQueries({ queryKey: ['chat', 'messages', channel.id] }); }).catch(toast.error);
      return;
    }
    if ((!text.trim() && !pending.length) || send.isPending) return;
    send.mutate({ body: text, reply_to_id: replyTo?.id, file_ids: pending.map((f) => f.id) });
  };
  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(0);
    try {
      const res = await uploadFiles([...files], { project_id: channel.project_id }, setUploading);
      setPending((p) => [...p, ...res]);
    } catch (e) {
      toast.error(e);
    }
    setUploading(null);
  };
  const remove = async (m) => {
    if (!(await confirm({ title: '¿Eliminar este mensaje?', confirmLabel: 'Eliminar', danger: true }))) return;
    api.del(`/chat/messages/${m.id}`).then(() => qc.invalidateQueries({ queryKey: ['chat', 'messages', channel.id] })).catch(toast.error);
  };

  let lastDay = null;
  let lastUser = null;
  let lastTime = 0;
  let unreadShown = false;
  return (
    <>
      <div className="chat-head">
        {isMobile && <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />}
        {channel.kind === 'dm' ? <Avatar user={channel.other_user} size="md" /> : channel.kind === 'project' ? <span style={{ fontSize: 20 }}>{channel.project_icon || '📁'}</span> : <Hash size={18} className="faint" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="strong truncate">{channel.name}</div>
          <div className="tiny faint truncate">{channel.kind === 'dm' ? 'Mensaje directo privado' : channel.kind === 'project' ? 'Conversación del proyecto' : channel.description || 'Canal del equipo'}</div>
        </div>
        {channel.kind === 'project' && <Link className="btn ghost sm" to={`/projects/${channel.project_id}`}><FolderKanban size={15} /><span className="hide-sm">Ver proyecto</span></Link>}
      </div>
      <div className="chat-messages" ref={scroller} onScroll={onScroll}>
        {query.isFetchingNextPage && <div style={{ textAlign: 'center', padding: 8 }}><Spinner /></div>}
        {query.isLoading ? <Loading /> : !messages.length ? (
          <EmptyState icon={MessageSquare} title="Aún no hay mensajes">{channel.kind === 'dm' ? 'Escribe el primer mensaje.' : 'Comparte avances, dudas y archivos con el equipo.'}</EmptyState>
        ) : messages.map((m) => {
          const day = cap(fmtDate(m.created_at, "EEEE d 'de' MMMM"));
          const t = Date.parse(m.created_at);
          const showDay = day !== lastDay;
          const first = showDay || lastUser !== m.user_id || t - lastTime > 5 * 60_000 || m.reply_to;
          const showUnread = !unreadShown && lastReadRef.current != null && m.id > lastReadRef.current && m.user_id !== me.id;
          if (showUnread) unreadShown = true;
          lastDay = day;
          lastUser = m.user_id;
          lastTime = t;
          const user = members.get(m.user_id) || m.user;
          return (
            <div key={m.id}>
              {showDay && <div className="day-sep">{day}</div>}
              {showUnread && <div className="unread-sep">Nuevos</div>}
              <div className={`msg ${first ? 'first' : ''} ${highlight === m.id ? 'highlight' : ''}`} data-mid={m.id}>
                <div className="msg-gutter">{first ? <Avatar user={user} size="md" /> : <div className="msg-time-hover">{fmtTime(m.created_at)}</div>}</div>
                <div className="msg-body">
                  {first && (
                    <div className="msg-head">
                      <span className="name">{user?.name}</span>
                      <span className="time">{fmtTime(m.created_at)}</span>
                    </div>
                  )}
                  {m.reply_to && <div className="msg-reply" onClick={() => scroller.current.querySelector(`[data-mid="${m.reply_to.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>↪ {m.reply_to.user_name}: {m.reply_to.body}</div>}
                  {m.deleted ? <div className="msg-deleted">Mensaje eliminado</div> : (
                    <>
                      {m.body && <div className="msg-text"><RichText text={m.body} />{m.edited_at && <span className="faint tiny"> (editado)</span>}</div>}
                      {m.attachments.length > 0 && (
                        <div className="mt-1" style={{ maxWidth: 480 }}>
                          {m.attachments.filter((f) => fileKind(f.mime) === 'image').map((f) => (
                            <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer"><img src={fileUrl(f.id)} alt={f.name} style={{ maxHeight: 260, borderRadius: 8, display: 'block', marginTop: 4 }} loading="lazy" /></a>
                          ))}
                          <AttachmentGrid files={m.attachments.filter((f) => fileKind(f.mime) !== 'image')} />
                        </div>
                      )}
                    </>
                  )}
                </div>
                {!m.deleted && (
                  <div className="msg-actions">
                    <IconButton icon={Reply} size="xs" label="Responder" onClick={() => { setReplyTo(m); textRef.current?.focus(); }} />
                    {m.user_id === me.id && <IconButton icon={Pencil} size="xs" label="Editar" onClick={() => { setEditing(m); setText(m.body); textRef.current?.focus(); }} />}
                    {m.user_id === me.id && <IconButton icon={Trash2} size="xs" label="Eliminar" onClick={() => remove(m)} />}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!atBottom && messages.length > 0 && (
        <div style={{ position: 'relative' }}>
          <Button size="sm" style={{ position: 'absolute', right: 20, bottom: 8, zIndex: 2 }} icon={ChevronDown} onClick={() => { scroller.current.scrollTop = scroller.current.scrollHeight; }}>Ir al final</Button>
        </div>
      )}
      <div className="chat-composer">
        {(replyTo || editing) && (
          <div className="replying">
            {replyTo ? <><Reply size={13} />Respondiendo a <strong>{replyTo.user?.name}</strong>: <span className="truncate">{replyTo.body}</span></> : <><Pencil size={13} />Editando mensaje</>}
            <span className="spacer" style={{ flex: 1 }} />
            <IconButton icon={X} size="xs" label="Cancelar" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }} />
          </div>
        )}
        <div className="composer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
          {pending.length > 0 && (
            <div className="flex wrap" style={{ gap: 6, padding: '8px 10px 0' }}>
              {pending.map((f) => (
                <span key={f.id} className="pill c-gray"><Paperclip size={11} /><span>{f.name} · {fileSize(f.size)}</span><button className="icon-btn xs" style={{ width: 16, height: 16 }} onClick={() => setPending(pending.filter((x) => x.id !== f.id))} aria-label="Quitar"><X size={11} /></button></span>
              ))}
            </div>
          )}
          <MentionTextarea
            textareaRef={textRef}
            value={text}
            onChange={setText}
            onSubmit={submit}
            placeholder={channel.kind === 'dm' ? `Mensaje para ${channel.name}` : `Mensaje en ${channel.kind === 'project' ? channel.name : `#${channel.name}`}`}
            onPaste={(e) => e.clipboardData.files.length && upload(e.clipboardData.files)}
          />
          <div className="composer-bar">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            <IconButton icon={Paperclip} size="sm" label="Adjuntar archivo" onClick={() => fileInput.current.click()} />
            {uploading !== null && <div style={{ width: 120 }}><Progress value={uploading * 100} thin /></div>}
            <span className="spacer" />
            <span className="faint tiny hide-sm">@ para mencionar · Enter envía</span>
            <Button size="sm" variant="primary" icon={Send} onClick={submit} loading={send.isPending} disabled={!text.trim() && !pending.length}>{editing ? 'Guardar' : 'Enviar'}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function NewChannelModal({ onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const create = useAction(() => api.post('/chat/channels', { name, description }), { invalidate: ['chat'], onSuccess: (r) => { onClose(); navigate(`/chat/${r.id}`); } });
  return (
    <Modal size="sm" title="Nuevo canal" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Crear</Button></>}>
      <p className="muted small mb-3">Los canales son visibles para todo el equipo. Cada proyecto ya tiene su propio canal.</p>
      <div className="field"><label>Nombre</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. proveedores, ideas, ventas" /></div>
      <div className="field"><label>Descripción (opcional)</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
    </Modal>
  );
}

function SearchModal({ onClose }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const navigate = useNavigate();
  const { data = [], isFetching } = useQuery({ queryKey: ['chat', 'search', dq], queryFn: () => api.get(`/chat/search${qs({ q: dq })}`), enabled: dq.length >= 2 });
  return (
    <Modal title="Buscar mensajes" onClose={onClose} size="lg">
      <div style={{ position: 'relative' }}>
        <Search size={15} className="faint" style={{ position: 'absolute', left: 10, top: 10 }} />
        <input className="input" style={{ paddingLeft: 32 }} autoFocus placeholder="Palabras del mensaje…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-3">
        {isFetching && <Loading />}
        {!isFetching && dq.length >= 2 && !data.length && <p className="faint small">Sin resultados.</p>}
        {data.map((m) => (
          <button key={m.id} className="list-row" onClick={() => { onClose(); navigate(`/chat/${m.channel_id}?m=${m.id}`); }}>
            <Avatar user={m.user} size="sm" />
            <div className="grow">
              <div className="small faint">{m.user?.name} · {m.channel_name} · {timeAgo(m.created_at)}</div>
              <div className="truncate">{m.body}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

