import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, HandCoins, Ban, Download, Wallet, Archive, ArchiveRestore, Pencil, Trash2, Info, PiggyBank, FileSpreadsheet } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { ACCOUNT_TYPES, COLORS } from '../../lib/constants.js';
import { centsToInput, fmtDate, money, parseMoney, relativeDay, todayIso } from '../../lib/format.js';
import { useAction, useMemberMap, useProjects, useActiveMembers } from '../../lib/hooks.js';
import { Avatar, Button, Callout, EmptyState, ErrorState, Field, FormError, MoneyInput, Pill, Progress, Segmented, SkeletonList, ColorDots, IconButton } from '../../components/ui.jsx';
import { Modal, useConfirm } from '../../components/overlay.jsx';
import { useLayout } from '../../components/Layout.jsx';
import { DateField } from '../../components/pickers.jsx';
import { AccountSelect } from './TransactionForm.jsx';
import { PeriodSelect, periodRange, TransactionDrawer, TxRow } from './Finance.jsx';

const OB_STATUS = { open: ['Pendiente', 'yellow'], partial: ['Pago parcial', 'blue'], paid: ['Liquidada', 'green'], cancelled: ['Cancelada', 'gray'] };
const SOURCE = { manual: '', reimbursement: 'Reembolso a socio', loan: 'Préstamo' };

