// Sincronización en tiempo real: el servidor avisa qué cambió y aquí se refrescan esas consultas.
const EXTRA = {
  tasks: ['calendar', 'goals', 'meetings'],
  meetings: ['calendar'],
  finance: ['calendar'],
  me: ['auth', 'members'],
  'chat-unread': ['chat'],
  comments: ['tasks'],
  files: ['comments'],
};

export function connectLive(queryClient, { onStatus } = {}) {
  let source = null;
  let pending = new Set();
  let timer = null;
  let closed = false;
  let hadError = false;

  const flush = () => {
    timer = null;
    const topics = pending;
    pending = new Set();
    queryClient.invalidateQueries({ predicate: (q) => topics.has(q.queryKey[0]) });
  };

  const open = () => {
    if (closed) return;
    source = new EventSource('/api/events');
    source.addEventListener('ready', () => {
      onStatus?.('online');
      // Tras una reconexión se refresca todo para no perder cambios ocurridos sin conexión.
      if (hadError) queryClient.invalidateQueries();
      hadError = false;
    });
    source.addEventListener('change', (e) => {
      try {
        const { topics = [] } = JSON.parse(e.data);
        for (const t of topics) {
          pending.add(t);
          for (const x of EXTRA[t] || []) pending.add(x);
        }
        if (!timer) timer = setTimeout(flush, 120);
      } catch {
        /* ignorar */
      }
    });
    source.onerror = () => {
      hadError = true;
      onStatus?.('offline');
    };
  };

  open();
  const onFocus = () => {
    if (document.visibilityState === 'visible' && hadError) queryClient.invalidateQueries();
  };
  document.addEventListener('visibilitychange', onFocus);
  return () => {
    closed = true;
    source?.close();
    document.removeEventListener('visibilitychange', onFocus);
  };
}
