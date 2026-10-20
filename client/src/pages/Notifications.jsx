import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import { api } from '../lib/api.js';
import { timeAgo, fmtDateTime } from '../lib/format.js';
import { useAction, useMemberMap } from '../lib/hooks.js';
import { Avatar, Button, EmptyState, SkeletonList, Segmented } from '../components/ui.jsx';
import { Topbar } from '../components/Layout.jsx';

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();
  const members = useMemberMap();
  const { data, isLoading } = useQuery({ queryKey: ['notifications', 'list', filter], queryFn: () => api.get(`/notifications${filter === 'unread' ? '?unread=1' : ''}`) });
  const readAll = useAction(() => api.post('/notifications/read', { all: true }), { invalidate: ['notifications', 'dashboard'] });
  const read = useAction((id) => api.post('/notifications/read', { ids: [id] }), { invalidate: ['notifications', 'dashboard'] });
  const open = (n) => {
    if (!n.read_at) read.mutate(n.id);
    if (n.link) navigate(n.link);
  };
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Notificaciones' }]}
        actions={
          <>
            <Link className="btn ghost sm" to="/settings/notifications"><Settings size={15} /><span className="hide-sm">Preferencias</span></Link>
            <Button size="sm" icon={CheckCheck} disabled={!data?.unread} onClick={() => readAll.mutate()}>Marcar todo como leído</Button>
          </>
        }
      />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <h1 className="page-title">Notificaciones</h1>
            <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Todas' }, { value: 'unread', label: `Sin leer${data?.unread ? ` (${data.unread})` : ''}` }]} />
          </div>
          {isLoading ? <SkeletonList /> : !data.items.length ? (
            <EmptyState icon={Bell} title="Estás al día">Aquí verás asignaciones, menciones, comentarios, vencimientos y aprobaciones.</EmptyState>
          ) : (
            <div className="flex-col" style={{ gap: 2 }}>
              {data.items.map((n) => (
                <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(n)}>
                  {n.actor_id ? <Avatar user={members.get(n.actor_id) || n.actor} size="md" /> : <span className="avatar md c-green"><Bell size={15} /></span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="n-title">{n.title}</div>
                    {n.body && <div className="n-body">{n.body}</div>}
                    <div className="faint tiny mt-1" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.read_at && <span className="n-dot" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
