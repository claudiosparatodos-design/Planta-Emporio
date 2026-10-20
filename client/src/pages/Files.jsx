import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FolderPlus, Upload, Search, MoreHorizontal, Pencil, Trash2, Download, Lock, Wallet, Globe, Paperclip, FolderInput } from 'lucide-react';
import { api, fileUrl, qs, uploadFiles } from '../lib/api.js';
import { fileSize, fmtDate, timeAgo } from '../lib/format.js';
import { useAction, useDebounced, useMe, useCan } from '../lib/hooks.js';
import { Button, EmptyState, ErrorState, Progress, SkeletonList, Segmented } from '../components/ui.jsx';
import { Menu, Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { FileIcon, FilePreview, fileKind } from '../components/collab.jsx';

const VIS = {
  workspace: { label: 'Todo el equipo', icon: Globe },
  finance: { label: 'Solo finanzas', icon: Wallet },
  private: { label: 'Solo yo', icon: Lock },
};

export default function Files() {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const canManage = useCan('projects.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const folderId = params.get('folder') ? Number(params.get('folder')) : null;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const dq = useDebounced(q);
  const [progress, setProgress] = useState(null);
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef(null);

  const { data: folders = [] } = useQuery({ queryKey: ['files', 'folders'], queryFn: () => api.get('/files/folders/all') });
  const { data: files = [], isLoading, error, refetch } = useQuery({
    queryKey: ['files', 'list', folderId, dq, kind],
    queryFn: () => api.get(`/files${qs({ folder_id: dq ? undefined : folderId ?? 'root', q: dq, kind })}`),
  });
  const { data: storage } = useQuery({ queryKey: ['files', 'storage'], queryFn: () => api.get('/files/storage') });

  useEffect(() => {
    const id = Number(params.get('file'));
    if (id) api.get(`/files/${id}`).then(setPreview).catch(() => toast.error('El archivo no existe o no tienes acceso.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('file')]);

  const folder = folders.find((f) => f.id === folderId);
  const crumbs = useMemo(() => {
    const out = [];
    let cur = folder;
    while (cur) {
      out.unshift(cur);
      cur = folders.find((f) => f.id === cur.parent_id);
    }
    return out;
  }, [folder, folders]);
  const subfolders = folders.filter((f) => (f.parent_id ?? null) === folderId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['files'] });

  const upload = async (list) => {
    if (!list?.length) return;
    setProgress(0);
    try {
      await uploadFiles([...list], { folder_id: folderId }, setProgress);
      toast.success(list.length > 1 ? `${list.length} archivos subidos` : 'Archivo subido');
      refresh();
    } catch (e) {
      toast.error(e);
    }
    setProgress(null);
  };
  const newFolder = async () => {
    const name = await confirm({ title: 'Nueva carpeta', input: { placeholder: 'Nombre de la carpeta', required: true }, confirmLabel: 'Crear' });
    if (!name) return;
    api.post('/files/folders', { name, parent_id: folderId }).then(refresh).catch(toast.error);
  };
  const go = (id) => setParams(id ? { folder: id } : {});

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Archivos', to: '/files' }, ...crumbs.map((c) => ({ label: c.name }))]}
        actions={
          <>
            <Button size="sm" icon={FolderPlus} onClick={newFolder}><span className="hide-sm">Carpeta</span></Button>
            <Button size="sm" variant="primary" icon={Upload} onClick={() => input.current.click()}>Subir</Button>
          </>
        }
      />
      <div className="content" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => e.currentTarget === e.target && setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        <div className="page">
          <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          <div className="page-header">
            <div>
              <h1 className="page-title">{folder ? folder.name : 'Archivos'}</h1>
              <p className="page-subtitle">Cotizaciones, contratos, imágenes, presentaciones y comprobantes en un solo lugar.</p>
            </div>
            {storage && (
              <div style={{ width: 200 }}>
                <div className="flex between tiny faint mb-2"><span>Almacenamiento</span><span>{fileSize(storage.used)} de {fileSize(storage.quota)}</span></div>
                <Progress value={(storage.used / storage.quota) * 100} thin tone={storage.used / storage.quota > 0.9 ? 'danger' : ''} />
              </div>
            )}
          </div>
          <div className="filter-bar">
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
              <Search size={14} className="faint" style={{ position: 'absolute', left: 9, top: 9 }} />
              <input className="input" style={{ paddingLeft: 30, height: 32 }} placeholder="Buscar en todos los archivos…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented value={kind} onChange={setKind} options={[{ value: '', label: 'Todos' }, { value: 'image', label: 'Imágenes' }, { value: 'pdf', label: 'PDF' }]} />
          </div>
          {progress !== null && <div className="upload-progress mb-3"><Upload size={14} />Subiendo… <Progress value={progress * 100} thin /></div>}
          {over && <div className="dropzone over mb-3">Suelta los archivos para subirlos {folder ? `a «${folder.name}»` : ''}</div>}

          {!dq && (subfolders.length > 0 || folderId) && (
            <div className="grid-cards mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
              {folderId && (
                <button className="card hoverable list-row" onClick={() => go(folder?.parent_id)}>
                  <Folder size={18} className="faint" /><span className="grow title muted">.. (volver)</span>
                </button>
              )}
              {subfolders.map((f) => (
                <div key={f.id} className="card hoverable list-row clickable" onClick={() => go(f.id)}>
                  <Folder size={18} style={{ color: 'var(--m-yellow)' }} fill="currentColor" fillOpacity={0.25} />
                  <span className="grow title">{f.name}</span>
                  <span className="meta">{f.file_count}</span>
                  <Menu
                    trigger={(p) => <button className="icon-btn xs" aria-label="Opciones" {...p}><MoreHorizontal size={14} /></button>}
                    items={[
                      { label: 'Renombrar', icon: Pencil, onClick: async () => { const n = await confirm({ title: 'Renombrar carpeta', input: { placeholder: f.name, required: true }, confirmLabel: 'Guardar' }); if (n) api.patch(`/files/folders/${f.id}`, { name: n }).then(refresh).catch(toast.error); } },
                      { label: 'Eliminar', icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: `¿Eliminar «${f.name}»?`, message: 'Solo se pueden eliminar carpetas vacías.', confirmLabel: 'Eliminar', danger: true })) api.del(`/files/folders/${f.id}`).then(refresh).catch(toast.error); } },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}

          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !files.length ? (
            <EmptyState icon={Paperclip} title={dq ? 'Sin resultados' : 'No hay archivos aquí'} actions={!dq && <Button variant="primary" icon={Upload} onClick={() => input.current.click()}>Subir archivos</Button>}>
              {!dq && 'Arrastra archivos a esta ventana o usa el botón Subir. Los archivos adjuntos a tareas o documentos también aparecen aquí.'}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nombre</th><th className="hide-sm">Subido por</th><th className="hide-sm">Fecha</th><th className="right">Tamaño</th><th className="hide-sm">Acceso</th><th /></tr></thead>
                <tbody>
                  {files.map((f) => {
                    const V = VIS[f.visibility];
                    const canEdit = f.uploaded_by === me.id || canManage;
                    return (
                      <tr key={f.id} className="clickable" onClick={() => setPreview(f)}>
                        <td>
                          <span className="flex" style={{ minWidth: 0 }}>
                            {fileKind(f.mime) === 'image' ? <img src={fileUrl(f.id)} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} loading="lazy" /> : <span className="faint" style={{ width: 28, display: 'grid', placeItems: 'center' }}><FileIcon mime={f.mime} size={18} /></span>}
                            <span className="truncate" style={{ maxWidth: 380 }}>{f.name}</span>
                          </span>
                        </td>
                        <td className="muted hide-sm">{f.uploaded_by_name}</td>
                        <td className="muted hide-sm" title={fmtDate(f.created_at, 'd MMM yyyy HH:mm')}>{timeAgo(f.created_at)}</td>
                        <td className="right muted num">{fileSize(f.size)}</td>
                        <td className="hide-sm"><span className="faint small flex" style={{ gap: 5 }}><V.icon size={13} />{V.label}</span></td>
                        <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
                          <FileMenu file={f} canEdit={canEdit} folders={folders} onChanged={refresh} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {preview && <FilePreview file={preview} onClose={() => { setPreview(null); if (params.get('file')) { const n = new URLSearchParams(params); n.delete('file'); setParams(n); } }} />}
    </>
  );
}

function FileMenu({ file, canEdit, folders, onChanged }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const act = (p) => p.then(onChanged).catch(toast.error);
  return (
    <>
      <Menu
        trigger={(p) => <button className="icon-btn sm" aria-label="Opciones del archivo" {...p}><MoreHorizontal size={15} /></button>}
        items={[
          { label: 'Descargar', icon: Download, onClick: () => { window.location.href = fileUrl(file.id, true); } },
          canEdit && { label: 'Renombrar', icon: Pencil, onClick: async () => { const n = await confirm({ title: 'Renombrar archivo', input: { placeholder: file.name, required: true }, confirmLabel: 'Guardar' }); if (n) act(api.patch(`/files/${file.id}`, { name: n })); } },
          canEdit && { label: 'Mover a carpeta', icon: FolderInput, onClick: () => setMoving(true) },
          canEdit && { section: 'Quién puede verlo' },
          ...(canEdit ? Object.entries(VIS).map(([k, v]) => ({ label: v.label, icon: v.icon, checked: file.visibility === k, onClick: () => act(api.patch(`/files/${file.id}`, { visibility: k })) })) : []),
          canEdit && 'sep',
          canEdit && { label: 'Enviar a la papelera', icon: Trash2, danger: true, onClick: async () => (await confirm({ title: `¿Enviar «${file.name}» a la papelera?`, confirmLabel: 'Eliminar', danger: true })) && act(api.del(`/files/${file.id}`)) },
        ]}
      />
      {moving && (
        <Modal size="sm" title="Mover a carpeta" onClose={() => setMoving(false)}>
          <button className="list-row" onClick={() => { act(api.patch(`/files/${file.id}`, { folder_id: null })); setMoving(false); }}><Folder size={16} className="faint" />Archivos (raíz)</button>
          {folders.map((f) => (
            <button key={f.id} className="list-row" onClick={() => { act(api.patch(`/files/${file.id}`, { folder_id: f.id })); setMoving(false); }}>
              <Folder size={16} style={{ color: 'var(--m-yellow)' }} />{f.name}
              {file.folder_id === f.id && <span className="meta">actual</span>}
            </button>
          ))}
        </Modal>
      )}
    </>
  );
}

