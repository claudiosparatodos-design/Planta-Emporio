import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleDot, Users, CalendarDays, Flag, FolderKanban, Tag, Repeat, Clock, Target, CalendarClock, MoreHorizontal, Copy, Trash2,
  Eye, EyeOff, Link2, Plus, X, Lock, ChevronRight, ListChecks, GitBranch, Paperclip, MessageSquare, History, ExternalLink, Timer, Bell,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { RECURRENCE, STATUS } from '../lib/constants.js';
import { minutes, relativeDay, fmtDateTime } from '../lib/format.js';
import { useAction, useMe, useCan } from '../lib/hooks.js';
import { AutoTextarea, Button, Callout, ErrorState, IconButton, Loading, Pill, Tabs, FormError } from './ui.jsx';
import { Drawer, Menu, Modal, Popover, useConfirm, useToast } from './overlay.jsx';
import { DateField, PriorityPicker, ProjectPicker, StatusPicker, TagPicker, UserPicker, EntitySearch } from './pickers.jsx';
import { ActivityList, Attachments, Comments, FavoriteButton, RelatedItems } from './collab.jsx';
import { TaskCheck, patchTaskCaches } from './tasks.jsx';
import { useLayout } from './Layout.jsx';

export default function TaskDrawer({ id, onClose }) {
  const { data: task, error, isLoading, refetch } = useQuery({ queryKey: ['tasks', 'detail', id], queryFn: () => api.get(`/tasks/${id}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const me = useMe();
  const { openTask } = useLayout();
  const watching = task?.watcher_ids?.includes(me.id);

  const watch = useAction(() => api.post(`/tasks/${id}/watch`, { watch: !watching }), { invalidate: ['tasks'], success: watching ? 'Dejaste de seguir la tarea' : 'Ahora sigues esta tarea' });
  const duplicate = useAction(() => api.post(`/tasks/${id}/duplicate`), { invalidate: ['tasks', 'projects'], onSuccess: (r) => { toast.success('Tarea duplicada'); openTask(r.id); } });
  const remove = async () => {
    const ok = await confirm({ title: '¿Enviar la tarea a la papelera?', message: 'Sus subtareas también se moverán. Podrás restaurarla desde la papelera.', confirmLabel: 'Enviar a la papelera', danger: true });
    if (!ok) return;
    try {
      await api.del(`/tasks/${id}`);
      qc.invalidateQueries({ predicate: (q) => ['tasks', 'projects', 'dashboard', 'trash'].includes(q.queryKey[0]) });
      onClose();
      toast.show('Tarea enviada a la papelera', { action: { label: 'Deshacer', onClick: async () => { await api.post('/trash/restore', { type: 'task', id }); qc.invalidateQueries(); } } });
    } catch (e) {
      toast.error(e);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tasks/${id}`);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar el enlace.');
    }
  };

  const header = (
    <>
      <div className="flex truncate" style={{ flex: 1, gap: 4, color: 'var(--text-2)', fontSize: 13 }}>
        {task?.project && (
          <Link to={`/projects/${task.project.id}`} className="truncate" onClick={onClose}>{task.project.icon || '📁'} {task.project.name}</Link>
        )}
        {task?.parent && (
          <>
            <ChevronRight size={13} className="faint" />
            <button className="link truncate" style={{ color: 'var(--text-2)' }} onClick={() => openTask(task.parent.id)}>{task.parent.title}</button>
          </>
        )}
        {!task?.project && !task?.parent && <span>Tarea</span>}
      </div>
      {task && (
        <>
          <FavoriteButton type="task" id={id} />
          <IconButton icon={watching ? EyeOff : Eye} label={watching ? 'Dejar de seguir' : 'Seguir (recibir avisos de comentarios)'} onClick={() => watch.mutate()} />
          <Menu
            trigger={(p) => <IconButton icon={MoreHorizontal} label="Más acciones" {...p} />}
            items={[
              { label: 'Copiar enlace', icon: Link2, onClick: copyLink },
              { label: 'Duplicar', icon: Copy, onClick: () => duplicate.mutate() },
              { label: 'Abrir en página completa', icon: ExternalLink, onClick: () => window.open(`/tasks/${id}`, '_self') },
              task.can_delete && 'sep',
              task.can_delete && { label: 'Enviar a la papelera', icon: Trash2, danger: true, onClick: remove },
            ]}
          />
        </>
      )}
    </>
  );

  return (
    <Drawer onClose={onClose} header={header}>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : <TaskDetail task={task} />}
    </Drawer>
  );
}

