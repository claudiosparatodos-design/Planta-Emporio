import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { Button, EmptyState, SkeletonList } from '../components/ui.jsx';
import { Topbar } from '../components/Layout.jsx';
import { ActivityList } from '../components/collab.jsx';

export default function Activity() {
  const q = useInfiniteQuery({
    queryKey: ['activity', 'all'],
    queryFn: ({ pageParam }) => api.get(`/activity${qs({ limit: 60, before: pageParam })}`),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.length >= 60 ? last[last.length - 1].id : undefined),
  });
  const items = q.data?.pages.flat() || [];
  return (
    <>
      <Topbar crumbs={[{ label: 'Actividad del equipo' }]} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Actividad</h1>
              <p className="page-subtitle">Quién hizo qué y cuándo. Solo ves lo que tienes permiso de consultar.</p>
            </div>
          </div>
          {q.isLoading ? <SkeletonList rows={10} /> : !items.length ? <EmptyState icon={ActivityIcon} title="Sin actividad todavía" /> : (
            <div className="card pad">
              <ActivityList items={items} />
              {q.hasNextPage && <Button className="mt-3" block variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Cargar más</Button>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
