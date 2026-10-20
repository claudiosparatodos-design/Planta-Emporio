import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui.jsx';
import { Topbar } from '../components/Layout.jsx';

export default function NotFound() {
  return (
    <>
      <Topbar crumbs={[{ label: 'Página no encontrada' }]} />
      <div className="content">
        <EmptyState icon={Compass} title="Esta página no existe" actions={<Link className="btn primary" to="/">Ir al inicio</Link>}>
          Puede que el enlace esté mal escrito o que el elemento se haya eliminado.
        </EmptyState>
      </div>
    </>
  );
}
