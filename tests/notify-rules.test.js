'use strict';

const { eq, ok, deepEq } = require('./_assert');
const notifyRules = require('../src/notify-rules');

it('createCooldown blocks repeats within window', () => {
  const allow = notifyRules.createCooldown(1000);
  ok(allow('test'));
  eq(allow('test'), false);
});

it('createCooldown allows after window expires', async () => {
  const allow = notifyRules.createCooldown(5);
  ok(allow('test'));
  await new Promise(r => setTimeout(r, 15));
  ok(allow('test'));
});

it('matchRule returns the matching rule', () => {
  const rule = notifyRules.matchRule([{ when: 'session_idle' }], 'session_idle');
  ok(rule);
  eq(rule.when, 'session_idle');
});

it('matchRule returns null when no rule applies', () => {
  eq(notifyRules.matchRule([{ when: 'session_idle' }], 'waiting_input'), null);
  eq(notifyRules.matchRule([], 'session_idle'), null);
  eq(notifyRules.matchRule(null, 'session_idle'), null);
});

it('fire with no rule is a no-op', () => {
  notifyRules.fire(null, { title: 'x', body: 'y' });   // shouldn't throw
});

it('fire swallows channel errors', () => {
  notifyRules.fire({ channels: ['bell'] }, { title: 'x', body: 'y' });   // bell writes \x07
});

it('fire on a webhook with no URL does nothing', () => {
  notifyRules.fire({ channels: ['webhook'] }, { title: 'x', body: 'y' });
});