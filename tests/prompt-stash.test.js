'use strict';

const { eq, ok, deepEq } = require('./_assert');
const safety = require('../src/safety');
const fs = require('fs');
const path = require('path');
const os = require('os');

const promptStash = require('../src/prompt-stash');

// Use a temp home so tests don't pollute the real ~/.cursor-plus.
const TMP_HOME = path.join(os.tmpdir(), `cursor-plus-test-${Date.now()}`);
fs.mkdirSync(TMP_HOME, { recursive: true });
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

it('saveDraft writes a record with ts and label', () => {
  const saved = promptStash.saveDraft('refactor auth', 'auth-pass');
  ok(saved.ts);
  eq(saved.label, 'auth-pass');
  eq(saved.text, 'refactor auth');
});

it('saveDraft without label stores null', () => {
  promptStash.clear();
  const saved = promptStash.saveDraft('plain draft');
  eq(saved.label, null);
});

it('listDrafts returns most-recent first', () => {
  promptStash.clear();
  promptStash.saveDraft('first');
  promptStash.saveDraft('second');
  const list = promptStash.listDrafts();
  eq(list[0].text, 'second');
  eq(list[1].text, 'first');
});

it('popDraft returns and removes the most-recent draft', () => {
  promptStash.clear();
  promptStash.saveDraft('keep-me');
  const popped = promptStash.popDraft();
  eq(popped.text, 'keep-me');
  eq(promptStash.listDrafts().length, 0);
});

it('saveCurrent keeps a separate "current" pointer', () => {
  promptStash.saveCurrent('half-written');
  const obj = promptStash.read();
  eq(obj.current, 'half-written');
});

it('popDraft returns null on empty stash', () => {
  promptStash.clear();
  eq(promptStash.popDraft(), null);
});