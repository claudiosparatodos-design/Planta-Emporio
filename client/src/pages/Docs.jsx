import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, Plus, FileText, MoreHorizontal, Trash2, Copy, LayoutTemplate, History, Lock, Globe, FolderKanban, Search, Smile,
  FolderInput, AlertTriangle, Check, CloudOff, X, List,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { PAGE_ICONS } from '../lib/constants.js';
import { fmtDateTime, timeAgo } from '../lib/format.js';
import { useAction, useActiveMembers, useCan, useIsMobile, useLocal, useMe } from '../lib/hooks.js';
import { AutoTextarea, Avatar, Button, Callout, EmptyState, ErrorState, IconButton, Loading, Pill, Spinner } from '../components/ui.jsx';
import { Menu, Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { EmojiPicker, ProjectPicker } from '../components/pickers.jsx';
import { Attachments, Comments, FavoriteButton, RelatedItems } from '../components/collab.jsx';
import Editor from '../components/Editor.jsx';

export default function Docs() {
  const { id } = useParams();
  const pid = id ? Number(id) : null;
  const isMobile = useIsMobile();
  const [treeOpen, setTreeOpen] = useState(false);
  const { data: pages = [], isLoading } = useQuery({ queryKey: ['pages', 'tree'], queryFn: () => api.get('/pages') });
  useEffect(() => setTreeOpen(false), [pid]);
  return (
    <div className="docs-layout">
      <aside className={`docs-tree ${treeOpen ? 'mobile-open' : ''}`}>
        {isMobile && treeOpen && <IconButton icon={X} label="Cerrar" style={{ position: 'absolute', top: 12, right: 12 }} onClick={() => setTreeOpen(false)} />}
        <PageTree pages={pages} loading={isLoading} activeId={pid} />
      </aside>
      <div className="docs-main" style={{ display: 'flex', flexDirection: 'column' }}>
        {pid ? <DocPage key={pid} id={pid} pages={pages} onOpenTree={() => setTreeOpen(true)} /> : <DocsHome pages={pages} loading={isLoading} onOpenTree={() => setTreeOpen(true)} />}
      </div>
    </div>
  );
}

function useCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  return async (body = {}) => {
    try {
      const page = await api.post('/pages', body);
      qc.invalidateQueries({ queryKey: ['pages'] });
      navigate(`/docs/${page.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
}

function PageTree({ pages, loading, activeId }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useLocal('docs-expanded', {});
  const canEdit = useCan('docs.edit');
  const create = useCreatePage();
  const children = useMemo(() => {
    const m = new Map();
    for (const p of pages) {
      const k = p.parent_id ?? 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  }, [pages]);
  // Expande automáticamente la ruta hasta la página abierta.
  useEffect(() => {
    if (!activeId) return;
    const byId = new Map(pages.map((p) => [p.id, p]));
    let cur = byId.get(activeId);
    const next = { ...expanded };
    let changed = false;
    while (cur?.parent_id) {
      if (!next[cur.parent_id]) {
        next[cur.parent_id] = true;
        changed = true;
      }
      cur = byId.get(cur.parent_id);
    }
    if (changed) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pages]);

  const q = filter.trim().toLowerCase();
  const render = (parent, depth) =>
    (children.get(parent) || []).map((p) => {
      const kids = children.get(p.id) || [];
      const open = expanded[p.id];
      return (
        <div key={p.id}>
          <TreeItem page={p} depth={depth} hasKids={kids.length > 0} open={open} active={p.id === activeId} onToggle={() => setExpanded({ ...expanded, [p.id]: !open })} onAddChild={canEdit ? () => { setExpanded({ ...expanded, [p.id]: true }); create({ parent_id: p.id }); } : null} />
          {open && render(p.id, depth + 1)}
        </div>
      );
    });

  return (
    <>
      <div className="flex mb-2" style={{ padding: '0 4px', gap: 4 }}>
        <Link to="/docs" className="strong" style={{ flex: 1, fontSize: 13 }}>Documentos</Link>
        {canEdit && <IconButton icon={Plus} size="sm" label="Nueva página" onClick={() => create({})} />}
      </div>
      <div style={{ position: 'relative', margin: '0 4px 8px' }}>
        <Search size={13} className="faint" style={{ position: 'absolute', left: 8, top: 9 }} />
        <input className="input" style={{ height: 30, paddingLeft: 26, fontSize: 13 }} placeholder="Filtrar páginas" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {loading ? <Loading /> : q ? (
        pages.filter((p) => (p.title || 'sin título').toLowerCase().includes(q)).map((p) => <TreeItem key={p.id} page={p} depth={0} active={p.id === activeId} />)
      ) : pages.length ? render(0, 0) : <p className="faint small" style={{ padding: 8 }}>Aún no hay páginas.</p>}
    </>
  );
}

function TreeItem({ page, depth, hasKids, open, active, onToggle, onAddChild }) {
  const navigate = useNavigate();
  return (
    <div className={`tree-item ${active ? 'active' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} onClick={() => navigate(`/docs/${page.id}`)}>
      <button className={`twisty ${open ? 'open' : ''}`} style={{ visibility: hasKids ? 'visible' : 'hidden' }} onClick={(e) => { e.stopPropagation(); onToggle?.(); }} aria-label={open ? 'Contraer' : 'Expandir'}>
        <ChevronRight size={13} />
      </button>
      <span className="t-icon">{page.icon || '📄'}</span>
      <span className="t-title">{page.title || 'Sin título'}</span>
      {page.visibility === 'private' && <Lock size={11} className="faint" />}
      {onAddChild && (
        <span className="t-actions">
          <button className="icon-btn xs" aria-label="Agregar subpágina" title="Agregar subpágina" onClick={(e) => { e.stopPropagation(); onAddChild(); }}><Plus size={13} /></button>
        </span>
      )}
    </div>
  );
}

function DocsHome({ pages, loading, onOpenTree }) {
  const canEdit = useCan('docs.edit');
  const create = useCreatePage();
  const isMobile = useIsMobile();
  const { data: templates = [] } = useQuery({ queryKey: ['pages', 'templates'], queryFn: () => api.get('/pages?templates=1') });
  const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 12);
  return (
    <>
      <Topbar crumbs={[{ label: 'Documentos' }]} actions={<>{isMobile && <Button size="sm" variant="ghost" icon={List} onClick={onOpenTree}>Páginas</Button>}{canEdit && <Button size="sm" variant="primary" icon={Plus} onClick={() => create({})}>Nueva página</Button>}</>} />
      <div className="content">
        <div className="page">
          <div className="page-header">
            <div>
              <h1 className="page-title">Documentos</h1>
              <p className="page-subtitle">La wiki de la empresa: planes, procesos, manuales, ideas, acuerdos y notas de reuniones.</p>
            </div>
          </div>
          {canEdit && templates.length > 0 && (
            <div className="section" style={{ marginTop: 0 }}>
              <div className="section-title"><h3>Empezar con una plantilla</h3></div>
              <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                <button className="card hoverable template-card" onClick={() => create({})}>
                  <span className="t-emoji"><FileText size={22} /></span>
                  <strong>Página en blanco</strong>
                </button>
                {templates.map((t) => (
                  <button key={t.id} className="card hoverable template-card" onClick={() => create({ template_id: t.id, title: '' })}>
                    <span className="t-emoji">{t.icon || '📄'}</span>
                    <strong>{t.title}</strong>
                    {t.template_category && <span className="faint tiny">{t.template_category}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="section">
            <div className="section-title"><h3>Editados recientemente</h3></div>
            {loading ? <Loading /> : recent.length ? (
              <div className="card" style={{ padding: 6 }}>
                {recent.map((p) => (
                  <Link key={p.id} to={`/docs/${p.id}`} className="list-row">
                    <span style={{ width: 22, textAlign: 'center' }}>{p.icon || '📄'}</span>
                    <div className="grow">
                      <div className="title">{p.title || 'Sin título'}</div>
                      {p.preview && <div className="faint small truncate">{p.preview}</div>}
                    </div>
                    {p.visibility === 'private' && <Lock size={12} className="faint" />}
                    <span className="meta">{timeAgo(p.updated_at)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileText} title="Aún no hay documentos" actions={canEdit && <Button variant="primary" icon={Plus} onClick={() => create({ title: 'Acuerdos entre socios', icon: '🤝' })}>Escribir los acuerdos entre socios</Button>}>
                Un buen primer documento: los acuerdos entre socios (aportaciones, roles y cómo se toman decisiones).
              </EmptyState>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ───────── Página de documento ─────────
function DocPage({ id, pages, onOpenTree }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useMe();
  const members = useActiveMembers();
  const isMobile = useIsMobile();
  const canEditDocs = useCan('docs.edit');
  const { data: page, isLoading, error, refetch } = useQuery({ queryKey: ['pages', 'detail', id], queryFn: () => api.get(`/pages/${id}`) });
  const canEdit = canEditDocs && page && (page.visibility !== 'private' || page.created_by === me.id);

  const [title, setTitle] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | offline | conflict
  const [conflict, setConflict] = useState(null);
  const [history, setHistory] = useState(false);
  const [moving, setMoving] = useState(false);
  const versionRef = useRef(null);
  const pending = useRef({});
  const lastEdit = useRef(0);
  const timer = useRef(null);
  const initialized = useRef(false);
  const interacted = useRef(false);

  useEffect(() => {
    if (!page) return;
    if (!initialized.current) {
      initialized.current = true;
      versionRef.current = page.version;
      setTitle(page.title);
      return;
    }
    // Cambios de otra persona: se cargan si no estás editando en ese momento.
    if (page.version > versionRef.current && !Object.keys(pending.current).length && Date.now() - lastEdit.current > 3000 && status !== 'conflict') {
      versionRef.current = page.version;
      setTitle(page.title);
      setEditorKey((k) => k + 1);
    }
  }, [page, status]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    setStatus('saving');
    try {
      const res = await api.patch(`/pages/${id}`, { ...body, base_version: versionRef.current });
      versionRef.current = res.version;
      setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved');
      qc.setQueryData(['pages', 'detail', id], (old) => (old ? { ...old, version: res.version, updated_at: res.updated_at, title: body.title ?? old.title, content: body.content ?? old.content } : old));
      if (body.title !== undefined) qc.invalidateQueries({ queryKey: ['pages', 'tree'] });
    } catch (e) {
      if (e.status === 409) {
        pending.current = { ...body, ...pending.current };
        setConflict(e.details || {});
        setStatus('conflict');
      } else if (e.status === 0 || e.status >= 500) {
        pending.current = { ...body, ...pending.current };
        setStatus('offline');
        timer.current = setTimeout(flush, 4000);
      } else {
        toast.error(e);
        setStatus('saved');
      }
    }
  }, [id, qc, toast]);

  const schedule = (patch) => {
    pending.current = { ...pending.current, ...patch };
    lastEdit.current = Date.now();
    if (status === 'conflict') return;
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };

  // Evita perder cambios al cerrar o recargar la pestaña.
  useEffect(() => {
    const fn = (e) => {
      if (Object.keys(pending.current).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => {
      window.removeEventListener('beforeunload', fn);
      if (Object.keys(pending.current).length && status !== 'conflict') flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush]);

  const resolveConflict = async (mode) => {
    const mine = pending.current;
    if (mode === 'copy') {
      try {
        const copy = await api.post('/pages', { title: `${mine.title ?? page.title} (mi versión)`, content: mine.content ?? page.content, parent_id: page.parent_id, project_id: page.project_id });
        toast.success('Tu versión se guardó como una página aparte', { action: { label: 'Abrir', onClick: () => navigate(`/docs/${copy.id}`) } });
      } catch (e) {
        return toast.error(e);
      }
    }
    pending.current = {};
    if (mode === 'overwrite') {
      const fresh = await api.get(`/pages/${id}`);
      versionRef.current = fresh.version;
      pending.current = mine;
      setConflict(null);
      setStatus('dirty');
      return flush();
    }
    const fresh = await refetch();
    versionRef.current = fresh.data.version;
    setTitle(fresh.data.title);
    setEditorKey((k) => k + 1);
    setConflict(null);
    setStatus('saved');
  };

  const setMeta = useAction((patch) => api.patch(`/pages/${id}`, patch), { invalidate: ['pages'] });
  const duplicate = useAction((asTemplate) => api.post(`/pages/${id}/duplicate`, { as_template: asTemplate }), {
    invalidate: ['pages'],
    onSuccess: (r, asTemplate) => { toast.success(asTemplate ? 'Plantilla creada' : 'Página duplicada'); navigate(`/docs/${r.id}`); },
  });
  const remove = async () => {
    const kids = pages.filter((p) => p.parent_id === id).length;
    if (!(await confirm({ title: '¿Enviar la página a la papelera?', message: kids ? `También se moverán sus subpáginas. Podrás restaurarlas.` : 'Podrás restaurarla desde la papelera.', confirmLabel: 'Enviar a la papelera', danger: true }))) return;
    try {
      await api.del(`/pages/${id}`);
      pending.current = {};
      qc.invalidateQueries({ queryKey: ['pages'] });
      navigate(page.parent_id ? `/docs/${page.parent_id}` : '/docs');
      toast.show('Página enviada a la papelera', { action: { label: 'Deshacer', onClick: async () => { await api.post('/trash/restore', { type: 'page', id }); qc.invalidateQueries({ queryKey: ['pages'] }); navigate(`/docs/${id}`); } } });
    } catch (e) {
      toast.error(e);
    }
  };

  if (isLoading) return <><Topbar crumbs={[{ label: 'Documentos', to: '/docs' }]} /><Loading /></>;
  if (error) return <><Topbar crumbs={[{ label: 'Documentos', to: '/docs' }]} /><ErrorState error={error} onRetry={refetch} /></>;

  const crumbs = [{ label: 'Documentos', to: '/docs' }, ...page.breadcrumbs.map((b) => ({ label: b.title || 'Sin título', to: `/docs/${b.id}`, icon: b.icon })), { label: page.title || 'Sin título', icon: page.icon }];
  const saveLabel = {
    saved: <><Check size={13} />Guardado</>,
    dirty: <>Cambios sin guardar</>,
    saving: <><Spinner size={12} />Guardando…</>,
    offline: <><CloudOff size={13} />Sin conexión, reintentando…</>,
    conflict: <><AlertTriangle size={13} />Conflicto</>,
  }[status];

  return (
    <>
      <Topbar
        crumbs={isMobile ? [{ label: page.title || 'Sin título', icon: page.icon }] : crumbs}
        actions={
          <>
            {canEdit && <span className={`save-state ${status === 'offline' || status === 'conflict' ? 'error' : ''}`} aria-live="polite">{saveLabel}</span>}
            {isMobile && <IconButton icon={List} label="Páginas" onClick={onOpenTree} />}
            {!page.is_template && <FavoriteButton type="page" id={id} />}
            <IconButton icon={History} label="Historial de versiones" onClick={() => setHistory(true)} />
            <Menu
              trigger={(p) => <IconButton icon={MoreHorizontal} label="Más opciones" {...p} />}
              items={[
                canEdit && { label: 'Duplicar', icon: Copy, onClick: () => duplicate.mutate(false) },
                canEdit && !page.is_template && { label: 'Guardar como plantilla', icon: LayoutTemplate, onClick: () => duplicate.mutate(true) },
                canEdit && { label: 'Mover a…', icon: FolderInput, onClick: () => setMoving(true) },
                page.created_by === me.id && { label: page.visibility === 'private' ? 'Compartir con el equipo' : 'Hacer privada (solo yo)', icon: page.visibility === 'private' ? Globe : Lock, onClick: () => setMeta.mutate({ visibility: page.visibility === 'private' ? 'workspace' : 'private' }) },
                canEdit && 'sep',
                canEdit && { label: 'Enviar a la papelera', icon: Trash2, danger: true, onClick: remove },
              ]}
            />
          </>
        }
      />
      <div className="content">
        <article className="doc">
          {conflict && (
            <div className="mb-4">
              <Callout tone="warning" icon={AlertTriangle} title={`${conflict.updated_by || 'Otra persona'} guardó cambios mientras editabas`}>
                <p className="small">Para no perder trabajo, tus últimos cambios no se han guardado todavía. Elige qué hacer:</p>
                <div className="btn-group mt-2">
                  <Button size="sm" onClick={() => resolveConflict('copy')}>Guardar mi versión como copia</Button>
                  <Button size="sm" onClick={() => resolveConflict('discard')}>Ver la versión actual</Button>
                  <Button size="sm" variant="danger" onClick={() => resolveConflict('overwrite')}>Reemplazar con la mía</Button>
                </div>
                <p className="faint tiny mt-2">Si reemplazas, la versión anterior queda en el historial y se puede restaurar.</p>
              </Callout>
            </div>
          )}
          {page.is_template === 1 && <div className="mb-3"><Pill color="purple">Plantilla{page.template_category ? ` · ${page.template_category}` : ''}</Pill></div>}
          <div className="doc-head">
            <EmojiPicker value={page.icon} onChange={(v) => setMeta.mutate({ icon: v })} icons={PAGE_ICONS}>
              {({ onClick }) => page.icon ? (
                <button className="doc-icon-btn" onClick={canEdit ? onClick : undefined} aria-label="Cambiar ícono">{page.icon}</button>
              ) : canEdit ? (
                <Button size="xs" variant="ghost" icon={Smile} className="doc-add-icon" onClick={onClick}>Agregar ícono</Button>
              ) : null}
            </EmojiPicker>
            <AutoTextarea
              className="doc-title"
              placeholder="Sin título"
              value={title}
              readOnly={!canEdit}
              onChange={(e) => {
                const v = e.target.value.replace(/\n/g, '');
                setTitle(v);
                schedule({ title: v });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              aria-label="Título del documento"
            />
          </div>
          <div className="doc-meta">
            {page.updated_by_user && <span className="flex" style={{ gap: 5 }}><Avatar user={page.updated_by_user} size="xs" />Editado {timeAgo(page.updated_at)} por {page.updated_by_user.name}</span>}
            {page.visibility === 'private' && <span className="flex" style={{ gap: 4 }}><Lock size={12} />Solo tú</span>}
            {page.project ? (
              <Link to={`/projects/${page.project.id}?view=docs`} className="flex link" style={{ gap: 4 }}><FolderKanban size={12} />{page.project.name}</Link>
            ) : canEdit && !page.is_template && (
              <ProjectPicker value={null} onChange={(v) => v && setMeta.mutate({ project_id: v })} placeholder="Vincular a proyecto">
                {({ onClick }) => <button className="link faint flex" style={{ gap: 4, color: 'var(--text-3)' }} onClick={onClick}><FolderKanban size={12} />Vincular a un proyecto</button>}
              </ProjectPicker>
            )}
          </div>

          {page.children.length > 0 && (
            <div className="subpages">
              {page.children.map((c) => (
                <Link key={c.id} to={`/docs/${c.id}`} className="list-row" style={{ minHeight: 32 }}><span>{c.icon || '📄'}</span><span className="title" style={{ textDecoration: 'underline', textDecorationColor: 'var(--border-strong)' }}>{c.title || 'Sin título'}</span></Link>
              ))}
            </div>
          )}

          <div
            className="doc-editor"
            onKeyDownCapture={() => { interacted.current = true; }}
            onPasteCapture={() => { interacted.current = true; }}
            onDropCapture={() => { interacted.current = true; }}
            onPointerDownCapture={() => { interacted.current = true; }}
          >
            <Editor
              key={editorKey}
              initialContent={editorKey === 0 ? page.content : qc.getQueryData(['pages', 'detail', id])?.content}
              editable={Boolean(canEdit) && status !== 'conflict'}
              pageId={id}
              projectId={page.project_id}
              members={members}
              onChange={(blocks) => canEdit && interacted.current && schedule({ content: blocks })}
            />
          </div>

          <div className="section" style={{ marginTop: 48 }}>
            <div className="section-title"><h3>Tareas, proyectos y reuniones vinculados</h3></div>
            <RelatedItems entityType="page" entityId={id} items={page.related} types="task,project,meeting,decision,goal,page" />
          </div>
          {page.backlinks.length > 0 && (
            <div className="section">
              <div className="section-title"><h3>Páginas que mencionan esta</h3></div>
              {page.backlinks.map((b) => <Link key={b.id} to={`/docs/${b.id}`} className="list-row"><span>{b.icon || '📄'}</span><span className="title">{b.title || 'Sin título'}</span></Link>)}
            </div>
          )}
          <div className="section">
            <div className="section-title"><h3>Archivos adjuntos</h3></div>
            <Attachments entityType="page" entityId={id} files={page.attachments} projectId={page.project_id} visibility={page.visibility === 'private' ? 'private' : undefined} />
          </div>
          {page.visibility !== 'private' && (
            <div className="section">
              <div className="section-title"><h3>Comentarios</h3></div>
              <Comments entityType="page" entityId={id} />
            </div>
          )}
          {canEdit && (
            <div className="mt-6"><SubpageButton parentId={id} /></div>
          )}
          <p className="faint tiny mt-4">Creado {fmtDateTime(page.created_at)}{page.created_by_user ? ` por ${page.created_by_user.name}` : ''}</p>
        </article>
      </div>
      {history && <VersionsModal page={page} canEdit={canEdit} onClose={() => setHistory(false)} onRestored={async () => { const fresh = await refetch(); versionRef.current = fresh.data.version; setTitle(fresh.data.title); setEditorKey((k) => k + 1); }} />}
      {moving && <MoveModal page={page} pages={pages} onClose={() => setMoving(false)} onMove={(parent_id) => setMeta.mutate({ parent_id })} />}
    </>
  );
}

function SubpageButton({ parentId }) {
  const create = useCreatePage();
  return <Button size="sm" variant="ghost" icon={Plus} onClick={() => create({ parent_id: parentId })}>Agregar subpágina</Button>;
}

function VersionsModal({ page, canEdit, onClose, onRestored }) {
  const confirm = useConfirm();
  const { data = [], isLoading } = useQuery({ queryKey: ['pages', 'versions', page.id], queryFn: () => api.get(`/pages/${page.id}/versions`) });
  const [preview, setPreview] = useState(null);
  const { data: version } = useQuery({ queryKey: ['pages', 'version', preview], queryFn: () => api.get(`/pages/${page.id}/versions/${preview}`), enabled: Boolean(preview) });
  const restore = useAction((vid) => api.post(`/pages/${page.id}/versions/${vid}/restore`), { invalidate: ['pages'], success: 'Versión restaurada', onSuccess: () => { onRestored(); onClose(); } });
  return (
    <Modal size="lg" title="Historial de versiones" onClose={onClose}>
      <p className="muted small mb-3">Se guarda una versión cada vez que alguien edita después de una pausa. Restaurar no borra la versión actual: también queda en el historial.</p>
      {isLoading ? <Loading /> : !data.length ? <EmptyState compact title="Todavía no hay versiones anteriores" /> : (
        <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ width: 240, flexShrink: 0 }}>
            {data.map((v) => (
              <button key={v.id} className="list-row" style={preview === v.id ? { background: 'var(--bg-active)' } : undefined} onClick={() => setPreview(v.id)}>
                <Avatar user={v.user} size="xs" />
                <div className="grow"><div className="small">{fmtDateTime(v.created_at)}</div><div className="faint tiny">{v.user?.name || '—'}</div></div>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            {version ? (
              <>
                <h3 style={{ fontSize: 16 }}>{version.title || 'Sin título'}</h3>
                <div className="card pad mt-2" style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{blocksPreview(version.content)}</div>
                {canEdit && <Button className="mt-3" variant="primary" loading={restore.isPending} onClick={async () => (await confirm({ title: '¿Restaurar esta versión?', message: 'La versión actual se conservará en el historial.', confirmLabel: 'Restaurar' })) && restore.mutate(version.id)}>Restaurar esta versión</Button>}
              </>
            ) : <p className="faint small">Elige una versión para verla.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function blocksPreview(blocks) {
  const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.text || (x.props?.label ? `@${x.props.label}` : '') || text(x.content))).join('') : '');
  const out = [];
  const walk = (list, depth = 0) => {
    for (const b of list || []) {
      const prefix = b.type === 'heading' ? '# ' : b.type === 'bulletListItem' ? '• ' : b.type === 'numberedListItem' ? '1. ' : b.type === 'checkListItem' ? (b.props?.checked ? '☑ ' : '☐ ') : '';
      out.push('  '.repeat(depth) + prefix + text(b.content));
      walk(b.children, depth + 1);
    }
  };
  walk(blocks);
  return out.join('\n') || '(vacío)';
}

function MoveModal({ page, pages, onClose, onMove }) {
  const [q, setQ] = useState('');
  // No se puede mover dentro de sí misma ni de sus descendientes.
  const blocked = new Set([page.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) if (p.parent_id && blocked.has(p.parent_id) && !blocked.has(p.id)) { blocked.add(p.id); grew = true; }
  }
  const options = pages.filter((p) => !blocked.has(p.id) && (p.title || 'Sin título').toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal size="sm" title="Mover página" onClose={onClose}>
      <input className="input mb-3" autoFocus placeholder="Buscar página destino…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="list-row" onClick={() => { onMove(null); onClose(); }}><FileText size={15} className="faint" />Nivel principal (sin página superior)</button>
      {options.map((p) => (
        <button key={p.id} className="list-row" onClick={() => { onMove(p.id); onClose(); }}>
          <span>{p.icon || '📄'}</span><span className="grow title">{p.title || 'Sin título'}</span>
          {p.id === page.parent_id && <span className="meta">actual</span>}
        </button>
      ))}
    </Modal>
  );
}