function TaskDetail({ task }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const canAssign = useCan('tasks.assign');
  const { openTask } = useLayout();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [tab, setTab] = useState('comments');
  const [more, setMore] = useState(Boolean(task.estimate_minutes || task.spent_minutes || task.recurrence || task.start_date));
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);

  const refresh = () => qc.invalidateQueries({ predicate: (q) => ['tasks', 'projects', 'dashboard', 'calendar', 'meetings', 'goals'].includes(q.queryKey[0]) });
  const save = async (patch) => {
    qc.setQueryData(['tasks', 'detail', task.id], (old) => (old ? { ...old, ...patch } : old));
    patchTaskCaches(qc, task.id, patch);
    try {
      await api.patch(`/tasks/${task.id}`, patch);
    } catch (e) {
      toast.error(e);
    }
    refresh();
  };
  const call = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    }
    refresh();
  };

  const statusColumns = task.columns?.length && !task.parent_id ? task.columns : null;
  const history = useQuery({ queryKey: ['tasks', 'history', task.id], queryFn: () => api.get(`/tasks/${task.id}/history`), enabled: tab === 'history' });

  return (
    <div className="task-panel">
      <div className="flex" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ paddingTop: 10 }}>
          <TaskCheck task={task} onToggle={(t, status) => save({ status })} />
        </div>
        <AutoTextarea
          className="tp-title"
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
          aria-label="Título de la tarea"
        />
      </div>

      {task.open_dependencies > 0 && (
        <div className="mt-2">
          <Callout tone="warning" icon={Lock} title="Esta tarea depende de otras que siguen pendientes">
            {task.depends_on_tasks.filter((d) => d.status !== 'done').map((d) => (
              <button key={d.id} className="link" style={{ display: 'block' }} onClick={() => openTask(d.id)}>{d.title}</button>
            ))}
          </Callout>
        </div>
      )}

      <div className="props">
        <span className="prop-label"><CircleDot size={15} />Estado</span>
        <span className="prop-value">
          {statusColumns ? (
            <StatusPicker columns={statusColumns} value={task.column_id ?? statusColumns.find((c) => c.category === task.status)?.id} onChange={(cid) => save({ column_id: cid, status: statusColumns.find((c) => c.id === cid)?.category })} />
          ) : (
            <StatusPicker value={task.status} onChange={(s) => save({ status: s })} />
          )}
        </span>

        <span className="prop-label"><Users size={15} />Responsables</span>
        <span className="prop-value">
          <UserPicker value={task.assignee_ids} onChange={(ids) => save({ assignee_ids: ids })} exclude={[]} placeholder={canAssign ? 'Asignar' : 'Asignarme'} />
          {!canAssign && !task.assignee_ids.includes(me.id) && <Button size="xs" variant="ghost" onClick={() => save({ assignee_ids: [...task.assignee_ids, me.id] })}>Asignarme</Button>}
        </span>

        <span className="prop-label"><CalendarDays size={15} />Fecha límite</span>
        <span className="prop-value">
          <DateField value={task.due_date} onChange={(d) => save({ due_date: d })} />
          {task.due_date && task.status !== 'done' && <span className="faint small">{relativeDay(task.due_date)}</span>}
        </span>

        <span className="prop-label"><Flag size={15} />Prioridad</span>
        <span className="prop-value"><PriorityPicker value={task.priority} onChange={(p) => save({ priority: p })} /></span>

        {!task.parent_id && (
          <>
            <span className="prop-label"><FolderKanban size={15} />Proyecto</span>
            <span className="prop-value"><ProjectPicker value={task.project_id} onChange={(pid) => save({ project_id: pid })} /></span>
          </>
        )}

        <span className="prop-label"><Tag size={15} />Etiquetas</span>
        <span className="prop-value"><TagPicker value={task.tags.map((t) => t.id)} onChange={(ids) => save({ tag_ids: ids })} /></span>

        {task.meeting && (
          <>
            <span className="prop-label"><CalendarClock size={15} />Surgió en</span>
            <span className="prop-value"><Link className="prop-btn" to={`/meetings/${task.meeting.id}`}>{task.meeting.title}</Link></span>
          </>
        )}
        {task.goal && (
          <>
            <span className="prop-label"><Target size={15} />Objetivo</span>
            <span className="prop-value"><Link className="prop-btn" to={`/goals/${task.goal.id}`}>{task.goal.title}</Link></span>
          </>
        )}

        {more && (
          <>
            <span className="prop-label"><CalendarDays size={15} />Inicio</span>
            <span className="prop-value"><DateField value={task.start_date} onChange={(d) => save({ start_date: d })} max={task.due_date || undefined} /></span>

            <span className="prop-label"><Repeat size={15} />Se repite</span>
            <span className="prop-value">
              <select
                className="select"
                style={{ width: 'auto', height: 30 }}
                value={task.recurrence?.freq || ''}
                onChange={(e) => save({ recurrence: e.target.value ? { freq: e.target.value, interval: 1 } : null })}
              >
                <option value="">No se repite</option>
                {Object.entries(RECURRENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {task.recurrence && <span className="faint tiny">Al completarla se crea la siguiente.</span>}
            </span>

            <span className="prop-label"><Clock size={15} />Tiempo estimado</span>
            <span className="prop-value">
              <HoursInput value={task.estimate_minutes} onChange={(m) => save({ estimate_minutes: m })} />
            </span>

            <span className="prop-label"><Timer size={15} />Tiempo invertido</span>
            <span className="prop-value">
              <span className="small">{minutes(task.spent_minutes)}</span>
              <LogTime taskId={task.id} onDone={refresh} />
            </span>
          </>
        )}
      </div>
      {!more && <Button size="xs" variant="ghost" onClick={() => setMore(true)} style={{ marginTop: -10, marginBottom: 6 }}>Más campos (inicio, recurrencia, tiempo)</Button>}

      <div className="tp-section">
        <AutoTextarea
          className="textarea ghost"
          style={{ minHeight: 60, fontSize: 14.5 }}
          placeholder="Agrega una descripción, contexto o instrucciones…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== task.description && save({ description })}
        />
      </div>

      {!task.parent_id && (
        <div className="tp-section">
          <div className="tp-section-title"><GitBranch size={14} />Subtareas {task.subtasks.length > 0 && <span className="faint">{task.subtasks.filter((s) => s.status === 'done').length}/{task.subtasks.length}</span>}</div>
          {task.subtasks.map((s) => (
            <div key={s.id} className={`task-row ${s.status === 'done' ? 'is-done' : ''}`} onClick={() => openTask(s.id)}>
              <TaskCheck task={s} onToggle={(t, status) => call(() => api.patch(`/tasks/${s.id}`, { status }))} />
              <span className="task-title">{s.title}</span>
              {s.due_date && <span className="faint small">{relativeDay(s.due_date)}</span>}
            </div>
          ))}
          <InlineAdd placeholder="Agregar subtarea" onAdd={(t) => call(() => api.post('/tasks', { title: t, parent_id: task.id }))} />
        </div>
      )}

      <div className="tp-section">
        <div className="tp-section-title"><ListChecks size={14} />Lista de verificación {task.checklist.length > 0 && <span className="faint">{task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>}</div>
        {task.checklist.map((c) => (
          <ChecklistItem key={c.id} item={c} onChange={(patch) => call(() => api.patch(`/tasks/checklist/${c.id}`, patch))} onDelete={() => call(() => api.del(`/tasks/checklist/${c.id}`))} />
        ))}
        <InlineAdd placeholder="Agregar elemento" onAdd={(t) => call(() => api.post(`/tasks/${task.id}/checklist`, { text: t }))} />
      </div>

      <div className="tp-section">
        <div className="tp-section-title"><Paperclip size={14} />Archivos</div>
        <Attachments entityType="task" entityId={task.id} files={task.attachments} projectId={task.project_id} compact />
      </div>

      <div className="tp-section">
        <div className="tp-section-title"><Link2 size={14} />Enlaces y documentos relacionados</div>
        {task.links.map((l) => (
          <div key={l.id} className="related-item">
            <ExternalLink size={14} className="faint" />
            <a href={l.url} target="_blank" rel="noreferrer noopener" className="truncate" style={{ flex: 1 }}>{l.title || l.url}</a>
            <IconButton icon={X} size="xs" label="Quitar enlace" onClick={() => call(() => api.del(`/tasks/links/${l.id}`))} />
          </div>
        ))}
        <RelatedItems entityType="task" entityId={task.id} items={task.related} types="page,project,meeting,decision,goal,task" />
        <AddUrl onAdd={(url, title) => call(() => api.post(`/tasks/${task.id}/links`, { url, title }))} />
      </div>

      <div className="tp-section">
        <div className="tp-section-title"><Lock size={14} />Dependencias</div>
        {task.depends_on_tasks.map((d) => (
          <div key={d.id} className="related-item">
            <span className="small faint" style={{ width: 70 }}>Depende de</span>
            <button className="link truncate" style={{ flex: 1, textAlign: 'left', color: 'var(--text)' }} onClick={() => openTask(d.id)}>{d.title}</button>
            <Pill color={STATUS[d.status].color} size="sm">{STATUS[d.status].label}</Pill>
            <IconButton icon={X} size="xs" label="Quitar dependencia" onClick={() => call(() => api.del(`/tasks/${task.id}/dependencies/${d.id}`))} />
          </div>
        ))}
        {task.blocking_tasks.map((d) => (
          <div key={d.id} className="related-item">
            <span className="small faint" style={{ width: 70 }}>Bloquea a</span>
            <button className="link truncate" style={{ flex: 1, textAlign: 'left', color: 'var(--text)' }} onClick={() => openTask(d.id)}>{d.title}</button>
            <Pill color={STATUS[d.status].color} size="sm">{STATUS[d.status].label}</Pill>
          </div>
        ))}
        <AddDependency task={task} onAdd={(otherId) => call(() => api.post(`/tasks/${task.id}/dependencies`, { depends_on_id: otherId }))} />
      </div>

      <div className="tp-section">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'comments', label: 'Comentarios', icon: MessageSquare, count: task.comment_count || null },
            { value: 'history', label: 'Historial', icon: History },
          ]}
        />
        {tab === 'comments' ? <Comments entityType="task" entityId={task.id} /> : history.isLoading ? <Loading /> : <ActivityList items={history.data} />}
        <p className="faint tiny mt-3">Creada {fmtDateTime(task.created_at)}{task.completed_at ? ` · Terminada ${fmtDateTime(task.completed_at)}` : ''}</p>
        <RemindMe task={task} />
      </div>
    </div>
  );
}

