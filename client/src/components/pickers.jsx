import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, Plus, X, CheckSquare, FolderKanban, FileText, CalendarClock, Gavel, Target, Paperclip, Hash } from 'lucide-react';
import { Popover } from './overlay.jsx';
import { Avatar, Pill, StatusPill, PriorityFlag, Spinner } from './ui.jsx';
import { STATUSES, PRIORITIES, COLORS, PROJECT_ICONS } from '../lib/constants.js';
import { useActiveMembers, useTags, useProjects, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';

/** Lista seleccionable con búsqueda y teclado. */
export function OptionList({ options, selected = [], onSelect, multi, search = true, placeholder = 'Buscar…', onCreate, createLabel, emptyText = 'Sin resultados' }) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(0);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.sub?.toLowerCase().includes(t)) : options;
  }, [q, options]);
  const canCreate = onCreate && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => Math.min(f + 1, filtered.length - (canCreate ? 0 : 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => Math.max(f - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[focus]) onSelect(filtered[focus].value);
      else if (canCreate) onCreate(q.trim());
      setQ('');
    }
  };
  return (
    <div>
      {search && (
        <div className="menu-search">
          <input className="input" autoFocus placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setFocus(0); }} onKeyDown={onKey} />
        </div>
      )}
      {filtered.map((o, i) => (
        <button key={String(o.value)} type="button" className={`menu-item ${i === focus ? 'focused' : ''}`} onMouseEnter={() => setFocus(i)} onClick={() => onSelect(o.value)}>
          {o.render ? o.render() : <span className="truncate">{o.label}</span>}
          {o.sub && <span className="hint truncate">{o.sub}</span>}
          {(multi ? selected.includes(o.value) : selected[0] === o.value) && <Check size={15} className="check-mark" />}
        </button>
      ))}
      {!filtered.length && !canCreate && <div className="menu-label" style={{ padding: 10 }}>{emptyText}</div>}
      {canCreate && (
        <button type="button" className={`menu-item ${focus === filtered.length ? 'focused' : ''}`} onClick={() => { onCreate(q.trim()); setQ(''); }}>
          <span className="icon"><Plus size={15} /></span>
          <span className="truncate">{createLabel || 'Crear'} «{q.trim()}»</span>
        </button>
      )}
    </div>
  );
}

function usePopover() {
  const [anchor, setAnchor] = useState(null);
  return { anchor, open: Boolean(anchor), toggle: (e) => setAnchor((a) => (a ? null : e.currentTarget)), close: () => setAnchor(null) };
}

/** Selector de integrantes (uno o varios). */
export function UserPicker({ value = [], onChange, multi = true, children, placeholder = 'Sin asignar', allowNone, exclude = [], disabled }) {
  const members = useActiveMembers().filter((m) => !exclude.includes(m.id));
  const pop = usePopover();
  const options = [
    ...(allowNone && !multi ? [{ value: null, label: 'Nadie', render: () => <span className="faint">Nadie</span> }] : []),
    ...members.map((m) => ({ value: m.id, label: m.name, sub: m.title || '', render: () => (<><Avatar user={m} size="sm" /><span className="truncate">{m.name}</span></>) })),
  ];
  const selected = multi ? value : [value];
  const pick = (id) => {
    if (multi) onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    else {
      onChange(id);
      pop.close();
    }
  };
  const shown = members.filter((m) => selected.includes(m.id));
  return (
    <>
      {children ? (
        children({ onClick: disabled ? undefined : pop.toggle, selected: shown })
      ) : (
        <button type="button" className={`prop-btn ${shown.length ? '' : 'empty-val'}`} onClick={disabled ? undefined : pop.toggle} disabled={disabled}>
          {shown.length ? (
            shown.length === 1 ? (
              <><Avatar user={shown[0]} size="sm" /> {shown[0].name}</>
            ) : (
              <span className="avatar-stack">{shown.map((u) => <Avatar key={u.id} user={u} size="sm" />)}<span style={{ marginLeft: 6 }}>{shown.map((u) => u.name.split(' ')[0]).join(', ')}</span></span>
            )
          ) : (
            placeholder
          )}
        </button>
      )}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={260}>
        <OptionList options={options} selected={selected} multi={multi} onSelect={pick} placeholder="Buscar integrante…" />
      </Popover>
    </>
  );
}

