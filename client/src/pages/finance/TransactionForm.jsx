import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, HandCoins, Landmark, ArrowLeftRight, Paperclip, X, AlertTriangle, Info } from 'lucide-react';
import { api, uploadFiles } from '../../lib/api.js';
import { centsToInput, parseMoney, todayIso, money } from '../../lib/format.js';
import { useActiveMembers, useDebounced, useFinanceMeta, useMe, useProjects } from '../../lib/hooks.js';
import { Button, Callout, Field, FormError, MoneyInput, Segmented, Spinner } from '../../components/ui.jsx';
import { Modal, useToast } from '../../components/overlay.jsx';

export const KIND_OPTIONS = [
  { value: 'expense', label: 'Gasto', icon: ArrowUpRight },
  { value: 'income', label: 'Ingreso', icon: ArrowDownLeft },
  { value: 'contribution', label: 'Aportación de socio', icon: HandCoins },
  { value: 'loan_in', label: 'Préstamo recibido', icon: Landmark },
  { value: 'transfer', label: 'Transferencia', icon: ArrowLeftRight },
];

const HELP = {
  expense: 'Dinero que sale para el negocio. Si lo pagó un integrante con su dinero, se registra el reembolso pendiente.',
  income: 'Dinero que entra por ventas o servicios del negocio.',
  contribution: 'Dinero que un socio pone en la empresa como capital. No es un ingreso ni una deuda.',
  loan_in: 'Dinero prestado a la empresa (por un socio o un tercero). Se registra la deuda para devolverlo.',
  transfer: 'Mover dinero entre cuentas de la empresa. No cambia los ingresos ni los gastos.',
};