function ChecklistItem({ item, onChange, onDelete }) {
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  return (
    <div className={`checklist-item ${item.done ? 'done' : ''}`}>
      <input type="checkbox" checked={Boolean(item.done)} onChange={(e) => onChange({ done: e.target.checked })} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} aria-label="Completado" />
      <input
        className="input ghost text"
        style={{ height: 28 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== item.text && onChange({ text: text.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <IconButton icon={X} size="xs" label="Eliminar elemento" onClick={onDelete} />
    </div>
  );
}

function InlineAdd({ placeholder, onAdd }) {
  const [v, setV] = useState('');
  return (
    <form className="quick-add" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}>
      <Plus size={15} />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

function AddUrl({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  if (!open) return <Button size="xs" variant="ghost" icon={ExternalLink} onClick={() => setOpen(true)}>Agregar enlace web</Button>;
  return (
    <form className="flex mt-1" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { onAdd(/^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`); setUrl(''); setOpen(false); } }}>
      <input className="input" autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ height: 30 }} />
      <Button size="sm" type="submit" variant="primary">Agregar</Button>
      <IconButton icon={X} label="Cancelar" onClick={() => setOpen(false)} />
    </form>
  );
}

function AddDependency({ task, onAdd }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <Button size="xs" variant="ghost" icon={Plus} onClick={(e) => setAnchor(e.currentTarget)}>Agregar dependencia</Button>
      <Popover anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} width={340}>
        <div className="menu-label">Esta tarea depende de…</div>
        <EntitySearch types="task" exclude={[{ type: 'task', id: task.id }, ...task.depends_on_tasks.map((d) => ({ type: 'task', id: d.id }))]} onPick={(it) => { onAdd(it.id); setAnchor(null); }} />
      </Popover>
    </>
  );
}

function HoursInput({ value, onChange }) {
  const [v, setV] = useState(value ? String(Math.round((value / 60) * 100) / 100) : '');
  return (
    <span className="flex" style={{ gap: 6 }}>
      <input
        className="input"
        style={{ width: 80, height: 30 }}
        inputMode="decimal"
        placeholder="0"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={() => {
          const m = v ? Math.round(Number(v) * 60) : null;
          if (m !== value) onChange(m);
        }}
      />
      <span className="faint small">horas</span>
    </span>
  );
}

function LogTime({ taskId, onDone }) {
  const [anchor, setAnchor] = useState(null);
  const [mins, setMins] = useState('30');
  const toast = useToast();
  const submit = async () => {
    try {
      await api.post(`/tasks/${taskId}/time`, { minutes: Number(mins) });
      setAnchor(null);
      onDone();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <Button size="xs" variant="ghost" icon={Plus} onClick={(e) => setAnchor(e.currentTarget)}>Registrar</Button>
      <Popover anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} width={220}>
        <div style={{ padding: 8 }}>
          <label className="label">Minutos trabajados</label>
          <div className="flex mt-1">
            <input className="input" type="number" min="1" max="1440" value={mins} onChange={(e) => setMins(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <Button size="sm" variant="primary" onClick={submit}>Sumar</Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function RemindMe({ task }) {
  const [anchor, setAnchor] = useState(null);
  const [when, setWhen] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const submit = async () => {
    try {
      await api.post('/reminders', { title: task.title, remind_at: new Date(when).toISOString(), entity_type: 'task', entity_id: task.id });
      toast.success('Te avisaremos en la fecha indicada');
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setAnchor(null);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <Button size="xs" variant="ghost" icon={Bell} onClick={(e) => setAnchor(e.currentTarget)} style={{ marginTop: 6 }}>Recordármelo</Button>
      <Popover anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} width={260} placement="top-start">
        <div style={{ padding: 8 }}>
          <label className="label">¿Cuándo?</label>
          <input className="input mt-1" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button size="sm" variant="primary" block className="mt-2" disabled={!when} onClick={submit}>Crear recordatorio</Button>
        </div>
      </Popover>
    </>
  );
}

// ───────── Creación rápida ─────────
export function QuickTaskModal({ defaults = {}, onClose }) {
  const me = useMe();
  const canAssign = useCan('tasks.assign');
  const { openTask } = useLayout();
  const [form, setForm] = useState({
    title: defaults.title || '',
    description: '',
    project_id: defaults.project_id ?? null,
    assignee_ids: defaults.assignee_ids || [me.id],
    due_date: defaults.due_date || null,
    priority: defaults.priority || 'none',
    meeting_id: defaults.meeting_id,
    column_id: defaults.column_id,
  });
  const [showDesc, setShowDesc] = useState(false);
  const [error, setError] = useState(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (open) => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const t = await api.post('/tasks', { ...form, title: form.title.trim() });
      qc.invalidateQueries({ predicate: (q) => ['tasks', 'projects', 'dashboard', 'calendar', 'meetings'].includes(q.queryKey[0]) });
      toast.success('Tarea creada', { action: open ? undefined : { label: 'Abrir', onClick: () => openTask(t.id) } });
      onClose();
      if (open) openTask(t.id);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Nueva tarea"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => submit(true)} disabled={!form.title.trim() || saving}>Crear y abrir</Button>
          <Button variant="primary" onClick={() => submit(false)} disabled={!form.title.trim()} loading={saving}>Crear tarea</Button>
        </>
      }
    >
      <FormError error={error} />
      <input
        className="input"
        style={{ height: 42, fontSize: 16, fontWeight: 500 }}
        autoFocus
        placeholder="¿Qué hay que hacer?"
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit(false)}
        aria-label="Título"
      />
      {showDesc ? (
        <textarea className="textarea mt-2" placeholder="Descripción (opcional)" value={form.description} onChange={(e) => set('description', e.target.value)} />
      ) : (
        <Button size="xs" variant="ghost" className="mt-1" onClick={() => setShowDesc(true)}>+ Agregar descripción</Button>
      )}
      <div className="props" style={{ marginBottom: 0 }}>
        <span className="prop-label"><FolderKanban size={15} />Proyecto</span>
        <span className="prop-value"><ProjectPicker value={form.project_id} onChange={(v) => set('project_id', v)} /></span>
        <span className="prop-label"><Users size={15} />Responsables</span>
        <span className="prop-value">
          {canAssign ? (
            <UserPicker value={form.assignee_ids} onChange={(v) => set('assignee_ids', v)} />
          ) : (
            <label className="check small"><input type="checkbox" checked={form.assignee_ids.includes(me.id)} onChange={(e) => set('assignee_ids', e.target.checked ? [me.id] : [])} /> Asignármela</label>
          )}
        </span>
        <span className="prop-label"><CalendarDays size={15} />Fecha límite</span>
        <span className="prop-value"><DateField value={form.due_date} onChange={(v) => set('due_date', v)} /></span>
        <span className="prop-label"><Flag size={15} />Prioridad</span>
        <span className="prop-value"><PriorityPicker value={form.priority} onChange={(v) => set('priority', v)} /></span>
      </div>
    </Modal>
  );
}

