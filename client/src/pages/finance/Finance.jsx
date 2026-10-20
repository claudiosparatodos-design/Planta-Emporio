import { useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Wallet, Receipt, Download, Check, X, Ban, Pencil, HandCoins, AlertTriangle, ArrowDownLeft, ArrowUpRight, Landmark, ArrowLeftRight,
  Search, Paperclip, History, Clock,
} from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { ACCOUNT_TYPES, KIND_LABELS } from '../../lib/constants.js';
import { fmtDate, fmtDateTime, money, plural, relativeDay, todayIso } from '../../lib/format.js';
import { useAction, useCan, useFinanceMeta, useMemberMap, usePref, useProjects } from '../../lib/hooks.js';
import { Button, Callout, EmptyState, ErrorState, Loading, Pill, Progress, SkeletonList, Avatar } from '../../components/ui.jsx';
import { Drawer, useConfirm } from '../../components/overlay.jsx';
import { Topbar, useLayout } from '../../components/Layout.jsx';
import { Attachments, Comments } from '../../components/collab.jsx';
import { CategoryBars, EXPENSE_COLOR, INCOME_COLOR, MonthlyChart } from './Charts.jsx';
import { TransactionModal } from './TransactionForm.jsx';
import { Obligations, Budgets, Partners, Reports, FinanceSetup } from './FinanceMore.jsx';

export const KIND_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, contribution: HandCoins, loan_in: Landmark, reimbursement: HandCoins, repayment: Landmark, transfer: ArrowLeftRight };
const INFLOW = ['income', 'contribution', 'loan_in'];

// ───────── Periodos ─────────
export const PERIODS = [
  { value: 'month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'quarter', label: 'Este trimestre' },
  { value: 'year', label: 'Este año' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'all', label: 'Todo' },
];

export function periodRange(p) {
  const t = todayIso();
  const [y, m] = t.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy, mm) => new Date(yy, mm, 0).getDate();
  switch (p) {
    case 'month': return { from: iso(y, m, 1), to: t };
    case 'last_month': { const yy = m === 1 ? y - 1 : y; const mm = m === 1 ? 12 : m - 1; return { from: iso(yy, mm, 1), to: iso(yy, mm, lastDay(yy, mm)) }; }
    case 'quarter': { const qm = Math.floor((m - 1) / 3) * 3 + 1; return { from: iso(y, qm, 1), to: t }; }
    case 'year': return { from: iso(y, 1, 1), to: t };
    case '12m': { const d = new Date(y, m - 12, 1); return { from: iso(d.getFullYear(), d.getMonth() + 1, 1), to: t }; }
    default: return { from: undefined, to: undefined };
  }
}

