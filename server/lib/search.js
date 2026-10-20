import { db } from './dbx.js';

/** Inserta o reemplaza el contenido indexado de una entidad. */
export function indexEntity(type, id, title, body = '') {
  db.run('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', type, id);
  db.run(
    'INSERT INTO search_index (entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)',
    type,
    id,
    title || '',
    (body || '').slice(0, 200_000),
  );
}

export function unindexEntity(type, id) {
  db.run('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', type, id);
}

/** Convierte texto libre en una consulta FTS5 segura con búsqueda por prefijo. */
export function toFtsQuery(text) {
  const tokens = String(text)
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

export function searchIndex(text, limit = 200) {
  const q = toFtsQuery(text);
  if (!q) return [];
  return db.all(
    `SELECT entity_type, entity_id, title,
            snippet(search_index, 3, '[[', ']]', '…', 14) AS snippet, bm25(search_index, 0, 0, 8, 1) AS rank
     FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?`,
    q,
    limit,
  );
}

/** Extrae texto plano de bloques del editor (BlockNote) para búsqueda y vista previa. */
export function blocksToText(blocks) {
  const out = [];
  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      out.push(inlineToText(b.content));
      if (b.type === 'table' && b.content?.rows) {
        for (const row of b.content.rows) for (const cell of row.cells || []) out.push(inlineToText(cell?.content ?? cell));
      }
      walk(b.children);
    }
  };
  walk(blocks);
  return out.filter(Boolean).join('\n');
}

function inlineToText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c.type === 'text') return c.text;
      if (c.type === 'link') return inlineToText(c.content);
      if (c.type === 'mention') return `@${c.props?.label ?? ''}`;
      return c.text || '';
    })
    .join('');
}
