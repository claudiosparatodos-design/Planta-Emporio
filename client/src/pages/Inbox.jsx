import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox as InboxIcon, Lightbulb, CheckSquare, FileText, Bell, Trash2, Undo2, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { useAction, useCan } from '../lib/hooks.js';
import { Button, EmptyState, IconButton, SkeletonList, Segmented } from '../components/ui.jsx';
import { Modal, Popover, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { ProjectPicker } from '../components/pickers.jsx';

export function CaptureModal({ onClose }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const save = useAction(() => api.post('/inbox', { title, notes }), { invalidate: ['inbox', 'dashboard'], success: 'Guardado en tu bandeja', onSuccess: onClose });
  return (
    <Modal
      title="Capturar idea"
      icon={<Lightbulb size={18} style={{ color: 'var(--m-yellow)' }} />}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}
    >
      <p className="muted small mb-3">Anótala ahora y decide después si es una tarea, una nota o un recordatorio.</p>
      <input className="input" autoFocus placeholder="¿Qué tienes en mente?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && save.mutate()} />
      <textarea className="textarea mt-2" placeholder="Detalles (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  );
}

export default function Inbox() {
  const [processed, setProcessed] = useState(false);
  const [capture, setCapture] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['inbox', processed], queryFn: () => api.get(`/inbox${processed ? '?processed=1' : ''}`) });
  const add = useAction(() => api.post('/inbox', { title: capture }), { invalidate: ['inbox'], onSuccess: () => setCapture('') });
  return (
    <>
      <Topbar crumbs={[{ label: 'Bandeja de entrada' }]} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Bandeja de entrada</h1>
              <p className="page-subtitle">Tu espacio personal para capturar ideas y pendientes sin organizarlos todavía.</p>
            </div>
            <Segmented value={processed ? 'done' : 'open'} onChange={(v) => setProcessed(v === 'done')} options={[{ value: 'open', label: 'Por organizar' }, { value: 'done', label: 'Organizados' }]} />
          </div>
          {!processed && (
            <form className="composer mb-4" onSubmit={(e) => { e.preventDefault(); if (capture.trim()) add.mutate(); }}>
              <div className="flex" style={{ padding: '4px 6px 4px 12px' }}>
                <Lightbulb size={16} className="faint" />
                <input className="input" style={{ border: 0, boxShadow: 'none', background: 'transparent' }} placeholder="Escribe una idea, pendiente o solicitud y presiona Enter" value={capture} onChange={(e) => setCapture(e.target.value)} />
                <Button size="sm" variant="primary" type="submit" icon={Send} disabled={!capture.trim()} loading={add.isPending}>Capturar</Button>
              </div>
            </form>
          )}
          {isLoading ? <SkeletonList /> : !data.length ? (
            <EmptyState icon={InboxIcon} title={processed ? 'Aún no organizas nada' : 'Bandeja vacía'}>{!processed && 'Todo está organizado. Captura aquí lo que se te ocurra en el momento.'}</EmptyState>
          ) : (
            <div className="card" style={{ padding: 6 }}>{data.map((item) => <InboxItem key={item.id} item={item} />)}</div>
          )}
        </div>
      </div>
    </>
  );
}

function InboxItem({ item }) {
  const navigate = useNavigate();
  const toast = useToast();
  const canDocs = useCan('docs.edit');
  const [anchor, setAnchor] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [when, setWhen] = useState('');
  const convert = useAction((body) => api.post(`/inbox/${item.id}/convert`, body), {
    invalidate: ['inbox', 'tasks', 'pages', 'reminders', 'dashboard'],
    onSuccess: (r) => {
      setAnchor(null);
      toast.success(r.type === 'task' ? 'Convertido en tarea' : r.type === 'page' ? 'Convertido en nota' : 'Recordatorio creado', { action: r.type !== 'reminder' ? { label: 'Abrir', onClick: () => navigate(r.url) } : undefined });
    },
  });
  const remove = useAction(() => api.del(`/inbox/${item.id}`), { invalidate: ['inbox'] });
  const reopen = useAction(() => api.patch(`/inbox/${item.id}`, { processed: false }), { invalidate: ['inbox'] });
  const label = { task: 'Tarea', page: 'Nota', reminder: 'Recordatorio' }[item.result_type];
  return (
    <div className="list-row" style={{ alignItems: 'flex-start', padding: 10 }}>
      <Lightbulb size={16} className="faint" style={{ marginTop: 2 }} />
      <div className="grow">
        <div style={{ fontWeight: 500 }}>{item.title}</div>
        {item.notes && <div className="muted small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</div>}
        <div className="faint tiny mt-1">{timeAgo(item.created_at)}{label ? ` · convertido en ${label.toLowerCase()}` : ''}</div>
      </div>
      {item.processed_at ? (
        <IconButton icon={Undo2} label="Volver a la bandeja" onClick={() => reopen.mutate()} />
      ) : (
        <>
          <Button size="xs" onClick={(e) => setAnchor(e.currentTarget)}>Organizar</Button>
          <IconButton icon={Trash2} size="sm" label="Descartar" onClick={() => remove.mutate()} />
        </>
      )}
      <Popover anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} width={280}>
        <div className="menu-label">Convertir en…</div>
        <div style={{ padding: '4px 8px' }}>
          <ProjectPicker value={projectId} onChange={setProjectId} placeholder="Sin proyecto" />
        </div>
        <button className="menu-item" onClick={() => convert.mutate({ to: 'task', project_id: projectId })}><span className="icon"><CheckSquare size={15} /></span>Tarea</button>
        {canDocs && <button className="menu-item" onClick={() => convert.mutate({ to: 'page', project_id: projectId })}><span className="icon"><FileText size={15} /></span>Nota o documento</button>}
        <div className="menu-sep" />
        <div style={{ padding: '4px 8px' }}>
          <label className="label">Recordatorio</label>
          <div className="flex mt-1">
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ height: 30 }} />
            <IconButton icon={Bell} label="Crear recordatorio" disabled={!when} onClick={() => convert.mutate({ to: 'reminder', remind_at: new Date(when).toISOString() })} />
          </div>
        </div>
      </Popover>
    </div>
  );
}
