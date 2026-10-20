import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button, IconButton } from './ui.jsx';

// ───────── Bloqueo de scroll y tecla Escape compartidos ─────────
const stack = [];
function useEscape(onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    stack.push(token);
    const handler = (e) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === token) {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      stack.splice(stack.indexOf(token), 1);
    };
  }, [onClose, active]);
}

export function Modal({ open = true, onClose, title, children, footer, size = '', icon, back }) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        {title !== undefined && (
          <div className="modal-head">
            {back && <IconButton icon={ArrowLeft} label="Atrás" size="sm" onClick={back} />}
            {icon}
            <h2>{title}</h2>
            {onClose && <IconButton icon={X} label="Cerrar" size="sm" onClick={onClose} />}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open = true, onClose, header, children }) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          {header}
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

// ───────── Popover posicionado junto a su ancla ─────────
export function Popover({ anchor, open, onClose, children, placement = 'bottom-start', className = 'menu', width, matchWidth }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEscape(onClose, open);

  useLayoutEffect(() => {
    if (!open || !anchor) return undefined;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth || width || 220;
      const h = el?.offsetHeight || 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = placement.endsWith('end') ? a.right - w : a.left;
      let top = placement.startsWith('top') ? a.top - h - 6 : a.bottom + 6;
      if (top + h > vh - 8 && a.top - h - 6 > 8) top = a.top - h - 6;
      if (top < 8) top = 8;
      left = Math.max(8, Math.min(left, vw - w - 8));
      setPos({ top, left, minWidth: matchWidth ? a.width : undefined });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, placement, width, matchWidth]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, minWidth: pos?.minWidth, zIndex: 250 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Botón + menú desplegable. items: [{label, icon, onClick, danger, checked, disabled, hint} | 'sep' | {section}] */
export function Menu({ trigger, items, placement = 'bottom-end', width }) {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      {trigger({ onClick: (e) => { e.stopPropagation(); setAnchor(open ? null : e.currentTarget); }, 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      <Popover anchor={anchor} open={open} onClose={close} placement={placement} width={width}>
        <div role="menu">
          {items.filter(Boolean).map((it, i) => {
            if (it === 'sep') return <div key={i} className="menu-sep" />;
            if (it.section) return <div key={i} className="menu-label">{it.section}</div>;
            const Icon = it.icon;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu-item ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  it.onClick?.(e);
                }}
              >
                {Icon && <span className="icon"><Icon size={15} /></span>}
                {it.emoji && <span style={{ width: 16, textAlign: 'center' }}>{it.emoji}</span>}
                <span className="truncate">{it.label}</span>
                {it.checked && <Check size={15} className="check-mark" />}
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

// ───────── Avisos (toasts) ─────────
const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message, opts = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, message, ...opts }]);
      setTimeout(() => remove(id), opts.duration || (opts.tone === 'error' ? 6000 : 3500));
      return id;
    },
    [remove],
  );
  const api = useRef(null);
  api.current = {
    show,
    success: (m, o) => show(m, { ...o, tone: 'success' }),
    error: (e, o) => show(typeof e === 'string' ? e : e?.message || 'Ocurrió un error.', { ...o, tone: 'error' }),
  };
  const [stable] = useState(() => ({
    show: (...a) => api.current.show(...a),
    success: (...a) => api.current.success(...a),
    error: (...a) => api.current.error(...a),
  }));
  return (
    <ToastContext.Provider value={stable}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`} role="status">
              {t.tone === 'success' && <Check size={16} />}
              {t.tone === 'error' && <AlertTriangle size={16} />}
              <span style={{ flex: 1 }}>{t.message}</span>
              {t.action && (
                <button className="toast-action" onClick={() => { t.action.onClick(); remove(t.id); }}>
                  {t.action.label}
                </button>
              )}
              <IconButton icon={X} label="Cerrar" size="xs" onClick={() => remove(t.id)} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

// ───────── Confirmaciones ─────────
const ConfirmContext = createContext(null);
export const useConfirm = () => useContext(ConfirmContext);

/**
 * confirm({ title, message, confirmLabel, danger, input: { label, placeholder, required } })
 * → Promise<false | true | string>
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const [text, setText] = useState('');
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setText('');
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = (value) => {
    state?.resolve(value);
    setState(null);
  };
  const needsText = state?.input?.required && !text.trim();
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          size="sm"
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>{state.cancelLabel || 'Cancelar'}</Button>
              <Button variant={state.danger ? 'danger' : 'primary'} disabled={needsText} onClick={() => close(state.input ? text.trim() : true)} autoFocus={!state.input}>
                {state.confirmLabel || 'Confirmar'}
              </Button>
            </>
          }
        >
          {state.message && <p className="muted" style={{ marginBottom: state.input ? 14 : 0 }}>{state.message}</p>}
          {state.input && (
            <div className="field">
              {state.input.label && <label>{state.input.label}</label>}
              <textarea
                className="textarea"
                style={{ minHeight: 70 }}
                autoFocus
                placeholder={state.input.placeholder}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