export function PeriodSelect({ value, onChange }) {
  return (
    <select className="select" style={{ width: 'auto', height: 32 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Periodo">
      {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>
  );
}

export function Amount({ tx, sign = true }) {
  const inflow = INFLOW.includes(tx.kind);
  const neutral = tx.kind === 'transfer';
  return <span className={`amount ${inflow ? 'money-in' : ''}`}>{neutral ? '' : sign ? (inflow ? '+' : '−') : ''}{money(tx.amount_cents)}</span>;
}

export function TxStatus({ tx }) {
  if (tx.voided_at) return <Pill size="sm" color="gray">Anulado</Pill>;
  if (tx.approval_status === 'pending') return <Pill size="sm" color="yellow">Pendiente de aprobación</Pill>;
  if (tx.approval_status === 'rejected') return <Pill size="sm" color="red">Rechazado</Pill>;
  return null;
}

// ───────── Layout ─────────
export default function Finance() {
  const { data: meta, isLoading, error } = useFinanceMeta();
  const { openCreate } = useLayout();
  const tabs = [
    meta?.can.view && { to: 'overview', label: 'Resumen' },
    { to: 'movements', label: 'Movimientos' },
    { to: 'obligations', label: 'Por pagar y cobrar' },
    meta?.can.view && { to: 'budgets', label: 'Presupuestos' },
    { to: 'partners', label: 'Socios' },
    meta?.can.view && { to: 'reports', label: 'Reportes' },
    { to: 'setup', label: 'Cuentas y categorías' },
  ].filter(Boolean);
  if (isLoading) return <><Topbar crumbs={[{ label: 'Finanzas' }]} /><Loading /></>;
  if (error) return <><Topbar crumbs={[{ label: 'Finanzas' }]} /><ErrorState error={error} /></>;
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Finanzas' }]}
        actions={meta.can.record && (
          <>
            <Button size="sm" icon={ArrowDownLeft} onClick={() => openCreate('income')} className="hide-sm">Ingreso</Button>
            <Button size="sm" variant="primary" icon={Receipt} onClick={() => openCreate('expense')}>Gasto</Button>
          </>
        )}
      />
      <div className="content">
        <div className="page wide" style={{ maxWidth: 1240 }}>
          <div className="tabs">
            {tabs.map((t) => <NavLink key={t.to} to={`/finance/${t.to}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>{t.label}</NavLink>)}
          </div>
          <Routes>
            <Route index element={<Navigate to={meta.can.view ? 'overview' : 'movements'} replace />} />
            <Route path="overview" element={meta.can.view ? <Overview meta={meta} /> : <Navigate to="/finance/movements" replace />} />
            <Route path="movements" element={<Movements meta={meta} />} />
            <Route path="obligations" element={<Obligations meta={meta} />} />
            <Route path="budgets" element={<Budgets meta={meta} />} />
            <Route path="partners" element={<Partners meta={meta} />} />
            <Route path="reports" element={<Reports meta={meta} />} />
            <Route path="setup" element={<FinanceSetup meta={meta} />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

// ───────── Resumen ─────────
function Overview({ meta }) {
  const [period, setPeriod] = usePref('financePeriod', 'month');
  const [projectId, setProjectId] = useState('');
  const { data: projects = [] } = useProjects();
  const range = periodRange(period);
  const { data: s, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'summary', period, projectId], queryFn: () => api.get(`/finance/summary${qs({ ...range, project_id: projectId })}`) });
  const [selected, setSelected] = useState(null);
  const noData = s && s.count === 0 && !s.cash.inflow && !s.cash.outflow;
  if (isLoading) return <SkeletonList rows={8} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const expenses = s.by_category.filter((c) => c.kind === 'expense');
  const incomes = s.by_category.filter((c) => c.kind === 'income');
  const projectRows = s.by_project.filter((p) => p.project_id);
  return (
    <>
      <div className="filter-bar">
        <PeriodSelect value={period} onChange={setPeriod} />
        <select className="select" style={{ width: 'auto', height: 32 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
          <option value="">Toda la empresa</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="faint small">{range.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'Desde el inicio'}</span>
      </div>

      {s.pending_approvals.count > 0 && meta.can.approve && (
        <Link to="/finance/movements?status=pending" className="callout warning mb-4" style={{ display: 'flex' }}>
          <AlertTriangle size={17} />
          <div className="callout-body"><strong>{s.pending_approvals.count} movimiento(s) esperan aprobación</strong>Por {money(s.pending_approvals.total_cents)}. No cuentan en los totales hasta aprobarse.</div>
        </Link>
      )}

      <div className="stats mb-4">
        <div className="card stat"><div className="label"><span className="swatch" style={{ background: INCOME_COLOR }} />Ingresos</div><div className="value">{money(s.income_cents)}</div><div className="sub">{plural(incomes.length, 'categoría', 'categorías')}</div></div>
        <div className="card stat"><div className="label"><span className="swatch" style={{ background: EXPENSE_COLOR }} />Gastos</div><div className="value">{money(s.expense_cents)}</div><div className="sub">{plural(expenses.length, 'categoría', 'categorías')}</div></div>
        <div className="card stat"><div className="label">Balance del periodo</div><div className={`value ${s.net_cents < 0 ? 'neg' : ''}`}>{money(s.net_cents)}</div><div className="sub">Ingresos − gastos</div></div>
        {!projectId && <div className="card stat"><div className="label">Saldo en cuentas</div><div className="value">{money(s.total_balance_cents)}</div><div className="sub">Hoy, en {s.accounts.length} cuenta(s)</div></div>}
      </div>

      {noData && (
        <div className="mb-4">
          <Callout tone="info" title="Aún no hay movimientos en este periodo">
            Los números se calculan únicamente con los movimientos que registren. Empieza con la aportación inicial de los socios o los primeros gastos.
          </Callout>
        </div>
      )}

      <div className="dash-grid">
        <section className="card span-8"><div className="card-head"><h3>Ingresos y gastos por mes</h3></div><div style={{ padding: 16 }}><MonthlyChart data={s.monthly} /></div></section>
        <section className="card span-4">
          <div className="card-head"><h3>Cuentas</h3><Link to="/finance/setup" className="link small">Administrar</Link></div>
          <div className="card-body">
            {s.accounts.map((a) => (
              <div key={a.id} className="list-row">
                <Wallet size={15} className="faint" />
                <span className="grow"><span className="title">{a.name}</span><div className="faint tiny">{ACCOUNT_TYPES[a.type]}</div></span>
                <span className={`amount ${a.balance_cents < 0 ? 'neg' : ''}`}>{money(a.balance_cents)}</span>
              </div>
            ))}
            {!projectId && (
              <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)', marginTop: 6 }} className="small">
                <div className="flex between"><span className="muted">Entradas de caja</span><span className="num">{money(s.cash.inflow)}</span></div>
                <div className="flex between"><span className="muted">Salidas de caja</span><span className="num">{money(s.cash.outflow)}</span></div>
                {(s.cash.contributions > 0 || s.cash.loans > 0) && <div className="faint tiny mt-1">Incluye {money(s.cash.contributions)} de aportaciones y {money(s.cash.loans)} de préstamos (no son ingresos).</div>}
              </div>
            )}
          </div>
        </section>
        <section className="card span-6"><div className="card-head"><h3>Gastos por categoría</h3></div><div style={{ padding: 16 }}><CategoryBars rows={expenses} total={s.expense_cents} /></div></section>
        <section className="card span-6"><div className="card-head"><h3>Ingresos por categoría</h3></div><div style={{ padding: 16 }}><CategoryBars rows={incomes} total={s.income_cents} color={INCOME_COLOR} /></div></section>
        <section className="card span-6">
          <div className="card-head"><h3>Por pagar y cobrar</h3><Link to="/finance/obligations" className="link small">Ver todo</Link></div>
          <div style={{ padding: 16 }}>
            <div className="grid-3" style={{ gap: 10 }}>
              <div><div className="tiny faint">Por pagar</div><div className="amount">{money(s.payables.total_cents)}</div>{s.payables.overdue > 0 && <div className="tiny neg">{s.payables.overdue} vencidas</div>}</div>
              <div><div className="tiny faint">Por cobrar</div><div className="amount">{money(s.receivables.total_cents)}</div>{s.receivables.overdue > 0 && <div className="tiny neg">{s.receivables.overdue} vencidas</div>}</div>
              <div><div className="tiny faint">Se debe a socios</div><div className="amount">{money(s.owed_to_partners.total_cents)}</div></div>
            </div>
            {s.upcoming_obligations.length > 0 && (
              <div className="mt-3">
                {s.upcoming_obligations.map((o) => (
                  <div key={o.id} className="flex between small" style={{ padding: '4px 0' }}>
                    <span className="truncate">{o.direction === 'payable' ? 'Pagar' : 'Cobrar'}: {o.title}</span>
                    <span className={`num ${o.overdue ? 'neg' : 'muted'}`}>{money(o.remaining_cents)} · {relativeDay(o.due_date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="card span-6">
          <div className="card-head"><h3>Presupuestos vigentes</h3><Link to="/finance/budgets" className="link small">Ver todos</Link></div>
          <div style={{ padding: 16 }}>
            {s.budgets.length ? s.budgets.map((b) => (
              <div key={b.id} className="mb-3">
                <div className="flex between small mb-2"><span className="truncate" style={{ fontWeight: 550 }}>{b.name}</span><span className={`num ${b.state === 'over' ? 'neg' : 'muted'}`}>{money(b.spent_cents)} / {money(b.amount_cents)}</span></div>
                <Progress value={b.pct} tone={b.state === 'over' ? 'danger' : b.state === 'warning' ? 'warning' : ''} thin />
              </div>
            )) : <p className="faint small">Sin presupuestos vigentes. {meta.can.approve && <Link className="link" to="/finance/budgets">Crear uno</Link>}</p>}
          </div>
        </section>
        {projectRows.length > 0 && !projectId && (
          <section className="card span-6">
            <div className="card-head"><h3>Por proyecto</h3></div>
            <div className="card-body">
              <table className="table">
                <thead><tr><th>Proyecto</th><th className="right">Ingresos</th><th className="right">Gastos</th><th className="right">Balance</th></tr></thead>
                <tbody>{projectRows.map((p) => <tr key={p.project_id}><td>{p.name}</td><td className="right num">{money(p.income)}</td><td className="right num">{money(p.expense)}</td><td className={`right num ${p.income - p.expense < 0 ? 'neg' : ''}`}>{money(p.income - p.expense)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
        <section className={`card ${projectRows.length > 0 && !projectId ? 'span-6' : 'span-12'}`}>
          <div className="card-head"><h3>Movimientos recientes</h3><Link to="/finance/movements" className="link small">Ver todos</Link></div>
          <div className="card-body">
            {s.recent.length ? s.recent.map((tx) => <TxRow key={tx.id} tx={tx} onClick={() => setSelected(tx.id)} />) : <EmptyState compact title="Sin movimientos" />}
          </div>
        </section>
      </div>
      {selected && <TransactionDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

export function TxRow({ tx, onClick }) {
  const Icon = KIND_ICON[tx.kind];
  return (
    <button className="list-row" onClick={onClick} style={tx.voided_at ? { opacity: 0.55 } : undefined}>
      <span className={`kind-ico ${tx.kind}`}><Icon size={14} /></span>
      <span className="grow">
        <span className="title" style={tx.voided_at ? { textDecoration: 'line-through' } : undefined}>{tx.concept}</span>
        <div className="faint tiny truncate">{fmtDate(tx.date)} · {tx.category_name || KIND_LABELS[tx.kind]}{tx.paid_personally ? ` · pagó ${tx.member_name}` : tx.account_name ? ` · ${tx.account_name}` : ''}</div>
      </span>
      <TxStatus tx={tx} />
      <Amount tx={tx} />
    </button>
  );
}

// ───────── Movimientos ─────────
function Movements({ meta }) {
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState(params.get('status') ? 'all' : 'month');
  const [filters, setFilters] = useState({ kind: '', category_id: '', project_id: '', account_id: '', status: params.get('status') || '', q: '' });
  const { data: projects = [] } = useProjects();
  const range = periodRange(period);
  const query = { ...range, ...filters };
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'transactions', query], queryFn: () => api.get(`/finance/transactions${qs(query)}`) });
  const selected = params.get('tx') ? Number(params.get('tx')) : null;
  const open = (id) => { const n = new URLSearchParams(params); n.set('tx', id); setParams(n); };
  const close = () => { const n = new URLSearchParams(params); n.delete('tx'); setParams(n); };
  const set = (k, v) => setFilters({ ...filters, [k]: v });
  const totals = useMemo(() => {
    const valid = data.filter((t) => !t.voided_at && t.approval_status === 'approved');
    return {
      income: valid.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount_cents, 0),
      expense: valid.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [data]);
  return (
    <>
      {!meta.can.view && (
        <div className="mb-3"><Callout tone="info" title="Ves solo tus movimientos">Aquí aparecen los movimientos que registraste o que te involucran (por ejemplo, tus reembolsos). La información financiera completa la consultan quienes tienen ese permiso.</Callout></div>
      )}
      <div className="filter-bar">
        <div style={{ position: 'relative', minWidth: 180, flex: 1, maxWidth: 260 }}>
          <Search size={14} className="faint" style={{ position: 'absolute', left: 9, top: 9 }} />
          <input className="input" style={{ paddingLeft: 30, height: 32 }} placeholder="Buscar concepto…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <PeriodSelect value={period} onChange={setPeriod} />
        <select className="select" style={{ width: 'auto', height: 32 }} value={filters.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 32 }} value={filters.category_id} onChange={(e) => set('category_id', e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.kind === 'income' ? '↓' : '↑'} {c.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 32 }} value={filters.project_id} onChange={(e) => set('project_id', e.target.value)} aria-label="Proyecto">
          <option value="">Todos los proyectos</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 32 }} value={filters.account_id} onChange={(e) => set('account_id', e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', height: 32 }} value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Estado">
          <option value="">Vigentes</option>
          <option value="pending">Pendientes de aprobación</option>
          <option value="voided">Anulados</option>
          <option value="rejected">Rechazados</option>
          <option value="all">Todos</option>
        </select>
        <span className="spacer" style={{ flex: 1 }} />
        <a className="btn sm" href={`/api/finance/export.csv${qs({ ...range, ...filters, status: filters.status || 'all' })}`}><Download size={14} />CSV</a>
      </div>
      {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.length ? (
        <EmptyState icon={Receipt} title="Sin movimientos" actions={meta.can.record && <RecordButton />}>No hay movimientos con estos filtros.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th className="hide-sm">Categoría</th><th className="hide-sm">Cuenta / pagó</th><th className="hide-sm">Proyecto</th><th className="right">Monto</th></tr></thead>
            <tbody>
              {data.map((tx) => {
                const Icon = KIND_ICON[tx.kind];
                return (
                  <tr key={tx.id} className={`clickable ${tx.voided_at ? 'voided' : ''}`} onClick={() => open(tx.id)}>
                    <td className="muted num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(tx.date, 'd MMM yy')}</td>
                    <td>
                      <span className="flex" style={{ minWidth: 180 }}>
                        <span className={`kind-ico ${tx.kind}`} style={{ width: 24, height: 24 }}><Icon size={13} /></span>
                        <span className="truncate">{tx.concept}</span>
                        <TxStatus tx={tx} />
                      </span>
                    </td>
                    <td className="hide-sm">{tx.category_name ? <Pill size="sm" color={tx.category_color}>{tx.category_name}</Pill> : <span className="faint small">{KIND_LABELS[tx.kind]}</span>}</td>
                    <td className="muted small hide-sm">{tx.paid_personally ? `Pagó ${tx.member_name}` : tx.kind === 'transfer' ? `${tx.account_name} → ${tx.to_account_name}` : tx.account_name}</td>
                    <td className="muted small hide-sm truncate" style={{ maxWidth: 160 }}>{tx.project_name || '—'}</td>
                    <td className="right"><Amount tx={tx} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{data.length} movimientos</td>
                <td colSpan={3} className="hide-sm" />
                <td className="right small"><div className="money-in">+{money(totals.income)}</div><div>−{money(totals.expense)}</div></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="faint tiny mt-2">Los totales del pie cuentan solo ingresos y gastos aprobados y vigentes.</p>
      {selected && <TransactionDrawer id={selected} onClose={close} />}
    </>
  );
}

function RecordButton() {
  const { openCreate } = useLayout();
  return <Button variant="primary" icon={Plus} onClick={() => openCreate('expense')}>Registrar movimiento</Button>;
}

export function TransactionDrawer({ id, onClose }) {
  const confirm = useConfirm();
  const members = useMemberMap();
  const canApprove = useCan('finance.approve');
  const [editing, setEditing] = useState(false);
  const { data: tx, isLoading, error } = useQuery({ queryKey: ['finance', 'tx', id], queryFn: () => api.get(`/finance/transactions/${id}`) });
  const inv = ['finance', 'dashboard', 'calendar'];
  const approve = useAction(() => api.post(`/finance/transactions/${id}/approve`), { invalidate: inv, success: 'Movimiento aprobado' });
  const reject = useAction((reason) => api.post(`/finance/transactions/${id}/reject`, { reason }), { invalidate: inv, success: 'Movimiento rechazado' });
  const voidTx = useAction((reason) => api.post(`/finance/transactions/${id}/void`, { reason }), { invalidate: inv, success: 'Movimiento anulado' });
  const askVoid = async () => {
    const reason = await confirm({
      title: 'Anular movimiento',
      message: 'El movimiento no se borra: queda en el historial marcado como anulado y deja de contar en los totales.',
      input: { label: 'Motivo de la anulación', placeholder: 'Ej. Se capturó dos veces', required: true },
      confirmLabel: 'Anular',
      danger: true,
    });
    if (reason) voidTx.mutate(reason);
  };
  const askReject = async () => {
    const reason = await confirm({ title: 'Rechazar movimiento', input: { label: 'Motivo', required: true }, confirmLabel: 'Rechazar', danger: true });
    if (reason) reject.mutate(reason);
  };
  const Field = ({ label, children }) => (
    <>
      <span className="prop-label">{label}</span>
      <span className="prop-value small">{children || <span className="faint">—</span>}</span>
    </>
  );
  return (
    <Drawer onClose={onClose} header={<span className="strong" style={{ flex: 1 }}>Movimiento</span>}>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} /> : (
        <div className="task-panel">
          <div className="flex" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className={`kind-ico ${tx.kind}`} style={{ width: 40, height: 40, borderRadius: 10 }}>{(() => { const I = KIND_ICON[tx.kind]; return <I size={20} />; })()}</span>
            <div style={{ flex: 1 }}>
              <div className="muted small">{KIND_LABELS[tx.kind]}{tx.contribution_type ? ` · ${tx.contribution_type}` : ''}</div>
              <h2 style={{ fontSize: 20 }}>{tx.concept}</h2>
              <div className="mt-1" style={{ fontSize: 26, fontWeight: 700 }}><Amount tx={tx} /></div>
            </div>
          </div>
          <div className="mt-2 flex wrap" style={{ gap: 6 }}><TxStatus tx={tx} /></div>
          {tx.voided_at && <div className="mt-3"><Callout icon={Ban} title={`Anulado por ${tx.voided_by_name} · ${fmtDateTime(tx.voided_at)}`}>{tx.void_reason}</Callout></div>}
          {tx.approval_status === 'pending' && !tx.voided_at && (
            <div className="mt-3">
              <Callout tone="warning" icon={Clock} title="Pendiente de aprobación">
                <div className="small">{tx.approval_reason}. No cuenta en totales ni genera reembolsos hasta aprobarse.</div>
                {canApprove && (
                  <div className="btn-group mt-2">
                    <Button size="sm" variant="primary" icon={Check} loading={approve.isPending} onClick={() => approve.mutate()}>Aprobar</Button>
                    <Button size="sm" icon={X} onClick={askReject}>Rechazar</Button>
                  </div>
                )}
              </Callout>
            </div>
          )}
          {tx.approval_status === 'rejected' && <div className="mt-3"><Callout tone="danger" icon={X} title={`Rechazado por ${tx.approved_by_name || '—'}`}>{tx.approval_reason}</Callout></div>}

          <div className="props">
            <Field label="Fecha">{fmtDate(tx.date, "d 'de' MMMM yyyy")}</Field>
            {tx.kind === 'transfer' ? <Field label="Cuentas">{tx.account_name} → {tx.to_account_name}</Field> : <Field label={tx.paid_personally ? 'Pagado por' : 'Cuenta'}>{tx.paid_personally ? `${tx.member_name} (con su dinero)` : tx.account_name}</Field>}
            {tx.category_name && <Field label="Categoría"><Pill size="sm" color={tx.category_color}>{tx.category_name}</Pill></Field>}
            {tx.member_name && !tx.paid_personally && <Field label="Integrante">{tx.member_name}</Field>}
            {tx.counterparty && <Field label="Contraparte">{tx.counterparty}</Field>}
            {tx.payment_method && <Field label="Método de pago">{tx.payment_method}</Field>}
            {tx.project_name && <Field label="Proyecto"><Link className="link" to={`/projects/${tx.project_id}`}>{tx.project_name}</Link></Field>}
            <Field label="Registró"><span className="flex" style={{ gap: 6 }}><Avatar user={members.get(tx.created_by)} size="xs" />{tx.created_by_name} · {fmtDateTime(tx.created_at)}</span></Field>
            {tx.approved_by_name && tx.approval_status === 'approved' && tx.approved_by !== tx.created_by && <Field label="Aprobó">{tx.approved_by_name}</Field>}
          </div>
          {tx.notes && <p style={{ whiteSpace: 'pre-wrap' }} className="mb-3">{tx.notes}</p>}
          {tx.derived_obligation && (
            <Callout icon={HandCoins} title={tx.derived_obligation.source === 'reimbursement' ? 'Reembolso generado' : 'Deuda generada'}>
              <div className="small">{tx.derived_obligation.title}: pendiente {money(tx.derived_obligation.remaining_cents)} de {money(tx.derived_obligation.amount_cents)}. <Link className="link" to="/finance/obligations">Ver</Link></div>
            </Callout>
          )}
          {tx.settles && <Callout icon={HandCoins} title="Liquida una obligación"><div className="small">{tx.settles.title} ({money(tx.settles.paid_cents)} de {money(tx.settles.amount_cents)} pagado)</div></Callout>}

          <div className="btn-group mt-4">
            {tx.can_edit && <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>}
            {tx.can_void && <Button size="sm" variant="ghost" icon={Ban} onClick={askVoid}>Anular</Button>}
          </div>

          <div className="tp-section">
            <div className="tp-section-title"><Paperclip size={14} />Comprobantes</div>
            <Attachments entityType="transaction" entityId={tx.id} files={tx.attachments} visibility="finance" compact />
          </div>
          <div className="tp-section">
            <div className="tp-section-title"><History size={14} />Historial</div>
            {tx.history.map((h) => (
              <div key={h.id} className="activity-item">
                <span className="activity-dot"><Avatar user={members.get(h.actor_id)} size="xs" /></span>
                <div style={{ flex: 1 }}>
                  <span className="who">{h.actor_name}</span> {h.summary}
                  {h.data && !h.data.snapshot && Object.entries(h.data).map(([k, v]) => <div key={k} className="tiny faint">{k.endsWith('_cents') ? `${money(v.from)} → ${money(v.to)}` : `${v.from ?? 'vacío'} → ${v.to ?? 'vacío'}`}</div>)}
                </div>
                <span className="when">{fmtDateTime(h.created_at)}</span>
              </div>
            ))}
          </div>
          <div className="tp-section">
            <div className="tp-section-title">Comentarios</div>
            <Comments entityType="transaction" entityId={tx.id} />
          </div>
        </div>
      )}
      {editing && <TransactionModal transaction={tx} onClose={() => setEditing(false)} />}
    </Drawer>
  );
}