/** Formulario para registrar o editar un movimiento financiero. */
export function TransactionModal({ defaults = {}, transaction, onClose, onSaved }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: meta } = useFinanceMeta();
  const members = useActiveMembers();
  const { data: projects = [] } = useProjects({ status: 'planning,active,paused' });
  const editing = Boolean(transaction);
  const [form, setForm] = useState(() => ({
    kind: transaction?.kind || defaults.kind || 'expense',
    amount: transaction ? centsToInput(transaction.amount_cents) : defaults.amount || '',
    concept: transaction?.concept || defaults.concept || '',
    date: transaction?.date || defaults.date || todayIso(),
    category_id: transaction?.category_id ?? defaults.category_id ?? '',
    account_id: transaction?.account_id ?? defaults.account_id ?? '',
    to_account_id: transaction?.to_account_id ?? '',
    project_id: transaction?.project_id ?? defaults.project_id ?? '',
    member_id: transaction?.member_id ?? defaults.member_id ?? '',
    counterparty: transaction?.counterparty || '',
    payment_method: transaction?.payment_method || '',
    notes: transaction?.notes || '',
    contribution_type: transaction?.contribution_type || '',
    paid_personally: transaction ? Boolean(transaction.paid_personally) : Boolean(defaults.paid_personally),
    reimburse_due_date: '',
    repay_due_date: '',
  }));
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cents = parseMoney(form.amount);

  const accounts = (meta?.accounts || []).filter((a) => !a.archived_at || a.id === form.account_id);
  useEffect(() => {
    if (meta && !form.account_id && accounts.length === 1 && form.kind !== 'transfer') set('account_id', accounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);
  useEffect(() => {
    if (form.kind === 'contribution' && !form.contribution_type && meta?.contribution_types?.length) set('contribution_type', meta.contribution_types[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.kind, meta]);

  // Aviso de presupuesto o aprobación antes de guardar.
  const dPreview = useDebounced(JSON.stringify({ kind: form.kind, amount: form.amount, date: form.date, project_id: form.project_id, category_id: form.category_id }), 400);
  useEffect(() => {
    const p = JSON.parse(dPreview);
    if (editing || p.kind !== 'expense' || !parseMoney(p.amount)) return setPreview(null);
    api.post('/finance/transactions/preview', { ...p, project_id: p.project_id || null, category_id: p.category_id || null }).then(setPreview).catch(() => setPreview(null));
  }, [dPreview, editing]);

  const categories = (meta?.categories || []).filter((c) => c.kind === form.kind && (!c.archived_at || c.id === form.category_id));
  const upload = async (list) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const res = await uploadFiles([...list], { visibility: 'finance' });
      setFiles((f) => [...f, ...res]);
    } catch (e) {
      toast.error(e);
    }
    setUploading(false);
  };

  const submit = async () => {
    setError(null);
    if (!cents) return setError(new Error('Escribe un monto válido (por ejemplo 1250.50).'));
    setSaving(true);
    const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const body = {
      kind: form.kind,
      amount_cents: cents,
      concept: form.concept,
      date: form.date,
      category_id: ['income', 'expense'].includes(form.kind) ? n(form.category_id) : null,
      account_id: form.kind === 'expense' && form.paid_personally ? null : n(form.account_id),
      to_account_id: form.kind === 'transfer' ? n(form.to_account_id) : null,
      project_id: n(form.project_id),
      member_id: form.kind === 'transfer' ? null : n(form.member_id),
      counterparty: form.counterparty,
      payment_method: form.payment_method,
      notes: form.notes,
      contribution_type: form.kind === 'contribution' ? form.contribution_type : null,
      paid_personally: form.kind === 'expense' && form.paid_personally,
      reimburse_due_date: form.reimburse_due_date || null,
      repay_due_date: form.repay_due_date || null,
      file_ids: files.map((f) => f.id),
    };
    try {
      let res;
      if (editing) {
        const { kind, paid_personally, file_ids, reimburse_due_date, repay_due_date, ...patch } = body;
        res = await api.patch(`/finance/transactions/${transaction.id}`, patch);
      } else {
        res = await api.post('/finance/transactions', body);
      }
      qc.invalidateQueries({ predicate: (q) => ['finance', 'dashboard', 'calendar'].includes(q.queryKey[0]) });
      if (res.approval_status === 'pending') toast.show(`Guardado como pendiente de aprobación${res.approval_reason ? `: ${res.approval_reason}` : ''}`, { duration: 6000 });
      else toast.success(editing ? 'Movimiento actualizado' : 'Movimiento registrado');
      onSaved?.(res);
      onClose();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  const k = form.kind;
  const needAccount = !(k === 'expense' && form.paid_personally);
  const valid = cents && form.concept.trim() && (!needAccount || form.account_id) && (k !== 'transfer' || form.to_account_id) && (k !== 'contribution' || form.member_id) && (!(k === 'expense' && form.paid_personally) || form.member_id) && (k !== 'loan_in' || form.member_id || form.counterparty.trim());

  return (
    <Modal
      size="lg"
      title={editing ? 'Editar movimiento' : 'Registrar movimiento'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid || uploading} loading={saving} onClick={submit}>{editing ? 'Guardar cambios' : 'Registrar'}</Button></>}
    >
      {!meta ? <Spinner /> : (
        <>
          <FormError error={error} />
          {!editing && (
            <div className="kind-picker" role="radiogroup" aria-label="Tipo de movimiento">
              {KIND_OPTIONS.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={k === o.value} className={`kind-option ${k === o.value ? 'active' : ''}`} onClick={() => set('kind', o.value)}>
                  <span className={`kind-ico ${o.value}`} style={{ width: 24, height: 24 }}><o.icon size={14} /></span>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <p className="muted small mb-3 flex" style={{ gap: 6, alignItems: 'flex-start' }}><Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />{HELP[k]}</p>
          <div className="grid-2">
            <Field label="Monto" htmlFor="tx-amount"><MoneyInput id="tx-amount" large autoFocus value={form.amount} onChange={(v) => set('amount', v)} /></Field>
            <Field label="Fecha"><input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} style={{ height: 44 }} /></Field>
          </div>
          <Field label="Concepto"><input className="input" value={form.concept} onChange={(e) => set('concept', e.target.value)} placeholder={k === 'expense' ? 'Ej. Macetas de barro para la feria' : k === 'income' ? 'Ej. Venta en mercado del sábado' : k === 'contribution' ? 'Ej. Aportación inicial' : k === 'loan_in' ? 'Ej. Préstamo para compra de material' : 'Ej. Depósito de efectivo al banco'} /></Field>

          {k === 'expense' && !editing && (
            <Field label="¿Quién pagó?">
              <Segmented value={form.paid_personally ? 'member' : 'company'} onChange={(v) => set('paid_personally', v === 'member')} options={[{ value: 'company', label: 'La empresa' }, { value: 'member', label: 'Un integrante con su dinero' }]} />
            </Field>
          )}

          <div className="grid-2">
            {k === 'transfer' ? (
              <>
                <Field label="Desde la cuenta"><AccountSelect accounts={accounts} value={form.account_id} onChange={(v) => set('account_id', v)} /></Field>
                <Field label="Hacia la cuenta"><AccountSelect accounts={accounts.filter((a) => a.id !== Number(form.account_id))} value={form.to_account_id} onChange={(v) => set('to_account_id', v)} /></Field>
              </>
            ) : (
              <>
                {needAccount && <Field label={k === 'expense' ? 'Cuenta de origen' : 'Cuenta donde entra'}><AccountSelect accounts={accounts} value={form.account_id} onChange={(v) => set('account_id', v)} /></Field>}
                {(k === 'contribution' || k === 'loan_in' || (k === 'expense' && form.paid_personally) || k === 'income') && (
                  <Field label={k === 'contribution' ? 'Socio que aporta' : k === 'loan_in' ? 'Socio que presta (o deja vacío si es un tercero)' : k === 'income' ? 'Quién lo recibió (opcional)' : 'Integrante que pagó'}>
                    <select className="select" value={form.member_id} onChange={(e) => set('member_id', e.target.value)}>
                      <option value="">{k === 'income' || k === 'loan_in' ? '—' : 'Elegir…'}</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (yo)` : m.name}</option>)}
                    </select>
                  </Field>
                )}
                {(k === 'income' || k === 'expense') && (
                  <Field label="Categoría">
                    <select className="select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                      <option value="">Sin categoría</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                )}
                {k === 'contribution' && (
                  <Field label="Tipo de aportación">
                    <select className="select" value={form.contribution_type} onChange={(e) => set('contribution_type', e.target.value)}>
                      {(meta.contribution_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                )}
                {(k === 'income' || k === 'expense' || (k === 'loan_in' && !form.member_id)) && (
                  <Field label={k === 'income' ? 'Cliente' : k === 'expense' ? 'Proveedor o comercio' : 'Quién prestó'}><input className="input" value={form.counterparty} onChange={(e) => set('counterparty', e.target.value)} /></Field>
                )}
                <Field label="Proyecto (opcional)">
                  <select className="select" value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
                    <option value="">Sin proyecto</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>)}
                  </select>
                </Field>
                {(k === 'income' || k === 'expense') && (
                  <Field label="Método de pago">
                    <select className="select" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                      <option value="">—</option>
                      {(meta.payment_methods || []).map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </Field>
                )}
                {k === 'expense' && form.paid_personally && !editing && <Field label="¿Cuándo se le reembolsa? (opcional)"><input className="input" type="date" value={form.reimburse_due_date} onChange={(e) => set('reimburse_due_date', e.target.value)} /></Field>}
                {k === 'loan_in' && !editing && <Field label="Fecha para devolverlo (opcional)"><input className="input" type="date" value={form.repay_due_date} onChange={(e) => set('repay_due_date', e.target.value)} /></Field>}
              </>
            )}
          </div>

          {k === 'expense' && form.paid_personally && cents && form.member_id && (
            <div className="mb-3"><Callout tone="info" icon={HandCoins}>Se registrará que la empresa debe reembolsar {money(cents)} a {members.find((m) => m.id === Number(form.member_id))?.name}. No sale dinero de ninguna cuenta hasta que se registre el reembolso.</Callout></div>
          )}
          {preview?.warnings?.length > 0 && (
            <div className="mb-3">
              <Callout tone={preview.pending ? 'warning' : 'info'} icon={AlertTriangle} title={preview.pending ? 'Este gasto quedará pendiente de aprobación' : 'Aviso de presupuesto'}>
                {preview.warnings.map((w) => <div key={w.name} className="small">{w.exceeds ? 'Excede' : 'Se acerca al límite de'} «{w.name}»{w.amount_cents ? ` (${money(w.spent_after_cents)} de ${money(w.amount_cents)})` : ''}</div>)}
              </Callout>
            </div>
          )}
          {preview?.pending && !preview.warnings?.length && <div className="mb-3"><Callout tone="warning" icon={AlertTriangle} title="Quedará pendiente de aprobación">{preview.reason}</Callout></div>}

          <Field label="Notas"><textarea className="textarea" style={{ minHeight: 60 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          {!editing && (
            <div>
              <input ref={fileInput} type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
              <div className="flex wrap" style={{ gap: 6 }}>
                {files.map((f) => (
                  <span key={f.id} className="pill c-gray"><Paperclip size={11} /><span>{f.name}</span><button className="icon-btn xs" style={{ width: 16, height: 16 }} aria-label="Quitar" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><X size={11} /></button></span>
                ))}
                <Button size="xs" variant="ghost" icon={Paperclip} loading={uploading} onClick={() => fileInput.current.click()}>Adjuntar comprobante</Button>
              </div>
              <p className="faint tiny mt-1">Los comprobantes solo los ven quienes tienen acceso a finanzas.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function AccountSelect({ accounts, value, onChange }) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">Elegir cuenta…</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.balance_cents !== undefined ? ` · ${money(a.balance_cents)}` : ''}</option>)}
    </select>
  );
}