export function StatusPicker({ value, onChange, columns, children }) {
  const pop = usePopover();
  const options = columns
    ? columns.map((c) => ({ value: c.id, label: c.name, render: () => (<><span className={`swatch m-${STATUSES.find((s) => s.key === c.category)?.color}`} /><span>{c.name}</span></>) }))
    : STATUSES.map((s) => ({ value: s.key, label: s.label, render: () => <StatusPill status={s.key} size="sm" /> }));
  return (
    <>
      {children ? children({ onClick: pop.toggle }) : (
        <button type="button" className="prop-btn" onClick={pop.toggle}>
          <StatusPill status={columns ? columns.find((c) => c.id === value)?.category : value} />
          {columns && (() => {
            const col = columns.find((c) => c.id === value);
            return col && col.name !== STATUSES.find((s) => s.key === col.category)?.label ? <span className="muted small">{col.name}</span> : null;
          })()}
        </button>
      )}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={220}>
        <OptionList search={false} options={options} selected={[value]} onSelect={(v) => { onChange(v); pop.close(); }} />
      </Popover>
    </>
  );
}

export function PriorityPicker({ value, onChange, children }) {
  const pop = usePopover();
  const options = PRIORITIES.map((p) => ({ value: p.key, label: p.label, render: () => (<><span style={{ width: 16, display: 'grid', placeItems: 'center' }}><PriorityFlag priority={p.key} /></span><span>{p.label}</span></>) }));
  return (
    <>
      {children ? children({ onClick: pop.toggle }) : (
        <button type="button" className={`prop-btn ${value === 'none' ? 'empty-val' : ''}`} onClick={pop.toggle}>
          <PriorityFlag priority={value} showLabel />
        </button>
      )}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={200}>
        <OptionList search={false} options={options} selected={[value]} onSelect={(v) => { onChange(v); pop.close(); }} />
      </Popover>
    </>
  );
}

