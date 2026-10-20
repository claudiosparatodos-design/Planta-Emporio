import { useEffect, useMemo, useState } from 'react';
import { BlockNoteSchema, defaultInlineContentSpecs, filterSuggestionItems } from '@blocknote/core';
import { es } from '@blocknote/core/locales';
import { createReactInlineContentSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { api, qs, uploadFiles } from '../lib/api.js';

const TARGET_URL = { user: '/members/', task: '/tasks/', page: '/docs/', project: '/projects/', meeting: '/meetings/', decision: '/decisions/', goal: '/goals/' };
const TARGET_ICON = { user: '@', task: '☑', page: '📄', project: '📁', meeting: '🗓', decision: '⚖', goal: '🎯' };

/** Mención en línea: persona, tarea, proyecto, documento… Al hacer clic navega al elemento. */
const Mention = createReactInlineContentSpec(
  {
    type: 'mention',
    propSchema: { target: { default: '' }, label: { default: '' } },
    content: 'none',
  },
  {
    render: (props) => {
      const { target, label } = props.inlineContent.props;
      const [kind, id] = String(target).split(':');
      const url = TARGET_URL[kind] ? `${TARGET_URL[kind]}${id}` : null;
      return (
        <span
          className="mention-chip"
          data-target={target}
          role="link"
          onClick={(e) => {
            e.preventDefault();
            if (url) window.dispatchEvent(new CustomEvent('pe:navigate', { detail: url }));
          }}
        >
          {kind === 'user' ? `@${label}` : `${TARGET_ICON[kind] || ''} ${label}`}
        </span>
      );
    },
  },
);

const schema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: Mention },
});

function useResolvedTheme() {
  const get = () => {
    const forced = document.documentElement.dataset.theme;
    if (forced === 'light' || forced === 'dark') return forced;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState(get);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(get()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setTheme(get());
    mq.addEventListener('change', fn);
    return () => {
      obs.disconnect();
      mq.removeEventListener('change', fn);
    };
  }, []);
  return theme;
}

const dictionary = {
  ...es,
  placeholders: { ...es.placeholders, default: "Escribe algo, usa '/' para insertar bloques o '@' para mencionar" },
};

/**
 * Editor de bloques (encabezados, listas, listas de verificación, tablas, imágenes, archivos…).
 * Los bloques se pueden reordenar arrastrando el asa de la izquierda.
 */
export default function Editor({ initialContent, onChange, editable = true, pageId, projectId, members = [] }) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    schema,
    dictionary,
    initialContent: initialContent?.length ? initialContent : undefined,
    uploadFile: async (file) => {
      const [f] = await uploadFiles([file], { link_type: pageId ? 'page' : undefined, link_id: pageId, project_id: projectId });
      return `/api/files/${f.id}/raw`;
    },
  });

  const getMentionItems = useMemo(
    () => async (query) => {
      const insert = (target, label) => () => {
        editor.insertInlineContent([{ type: 'mention', props: { target, label } }, ' ']);
      };
      const people = members
        .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map((m) => ({ title: m.name, subtext: 'Integrante', group: 'Personas', onItemClick: insert(`user:${m.id}`, m.name) }));
      let entities = [];
      try {
        const res = await api.get(`/entities/search${qs({ q: query, types: 'task,project,page,meeting,decision,goal' })}`);
        const groupOf = { task: 'Tareas', project: 'Proyectos', page: 'Documentos', meeting: 'Reuniones', decision: 'Decisiones', goal: 'Objetivos' };
        entities = res.slice(0, 8).map((it) => ({ title: it.title, subtext: it.subtitle, group: groupOf[it.type], onItemClick: insert(`${it.type}:${it.id}`, it.title) }));
      } catch {
        /* sin conexión: solo personas */
      }
      return [...people, ...entities];
    },
    [editor, members],
  );

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      editable={editable}
      onChange={() => onChange?.(editor.document)}
      slashMenu={false}
    >
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)} />
      <SuggestionMenuController triggerCharacter="@" getItems={getMentionItems} />
    </BlockNoteView>
  );
}
