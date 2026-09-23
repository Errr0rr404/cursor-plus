'use strict';

const { eq, ok, deepEq } = require('./_assert');
const history = require('../src/history');

it('HISTORY_PATH is under ~/.cursor-plus', () => {
  ok(history.HISTORY_PATH.includes('.cursor-plus'));
  ok(history.HISTORY_PATH.endsWith('history.jsonl'));
});

it('append + readRecent roundtrip', () => {
  history.clear();
  history.append({ ts: '2026-01-01T00:00:00Z', cwd: '/tmp', prompt: 'first' });
  history.append({ ts: '2026-01-01T00:00:01Z', cwd: '/tmp', prompt: 'second' });
  const recent = history.readRecent(10);
  eq(recent.length, 2);
  eq(recent[0].prompt, 'second');   // most recent first
  eq(recent[1].prompt, 'first');
});

it('search filters by substring', () => {
  history.clear();
  history.append({ ts: '2026-01-01', prompt: 'refactor auth' });
  history.append({ ts: '2026-01-01', prompt: 'fix bug' });
  history.append({ ts: '2026-01-01', prompt: 'refactor db' });
  const matches = history.search('refactor');
  eq(matches.length, 2);
});

it('search is case-insensitive', () => {
  history.clear();
  history.append({ ts: '2026-01-01', prompt: 'Refactor Auth' });
  eq(history.search('refactor').length, 1);
});

it('search with no query returns recent', () => {
  history.clear();
  history.append({ ts: '2026-01-01', prompt: 'a' });
  history.append({ ts: '2026-01-01', prompt: 'b' });
  eq(history.search('').length, 2);
});

it('append truncates huge prompts', () => {
  history.clear();
  const big = 'x'.repeat(10_000);
  history.append({ ts: '2026-01-01', prompt: big });
  const recent = history.readRecent(1);
  ok(recent[0].prompt.length <= 4000);
});

it('readRecent with no file returns empty array', () => {
  history.clear();
  eq(history.readRecent().length, 0);
});

it('stats counts entries and bytes', () => {
  history.clear();
  history.append({ ts: '2026-01-01', prompt: 'hi' });
  const s = history.stats();
  ok(s.count >= 1);
  ok(s.bytes > 0);
});