/** Fecha con selector nativo (cómodo en móvil). */
export function DateField({ value, onChange, placeholder = 'Sin fecha', clearable = true, min, max }) {
  const ref = useRef(null);
  return (
    <span className={`prop-btn ${value ? '' : 'empty-val'}`} style={{ position: 'relative' }}>
      <input
        ref={ref}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={placeholder}
        style={{ minWidth: 120, colorScheme: 'inherit', ...(value ? {} : { color: 'var(--text-3)' }) }}
      />
      {value && clearable && (
        <button type="button" className="icon-btn xs" aria-label="Quitar fecha" onClick={() => onChange(null)}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function TagPicker({ value = [], onChange, children }) {
  const { data: tags = [] } = useTags();
  const qc = useQueryClient();
  const pop = usePopover();
  const options = tags.map((t) => ({ value: t.id, label: t.name, render: () => <Pill color={t.color} size="sm">{t.name}</Pill> }));
  const create = async (name) => {
    const tag = await api.post('/tags', { name });
    qc.invalidateQueries({ queryKey: ['tags'] });
    onChange([...value, tag.id]);
  };
  const shown = tags.filter((t) => value.includes(t.id));
  return (
    <>
      {children ? children({ onClick: pop.toggle }) : (
        <button type="button" className={`prop-btn ${shown.length ? '' : 'empty-val'}`} onClick={pop.toggle} style={{ flexWrap: 'wrap' }}>
          {shown.length ? shown.map((t) => <Pill key={t.id} color={t.color} size="sm">{t.name}</Pill>) : 'Agregar etiquetas'}
        </button>
      )}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={240}>
        <OptionList options={options} selected={value} multi onSelect={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])} onCreate={create} createLabel="Crear etiqueta" placeholder="Buscar o crear…" />
      </Popover>
    </>
  );
}

export function ProjectPicker({ value, onChange, allowNone = true, children, placeholder = 'Sin proyecto' }) {
  const { data: projects = [] } = useProjects({ status: 'planning,active,paused' });
  const pop = usePopover();
  const options = [
    ...(allowNone ? [{ value: null, label: placeholder, render: () => <span className="faint">{placeholder}</span> }] : []),
    ...projects.map((p) => ({ value: p.id, label: p.name, render: () => (<><span style={{ width: 18, textAlign: 'center' }}>{p.icon || '📁'}</span><span className="truncate">{p.name}</span></>) })),
  ];
  const current = projects.find((p) => p.id === value);
  return (
    <>
      {children ? children({ onClick: pop.toggle, current }) : (
        <button type="button" className={`prop-btn ${current ? '' : 'empty-val'}`} onClick={pop.toggle}>
          {current ? <><span>{current.icon || '📁'}</span> {current.name}</> : placeholder}
        </button>
      )}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={260}>
        <OptionList options={options} selected={[value ?? null]} onSelect={(v) => { onChange(v); pop.close(); }} placeholder="Buscar proyecto…" />
      </Popover>
    </>
  );
}

export function EmojiPicker({ value, onChange, children, icons = PROJECT_ICONS, allowRemove = true }) {
  const pop = usePopover();
  return (
    <>
      {children({ onClick: pop.toggle })}
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} width={296}>
        <div className="emoji-grid">
          {icons.map((i) => (
            <button key={i} type="button" onClick={() => { onChange(i); pop.close(); }} aria-label={i} style={value === i ? { background: 'var(--bg-active)' } : undefined}>{i}</button>
          ))}
        </div>
        {allowRemove && value && (
          <>
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={() => { onChange(null); pop.close(); }}>Quitar ícono</button>
          </>
        )}
      </Popover>
    </>
  );
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="color-dots">
      {COLORS.map((c) => (
        <button key={c} type="button" className={`color-dot m-${c} ${value === c ? 'active' : ''}`} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

export const ENTITY_ICONS = { task: CheckSquare, project: FolderKanban, page: FileText, meeting: CalendarClock, decision: Gavel, goal: Target, file: Paperclip, message: Hash, channel: Hash };
export const ENTITY_LABELS = { task: 'Tareas', project: 'Proyectos', page: 'Documentos', meeting: 'Reuniones', decision: 'Decisiones', goal: 'Objetivos', file: 'Archivos', message: 'Mensajes', member: 'Integrantes' };

export function EntityIcon({ item }) {
  if (item.icon) return <span className="entity-ico">{item.icon}</span>;
  const Icon = ENTITY_ICONS[item.type] || FileText;
  return <span className="entity-ico"><Icon size={15} /></span>;
}

/** Busca tareas, proyectos, documentos… para vincularlos. */
export function EntitySearch({ onPick, types = 'task,project,page,meeting,decision,goal', exclude = [] }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data = [], isFetching } = useQuery({ queryKey: ['entity-search', dq, types], queryFn: () => api.get(`/entities/search${qs({ q: dq, types })}`) });
  const items = data.filter((d) => !exclude.some((e) => e.type === d.type && e.id === d.id));
  return (
    <div>
      <div className="menu-search flex" style={{ gap: 6 }}>
        <Search size={15} className="faint" style={{ marginLeft: 6 }} />
        <input className="input" style={{ border: 0, boxShadow: 'none' }} autoFocus placeholder="Buscar para vincular…" value={q} onChange={(e) => setQ(e.target.value)} />
        {isFetching && <Spinner size={14} />}
      </div>
      {!q && <div className="menu-label">Recientes</div>}
      {items.map((it) => (
        <button key={`${it.type}-${it.id}`} type="button" className="menu-item" onClick={() => onPick(it)}>
          <EntityIcon item={it} />
          <span className="truncate">{it.title}</span>
          <span className="hint truncate">{it.subtitle}</span>
        </button>
      ))}
      {!items.length && !isFetching && <div className="menu-label" style={{ padding: 10 }}>Sin resultados</div>}
    </div>
  );
}
