import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate, useSearchParams, matchPath } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Home, CheckSquare, FolderKanban, FileText, CalendarDays, Wallet, MessageSquare, CalendarClock, Settings, Search, Bell, Inbox,
  Plus, Users, Trash2, Gavel, Target, Paperclip, Sprout, ChevronDown, LogOut, Sun, Moon, Monitor, Menu as MenuIcon,
  ChevronRight, Star, Receipt, Lightbulb, Activity as ActivityIcon, CornerDownLeft, X, WifiOff,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { connectLive } from '../lib/live.js';
import { useAuth, useCan, useDebounced, useFavorites, useIsMobile, useMe, usePref, useProjects } from '../lib/hooks.js';
import { Avatar, IconButton, Snippet, Spinner, Button } from './ui.jsx';
import { Menu, Modal, useToast } from './overlay.jsx';
import { EntityIcon, ENTITY_LABELS } from './pickers.jsx';
import TaskDrawer, { QuickTaskModal } from './TaskPanel.jsx';
import { NewProjectModal } from '../pages/Projects.jsx';
import { MeetingModal } from '../pages/Meetings.jsx';
import { CaptureModal } from '../pages/Inbox.jsx';
import { TransactionModal } from '../pages/finance/TransactionForm.jsx';

const LayoutContext = createContext(null);
export const useLayout = () => useContext(LayoutContext);

export const NAV = [
  { key: 'home', to: '/', label: 'Inicio', icon: Home, end: true },
  { key: 'tasks', to: '/tasks', label: 'Mis tareas', icon: CheckSquare },
  { key: 'projects', to: '/projects', label: 'Proyectos', icon: FolderKanban },
  { key: 'docs', to: '/docs', label: 'Documentos', icon: FileText },
  { key: 'calendar', to: '/calendar', label: 'Calendario', icon: CalendarDays },
  { key: 'meetings', to: '/meetings', label: 'Reuniones', icon: CalendarClock },
  { key: 'decisions', to: '/decisions', label: 'Decisiones', icon: Gavel },
  { key: 'goals', to: '/goals', label: 'Objetivos', icon: Target },
  { key: 'finance', to: '/finance', label: 'Finanzas', icon: Wallet, perm: ['finance.view', 'finance.record'] },
  { key: 'chat', to: '/chat', label: 'Chat', icon: MessageSquare },
  { key: 'files', to: '/files', label: 'Archivos', icon: Paperclip },
];

