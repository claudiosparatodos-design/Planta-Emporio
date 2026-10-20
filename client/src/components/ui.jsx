import { forwardRef, useEffect, useRef } from 'react';
import { AlertCircle, Flag, CalendarDays, Repeat, Inbox } from 'lucide-react';
import { STATUS, PRIORITY } from '../lib/constants.js';
import { dueState, initials, relativeDay } from '../lib/format.js';
import { fileUrl } from '../lib/api.js';

export const Spinner = ({ size }) => <span className="spinner" style={size ? { width: size, height: size } : undefined} />;

export const Button = forwardRef(function Button(
  { variant, size, block, loading, icon: Icon, children, className = '', type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', variant, size, block && 'block', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner /> : Icon ? <Icon size={size === 'xs' ? 13 : 15} strokeWidth={2} /> : null}
      {children}
    </button>
  );
});

export const IconButton = forwardRef(function IconButton({ icon: Icon, label, size, className = '', active, iconSize, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={['icon-btn', size, active && 'active', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Icon size={iconSize || (size === 'xs' ? 14 : 16)} strokeWidth={2} />
    </button>
  );
});

export function Avatar({ user, size = '', title }) {
  if (!user) return <span className={`avatar ${size} c-gray`} aria-hidden>?</span>;
  return (
    <span className={`avatar ${size} c-${user.avatar_color || 'gray'}`} title={title ?? user.name} aria-label={user.name}>
      {user.avatar_file_id ? <img src={fileUrl(user.avatar_file_id)} alt="" /> : initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3, size = 'sm' }) {
  const shown = users.filter(Boolean).slice(0, max);
  const extra = users.filter(Boolean).length - shown.length;
  if (!shown.length) return null;
  return (
    <span className="avatar-stack" title={users.filter(Boolean).map((u) => u.name).join(', ')}>
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} title="" />
      ))}
      {extra > 0 && <span className="more">+{extra}</span>}
    </span>
  );
}

export function UserChip({ user, size = 'sm', muted }) {
  if (!user) return <span className="faint">—</span>;
  return (
    <span className="user-chip">
      <Avatar user={user} size={size} />
      <span className={`name ${muted ? 'muted' : ''}`}>{user.name}</span>
    </span>
  );
}

export function Pill({ color = 'gray', children, dot, size, square, className = '', ...rest }) {
  return (
    <span className={`pill c-${color} ${size || ''} ${square ? 'square' : ''} ${className}`} {...rest}>
      {dot && <span className="dot" />}
      <span>{children}</span>
    </span>
  );
}

export function StatusPill({ status, size }) {
  const s = STATUS[status] || STATUS.todo;
  return (
    <Pill color={s.color} dot size={size}>
      {s.label}
    </Pill>
  );
}

export function PriorityFlag({ priority, showLabel }) {
  if (!priority || priority === 'none') return showLabel ? <span className="faint">Sin prioridad</span> : null;
  const p = PRIORITY[priority];
  return (
    <span className={`prio-flag ${priority}`} title={`Prioridad ${p.label.toLowerCase()}`}>
      <Flag size={13} fill="currentColor" strokeWidth={2} />
      {showLabel && <span style={{ marginLeft: 5, color: 'var(--text)' }}>{p.label}</span>}
    </span>
  );
}

export function DueDate({ task, date, icon = true }) {
  const d = date || task?.due_date;
  if (!d) return null;
  const state = task ? dueState(task) : null;
  return (
    <span className={`due ${state || ''}`} title={state === 'overdue' ? 'Vencida' : 'Fecha límite'}>
      {icon && <CalendarDays size={12.5} />}
      {relativeDay(d)}
      {task?.recurrence && <Repeat size={11} />}
    </span>
  );
}

export function Progress({ value = 0, tone, thin }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress ${tone || ''} ${thin ? 'thin' : ''}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, actions, compact }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">
        <Icon size={22} />
      </div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {actions && <div className="btn-group">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="empty-icon" style={{ color: 'var(--danger)' }}>
        <AlertCircle size={22} />
      </div>
      <h3>{error?.status === 404 ? 'No encontramos esto' : error?.status === 403 ? 'No tienes acceso' : 'Algo salió mal'}</h3>
      <p>{error?.message || 'No se pudo cargar la información.'}</p>
      {onRetry && error?.status !== 404 && error?.status !== 403 && (
        <div className="btn-group">
          <Button onClick={onRetry}>Reintentar</Button>
        </div>
      )}
    </div>
  );
}

export const Loading = () => (
  <div className="center-load">
    <Spinner />
  </div>
);

export function Skeleton({ h = 16, w = '100%', style }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div className="flex-col" style={{ gap: 10, padding: '8px 4px' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={22} w={`${90 - (i % 3) * 15}%`} />
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="check" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span className="switch">
        <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        <span />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)} style={size === 'sm' ? { padding: '3px 8px' } : undefined}>
          {o.icon && <o.icon size={14} />}
          {o.label && <span className={o.icon ? 'hide-sm' : ''}>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={14} />}
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Callout({ tone = '', icon: Icon = AlertCircle, title, children, action }) {
  return (
    <div className={`callout ${tone}`}>
      <Icon size={17} style={{ flexShrink: 0, marginTop: 1 }} />
      <div className="callout-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{error.message || String(error)}</span>
    </div>
  );
}

/** Textarea que crece con el contenido. */
export function AutoTextarea({ value, onChange, className = 'textarea', minRows = 1, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} className={className} value={value} onChange={onChange} {...rest} />;
}

export function MoneyInput({ value, onChange, large, autoFocus, id, placeholder = '0.00' }) {
  return (
    <div className={`input-money ${large ? 'lg' : ''}`}>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
      />
    </div>
  );
}

export function ColorDots({ value, onChange, colors }) {
  return (
    <div className="color-dots">
      {colors.map((c) => (
        <button key={c} type="button" className={`color-dot m-${c} ${value === c ? 'active' : ''}`} onClick={() => onChange(c)} aria-label={c} title={c} />
      ))}
    </div>
  );
}

/** Resalta las coincidencias marcadas por el buscador como [[texto]]. */
export function Snippet({ text }) {
  if (!text) return null;
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <span>
      {parts.map((p, i) => (p.startsWith('[[') ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}
