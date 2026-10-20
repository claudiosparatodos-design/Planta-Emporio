import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CalendarClock, MapPin, Users, Target, CheckCircle2, Gavel, MoreHorizontal, Trash2, Pencil, ListTodo, FileText, XCircle, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { DECISION_STATUS } from '../lib/constants.js';
import { fmtDate, fmtDateTime, fmtTime, relativeDay } from '../lib/format.js';
import { useAction, useMe, useMemberMap, useCan } from '../lib/hooks.js';
import { AutoTextarea, AvatarStack, Button, EmptyState, ErrorState, Field, FormError, Loading, Pill, Segmented, SkeletonList, Switch } from '../components/ui.jsx';
import { Menu, Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { DateField, ProjectPicker, UserPicker } from '../components/pickers.jsx';
import { Attachments, Comments, RelatedItems } from '../components/collab.jsx';
import { TaskRow, useTaskPatch } from '../components/tasks.jsx';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function Meetings() {
  const [tab, setTab] = useState('upcoming');
  const { openCreate } = useLayout();
  const members = useMemberMap();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['meetings', 'list'], queryFn: () => api.get('/meetings') });
  const now = Date.now() - 2 * 3600e3;
  const upcoming = data.filter((m) => m.status === 'scheduled' && Date.parse(m.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = data.filter((m) => !(m.status === 'scheduled' && Date.parse(m.starts_at) >= now));
  const list = tab === 'upcoming' ? upcoming : past;
  return (
    <>
      <Topbar crumbs={[{ label: 'Reuniones' }]} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate('meeting')}>Nueva reunión</Button>} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Reuniones</h1>
              <p className="page-subtitle">Agenda, acuerdos y tareas que salen de cada reunión.</p>
            </div>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'upcoming', label: `Próximas (${upcoming.length})` }, { value: 'past', label: 'Anteriores' }]} />
          </div>
          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !list.length ? (
            <EmptyState icon={CalendarClock} title={tab === 'upcoming' ? 'No hay reuniones programadas' : 'Aún no hay reuniones anteriores'} actions={tab === 'upcoming' && <Button variant="primary" icon={Plus} onClick={() => openCreate('meeting')}>Programar reunión</Button>}>
              {tab === 'upcoming' && 'Define objetivo y agenda, y al terminar registra los acuerdos como tareas con responsable.'}
            </EmptyState>
          ) : (
            <div className="card" style={{ padding: 6 }}>
              {list.map((m) => (
                <Link key={m.id} to={`/meetings/${m.id}`} className="list-row" style={{ padding: '10px 10px' }}>
                  <div style={{ width: 62, textAlign: 'center', flexShrink: 0 }}>
                    <div className="tiny faint" style={{ textTransform: 'uppercase' }}>{fmtDate(m.starts_at, 'MMM')}</div>
                    <div className="strong" style={{ fontSize: 20, lineHeight: 1.1 }}>{fmtDate(m.starts_at, 'd')}</div>
                  </div>
                  <div className="grow">
                    <div className="flex"><span className="title strong" style={{ fontWeight: 550 }}>{m.title}</span>
                      {m.status === 'done' && <Pill size="sm" color="green">Realizada</Pill>}
                      {m.status === 'cancelled' && <Pill size="sm">Cancelada</Pill>}
                    </div>
                    <div className="small faint flex wrap mt-1" style={{ gap: 10 }}>
                      <span>{relativeDay(m.starts_at)} · {fmtTime(m.starts_at)}</span>
                      {m.project_name && <span>{m.project_name}</span>}
                      {m.action_count > 0 && <span>{m.open_actions}/{m.action_count} acuerdos pendientes</span>}
                      {m.decision_count > 0 && <span>{m.decision_count} decisiones</span>}
                    </div>
                  </div>
                  <AvatarStack users={m.participant_ids.map((id) => members.get(id))} max={4} size="xs" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function MeetingModal({ defaults = {}, meeting, onClose }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const start = new Date(Date.now() + 864e5);
  start.setHours(10, 0, 0, 0);
  const [form, setForm] = useState(() => ({
    title: meeting?.title || defaults.title || '',
    starts_at: toLocalInput(meeting?.starts_at) || toLocalInput(start.toISOString()),
    duration: meeting?.ends_at ? Math.round((Date.parse(meeting.ends_at) - Date.parse(meeting.starts_at)) / 60000) : 60,
    location: meeting?.location || '',
    objective: meeting?.objective || '',
    agenda: meeting?.agenda || '',
    participant_ids: meeting?.participant_ids || defaults.participant_ids || [me.id],
    project_id: meeting?.project_id ?? defaults.project_id ?? null,
  }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const startsAt = new Date(form.starts_at);
      const body = {
        title: form.title,
        starts_at: startsAt.toISOString(),
        ends_at: form.duration ? new Date(startsAt.getTime() + form.duration * 60000).toISOString() : null,
        location: form.location,
        objective: form.objective,
        agenda: form.agenda,
        participant_ids: form.participant_ids,
        project_id: form.project_id,
      };
      if (meeting) await api.patch(`/meetings/${meeting.id}`, body);
      else {
        const { id } = await api.post('/meetings', body);
        navigate(`/meetings/${id}`);
      }
      qc.invalidateQueries({ predicate: (q) => ['meetings', 'dashboard', 'calendar'].includes(q.queryKey[0]) });
      onClose();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };
  return (
    <Modal
      size="lg"
      title={meeting ? 'Editar reunión' : 'Nueva reunión'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.title.trim() || !form.starts_at} loading={saving} onClick={submit}>{meeting ? 'Guardar' : 'Programar'}</Button></>}
    >
      <FormError error={error} />
      <Field label="Título"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej. Reunión semanal de socios" /></Field>
      <div className="grid-3">
        <Field label="Fecha y hora"><input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field>
        <Field label="Duración">
          <select className="select" value={form.duration} onChange={(e) => set('duration', Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
          </select>
        </Field>
        <Field label="Lugar o enlace"><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Oficina, café, videollamada…" /></Field>
      </div>
      <div className="grid-2">
        <Field label="Participantes"><UserPicker value={form.participant_ids} onChange={(v) => set('participant_ids', v)} /></Field>
        <Field label="Proyecto (opcional)"><ProjectPicker value={form.project_id} onChange={(v) => set('project_id', v)} /></Field>
      </div>
      <Field label="Objetivo" hint="¿Qué debemos decidir o lograr en esta reunión?"><input className="input" value={form.objective} onChange={(e) => set('objective', e.target.value)} /></Field>
      <Field label="Agenda"><textarea className="textarea" value={form.agenda} onChange={(e) => set('agenda', e.target.value)} placeholder={'1. Revisión de ventas\n2. Pendientes de la semana\n3. Decisiones'} /></Field>
    </Modal>
  );
}

export function MeetingDetail() {
  const { id } = useParams();
  const mid = Number(id);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const members = useMemberMap();
  const patchTask = useTaskPatch();
  const canDocs = useCan('docs.edit');
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const { data: m, isLoading, error, refetch } = useQuery({ queryKey: ['meetings', 'detail', mid], queryFn: () => api.get(`/meetings/${mid}`) });
  const [notes, setNotes] = useState('');
  const [agenda, setAgenda] = useState('');
  const [saveState, setSaveState] = useState('');
  const timer = useRef(null);
  useEffect(() => {
    if (m) {
      setNotes(m.notes);
      setAgenda(m.agenda);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id]);

  const save = async (patch) => {
    try {
      await api.patch(`/meetings/${mid}`, patch);
      qc.invalidateQueries({ predicate: (q) => ['meetings', 'dashboard', 'calendar'].includes(q.queryKey[0]) });
    } catch (e) {
      toast.error(e);
    }
  };
  const autosave = (field, value) => {
    setSaveState('Guardando…');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await save({ [field]: value });
      setSaveState('Guardado');
    }, 800);
  };
  const createNotesDoc = async () => {
    try {
      const templates = await api.get('/pages?templates=1');
      const tpl = templates.find((t) => t.title === 'Notas de reunión');
      const page = await api.post('/pages', { title: `Notas · ${m.title} (${fmtDate(m.starts_at)})`, template_id: tpl?.id, project_id: m.project_id });
      await api.post('/links', { a_type: 'meeting', a_id: mid, b_type: 'page', b_id: page.id });
      navigate(`/docs/${page.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: '¿Eliminar la reunión?', message: 'Las tareas y decisiones que surgieron de ella se conservan.', confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.del(`/meetings/${mid}`);
      qc.invalidateQueries({ queryKey: ['meetings'] });
      navigate('/meetings');
    } catch (e) {
      toast.error(e);
    }
  };

  if (isLoading) return <><Topbar crumbs={[{ label: 'Reuniones', to: '/meetings' }]} /><Loading /></>;
  if (error) return <><Topbar crumbs={[{ label: 'Reuniones', to: '/meetings' }]} /><ErrorState error={error} onRetry={refetch} /></>;
  const participants = m.participant_ids.map((x) => members.get(x)).filter(Boolean);
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Reuniones', to: '/meetings' }, { label: m.title }]}
        actions={
          <>
            {saveState && <span className="save-state">{saveState}</span>}
            {m.status === 'scheduled' && <Button size="sm" icon={CheckCircle2} onClick={() => save({ status: 'done' })}>Marcar como realizada</Button>}
            <Menu
              trigger={(p) => <button className="icon-btn" aria-label="Opciones" {...p}><MoreHorizontal size={16} /></button>}
              items={[
                { label: 'Editar detalles', icon: Pencil, onClick: () => setEditing(true) },
                m.status === 'scheduled' && { label: 'Cancelar reunión', icon: XCircle, onClick: () => save({ status: 'cancelled' }) },
                m.status !== 'scheduled' && { label: 'Volver a programada', icon: Clock, onClick: () => save({ status: 'scheduled' }) },
                'sep',
                { label: 'Eliminar', icon: Trash2, danger: true, onClick: remove },
              ]}
            />
          </>
        }
      />
      <div className="content">
        <div className="page narrow">
          <h1 className="page-title">{m.title}</h1>
          <div className="flex wrap muted small mt-2" style={{ gap: 14 }}>
            <span className="flex" style={{ gap: 5 }}><CalendarClock size={14} />{fmtDateTime(m.starts_at)}{m.ends_at ? ` – ${fmtTime(m.ends_at)}` : ''}</span>
            {m.location && <span className="flex" style={{ gap: 5 }}><MapPin size={14} />{/^https?:/.test(m.location) ? <a className="link" href={m.location} target="_blank" rel="noreferrer">{m.location}</a> : m.location}</span>}
            <span className="flex" style={{ gap: 5 }}><Users size={14} /><AvatarStack users={participants} max={6} size="xs" /> {participants.length}</span>
            {m.project && <Link className="link" to={`/projects/${m.project.id}`}>{m.project.icon || '📁'} {m.project.name}</Link>}
            {m.status === 'done' && <Pill color="green" size="sm">Realizada</Pill>}
            {m.status === 'cancelled' && <Pill size="sm">Cancelada</Pill>}
          </div>
          {m.objective && (
            <div className="callout mt-4"><Target size={16} /><div className="callout-body"><strong>Objetivo</strong>{m.objective}</div></div>
          )}

          <div className="section">
            <div className="section-title"><h3>Agenda</h3></div>
            <AutoTextarea className="textarea ghost" placeholder="Temas a tratar…" value={agenda} onChange={(e) => { setAgenda(e.target.value); autosave('agenda', e.target.value); }} />
          </div>
          <div className="section">
            <div className="section-title">
              <h3>Notas</h3>
              {canDocs && <Button size="xs" variant="ghost" icon={FileText} onClick={createNotesDoc}>Crear documento de notas</Button>}
            </div>
            <AutoTextarea className="textarea ghost" style={{ minHeight: 120 }} placeholder="Escribe lo que se habló. Se guarda automáticamente." value={notes} onChange={(e) => { setNotes(e.target.value); autosave('notes', e.target.value); }} />
          </div>

          <div className="section">
            <div className="section-title"><h3 className="flex"><ListTodo size={14} />Acuerdos y tareas resultantes</h3></div>
            {m.actions.map((t) => <TaskRow key={t.id} task={t} onToggle={(x, s) => patchTask(x.id, { status: s })} />)}
            <ActionCreator meeting={m} />
          </div>

          <div className="section">
            <div className="section-title">
              <h3 className="flex"><Gavel size={14} />Decisiones</h3>
              <Button size="xs" variant="ghost" icon={Plus} onClick={() => setDeciding(true)}>Registrar decisión</Button>
            </div>
            {m.decisions.length ? m.decisions.map((d) => (
              <Link key={d.id} to={`/decisions/${d.id}`} className="list-row">
                <Gavel size={14} className="faint" />
                <span className="grow title">{d.title}</span>
                <Pill size="sm" color={DECISION_STATUS[d.status].color}>{DECISION_STATUS[d.status].label}</Pill>
              </Link>
            )) : <p className="faint small">Las decisiones se registran explícitamente para que nadie dé por definitivo algo que no se confirmó.</p>}
          </div>

          <div className="section">
            <div className="section-title"><h3>Documentos y recursos</h3></div>
            <RelatedItems entityType="meeting" entityId={mid} items={m.related} types="page,project,task,decision" />
            <div className="mt-2"><Attachments entityType="meeting" entityId={mid} files={m.attachments} projectId={m.project_id} compact /></div>
          </div>
          <div className="section">
            <div className="section-title"><h3>Comentarios</h3></div>
            <Comments entityType="meeting" entityId={mid} />
          </div>
        </div>
      </div>
      {editing && <MeetingModal meeting={m} onClose={() => setEditing(false)} />}
      {deciding && <DecisionModal defaults={{ meeting_id: mid, project_id: m.project_id, approver_ids: m.participant_ids }} onClose={() => setDeciding(false)} />}
    </>
  );
}

function ActionCreator({ meeting }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [due, setDue] = useState(null);
  const create = useAction((body) => api.post(`/meetings/${meeting.id}/actions`, body), { invalidate: ['meetings', 'tasks', 'dashboard'], onSuccess: () => { setTitle(''); setDue(null); } });
  const submit = (e) => {
    e?.preventDefault();
    if (title.trim()) create.mutate({ title: title.trim(), assignee_ids: assignees, due_date: due });
  };
  return (
    <form className="card mt-2" style={{ padding: 8 }} onSubmit={submit}>
      <input className="input ghost" placeholder="Nuevo acuerdo, p. ej. «Pedir 3 cotizaciones de empaque»" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex wrap mt-1" style={{ gap: 6 }}>
        <UserPicker value={assignees} onChange={setAssignees} placeholder="Responsable" />
        <DateField value={due} onChange={setDue} placeholder="Fecha límite" />
        <span className="spacer" style={{ flex: 1 }} />
        <Button size="sm" type="submit" variant="primary" disabled={!title.trim()} loading={create.isPending}>Agregar acuerdo</Button>
      </div>
    </form>
  );
}

export function DecisionModal({ defaults = {}, onClose }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  // Quien propone no se aprueba a sí mismo.
  const [form, setForm] = useState({ title: '', description: '', record_as_decided: false, ...defaults, approver_ids: (defaults.approver_ids || []).filter((x) => x !== me.id) });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setSaving(true);
    try {
      const { id } = await api.post('/decisions', { ...form, record_as_decided: form.approver_ids.length === 0 && form.record_as_decided });
      qc.invalidateQueries({ predicate: (q) => ['decisions', 'meetings', 'dashboard'].includes(q.queryKey[0]) });
      onClose();
      if (!defaults.meeting_id) navigate(`/decisions/${id}`);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Registrar decisión"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.title.trim() || (!form.approver_ids.length && !form.record_as_decided)} loading={saving} onClick={submit}>{form.approver_ids.length ? 'Pedir aprobación' : 'Registrar'}</Button></>}
    >
      <FormError error={error} />
      <Field label="Decisión"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej. Vender también en mercado local los sábados" /></Field>
      <Field label="Contexto y motivo"><textarea className="textarea" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="¿Por qué? ¿Qué alternativas se consideraron?" /></Field>
      <Field label="¿Quiénes deben aprobarla?" hint="Queda pendiente hasta que todos aprueben; si alguien la rechaza, queda rechazada.">
        <UserPicker value={form.approver_ids} onChange={(v) => set('approver_ids', v)} placeholder="Elegir aprobadores" />
      </Field>
      {!form.approver_ids.length && (
        <div className="callout">
          <Gavel size={16} />
          <div className="callout-body small">
            <Switch checked={form.record_as_decided} onChange={(v) => set('record_as_decided', v)} label="Confirmo que esta decisión ya se tomó y la registro como aprobada" />
          </div>
        </div>
      )}
    </Modal>
  );
}
