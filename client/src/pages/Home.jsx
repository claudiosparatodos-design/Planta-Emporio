import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarClock, Gavel, Bell, Wallet, FolderKanban, Activity as ActivityIcon, CheckSquare, Plus, FileText, Receipt,
  Lightbulb, Check, SlidersHorizontal, ArrowUp, ArrowDown, Eye, EyeOff, Target, Users, Clock, X, HandCoins, Sparkles, Inbox,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAction, useCan, useMe, usePref, useMemberMap } from '../lib/hooks.js';
import { cap, fmtDate, fmtTime, money, relativeDay, timeAgo, plural } from '../lib/format.js';
import { GOAL_STATUS, PROJECT_STATUS } from '../lib/constants.js';
import { Avatar, Button, EmptyState, ErrorState, Pill, Progress, SkeletonList, Switch, IconButton, Segmented } from '../components/ui.jsx';
import { Modal } from '../components/overlay.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { ActivityList } from '../components/collab.jsx';
import { TaskRow, useTaskPatch } from '../components/tasks.jsx';

const PERSONAL_SECTIONS = [
  { key: 'focus', label: 'Para hoy y vencidas' },
  { key: 'my_tasks', label: 'Mis tareas' },
  { key: 'attention', label: 'Necesita mi atención' },
  { key: 'decisions', label: 'Decisiones por aprobar' },
  { key: 'meetings', label: 'Próximas reuniones' },
  { key: 'reminders', label: 'Recordatorios' },
  { key: 'projects', label: 'Mis proyectos' },
  { key: 'finance', label: 'Resumen financiero' },
  { key: 'notifications', label: 'Notificaciones' },
  { key: 'activity', label: 'Actividad reciente' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Home() {
  const me = useMe();
  const [tab, setTab] = usePref('homeTab', 'me');
  const [dash, setDash] = usePref('dashboard', {});
  const [customize, setCustomize] = useState(false);
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Inicio' }]}
        actions={
          <>
            <Segmented size="sm" value={tab === 'company' ? 'company' : 'me'} onChange={setTab} options={[{ value: 'me', label: 'Para mí' }, { value: 'company', label: 'Empresa' }]} />
            {tab !== 'company' && <IconButton icon={SlidersHorizontal} label="Personalizar inicio" onClick={() => setCustomize(true)} />}
          </>
        }
      />
      <div className="content">
        <div className="page">
          <div className="mb-4">
            <div className="greeting">{greeting()}, {me.name.split(' ')[0]}</div>
            <div className="muted mt-1">{cap(fmtDate(new Date(), "EEEE d 'de' MMMM"))}</div>
          </div>
          {tab === 'company' ? <CompanyDashboard /> : <PersonalDashboard prefs={dash} />}
        </div>
      </div>
      {customize && <CustomizeModal prefs={dash} onSave={setDash} onClose={() => setCustomize(false)} />}
    </>
  );
}

function QuickActions() {
  const { openCreate } = useLayout();
  const canFinance = useCan('finance.record');
  const canDocs = useCan('docs.edit');
  const canProject = useCan('projects.create');
  return (
    <div className="btn-group mb-4">
      <Button size="sm" icon={CheckSquare} onClick={() => openCreate('task')}>Tarea</Button>
      {canDocs && <Button size="sm" icon={FileText} onClick={() => openCreate('page')}>Nota</Button>}
      {canProject && <Button size="sm" icon={FolderKanban} onClick={() => openCreate('project')}>Proyecto</Button>}
      {canFinance && <Button size="sm" icon={Receipt} onClick={() => openCreate('expense')}>Gasto</Button>}
      <Button size="sm" icon={CalendarClock} onClick={() => openCreate('meeting')}>Reunión</Button>
      <Button size="sm" variant="ghost" icon={Lightbulb} onClick={() => openCreate('capture')}>Capturar idea</Button>
    </div>
  );
}

function Card({ title, icon: Icon, action, children, className = '', count }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <h3>{Icon && <Icon size={15} className="faint" />}{title}{count != null && <span className="faint" style={{ fontWeight: 500 }}>{count}</span>}</h3>
        {action}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function PersonalDashboard({ prefs }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard', 'me'], queryFn: () => api.get('/dashboard/me') });
  const patch = useTaskPatch();
  const toggle = (t, status) => patch(t.id, { status });
  if (isLoading) return <SkeletonList rows={8} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const hidden = prefs?.hidden || [];
  const order = prefs?.order?.length ? prefs.order : PERSONAL_SECTIONS.map((s) => s.key);
  const show = (k) => !hidden.includes(k);
  const attentionCount = data.attention.review.length + data.attention.blocked.length + data.attention.waiting_on_me.length;

  const sections = {
    focus: (data.overdue.length > 0 || data.my_tasks.some((t) => t.due_date === data.today)) && (
      <Card key="focus" className="span-12" title="Para hoy y vencidas" icon={AlertTriangle}>
        {[...data.overdue, ...data.my_tasks.filter((t) => t.due_date === data.today)].map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
      </Card>
    ),
    my_tasks: (
      <Card key="my_tasks" className="span-7" title="Mis tareas" icon={CheckSquare} count={data.counts.open} action={<Link to="/tasks" className="link small">Ver todas</Link>}>
        {data.my_tasks.length ? (
          data.my_tasks.filter((t) => !(t.due_date && t.due_date <= data.today)).slice(0, 10).map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)
        ) : (
          <EmptyState compact title="No tienes tareas pendientes">Cuando te asignen algo aparecerá aquí.</EmptyState>
        )}
      </Card>
    ),
    attention: attentionCount > 0 && (
      <Card key="attention" className="span-5" title="Necesita mi atención" icon={Users} count={attentionCount}>
        {data.attention.review.length > 0 && <div className="menu-label">Esperando tu revisión</div>}
        {data.attention.review.map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
        {data.attention.blocked.length > 0 && <div className="menu-label">Bloqueadas en tus proyectos</div>}
        {data.attention.blocked.map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
        {data.attention.waiting_on_me.length > 0 && <div className="menu-label">Otros esperan a que termines algo</div>}
        {data.attention.waiting_on_me.map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
      </Card>
    ),
    decisions: data.decisions.length > 0 && (
      <Card key="decisions" className="span-5" title="Decisiones por aprobar" icon={Gavel} count={data.decisions.length}>
        {data.decisions.map((d) => (
          <Link key={d.id} to={`/decisions/${d.id}`} className="list-row">
            <span className="grow title">{d.title}</span>
            <span className="meta">{d.proposed_by_name}</span>
          </Link>
        ))}
      </Card>
    ),
    meetings: (
      <Card key="meetings" className="span-5" title="Próximas reuniones" icon={CalendarClock} action={<Link to="/meetings" className="link small">Ver todas</Link>}>
        {data.meetings.length ? data.meetings.map((m) => (
          <Link key={m.id} to={`/meetings/${m.id}`} className="list-row">
            <div style={{ width: 54, textAlign: 'center', flexShrink: 0 }}>
              <div className="tiny faint" style={{ textTransform: 'uppercase' }}>{relativeDay(m.starts_at)}</div>
              <div className="strong small">{fmtTime(m.starts_at)}</div>
            </div>
            <span className="grow title">{m.title}</span>
          </Link>
        )) : <EmptyState compact title="Sin reuniones próximas" />}
      </Card>
    ),
    reminders: data.reminders.length > 0 && (
      <Card key="reminders" className="span-5" title="Recordatorios" icon={Clock}>
        {data.reminders.map((r) => <ReminderRow key={r.id} r={r} />)}
      </Card>
    ),
    projects: (
      <Card key="projects" className="span-7" title="Mis proyectos" icon={FolderKanban} action={<Link to="/projects" className="link small">Ver todos</Link>}>
        {data.projects.length ? data.projects.map((p) => <ProjectRow key={p.id} p={p} />) : (
          <EmptyState compact title="Aún no participas en proyectos" />
        )}
      </Card>
    ),
    finance: (data.finance || data.my_reimbursements.length > 0) && (
      <Card key="finance" className="span-5" title="Finanzas" icon={Wallet} action={data.finance && <Link to="/finance" className="link small">Abrir</Link>}>
        {data.finance && <FinanceMini f={data.finance} />}
        {data.my_reimbursements.length > 0 && (
          <div style={{ padding: '6px 8px' }}>
            <div className="menu-label" style={{ padding: '4px 0' }}>La empresa te debe</div>
            {data.my_reimbursements.map((o) => (
              <div key={o.id} className="flex between small" style={{ padding: '3px 0' }}>
                <span className="truncate">{o.title}</span>
                <span className="amount">{money(o.remaining_cents)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    ),
    notifications: (
      <Card key="notifications" className="span-7" title="Notificaciones" icon={Bell} count={data.unread_notifications || null} action={<Link to="/notifications" className="link small">Ver todas</Link>}>
        {data.notifications.length ? data.notifications.map((n) => (
          <Link key={n.id} to={n.link || '/notifications'} className="list-row">
            <span className="n-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span className="grow title">{n.title}</span>
            <span className="meta">{timeAgo(n.created_at)}</span>
          </Link>
        )) : <EmptyState compact title="Estás al día" />}
      </Card>
    ),
    activity: (
      <Card key="activity" className="span-12" title="Actividad reciente del equipo" icon={ActivityIcon} action={<Link to="/activity" className="link small">Ver toda</Link>}>
        <div style={{ padding: '0 8px' }}><ActivityList items={data.activity} compact /></div>
      </Card>
    ),
  };

  return (
    <>
      <QuickActions />
      {data.onboarding && <Onboarding data={data.onboarding} />}
      {data.inbox_count > 0 && (
        <Link to="/inbox" className="callout mb-4" style={{ display: 'flex' }}>
          <Inbox size={17} />
          <div className="callout-body">Tienes {plural(data.inbox_count, 'idea capturada', 'ideas capturadas')} por organizar en tu bandeja.</div>
        </Link>
      )}
      <div className="dash-grid">{order.filter(show).map((k) => sections[k]).filter(Boolean)}</div>
    </>
  );
}

function ReminderRow({ r }) {
  const done = useAction(() => api.patch(`/reminders/${r.id}`, { done: true }), { invalidate: ['dashboard', 'reminders'] });
  const due = new Date(r.remind_at) <= new Date();
  return (
    <div className="list-row">
      <button className="task-check" onClick={() => done.mutate()} aria-label="Marcar como hecho"><Check size={11} strokeWidth={3} /></button>
      <span className="grow title">{r.title}</span>
      <span className="meta" style={due ? { color: 'var(--warning)' } : undefined}>{relativeDay(r.remind_at)} {fmtTime(r.remind_at)}</span>
    </div>
  );
}

export function ProjectRow({ p }) {
  const st = PROJECT_STATUS[p.status];
  return (
    <Link to={`/projects/${p.id}`} className="list-row">
      <span style={{ width: 22, textAlign: 'center', fontSize: 16 }}>{p.icon || '📁'}</span>
      <div className="grow">
        <div className="flex" style={{ gap: 8 }}>
          <span className="title strong" style={{ fontWeight: 550 }}>{p.name}</span>
          {p.status !== 'active' && <Pill color={st.color} size="sm">{st.label}</Pill>}
        </div>
        <div className="flex mt-1" style={{ gap: 10 }}>
          <div style={{ flex: 1, maxWidth: 220 }}><Progress value={p.progress} thin /></div>
          <span className="tiny faint num">{p.stats.done}/{p.stats.total}</span>
          {p.stats.overdue > 0 && <span className="tiny" style={{ color: 'var(--danger)' }}>{p.stats.overdue} vencidas</span>}
          {p.stats.blocked > 0 && <span className="tiny" style={{ color: 'var(--warning)' }}>{p.stats.blocked} bloqueadas</span>}
        </div>
      </div>
      {p.due_date && <span className="meta hide-sm">{fmtDate(p.due_date)}</span>}
    </Link>
  );
}

function FinanceMini({ f }) {
  return (
    <div style={{ padding: '4px 8px' }}>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><div className="tiny faint">Ingresos del mes</div><div className="amount pos">{money(f.month.income_cents)}</div></div>
        <div><div className="tiny faint">Gastos del mes</div><div className="amount">{money(f.month.expense_cents)}</div></div>
        <div><div className="tiny faint">Balance del mes</div><div className={`amount ${f.month.net_cents < 0 ? 'neg' : ''}`}>{money(f.month.net_cents)}</div></div>
        <div><div className="tiny faint">Saldo en cuentas</div><div className="amount">{money(f.balance_cents)}</div></div>
      </div>
      {(f.payable_cents > 0 || f.receivable_cents > 0) && (
        <div className="flex small mt-3" style={{ gap: 14 }}>
          <span className="muted">Por pagar <strong className="num">{money(f.payable_cents)}</strong></span>
          <span className="muted">Por cobrar <strong className="num">{money(f.receivable_cents)}</strong></span>
        </div>
      )}
      {f.pending_approvals > 0 && (
        <Link to="/finance/movements?status=pending" className="callout warning mt-3" style={{ display: 'flex', padding: '8px 10px' }}>
          <HandCoins size={15} />
          <div className="callout-body small">{plural(f.pending_approvals, 'movimiento espera', 'movimientos esperan')} tu aprobación</div>
        </Link>
      )}
      {f.due_soon.length > 0 && (
        <div className="mt-3">
          <div className="tiny faint mb-2">Vencen pronto</div>
          {f.due_soon.map((o) => (
            <div key={o.id} className="flex between small" style={{ padding: '2px 0' }}>
              <span className="truncate">{o.direction === 'payable' ? 'Pagar' : 'Cobrar'}: {o.title}</span>
              <span className={`num ${o.overdue ? 'neg' : 'muted'}`}>{relativeDay(o.due_date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Onboarding({ data }) {
  const done = data.steps.filter((s) => s.done).length;
  const dismiss = useAction(() => api.patch('/settings', { onboarding_dismissed: true }), { invalidate: ['dashboard'] });
  const navigate = useNavigate();
  return (
    <section className="card onboarding mb-4">
      <div className="flex between">
        <div>
          <h3 className="flex" style={{ fontSize: 15 }}><Sparkles size={16} style={{ color: 'var(--accent)' }} />Primeros pasos</h3>
          <p className="muted small mt-1">{done} de {data.steps.length} listos. Configura el espacio en unos minutos.</p>
        </div>
        {data.can_dismiss && <IconButton icon={X} label="Ocultar primeros pasos" onClick={() => dismiss.mutate()} />}
      </div>
      <div className="mt-2" style={{ maxWidth: 360 }}><Progress value={(done / data.steps.length) * 100} thin /></div>
      <div className="mt-3">
        {data.steps.map((s) => (
          <div key={s.key} className={`step ${s.done ? 'done' : ''}`}>
            <span className="step-dot">{s.done && <Check size={12} strokeWidth={3} />}</span>
            <span className="step-label" style={{ flex: 1 }}>{s.label}</span>
            {!s.done && <Button size="xs" onClick={() => navigate(s.href)}>Empezar</Button>}
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomizeModal({ prefs, onSave, onClose }) {
  const [order, setOrder] = useState(() => {
    const base = prefs?.order?.length ? prefs.order : PERSONAL_SECTIONS.map((s) => s.key);
    return [...base, ...PERSONAL_SECTIONS.map((s) => s.key).filter((k) => !base.includes(k))];
  });
  const [hidden, setHidden] = useState(prefs?.hidden || []);
  const move = (i, d) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <Modal
      title="Personalizar inicio"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="left" onClick={() => { setOrder(PERSONAL_SECTIONS.map((s) => s.key)); setHidden([]); }}>Restablecer</Button>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => { onSave({ order, hidden }); onClose(); }}>Guardar</Button>
        </>
      }
    >
      <p className="muted small mb-3">Elige qué secciones ver y en qué orden. Solo afecta tu vista.</p>
      {order.map((k, i) => {
        const s = PERSONAL_SECTIONS.find((x) => x.key === k);
        if (!s) return null;
        const off = hidden.includes(k);
        return (
          <div key={k} className="list-row" style={{ opacity: off ? 0.55 : 1 }}>
            <IconButton icon={off ? EyeOff : Eye} size="sm" label={off ? 'Mostrar' : 'Ocultar'} onClick={() => setHidden(off ? hidden.filter((h) => h !== k) : [...hidden, k])} />
            <span className="grow">{s.label}</span>
            <IconButton icon={ArrowUp} size="sm" label="Subir" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon={ArrowDown} size="sm" label="Bajar" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
          </div>
        );
      })}
    </Modal>
  );
}

// ───────── Panel general de la empresa ─────────
function CompanyDashboard() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard', 'company'], queryFn: () => api.get('/dashboard/company') });
  const members = useMemberMap();
  const patch = useTaskPatch();
  if (isLoading) return <SkeletonList rows={8} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const { tasks } = data;
  const maxLoad = Math.max(1, ...data.workload.map((w) => w.open));
  return (
    <>
      <div className="stats mb-4">
        <div className="card stat"><div className="label">Proyectos activos</div><div className="value">{data.projects.filter((p) => p.status === 'active').length}</div><div className="sub">{data.projects.length} en total abiertos</div></div>
        <div className="card stat"><div className="label">Tareas pendientes</div><div className="value">{tasks.open}</div><div className="sub">{tasks.done_week} terminadas esta semana</div></div>
        <div className="card stat"><div className="label">Atrasadas</div><div className="value" style={tasks.overdue ? { color: 'var(--danger)' } : undefined}>{tasks.overdue}</div><div className="sub">{tasks.blocked} bloqueadas</div></div>
        {data.finance && (
          <div className="card stat"><div className="label">Balance del mes</div><div className={`value ${data.finance.month.net_cents < 0 ? 'neg' : ''}`}>{money(data.finance.month.net_cents, { compact: true })}</div><div className="sub">Saldo {money(data.finance.balance_cents, { compact: true })}</div></div>
        )}
      </div>
      <div className="dash-grid">
        <Card className="span-7" title="Proyectos" icon={FolderKanban} action={<Link to="/projects" className="link small">Ver todos</Link>}>
          {data.projects.length ? data.projects.map((p) => <ProjectRow key={p.id} p={p} />) : <EmptyState compact title="Sin proyectos activos" />}
        </Card>
        <Card className="span-5" title="Carga de trabajo" icon={Users}>
          {data.workload.map((w) => (
            <Link key={w.id} to={`/members/${w.id}`} className="list-row">
              <Avatar user={members.get(w.id) || w} size="sm" />
              <div className="grow">
                <div className="flex between small">
                  <span className="truncate" style={{ fontWeight: 550 }}>{w.name}</span>
                  <span className="faint num">{w.open} abiertas{w.overdue ? <span className="neg"> · {w.overdue} vencidas</span> : ''}</span>
                </div>
                <div className="mt-1"><Progress value={(w.open / maxLoad) * 100} thin tone={w.overdue ? 'danger' : ''} /></div>
              </div>
            </Link>
          ))}
        </Card>
        <Card className="span-7" title="Próximos vencimientos (14 días)" icon={Clock} count={data.upcoming.length}>
          {data.upcoming.length ? data.upcoming.map((t) => <TaskRow key={t.id} task={t} onToggle={(x, s) => patch(x.id, { status: s })} />) : <EmptyState compact title="Nada vence en los próximos días" />}
        </Card>
        <Card className="span-5" title="Objetivos" icon={Target} action={<Link to="/goals" className="link small">Ver todos</Link>}>
          {data.goals.length ? data.goals.map((g) => (
            <Link key={g.id} to={`/goals/${g.id}`} className="list-row">
              <div className="grow">
                <div className="flex between small"><span className="truncate" style={{ fontWeight: 550 }}>{g.title}</span><Pill size="sm" color={GOAL_STATUS[g.status].color}>{GOAL_STATUS[g.status].label}</Pill></div>
                <div className="flex mt-1"><div style={{ flex: 1 }}><Progress value={g.progress} thin /></div><span className="tiny faint num">{g.progress}%</span></div>
              </div>
            </Link>
          )) : <EmptyState compact title="Sin objetivos definidos" actions={<Link className="btn sm" to="/goals"><Plus size={14} />Definir objetivo</Link>} />}
        </Card>
        {data.overdue.length > 0 && (
          <Card className="span-7" title="Tareas atrasadas" icon={AlertTriangle} count={data.overdue.length}>
            {data.overdue.map((t) => <TaskRow key={t.id} task={t} onToggle={(x, s) => patch(x.id, { status: s })} />)}
          </Card>
        )}
        {data.finance && (
          <Card className="span-5" title="Finanzas" icon={Wallet} action={<Link to="/finance" className="link small">Abrir</Link>}>
            <FinanceMini f={data.finance} />
          </Card>
        )}
        <Card className="span-12" title="Actividad de la empresa" icon={ActivityIcon}>
          <div style={{ padding: '0 8px' }}><ActivityList items={data.activity} compact /></div>
        </Card>
      </div>
    </>
  );
}
