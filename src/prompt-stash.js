'use strict';

/**
 * prompt-stash — persist and restore unsent draft prompts.
 *
 * Single-user JSON file at ~/.cursor-plus/prompt-stash.json.
 * Stores a small list of saved drafts (timestamped) plus the most
 * recent "current draft" so a Ctrl+S / restore round-trip is lossless.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STASH_PATH = path.join(os.homedir(), '.cursor-plus', 'prompt-stash.json');

function read() {
  if (!fs.existsSync(STASH_PATH)) return { drafts: [], current: '' };
  try { return JSON.parse(fs.readFileSync(STASH_PATH, 'utf8')); }
  catch { return { drafts: [], current: '' }; }
}

function _write(obj) {
  fs.mkdirSync(path.dirname(STASH_PATH), { recursive: true });
  fs.writeFileSync(STASH_PATH, JSON.stringify(obj, null, 2));
}

function saveCurrent(text) {
  const obj = read();
  obj.current = String(text || '');
  _write(obj);
}

function saveDraft(text, label) {
  const obj = read();
  obj.drafts.unshift({
    ts: new Date().toISOString(),
    label: label || null,
    text: String(text || ''),
  });
  if (obj.drafts.length > 50) obj.drafts.length = 50;
  _write(obj);
  return obj.drafts[0];
}

function popDraft() {
  const obj = read();
  const d = obj.drafts.shift() || null;
  _write(obj);
  return d;
}

function listDrafts() {
  return read().drafts;
}

function clear() {
  try { fs.unlinkSync(STASH_PATH); } catch {}
}

module.exports = {
  STASH_PATH,
  read, saveCurrent, saveDraft, popDraft, listDrafts, clear,
};