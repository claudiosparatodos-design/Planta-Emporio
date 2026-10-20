// Bus de eventos en tiempo real (Server-Sent Events).
// Solo se envían avisos de "qué cambió"; los datos se piden por la API, que valida permisos.

const clients = new Set();
let counter = 0;

export function addClient(user, res) {
  const client = { id: ++counter, user, res };
  clients.add(client);
  return () => clients.delete(client);
}

/**
 * @param {string[]} topics  claves de datos que cambiaron (p. ej. ['tasks','projects'])
 * @param {object} [opts]
 * @param {number[]} [opts.userIds]  limita el aviso a estos usuarios
 * @param {(user) => boolean} [opts.filter]  limita por permisos
 * @param {object} [opts.data]  información mínima (ids) para refrescos precisos
 */
export function emit(topics, opts = {}) {
  const payload = `event: change\ndata: ${JSON.stringify({ topics, ...(opts.data || {}) })}\n\n`;
  for (const client of clients) {
    if (opts.userIds && !opts.userIds.includes(client.user.id)) continue;
    if (opts.filter) {
      try {
        if (!opts.filter(client.user)) continue;
      } catch {
        continue;
      }
    }
    client.res.write(payload);
  }
}

export function onlineUserIds() {
  return [...new Set([...clients].map((c) => c.user.id))];
}

export function closeAll() {
  for (const c of clients) c.res.end();
  clients.clear();
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25_000).unref();
