import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gavel, Plus, Search, Check, X, CalendarClock, FolderKanban, Undo2, Archive } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { DECISION_STATUS } from '../lib/constants.js';
import { fmtDate, fmtDateTime, timeAgo } from '../lib/format.js';
import { useAction, useDebounced, useMe, useMemberMap, useCan } from '../lib/hooks.js';
import { Avatar, Button, EmptyState, ErrorState, Loading, Pill, Segmented, SkeletonList } from '../components/ui.jsx';
import { Modal, useConfirm } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { Comments } from '../components/collab.jsx';
import { DecisionModal } from './Meetings.jsx';

export default function Decisions() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['decisions', 'list', status, dq], queryFn: () => api.get(`/decisions${qs({ status, q: dq })}`) });
  return (
    <>
      <Topbar crumbs={[{ label: 'Decisiones' }]} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>Registrar decisión</Button>} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Decisiones</h1>
              <p className="page-subtitle">El registro de acuerdos importantes de la empresa, para consultarlos sin buscar en conversaciones.</p>
            </div>
          </div>
          <div className="filter-bar">
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
              <Search size={14} className="faint" style={{ position: 'absolute', left: 9, top: 9 }} />
              <input className="input" style={{ paddingLeft: 30, height: 32 }} placeholder="Buscar decisiones…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented value={status} onChange={setStatus} options={[{ value: '', label: 'Todas' }, { value: 'proposed', label: 'Pendientes' }, { value: 'approved', label: 'Aprobadas' }, { value: 'rejected', label: 'Rechazadas' }]} />
          </div>
          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.length ? (
            <EmptyState icon={Gavel} title="Sin decisiones registradas" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Registrar la primera</Button>}>
              Registra aquí acuerdos como el reparto de utilidades, precios o proveedores elegidos.
            </EmptyState>
          ) : (
            <div className="card" style={{ padding: 6 }}>
              {data.map((d) => (
                <Link key={d.id} to={`/decisions/${d.id}`} className="list-row" style={{ padding: '10px' }}>
                  <Gavel size={16} className="faint" />
                  <div className="grow">
                    <div className="title" style={{ fontWeight: 550 }}>{d.title}</div>
                    <div className="small faint mt-1 flex wrap" style={{ gap: 10 }}>
                      <span>{d.decided_at ? `Decidida ${fmtDate(d.decided_at)}` : `Propuesta ${timeAgo(d.created_at)}`}</span>
                      {d.proposed_by_name && <span>por {d.proposed_by_name}</span>}
                      {d.meeting_title && <span>· {d.meeting_title}</span>}
                      {d.project_name && <span>· {d.project_name}</span>}
                      {d.status === 'proposed' && <span>{d.approvers.filter((a) => a.response === 'approved').length}/{d.approvers.length} aprobaciones</span>}
                    </div>
                  </div>
                  <Pill size="sm" color={DECISION_STATUS[d.status].color}>{DECISION_STATUS[d.status].label}</Pill>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      {creating && <DecisionModal onClose={() => setCreating(false)} />}
      {id && <DecisionDetail id={Number(id)} onClose={() => navigate('/decisions')} />}
    </>
  );
}

function DecisionDetail({ id, onClose }) {
  const me = useMe();
  const members = useMemberMap();
  const confirm = useConfirm();
  const canManage = useCan('projects.manage');
  const { data: d, isLoading, error } = useQuery({ queryKey: ['decisions', 'detail', id], queryFn: () => api.get(`/decisions/${id}`) });
  const respond = useAction((body) => api.post(`/decisions/${id}/respond`, body), { invalidate: ['decisions', 'dashboard', 'meetings'], success: 'Respuesta registrada' });
  const supersede = useAction(() => api.patch(`/decisions/${id}`, { status: 'superseded' }), { invalidate: ['decisions'], success: 'Marcada como reemplazada' });
  const withdraw = useAction(() => api.del(`/decisions/${id}`), { invalidate: ['decisions', 'dashboard'], onSuccess: onClose, success: 'Propuesta retirada' });
  const myRow = d?.approvers.find((a) => a.user_id === me.id);
  const isOwner = d && (d.proposed_by === me.id || canManage);
  return (
    <Modal size="lg" title="Decisión" onClose={onClose}>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} /> : (
        <>
          <div className="flex" style={{ alignItems: 'flex-start' }}>
            <h2 style={{ fontSize: 20, flex: 1 }}>{d.title}</h2>
            <Pill color={DECISION_STATUS[d.status].color}>{DECISION_STATUS[d.status].label}</Pill>
          </div>
          <div className="small muted flex wrap mt-2" style={{ gap: 12 }}>
            {d.proposed_by_user && <span className="flex" style={{ gap: 6 }}><Avatar user={members.get(d.proposed_by) || d.proposed_by_user} size="xs" />Propuesta por {d.proposed_by_user.name} · {fmtDateTime(d.created_at)}</span>}
            {d.decided_at && <span>Resuelta {fmtDateTime(d.decided_at)}</span>}
            {d.meeting && <Link className="link flex" style={{ gap: 4 }} to={`/meetings/${d.meeting.id}`}><CalendarClock size={13} />{d.meeting.title}</Link>}
            {d.project && <Link className="link flex" style={{ gap: 4 }} to={`/projects/${d.project.id}`}><FolderKanban size={13} />{d.project.name}</Link>}
          </div>
          {d.description && <p className="mt-4" style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>}

          {d.approvers.length > 0 && (
            <div className="section">
              <div className="section-title"><h3>Aprobaciones</h3></div>
              {d.approvers.map((a) => (
                <div key={a.user_id} className="list-row">
                  <Avatar user={members.get(a.user_id) || { name: a.name }} size="sm" />
                  <span className="grow">{a.name}{a.comment && <span className="faint small"> — “{a.comment}”</span>}</span>
                  {a.response === 'pending' ? <Pill size="sm">Pendiente</Pill> : a.response === 'approved' ? <Pill size="sm" color="green">Aprobó</Pill> : <Pill size="sm" color="red">Rechazó</Pill>}
                </div>
              ))}
            </div>
          )}

          {d.status === 'proposed' && myRow?.response === 'pending' && (
            <div className="callout mt-4">
              <Gavel size={16} />
              <div className="callout-body">
                <strong>Tu aprobación está pendiente</strong>
                <div className="btn-group mt-2">
                  <Button size="sm" variant="primary" icon={Check} loading={respond.isPending} onClick={() => respond.mutate({ response: 'approved' })}>Aprobar</Button>
                  <Button size="sm" icon={X} onClick={async () => { const c = await confirm({ title: 'Rechazar decisión', input: { label: 'Motivo (opcional)' }, confirmLabel: 'Rechazar', danger: true }); if (c !== false) respond.mutate({ response: 'rejected', comment: c || undefined }); }}>Rechazar</Button>
                </div>
              </div>
            </div>
          )}

          {isOwner && (
            <div className="btn-group mt-4">
              {d.status === 'proposed' && <Button size="sm" variant="ghost" icon={Undo2} onClick={async () => (await confirm({ title: '¿Retirar la propuesta?', confirmLabel: 'Retirar', danger: true })) && withdraw.mutate()}>Retirar propuesta</Button>}
              {d.status === 'approved' && <Button size="sm" variant="ghost" icon={Archive} onClick={async () => (await confirm({ title: '¿Marcar como reemplazada?', message: 'Úsalo cuando una decisión nueva sustituya a esta. Se conserva en el historial.', confirmLabel: 'Marcar' })) && supersede.mutate()}>Marcar como reemplazada</Button>}
            </div>
          )}

          <div className="section">
            <div className="section-title"><h3>Comentarios</h3></div>
            <Comments entityType="decision" entityId={id} />
          </div>
        </>
      )}
    </Modal>
  );
}