export default function Layout() {
  const qc = useQueryClient();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [create, setCreate] = useState(null);
  const [online, setOnline] = useState(true);
  const { data: auth } = useAuth();

  useEffect(() => connectLive(qc, { onStatus: (s) => setOnline(s === 'online') }), [qc]);
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Panel de tarea: ?task=ID desde cualquier lugar, o la ruta /tasks/:id
  const routeTask = matchPath('/tasks/:taskId', location.pathname)?.params.taskId;
  const taskId = params.get('task') || routeTask;
  const openTask = useCallback(
    (id) => {
      const next = new URLSearchParams(params);
      next.set('task', id);
      setParams(next);
    },
    [params, setParams],
  );
  const closeTask = useCallback(() => {
    if (routeTask && !params.get('task')) return navigate('/tasks');
    const next = new URLSearchParams(params);
    next.delete('task');
    setParams(next);
  }, [params, setParams, routeTask, navigate]);

  const ctx = useMemo(
    () => ({
      openSidebar: () => setSidebarOpen(true),
      openPalette: () => setPaletteOpen(true),
      openCreate: (kind, defaults = {}) => setCreate({ kind, defaults }),
      openTask,
      online,
    }),
    [openTask, online],
  );

  const closeCreate = () => setCreate(null);
  const createPage = async (defaults = {}) => {
    try {
      const page = await api.post('/pages', defaults);
      qc.invalidateQueries({ queryKey: ['pages'] });
      navigate(`/docs/${page.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  const toast = useToast();
  useEffect(() => {
    if (create?.kind === 'page') {
      createPage(create.defaults);
      setCreate(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create]);

  if (!me) return null;
  return (
    <LayoutContext.Provider value={ctx}>
      <div className="app">
        {isMobile && sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="main">
          {!online && (
            <div className="offline-bar"><WifiOff size={12} style={{ verticalAlign: -1, marginRight: 6 }} />Reconectando… los cambios de otros pueden tardar en aparecer.</div>
          )}
          {auth?.storageWarning && (
            <div className="offline-bar" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              Los datos no se están guardando de forma permanente: este alojamiento borra su disco. Configura Turso (ver docs/DESPLIEGUE-GRATIS.md).
            </div>
          )}
          <Outlet />
        </main>
        <MobileNav />
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {taskId && <TaskDrawer key={taskId} id={Number(taskId)} onClose={closeTask} />}
      {create?.kind === 'task' && <QuickTaskModal defaults={create.defaults} onClose={closeCreate} />}
      {create?.kind === 'project' && <NewProjectModal defaults={create.defaults} onClose={closeCreate} />}
      {create?.kind === 'meeting' && <MeetingModal defaults={create.defaults} onClose={closeCreate} />}
      {create?.kind === 'capture' && <CaptureModal onClose={closeCreate} />}
      {(create?.kind === 'expense' || create?.kind === 'income' || create?.kind === 'transaction') && (
        <TransactionModal defaults={{ kind: create.kind === 'transaction' ? 'expense' : create.kind, ...create.defaults }} onClose={closeCreate} />
      )}
    </LayoutContext.Provider>
  );
}

/** Opciones del menú de creación rápida según permisos. */
export function useCreateItems() {
  const { openCreate } = useLayout();
  const canProject = useCan('projects.create');
  const canDocs = useCan('docs.edit');
  const canFinance = useCan('finance.record');
  return [
    { label: 'Tarea', icon: CheckSquare, onClick: () => openCreate('task'), hint: 'T' },
    canDocs && { label: 'Documento o nota', icon: FileText, onClick: () => openCreate('page') },
    canProject && { label: 'Proyecto', icon: FolderKanban, onClick: () => openCreate('project') },
    canFinance && { label: 'Gasto', icon: Receipt, onClick: () => openCreate('expense') },
    canFinance && { label: 'Ingreso', icon: Wallet, onClick: () => openCreate('income') },
    { label: 'Reunión', icon: CalendarClock, onClick: () => openCreate('meeting') },
    'sep',
    { label: 'Capturar idea rápida', icon: Lightbulb, onClick: () => openCreate('capture') },
  ];
}

function Sidebar({ open }) {
  const me = useMe();
  const { data: auth } = useAuth();
  const { openPalette } = useLayout();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createItems = useCreateItems();
  const [sidebarPref] = usePref('sidebar', {});
  const [, setTheme] = usePref('theme', 'system');
  const hidden = sidebarPref?.hidden || [];
  const { data: notif } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/notifications?unread=1') });
  const { data: inbox } = useQuery({ queryKey: ['inbox'], queryFn: () => api.get('/inbox') });
  const { data: channels } = useQuery({ queryKey: ['chat', 'channels'], queryFn: () => api.get('/chat/channels') });
  const { data: favorites } = useFavorites();
  const { data: projects } = useProjects({ status: 'active,planning' });
  const [projectsOpen, setProjectsOpen] = useState(true);
  const chatUnread = (channels || []).reduce((s, c) => s + c.unread, 0);
  const canSee = (item) => !item.perm || item.perm.some((p) => me.permissions.includes(p));

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/login');
    qc.invalidateQueries({ queryKey: ['auth'] });
  };

  const theme = me.prefs?.theme || 'system';
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navegación principal">
      <div className="sb-head">
        <Menu
          placement="bottom-start"
          width={240}
          trigger={(p) => (
            <button className="ws-switch" {...p}>
              <span className="ws-logo"><Sprout size={15} /></span>
              <span className="ws-name">{auth?.workspace?.name}</span>
              <ChevronDown size={14} className="faint" />
            </button>
          )}
          items={[
            { section: me.email },
            { label: 'Mi perfil y preferencias', icon: Settings, onClick: () => navigate('/settings/profile') },
            { section: 'Tema' },
            { label: 'Claro', icon: Sun, checked: theme === 'light', onClick: () => setTheme('light') },
            { label: 'Oscuro', icon: Moon, checked: theme === 'dark', onClick: () => setTheme('dark') },
            { label: 'Automático', icon: Monitor, checked: theme === 'system', onClick: () => setTheme('system') },
            'sep',
            { label: 'Cerrar sesión', icon: LogOut, onClick: logout },
          ]}
        />
      </div>
      <div className="sb-scroll">
        <button className="sb-item" onClick={openPalette}>
          <span className="icon"><Search size={16} /></span>
          <span className="label">Buscar</span>
          <span className="kbd hide-sm">⌘K</span>
        </button>
        <NavLink to="/inbox" className="sb-item">
          <span className="icon"><Inbox size={16} /></span>
          <span className="label">Bandeja de entrada</span>
          {inbox?.length > 0 && <span className="sb-badge muted">{inbox.length}</span>}
        </NavLink>
        <NavLink to="/notifications" className="sb-item">
          <span className="icon"><Bell size={16} /></span>
          <span className="label">Notificaciones</span>
          {notif?.unread > 0 && <span className="sb-badge">{notif.unread > 99 ? '99+' : notif.unread}</span>}
        </NavLink>
        <div className="sb-new">
          <Menu
            placement="bottom-start"
            width={230}
            items={createItems}
            trigger={(p) => (
              <Button variant="primary" size="sm" icon={Plus} {...p} style={{ flex: 1, justifyContent: 'flex-start' }}>
                Nuevo
              </Button>
            )}
          />
        </div>

        <div className="sb-group" style={{ marginTop: 6 }}>
          {NAV.filter(canSee).filter((n) => !hidden.includes(n.key)).map((n) => (
            <NavLink key={n.key} to={n.to} end={n.end} className="sb-item">
              <span className="icon"><n.icon size={16} /></span>
              <span className="label">{n.label}</span>
              {n.key === 'chat' && chatUnread > 0 && <span className="sb-badge">{chatUnread > 99 ? '99+' : chatUnread}</span>}
            </NavLink>
          ))}
        </div>

        {favorites?.length > 0 && (
          <div className="sb-group">
            <div className="sb-group-title">Favoritos</div>
            {favorites.map((f) => (
              <NavLink key={`${f.type}-${f.id}`} to={f.url} className="sb-item">
                {f.icon ? <span className="emoji">{f.icon}</span> : <span className="icon"><EntityIconSmall type={f.type} /></span>}
                <span className="label">{f.title}</span>
              </NavLink>
            ))}
          </div>
        )}

        {projects?.length > 0 && (
          <div className="sb-group">
            <div className="sb-group-title">
              <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setProjectsOpen(!projectsOpen)}>
                <ChevronRight size={12} style={{ transform: projectsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                Proyectos activos
              </span>
            </div>
            {projectsOpen &&
              projects.slice(0, 12).map((p) => (
                <NavLink key={p.id} to={`/projects/${p.id}`} className="sb-item">
                  <span className="emoji">{p.icon || '📁'}</span>
                  <span className="label">{p.name}</span>
                </NavLink>
              ))}
          </div>
        )}
      </div>
      <div className="sb-foot">
        <NavLink to="/members" className="sb-item">
          <span className="icon"><Users size={16} /></span>
          <span className="label">Integrantes</span>
        </NavLink>
        <NavLink to="/settings" className="sb-item">
          <span className="icon"><Settings size={16} /></span>
          <span className="label">Configuración</span>
        </NavLink>
        <NavLink to="/trash" className="sb-item">
          <span className="icon"><Trash2 size={16} /></span>
          <span className="label">Papelera</span>
        </NavLink>
        <Link to="/settings/profile" className="sb-item" style={{ marginTop: 4 }}>
          <Avatar user={me} size="sm" />
          <span className="label" style={{ color: 'var(--text)' }}>{me.name}</span>
        </Link>
      </div>
    </aside>
  );
}

function EntityIconSmall({ type }) {
  if (type === 'view') return <Star size={15} />;
  return <EntityIcon item={{ type }} />;
}

function MobileNav() {
  const { openSidebar } = useLayout();
  const createItems = useCreateItems();
  const { data: channels } = useQuery({ queryKey: ['chat', 'channels'], queryFn: () => api.get('/chat/channels') });
  const { data: notif } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/notifications?unread=1') });
  const chatUnread = (channels || []).reduce((s, c) => s + c.unread, 0);
  return (
    <nav className="mobile-nav" aria-label="Navegación móvil">
      <NavLink to="/" end>
        <Home size={21} />
        Inicio
      </NavLink>
      <NavLink to="/tasks">
        <CheckSquare size={21} />
        Tareas
      </NavLink>
      <Menu
        placement="top-start"
        width={240}
        items={createItems}
        trigger={(p) => (
          <button className="fab" aria-label="Crear" {...p}>
            <Plus size={24} />
          </button>
        )}
      />
      <NavLink to="/chat">
        <MessageSquare size={21} />
        Chat
        {chatUnread > 0 && <span className="nav-badge">{chatUnread}</span>}
      </NavLink>
      <button onClick={openSidebar}>
        <MenuIcon size={21} />
        Más
        {notif?.unread > 0 && <span className="nav-badge">{notif.unread}</span>}
      </button>
    </nav>
  );
}

/** Barra superior de cada pantalla: migas de pan y acciones. */
export function Topbar({ crumbs = [], actions, bordered, children }) {
  const { openSidebar } = useLayout();
  const isMobile = useIsMobile();
  return (
    <header className={`topbar ${bordered ? 'bordered' : ''}`}>
      {isMobile && <IconButton icon={MenuIcon} label="Menú" onClick={openSidebar} />}
      <nav className="crumbs" aria-label="Ruta">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <ChevronRight size={13} className="crumb-sep" />}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.icon && <span style={{ marginRight: 5 }}>{c.icon}</span>}{c.label}</Link> : <span className={i === crumbs.length - 1 ? 'current' : ''}>{c.icon && <span style={{ marginRight: 5 }}>{c.icon}</span>}{c.label}</span>}
          </span>
        ))}
        {children}
      </nav>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

// ───────── Paleta de comandos (⌘K) ─────────
function CommandPalette({ onClose }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 180);
  const navigate = useNavigate();
  const { openCreate } = useLayout();
  const me = useMe();
  const [focus, setFocus] = useState(0);
  const listRef = useRef(null);
  const { data, isFetching } = useQuery({ queryKey: ['search', dq], queryFn: () => api.get(`/search${qs({ q: dq })}`), enabled: dq.length >= 2 });

  const actions = [
    { title: 'Nueva tarea', icon: CheckSquare, run: () => openCreate('task') },
    me.permissions.includes('docs.edit') && { title: 'Nuevo documento', icon: FileText, run: () => openCreate('page') },
    me.permissions.includes('projects.create') && { title: 'Nuevo proyecto', icon: FolderKanban, run: () => openCreate('project') },
    me.permissions.includes('finance.record') && { title: 'Registrar gasto', icon: Receipt, run: () => openCreate('expense') },
    { title: 'Programar reunión', icon: CalendarClock, run: () => openCreate('meeting') },
    { title: 'Capturar idea', icon: Lightbulb, run: () => openCreate('capture') },
  ].filter(Boolean);
  const nav = [
    ...NAV.filter((n) => !n.perm || n.perm.some((p) => me.permissions.includes(p))).map((n) => ({ title: n.label, icon: n.icon, run: () => navigate(n.to) })),
    { title: 'Integrantes', icon: Users, run: () => navigate('/members') },
    { title: 'Actividad del equipo', icon: ActivityIcon, run: () => navigate('/activity') },
    { title: 'Configuración', icon: Settings, run: () => navigate('/settings') },
  ];

  const groups = useMemo(() => {
    if (dq.length < 2) {
      const t = q.trim().toLowerCase();
      const f = (list) => (t ? list.filter((a) => a.title.toLowerCase().includes(t)) : list);
      return [
        { label: 'Crear', items: f(actions) },
        { label: 'Ir a', items: f(nav) },
      ].filter((g) => g.items.length);
    }
    const out = (data?.groups || []).map((g) => ({
      label: ENTITY_LABELS[g.type] || g.type,
      items: g.items.map((it) => ({ title: it.title, sub: it.subtitle, snippet: it.snippet, entity: it, run: () => navigate(it.url) })),
    }));
    if (data?.members?.length) out.push({ label: 'Integrantes', items: data.members.map((m) => ({ title: m.name, sub: m.subtitle, member: m, run: () => navigate(m.url) })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, q, data]);

  const flat = groups.flatMap((g) => g.items);
  useEffect(() => setFocus(0), [dq, q]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.focused')?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const run = (item) => {
    onClose();
    item.run();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(f + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(f - 1, 0));
    } else if (e.key === 'Enter' && flat[focus]) {
      e.preventDefault();
      run(flat[focus]);
    }
  };
  let idx = -1;
  return (
    <Modal onClose={onClose} size="palette">
      <div className="palette-input" style={{ margin: '-8px -20px 0' }}>
        <Search size={18} className="faint" />
        <input autoFocus placeholder="Buscar tareas, documentos, proyectos, mensajes… o escribe una acción" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Buscar" />
        {isFetching ? <Spinner size={16} /> : q && <IconButton icon={X} size="xs" label="Limpiar" onClick={() => setQ('')} />}
      </div>
      <div className="palette-results" ref={listRef} style={{ margin: '0 -20px' }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="palette-group">{g.label}</div>
            {g.items.map((it) => {
              idx += 1;
              const i = idx;
              return (
                <div key={i} className={`palette-item ${i === focus ? 'focused' : ''}`} onMouseMove={() => setFocus(i)} onClick={() => run(it)}>
                  <span className="ico">{it.entity ? <EntityIcon item={it.entity} /> : it.member ? <Avatar user={it.member} size="sm" /> : <it.icon size={16} />}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate">{it.title || 'Sin título'}</div>
                    {it.snippet && <div className="sub truncate"><Snippet text={it.snippet} /></div>}
                  </div>
                  {it.sub && <span className="sub truncate" style={{ maxWidth: 180 }}>{it.sub}</span>}
                  {i === focus && <CornerDownLeft size={14} className="faint" />}
                </div>
              );
            })}
          </div>
        ))}
        {dq.length >= 2 && !isFetching && !flat.length && (
          <div className="empty compact"><p>No encontramos «{dq}». Prueba con otras palabras.</p></div>
        )}
      </div>
      <div className="palette-foot hide-sm" style={{ margin: '0 -20px -16px' }}>
        <span><span className="kbd">↑↓</span> navegar</span>
        <span><span className="kbd">↵</span> abrir</span>
        <span><span className="kbd">esc</span> cerrar</span>
      </div>
    </Modal>
  );
}
