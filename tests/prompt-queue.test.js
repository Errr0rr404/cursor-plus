'use strict';

const { eq, ok, deepEq } = require('./_assert');
const { PromptQueue } = require('../src/prompt-queue');

it('enqueue appends and returns ok', () => {
  const q = new PromptQueue();
  const r = q.enqueue('first');
  eq(r.ok, true);
  eq(r.size, 1);
  eq(q.length, 1);
});

it('enqueue trims whitespace', () => {
  const q = new PromptQueue();
  q.enqueue('  spaced  ');
  ok(q.peek().includes('spaced'));
});

it('enqueue rejects empty', () => {
  const q = new PromptQueue();
  const r = q.enqueue('   ');
  eq(r.ok, false);
  eq(r.reason, 'empty');
});

it('enqueue respects maxSize', () => {
  const q = new PromptQueue({ maxSize: 2 });
  q.enqueue('one');
  q.enqueue('two');
  const r = q.enqueue('three');
  eq(r.ok, false);
  eq(r.reason, 'full');
});

it('dequeue is FIFO', () => {
  const q = new PromptQueue();
  q.enqueue('a');
  q.enqueue('b');
  q.enqueue('c');
  eq(q.dequeue(), 'a');
  eq(q.dequeue(), 'b');
  eq(q.dequeue(), 'c');
  eq(q.dequeue(), null);
});

it('peek returns next without removing', () => {
  const q = new PromptQueue();
  q.enqueue('hello');
  eq(q.peek(), 'hello');
  eq(q.length, 1);
});

it('clear empties the queue', () => {
  const q = new PromptQueue();
  q.enqueue('a');
  q.enqueue('b');
  q.clear();
  eq(q.length, 0);
  eq(q.peek(), null);
});

it('toArray returns a snapshot copy', () => {
  const q = new PromptQueue();
  q.enqueue('a');
  const arr = q.toArray();
  q.enqueue('b');
  eq(arr.length, 1);
  eq(q.length, 2);
});