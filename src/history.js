'use strict';

/**
 * history — append-only JSONL log of every submitted prompt.
 *
 * Path: ~/.cursor-plus/history.jsonl
 *
 * Each entry: { ts, pid, cwd, prompt, model? }
 *
 * The file is append-only so a crash mid-write can't corrupt earlier
 * entries. Reads tolerate malformed trailing lines (filter them out).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

const HISTORY_PATH = path.join(os.homedir(), '.cursor-plus', 'history.jsonl');

function append(record) {
  if (!record) return;
  const ts = record.ts || new Date().toISOString();
  const pid = record.pid || process.pid;
  const cwd = record.cwd || process.cwd();
  const prompt = String(record.prompt || '').slice(0, 4000);
  const line = JSON.stringify({ ts, pid, cwd, prompt, model: record.model || null }) + '\n';
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.appendFileSync(HISTORY_PATH, line);
  } catch {}
}

function readRecent(limit = 50) {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  const lines = fs.readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean);
  const recent = lines.slice(-limit);
  const out = [];
  for (const line of recent.reverse()) {
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function search(query, { limit = 50 } = {}) {
  const recent = readRecent(1000);
  const q = String(query || '').toLowerCase();
  if (!q) return recent.slice(0, limit);
  return recent.filter(r => String(r.prompt || '').toLowerCase().includes(q)).slice(0, limit);
}

function clear() {
  try { fs.unlinkSync(HISTORY_PATH); } catch {}
}

function stats() {
  if (!fs.existsSync(HISTORY_PATH)) return { count: 0, bytes: 0 };
  const st = fs.statSync(HISTORY_PATH);
  const count = fs.readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean).length;
  return { count, bytes: st.size };
}

module.exports = { HISTORY_PATH, append, readRecent, search, clear, stats };