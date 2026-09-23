'use strict';

const { eq, ok } = require('./_assert');
const logger = require('../src/logger');

it('forUser strips the current home directory', () => {
  const os = require('os');
  const home = os.homedir();
  const out = logger.forUser(new Error(`see ${home}/secrets.txt`));
  ok(!out.includes(home), `expected home stripped, got: ${out}`);
  ok(out.includes('~'), `expected ~ placeholder, got: ${out}`);
});

it('forUser collapses whitespace', () => {
  const out = logger.forUser('hello\n   world');
  eq(out, 'hello world');
});

it('forUser collapses whitespace', () => {
  const out = logger.forUser('hello\n   world');
  eq(out, 'hello world');
});

it('forUser truncates long messages', () => {
  const long = 'a'.repeat(500);
  const out = logger.forUser(long, 30);
  ok(out.length <= 30);
  ok(out.endsWith('…'));
});

it('forUser handles null/undefined', () => {
  eq(logger.forUser(null), '');
  eq(logger.forUser(undefined), '');
});

it('setLevel changes the active level', () => {
  logger.setLevel('debug');
  // No public getter; just verify it doesn't throw.
  logger.debug('hidden message');
  logger.setLevel('error');
  logger.debug('still hidden');
});

it('LOG_PATH is under ~/.cursor-plus', () => {
  ok(logger.LOG_PATH.includes('.cursor-plus'));
  ok(logger.LOG_PATH.endsWith('cursor-plus.log'));
});