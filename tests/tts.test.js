'use strict';

const { eq, ok } = require('./_assert');
const tts = require('../src/tts');

it('summarize strips fenced code blocks', () => {
  const out = tts.summarize('hello\n```js\nconsole.log(1)\n```\nworld');
  ok(!out.includes('console.log'));
  ok(out.includes('hello'));
  ok(out.includes('world'));
});

it('summarize strips inline code', () => {
  const out = tts.summarize('use `npm test` to run tests');
  ok(!out.includes('`'));
});

it('summarize strips ANSI codes', () => {
  const out = tts.summarize('\x1b[31mhello\x1b[0m world');
  eq(out, 'hello world');
});

it('summarize strips markdown headers', () => {
  const out = tts.summarize('# Title\n## Sub\nbody');
  ok(!out.startsWith('#'));
});

it('summarize truncates overlong output', () => {
  const long = 'word '.repeat(500);
  const out = tts.summarize(long, 100);
  ok(out.length <= 100);
  ok(out.endsWith('…'));
});

it('summarize handles empty / null gracefully', () => {
  eq(tts.summarize(''), '');
  eq(tts.summarize(null), '');
  eq(tts.summarize(undefined), '');
});

it('class exposes summarize as a static helper', () => {
  ok(typeof tts.summarize === 'function');
  ok(typeof tts.TTS.summarize === 'function');
});