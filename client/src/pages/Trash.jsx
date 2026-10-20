import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, RotateCcw, FolderKanban, CheckSquare, FileText, Paperclip, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { Button, EmptyState, SkeletonList, Callout } from '../components/ui.jsx';
import { useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';

const ICONS = { project: FolderKanban, task: CheckSquare, page: FileText, file: Paperclip, meeting: CalendarClock };
const LABELS = { project: 'Proyecto', task: 'Tarea', page: 'Documento', file: 'Archivo', meeting: 'Reunión' };

export default function Trash() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['trash'], queryFn: () => api.get('/trash') });
  const restore = async (it) => {
    try {
      await api.post('/trash/restore', { type: it.type, id: it.id });
      qc.invalidateQueries();
      toast.success(`«${it.title || 'Sin título'}» restaurado`);
    } catch (e) {
      toast.error(e);
    }
  };
  const purge = async (it) => {
    if (!(await confirm({ title: '¿Eliminar definitivamente?', message: `«${it.title || 'Sin título'}» se borrará para siempre y no se podrá recuperar.`, confirmLabel: 'Eliminar para siempre', danger: true }))) return;
    try {
      await api.post('/trash/purge', { type: it.type, id: it.id });
      qc.invalidateQueries({ queryKey: ['trash'] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <Topbar crumbs={[{ label: 'Papelera' }]} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Papelera</h1>
              <p className="page-subtitle">Lo que se elimina llega aquí y se puede restaurar. Los movimientos financieros nunca se borran: se anulan.</p>
            </div>
          </div>
          {isLoading ? <SkeletonList /> : !data.items.length ? (
            <EmptyState icon={Trash2} title="La papelera está vacía" />
          ) : (
            <>
              {data.can_purge && <div className="mb-3"><Callout tone="warning" title="Eliminación definitiva">Como administrador puedes borrar elementos para siempre. Hazlo solo si estás seguro.</Callout></div>}
              <div className="card" style={{ padding: 6 }}>
                {data.items.map((it) => {
                  const Icon = ICONS[it.type];
                  return (
                    <div key={`${it.type}-${it.id}`} className="list-row">
                      <Icon size={16} className="faint" />
                      <div className="grow">
                        <div className="title">{it.title || 'Sin título'}</div>
                        <div className="faint small">{LABELS[it.type]} · eliminado {timeAgo(it.deleted_at)}</div>
                      </div>
                      <Button size="xs" icon={RotateCcw} onClick={() => restore(it)}>Restaurar</Button>
                      {data.can_purge && <Button size="xs" variant="ghost" onClick={() => purge(it)}>Eliminar</Button>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
