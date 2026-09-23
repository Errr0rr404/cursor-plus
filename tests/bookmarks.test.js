'use strict';

const { eq, ok } = require('./_assert');
const bookmarks = require('../src/bookmarks');

it('BOOKMARKS_PATH is under ~/.cursor-plus', () => {
  ok(bookmarks.BOOKMARKS_PATH.includes('.cursor-plus'));
  ok(bookmarks.BOOKMARKS_PATH.endsWith('bookmarks.json'));
});

it('add + list returns newest first', () => {
  const a = bookmarks.add({ title: 'first', body: 'one' });
  const b = bookmarks.add({ title: 'second', body: 'two' });
  const list = bookmarks.list();
  eq(list.length >= 2, true);
  eq(list[0].id, b.id);
  eq(list[0].title, 'second');
  ok(a.id);
});

it('list filters by query', () => {
  bookmarks.add({ title: 'Refactor auth', body: 'plain body' });
  bookmarks.add({ title: 'Fix bug',     body: 'plain body' });
  const matches = bookmarks.list({ query: 'refactor' });
  ok(matches.every(b => /refactor/i.test(b.title + ' ' + b.body)));
});

it('list with no query returns everything', () => {
  const before = bookmarks.list().length;
  bookmarks.add({ title: 'X', body: 'Y' });
  ok(bookmarks.list().length > before);
});

it('remove deletes a bookmark by id', () => {
  const b = bookmarks.add({ title: 'will-remove', body: 'bye' });
  const ok1 = bookmarks.remove(b.id);
  eq(ok1, true);
  eq(bookmarks.list({ query: 'will-remove' }).length, 0);
});

it('remove returns false for unknown id', () => {
  eq(bookmarks.remove('does-not-exist'), false);
});

it('tags are preserved', () => {
  const b = bookmarks.add({ title: 't', body: 'b', tags: ['auth', 'plan'] });
  eq(b.tags.join(','), 'auth,plan');
});