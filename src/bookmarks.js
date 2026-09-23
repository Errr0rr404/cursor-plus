'use strict';

/**
 * bookmarks — save the last agent response for later. Stored as a single
 * JSON array at ~/.cursor-plus/bookmarks.json.
 *
 * Each entry: { id, ts, title, tags, body, cwd, model }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BOOKMARKS_PATH = path.join(os.homedir(), '.cursor-plus', 'bookmarks.json');
let _seq = Date.now();

function _read() {
  if (!fs.existsSync(BOOKMARKS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BOOKMARKS_PATH, 'utf8')); } catch { return []; }
}

function _write(arr) {
  fs.mkdirSync(path.dirname(BOOKMARKS_PATH), { recursive: true });
  fs.writeFileSync(BOOKMARKS_PATH, JSON.stringify(arr, null, 2));
}

function add({ title, body, tags = [], cwd, model }) {
  const list = _read();
  const id = String(++_seq);
  const entry = {
    id,
    ts: new Date().toISOString(),
    title: title || (String(body || '').split('\n')[0] || '').slice(0, 80),
    tags,
    body: String(body || '').slice(0, 20000),
    cwd: cwd || process.cwd(),
    model: model || null,
  };
  list.unshift(entry);
  _write(list);
  return entry;
}

function list({ query } = {}) {
  const list = _read();
  if (!query) return list;
  const q = String(query).toLowerCase();
  return list.filter(b =>
    String(b.title || '').toLowerCase().includes(q) ||
    String(b.body || '').toLowerCase().includes(q) ||
    (b.tags || []).some(t => t.toLowerCase().includes(q))
  );
}

function remove(id) {
  const list = _read();
  const next = list.filter(b => b.id !== String(id));
  if (next.length === list.length) return false;
  _write(next);
  return true;
}

module.exports = { BOOKMARKS_PATH, add, list, remove };