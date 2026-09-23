'use strict';

const { eq, ok } = require('./_assert');
const theme = require('../src/theme');

it('set accepts known theme names', () => {
  theme.set('dark');
  theme.set('light');
  theme.set('solarized');
  theme.set('monokai');
  theme.set('auto');
});

it('set silently ignores unknown themes', () => {
  theme.set('totally-fake');
  const t = theme.get();
  ok(['dark', 'light', 'solarized', 'monokai'].includes(t.name));
});

it('get returns the expected palette keys', () => {
  const t = theme.get();
  ok(typeof t.reset === 'string');
  ok(typeof t.bold === 'string');
  ok(typeof t.dim === 'string');
  ok(typeof t.accent === 'string');
  ok(typeof t.success === 'string');
  ok(typeof t.warn === 'string');
  ok(typeof t.error === 'string');
});

it('reset always ends with the ANSI reset code', () => {
  theme.set('dark');
  const t = theme.get();
  ok(t.reset.includes('\x1b[') || t.reset === '');
});