// ───────── Cuentas por pagar y cobrar ─────────
export function Obligations({ meta }) {
  const [view, setView] = useState('payable');
  const [status, setStatus] = useState('pending');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(null);
  const confirm = useConfirm();
  const query = { status, ...(view === 'partners' ? { source: undefined } : { direction: view }) };
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'obligations', view, status], queryFn: () => api.get(`/finance/obligations${qs(query)}`) });
  const rows = view === 'partners' ? data.filter((o) => o.source !== 'manual') : view === 'payable' ? data.filter((o) => o.source === 'manual') : data;
  const cancel = useAction(({ id, reason }) => api.post(`/finance/obligations/${id}/cancel`, { reason }), { invalidate: ['finance', 'dashboard', 'calendar'], success: 'Obligación cancelada' });
  const total = rows.reduce((s, o) => s + o.remaining_cents, 0);
  return (
    <>
      <div className="filter-bar">
        <Segmented value={view} onChange={setView} options={[{ value: 'payable', label: 'Por pagar' }, { value: 'receivable', label: 'Por cobrar' }, { value: 'partners', label: 'Deudas con socios' }]} />
        <select className="select" style={{ width: 'auto', height: 32 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
          <option value="pending">Pendientes</option>
          <option value="paid">Liquidadas</option>
          <option value="cancelled">Canceladas</option>
          <option value="all">Todas</option>
        </select>
        <span className="spacer" style={{ flex: 1 }} />
        {meta.can.view && <a className="btn sm" href="/api/finance/export.csv?type=obligations"><Download size={14} />CSV</a>}
        {meta.can.record && view !== 'partners' && <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>{view === 'payable' ? 'Cuenta por pagar' : 'Cuenta por cobrar'}</Button>}
      </div>
      {view === 'partners' && <div className="mb-3"><Callout icon={Info}>Se generan solas: cuando un integrante paga un gasto con su dinero (reembolso) o presta dinero a la empresa (préstamo). Al registrar el pago se descuenta de la cuenta elegida.</Callout></div>}
      {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !rows.length ? (
        <EmptyState icon={HandCoins} title="Nada pendiente">{view === 'payable' ? 'Registra facturas de proveedores o pagos programados para no olvidarlos.' : view === 'receivable' ? 'Registra lo que un cliente te debe para darle seguimiento.' : 'La empresa no le debe nada a ningún socio.'}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Concepto</th><th className="hide-sm">Con quién</th><th>Vence</th><th className="right">Monto</th><th className="right hide-sm">Pagado</th><th className="right">Pendiente</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((o) => {
                const [label, color] = OB_STATUS[o.status];
                const open = o.status === 'open' || o.status === 'partial';
                const canPay = open && (o.source === 'manual' ? meta.can.record : meta.can.approve);
                return (
                  <tr key={o.id}>
                    <td><div>{o.title}</div>{SOURCE[o.source] && <div className="faint tiny">{SOURCE[o.source]}</div>}{o.pending_cents > 0 && <div className="tiny" style={{ color: 'var(--warning)' }}>{money(o.pending_cents)} en pagos por aprobar</div>}</td>
                    <td className="muted small hide-sm">{o.member_name || o.counterparty || '—'}</td>
                    <td className={`small ${o.overdue ? 'neg' : 'muted'}`} style={{ whiteSpace: 'nowrap' }}>{o.due_date ? relativeDay(o.due_date) : '—'}</td>
                    <td className="right num">{money(o.amount_cents)}</td>
                    <td className="right num muted hide-sm">{money(o.paid_cents)}</td>
                    <td className="right"><span className="amount">{money(o.remaining_cents)}</span></td>
                    <td><Pill size="sm" color={o.overdue ? 'red' : color}>{o.overdue ? 'Vencida' : label}</Pill></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canPay && <Button size="xs" onClick={() => setPaying(o)}>{o.direction === 'payable' ? 'Registrar pago' : 'Registrar cobro'}</Button>}
                      {open && meta.can.approve && <IconButton icon={Ban} size="xs" label="Cancelar obligación" onClick={async () => { const reason = await confirm({ title: `Cancelar «${o.title}»`, message: 'Se conserva en el historial. Úsalo si ya no se debe (por ejemplo, el proveedor canceló el pedido).', input: { label: 'Motivo', required: true }, confirmLabel: 'Cancelar obligación', danger: true }); if (reason) cancel.mutate({ id: o.id, reason }); }} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {status === 'pending' && <tfoot><tr><td colSpan={5} className="hide-sm">Total pendiente</td><td colSpan={1} className="right">{money(total)}</td><td colSpan={2} /></tr></tfoot>}
          </table>
        </div>
      )}
      {creating && <ObligationModal direction={view === 'receivable' ? 'receivable' : 'payable'} meta={meta} onClose={() => setCreating(false)} />}
      {paying && <PayModal o={paying} meta={meta} onClose={() => setPaying(null)} />}
    </>
  );
}

function ObligationModal({ direction, meta, onClose }) {
  const { data: projects = [] } = useProjects({ status: 'planning,active,paused' });
  const [form, setForm] = useState({ title: '', counterparty: '', amount: '', due_date: null, category_id: '', project_id: '', notes: '' });
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = useAction(() => api.post('/finance/obligations', { ...form, direction, amount_cents: parseMoney(form.amount), category_id: form.category_id || null, project_id: form.project_id || null }), { invalidate: ['finance', 'calendar'], success: 'Registrado', onSuccess: onClose, onError: setError });
  const cats = meta.categories.filter((c) => c.kind === (direction === 'payable' ? 'expense' : 'income') && !c.archived_at);
  return (
    <Modal title={direction === 'payable' ? 'Nueva cuenta por pagar' : 'Nueva cuenta por cobrar'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.title.trim() || !parseMoney(form.amount)} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <FormError error={error} />
      <p className="muted small mb-3">{direction === 'payable' ? 'Aún no es un gasto: se registrará como gasto cuando se pague.' : 'Aún no es un ingreso: se registrará como ingreso cuando se cobre.'}</p>
      <Field label="Concepto"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={direction === 'payable' ? 'Ej. Factura de empaques' : 'Ej. Pedido de la tienda Hojas'} /></Field>
      <div className="grid-2">
        <Field label="Monto"><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
        <Field label="Vence"><DateField value={form.due_date} onChange={(v) => set('due_date', v)} /></Field>
        <Field label={direction === 'payable' ? 'Proveedor' : 'Cliente'}><input className="input" value={form.counterparty} onChange={(e) => set('counterparty', e.target.value)} /></Field>
        <Field label="Categoría"><select className="select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}><option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Proyecto"><select className="select" value={form.project_id} onChange={(e) => set('project_id', e.target.value)}><option value="">Sin proyecto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      </div>
      <Field label="Notas"><textarea className="textarea" style={{ minHeight: 60 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  );
}

function PayModal({ o, meta, onClose }) {
  const available = o.remaining_cents - o.pending_cents;
  const [form, setForm] = useState({ amount: centsToInput(available), account_id: meta.accounts.filter((a) => !a.archived_at).length === 1 ? meta.accounts.find((a) => !a.archived_at).id : '', date: todayIso(), payment_method: '', notes: '' });
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cents = parseMoney(form.amount);
  const save = useAction(() => api.post(`/finance/obligations/${o.id}/pay`, { ...form, amount_cents: cents }), { invalidate: ['finance', 'dashboard', 'calendar'], success: (r) => (r.approval_status === 'pending' ? 'Pago registrado como pendiente de aprobación' : 'Pago registrado'), onSuccess: onClose, onError: setError });
  const verb = o.direction === 'payable' ? 'pago' : 'cobro';
  return (
    <Modal title={`Registrar ${verb}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!cents || cents > available || !form.account_id} loading={save.isPending} onClick={() => save.mutate()}>Registrar {verb}</Button></>}>
      <FormError error={error} />
      <p className="mb-3"><strong>{o.title}</strong><br /><span className="muted small">Pendiente {money(available)} de {money(o.amount_cents)}{o.member_name ? ` · ${o.member_name}` : o.counterparty ? ` · ${o.counterparty}` : ''}</span></p>
      <div className="grid-2">
        <Field label="Monto" hint={cents > available ? 'Excede lo pendiente' : 'Puede ser un pago parcial'}><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
        <Field label="Fecha"><input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label={o.direction === 'payable' ? 'Sale de la cuenta' : 'Entra a la cuenta'}><AccountSelect accounts={meta.accounts.filter((a) => !a.archived_at)} value={form.account_id} onChange={(v) => set('account_id', v)} /></Field>
        <Field label="Método"><select className="select" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}><option value="">—</option>{meta.payment_methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
      </div>
      <p className="faint small">{o.source === 'manual' ? `Se registrará como ${o.direction === 'payable' ? 'gasto' : 'ingreso'} real en esta fecha.` : o.source === 'reimbursement' ? 'Es un reembolso: sale dinero de la cuenta, pero no se cuenta otra vez como gasto.' : 'Es la devolución de un préstamo: no se cuenta como gasto.'}</p>
    </Modal>
  );
}

// ───────── Presupuestos ─────────
export function Budgets({ meta }) {
  const [editing, setEditing] = useState(null);
  const [archived, setArchived] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'budgets', archived], queryFn: () => api.get(`/finance/budgets${archived ? '?archived=1' : ''}`) });
  const archive = useAction(({ id, value }) => api.patch(`/finance/budgets/${id}`, { archived: value }), { invalidate: ['finance'] });
  const catName = (id) => meta.categories.find((c) => c.id === id)?.name;
  if (!meta.can.view) return <EmptyState title="Sin acceso">Los presupuestos los consulta quien tiene acceso a las finanzas.</EmptyState>;
  return (
    <>
      <div className="filter-bar">
        <p className="muted small" style={{ flex: 1 }}>Define cuánto se puede gastar en un periodo, para un proyecto o categorías. Puedes advertir o exigir aprobación al excederlo.</p>
        <Segmented value={archived ? 'all' : 'active'} onChange={(v) => setArchived(v === 'all')} options={[{ value: 'active', label: 'Vigentes' }, { value: 'all', label: 'Todos' }]} />
        {meta.can.approve && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({})}>Nuevo presupuesto</Button>}
      </div>
      {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.length ? (
        <EmptyState icon={PiggyBank} title="Sin presupuestos" actions={meta.can.approve && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Crear presupuesto</Button>}>Por ejemplo: «Publicidad de noviembre: $3,000» o «Feria de diciembre: $8,000».</EmptyState>
      ) : (
        <div className="grid-cards">
          {data.map((b) => (
            <div key={b.id} className="card pad" style={b.archived_at ? { opacity: 0.6 } : undefined}>
              <div className="flex" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="strong">{b.name}</div>
                  <div className="faint small">{fmtDate(b.period_start)} – {fmtDate(b.period_end)}</div>
                </div>
                {meta.can.approve && (
                  <>
                    <IconButton icon={Pencil} size="sm" label="Editar" onClick={() => setEditing(b)} />
                    <IconButton icon={b.archived_at ? ArchiveRestore : Archive} size="sm" label={b.archived_at ? 'Restaurar' : 'Archivar'} onClick={() => archive.mutate({ id: b.id, value: !b.archived_at })} />
                  </>
                )}
              </div>
              <div className="flex wrap mt-2" style={{ gap: 4 }}>
                {b.project_name && <Pill size="sm" color="purple">{b.project_name}</Pill>}
                {b.category_ids.map((c) => <Pill key={c} size="sm">{catName(c)}</Pill>)}
                {!b.project_name && !b.category_ids.length && <Pill size="sm">Todos los gastos</Pill>}
                {b.over_action === 'approval' && <Pill size="sm" color="orange">Requiere aprobación al exceder</Pill>}
              </div>
              <div className="flex between mt-3 small"><span className="muted">Gastado</span><span className={`num strong ${b.state === 'over' ? 'neg' : ''}`}>{money(b.spent_cents)} de {money(b.amount_cents)}</span></div>
              <div className="mt-2"><Progress value={b.pct} tone={b.state === 'over' ? 'danger' : b.state === 'warning' ? 'warning' : ''} /></div>
              <div className="flex between mt-2 tiny faint">
                <span>{b.remaining_cents >= 0 ? `Disponible ${money(b.remaining_cents)}` : `Excedido por ${money(-b.remaining_cents)}`}</span>
                <span>{b.pct}%</span>
              </div>
              {b.pending_cents > 0 && <div className="tiny mt-1" style={{ color: 'var(--warning)' }}>{money(b.pending_cents)} en gastos por aprobar</div>}
            </div>
          ))}
        </div>
      )}
      {editing && <BudgetModal budget={editing.id ? editing : null} meta={meta} onClose={() => setEditing(null)} />}
    </>
  );
}

function BudgetModal({ budget, meta, onClose }) {
  const { data: projects = [] } = useProjects();
  const members = useActiveMembers();
  const month = periodRange('month');
  const [form, setForm] = useState({
    name: budget?.name || '', amount: centsToInput(budget?.amount_cents) || '', period_start: budget?.period_start || month.from,
    period_end: budget?.period_end || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
    project_id: budget?.project_id || '', category_ids: budget?.category_ids || [], owner_id: budget?.owner_id || '', alert_pct: budget?.alert_pct || 80, over_action: budget?.over_action || 'warn',
  });
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = useAction(() => {
    const body = { ...form, amount_cents: parseMoney(form.amount), project_id: form.project_id || null, owner_id: form.owner_id || null, alert_pct: Number(form.alert_pct) };
    return budget ? api.patch(`/finance/budgets/${budget.id}`, body) : api.post('/finance/budgets', body);
  }, { invalidate: ['finance'], success: 'Presupuesto guardado', onSuccess: onClose, onError: setError });
  const cats = meta.categories.filter((c) => c.kind === 'expense' && !c.archived_at);
  return (
    <Modal size="lg" title={budget ? 'Editar presupuesto' : 'Nuevo presupuesto'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.name.trim() || !parseMoney(form.amount)} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <FormError error={error} />
      <div className="grid-2">
        <Field label="Nombre"><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Publicidad de noviembre" /></Field>
        <Field label="Monto"><MoneyInput value={form.amount} onChange={(v) => set('amount', v)} /></Field>
        <Field label="Desde"><input className="input" type="date" value={form.period_start} onChange={(e) => set('period_start', e.target.value)} /></Field>
        <Field label="Hasta"><input className="input" type="date" value={form.period_end} onChange={(e) => set('period_end', e.target.value)} /></Field>
        <Field label="Proyecto (opcional)"><select className="select" value={form.project_id} onChange={(e) => set('project_id', e.target.value)}><option value="">Toda la empresa</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Responsable (opcional)"><select className="select" value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      </div>
      <Field label="Categorías" hint="Si no eliges ninguna, cuenta todos los gastos del periodo (y del proyecto, si elegiste uno).">
        <div className="flex wrap" style={{ gap: 6 }}>
          {cats.map((c) => {
            const on = form.category_ids.includes(c.id);
            return <button key={c.id} type="button" className={`filter-chip ${on ? 'on' : ''}`} onClick={() => set('category_ids', on ? form.category_ids.filter((x) => x !== c.id) : [...form.category_ids, c.id])}>{c.name}</button>;
          })}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Avisar al llegar al" hint="Porcentaje del presupuesto"><input className="input" type="number" min="1" max="100" value={form.alert_pct} onChange={(e) => set('alert_pct', e.target.value)} /></Field>
        <Field label="Si un gasto lo excede">
          <select className="select" value={form.over_action} onChange={(e) => set('over_action', e.target.value)}>
            <option value="warn">Solo mostrar advertencia</option>
            <option value="approval">Pedir aprobación</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ───────── Socios ─────────
export function Partners({ meta }) {
  const { openCreate } = useLayout();
  const members = useMemberMap();
  const [selected, setSelected] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'partners'], queryFn: () => api.get('/finance/partners') });
  if (isLoading) return <SkeletonList />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <div className="mb-4">
        <Callout icon={Info} title="Cómo se distingue cada cosa">
          <div className="small">
            <strong style={{ display: 'inline' }}>Aportación:</strong> dinero que un socio pone como capital (no se devuelve). ·{' '}
            <strong style={{ display: 'inline' }}>Préstamo:</strong> dinero que la empresa debe devolver. ·{' '}
            <strong style={{ display: 'inline' }}>Gasto con dinero propio:</strong> es un gasto del negocio y genera un reembolso pendiente. Nada de esto se cuenta como ingreso.
          </div>
        </Callout>
      </div>
      {meta.can.record && (
        <div className="btn-group mb-3">
          <Button size="sm" variant="primary" icon={HandCoins} onClick={() => openCreate('transaction', { kind: 'contribution' })}>Registrar aportación</Button>
          <Button size="sm" icon={Wallet} onClick={() => openCreate('transaction', { kind: 'loan_in' })}>Registrar préstamo de un socio</Button>
          <Button size="sm" variant="ghost" onClick={() => openCreate('expense', { paid_personally: true })}>Gasto pagado con dinero propio</Button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Integrante</th><th className="right">Capital aportado</th><th className="right">Préstamos por devolver</th><th className="right">Reembolsos pendientes</th><th className="right hide-sm">Pagó con su dinero</th><th className="right hide-sm">Ya reembolsado</th></tr></thead>
          <tbody>
            {data.partners.map((p) => (
              <tr key={p.member.id}>
                <td><span className="flex"><Avatar user={members.get(p.member.id) || p.member} size="sm" />{p.member.name}</span>{p.contributions_by_type.length > 1 && <div className="faint tiny">{p.contributions_by_type.map((c) => `${c.type}: ${money(c.total)}`).join(' · ')}</div>}</td>
                <td className="right num strong">{money(p.capital_cents)}</td>
                <td className="right num">{p.loans_pending_cents ? money(p.loans_pending_cents) : '—'}</td>
                <td className={`right num ${p.reimbursements_pending_cents ? 'strong' : ''}`}>{p.reimbursements_pending_cents ? money(p.reimbursements_pending_cents) : '—'}</td>
                <td className="right num muted hide-sm">{money(p.paid_personally_cents)}</td>
                <td className="right num muted hide-sm">{money(p.reimbursed_cents)}</td>
              </tr>
            ))}
          </tbody>
          {data.partners.length > 1 && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="right">{money(data.partners.reduce((s, p) => s + p.capital_cents, 0))}</td>
                <td className="right">{money(data.partners.reduce((s, p) => s + p.loans_pending_cents, 0))}</td>
                <td className="right">{money(data.partners.reduce((s, p) => s + p.reimbursements_pending_cents, 0))}</td>
                <td className="right hide-sm">{money(data.partners.reduce((s, p) => s + p.paid_personally_cents, 0))}</td>
                <td className="right hide-sm">{money(data.partners.reduce((s, p) => s + p.reimbursed_cents, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="section">
        <div className="section-title"><h3>Aportaciones y préstamos registrados</h3></div>
        {data.contributions.length ? <div className="card" style={{ padding: 6 }}>{data.contributions.map((tx) => <TxRow key={tx.id} tx={tx} onClick={() => setSelected(tx.id)} />)}</div> : <EmptyState compact title="Sin aportaciones registradas" />}
      </div>
      {selected && <TransactionDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

// ───────── Reportes ─────────
export function Reports({ meta }) {
  const [period, setPeriod] = useState('year');
  const [group, setGroup] = useState('category');
  const [projectId, setProjectId] = useState('');
  const { data: projects = [] } = useProjects();
  const range = periodRange(period);
  const query = { ...range, group, project_id: projectId };
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'report', query], queryFn: () => api.get(`/finance/report${qs(query)}`), enabled: meta.can.view });
  if (!meta.can.view) return <EmptyState title="Sin acceso">Los reportes los consulta quien tiene acceso a las finanzas.</EmptyState>;
  const groupLabel = { category: 'Categoría', project: 'Proyecto', member: 'Responsable del registro', month: 'Mes', account: 'Cuenta' }[group];
  return (
    <>
      <div className="filter-bar">
        <PeriodSelect value={period} onChange={setPeriod} />
        <select className="select" style={{ width: 'auto', height: 32 }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Agrupar por">
          <option value="category">Por categoría</option>
          <option value="project">Por proyecto</option>
          <option value="month">Por mes</option>
          <option value="member">Por responsable del registro</option>
          <option value="account">Por cuenta</option>
        </select>
        <select className="select" style={{ width: 'auto', height: 32 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
          <option value="">Toda la empresa</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" style={{ flex: 1 }} />
        <a className="btn sm" href={`/api/finance/export.csv${qs({ ...query, type: 'report' })}`}><FileSpreadsheet size={14} />Exportar reporte</a>
        <a className="btn sm" href={`/api/finance/export.csv${qs({ ...range, project_id: projectId, status: 'all' })}`}><Download size={14} />Exportar movimientos</a>
      </div>
      {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} /> : !data.rows.length ? <EmptyState compact title="Sin movimientos en este periodo" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{groupLabel}</th><th className="right">Ingresos</th><th className="right">Gastos</th><th className="right">Balance</th><th className="right hide-sm">Movimientos</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={String(r.group_key)}>
                  <td>{group === 'month' ? fmtDate(`${r.label}-01`, 'MMMM yyyy') : r.label}</td>
                  <td className="right num">{r.income_cents ? money(r.income_cents) : '—'}</td>
                  <td className="right num">{r.expense_cents ? money(r.expense_cents) : '—'}</td>
                  <td className={`right num ${r.net_cents < 0 ? 'neg' : ''}`}>{money(r.net_cents)}</td>
                  <td className="right muted hide-sm">{r.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td className="right">{money(data.total.income_cents)}</td><td className="right">{money(data.total.expense_cents)}</td><td className={`right ${data.total.net_cents < 0 ? 'neg' : ''}`}>{money(data.total.net_cents)}</td><td className="right hide-sm">{data.total.count}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="faint small mt-2">Incluye solo ingresos y gastos aprobados y vigentes. Las aportaciones, préstamos, reembolsos y transferencias no son ingresos ni gastos. El archivo CSV se abre en Excel, Numbers o Google Sheets.</p>
    </>
  );
}

// ───────── Cuentas y categorías ─────────
export function FinanceSetup({ meta }) {
  const confirm = useConfirm();
  const [account, setAccount] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', kind: 'expense', color: 'gray' });
  const [editCat, setEditCat] = useState(null);
  const inv = ['finance'];
  const updateAccount = useAction(({ id, ...b }) => api.patch(`/finance/accounts/${id}`, b), { invalidate: inv });
  const addCat = useAction(() => api.post('/finance/categories', newCat), { invalidate: inv, success: 'Categoría creada', onSuccess: () => setNewCat({ ...newCat, name: '' }) });
  const updateCat = useAction(({ id, ...b }) => api.patch(`/finance/categories/${id}`, b), { invalidate: inv, onSuccess: () => setEditCat(null) });
  const delCat = useAction((id) => api.del(`/finance/categories/${id}`), { invalidate: inv, success: 'Categoría eliminada' });
  const can = meta.can.approve;
  return (
    <>
      <div className="section" style={{ marginTop: 0 }}>
        <div className="section-title"><h3>Cuentas y fondos</h3>{can && <Button size="xs" variant="ghost" icon={Plus} onClick={() => setAccount({})}>Nueva cuenta</Button>}</div>
        <div className="card" style={{ padding: 6 }}>
          {meta.accounts.map((a) => (
            <div key={a.id} className="list-row" style={a.archived_at ? { opacity: 0.55 } : undefined}>
              <Wallet size={16} className="faint" />
              <span className="grow"><span className="title">{a.name}</span><div className="faint tiny">{ACCOUNT_TYPES[a.type]}{a.initial_balance_cents !== undefined ? ` · saldo inicial ${money(a.initial_balance_cents)}` : ''}{a.archived_at ? ' · archivada' : ''}</div></span>
              {a.balance_cents !== undefined && <span className="amount">{money(a.balance_cents)}</span>}
              {can && <IconButton icon={Pencil} size="sm" label="Editar" onClick={() => setAccount(a)} />}
              {can && <IconButton icon={a.archived_at ? ArchiveRestore : Archive} size="sm" label={a.archived_at ? 'Restaurar' : 'Archivar'} onClick={() => updateAccount.mutate({ id: a.id, archived: !a.archived_at })} />}
            </div>
          ))}
        </div>
        <p className="faint small mt-2">Registra el saldo inicial real de cada cuenta al empezar. Después, los saldos se calculan con los movimientos.</p>
      </div>

      <div className="section">
        <div className="section-title"><h3>Categorías</h3></div>
        <div className="grid-2" style={{ gap: 16 }}>
          {['expense', 'income'].map((kind) => (
            <div key={kind}>
              <div className="label mb-2">{kind === 'expense' ? 'De gastos' : 'De ingresos'}</div>
              <div className="card" style={{ padding: 6 }}>
                {meta.categories.filter((c) => c.kind === kind).map((c) => (
                  <div key={c.id} className="list-row" style={c.archived_at ? { opacity: 0.5 } : undefined}>
                    <span className={`swatch m-${c.color}`} />
                    {editCat?.id === c.id ? (
                      <input className="input" style={{ height: 28 }} autoFocus value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} onBlur={() => editCat.name.trim() && updateCat.mutate({ id: c.id, name: editCat.name })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                    ) : <span className="grow title">{c.name}{c.archived_at ? ' (archivada)' : ''}</span>}
                    {can && editCat?.id !== c.id && (
                      <>
                        <IconButton icon={Pencil} size="xs" label="Renombrar" onClick={() => setEditCat({ id: c.id, name: c.name })} />
                        <IconButton icon={c.archived_at ? ArchiveRestore : Archive} size="xs" label={c.archived_at ? 'Restaurar' : 'Archivar'} onClick={() => updateCat.mutate({ id: c.id, archived: !c.archived_at })} />
                        <IconButton icon={Trash2} size="xs" label="Eliminar" onClick={async () => (await confirm({ title: `¿Eliminar «${c.name}»?`, message: 'Solo se pueden eliminar categorías sin movimientos; si tiene, archívala.', confirmLabel: 'Eliminar', danger: true })) && delCat.mutate(c.id)} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {can && (
          <div className="card pad mt-3">
            <div className="label mb-2">Nueva categoría</div>
            <div className="flex wrap" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Nombre" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
              <select className="select" style={{ width: 'auto' }} value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value })}><option value="expense">Gasto</option><option value="income">Ingreso</option></select>
              <Button variant="primary" disabled={!newCat.name.trim()} loading={addCat.isPending} onClick={() => addCat.mutate()}>Agregar</Button>
            </div>
            <div className="mt-2"><ColorDots colors={COLORS} value={newCat.color} onChange={(c) => setNewCat({ ...newCat, color: c })} /></div>
          </div>
        )}
        {!can && <p className="faint small mt-2">Las cuentas y categorías las administra quien tiene permiso de aprobar movimientos.</p>}
      </div>
      {account && <AccountModal account={account.id ? account : null} onClose={() => setAccount(null)} />}
    </>
  );
}

function AccountModal({ account, onClose }) {
  const [form, setForm] = useState({ name: account?.name || '', type: account?.type || 'bank', initial: centsToInput(account?.initial_balance_cents ?? 0), notes: account?.notes || '' });
  const [error, setError] = useState(null);
  const save = useAction(() => {
    const neg = String(form.initial).trim().startsWith('-');
    const cents = parseMoney(String(form.initial).replace('-', '')) ?? 0;
    const body = { name: form.name, type: form.type, notes: form.notes, initial_balance_cents: neg ? -cents : cents };
    return account ? api.patch(`/finance/accounts/${account.id}`, body) : api.post('/finance/accounts', body);
  }, { invalidate: ['finance'], success: 'Cuenta guardada', onSuccess: onClose, onError: setError });
  return (
    <Modal size="sm" title={account ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <FormError error={error} />
      <Field label="Nombre"><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Cuenta BBVA, Caja chica" /></Field>
      <Field label="Tipo"><select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Saldo inicial" hint={account ? 'Cambiarlo afecta el saldo calculado y queda en el historial.' : 'El dinero que ya había en la cuenta al empezar a usar la plataforma.'}><MoneyInput value={form.initial} onChange={(v) => setForm({ ...form, initial: v })} /></Field>
      <Field label="Notas"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </Modal>
  );
}
