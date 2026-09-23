'use strict';

const { eq, ok } = require('./_assert');
const config = require('../src/config');

it('defaultConfig returns a complete shape', () => {
  const d = config.defaultConfig();
  ok(d.agentBin);
  ok(d.voice);
  ok(d.mouse);
  ok(d.tts);
  ok(d.queue);
  ok(d.safety);
  ok(d.notifications);
});

it('defaultConfig.voice has holdSpace and modelPath', () => {
  const v = config.defaultConfig().voice;
  eq(v.holdSpace, true);
  ok(v.modelPath);
  eq(v.language, 'en');
});

it('validate flags an unknown theme', () => {
  const warns = config.validate({ theme: 'rainbow' });
  ok(warns.some(w => /unknown theme/.test(w)));
});

it('validate accepts ISO language codes', () => {
  eq(config.validate({ voice: { language: 'en' } }).length, 0);
  eq(config.validate({ voice: { language: 'auto' } }).length, 0);
  eq(config.validate({ voice: { language: 'es' } }).length, 0);
});

it('validate flags a bad language code', () => {
  const warns = config.validate({ voice: { language: 'this-is-a-language' } });
  ok(warns.length > 0);
});

it('validate flags an out-of-range tts.rate', () => {
  const warns = config.validate({ tts: { rate: 99 } });
  ok(warns.some(w => /tts\.rate/.test(w)));
});

it('validate flags invalid queue.maxSize', () => {
  ok(config.validate({ queue: { maxSize: -1 } }).length > 0);
  ok(config.validate({ queue: { maxSize: 'big' } }).length > 0);
});

it('validate flags invalid mouse.reportMode', () => {
  ok(config.validate({ mouse: { reportMode: 'mystery' } }).length > 0);
});

it('load returns a usable config even when file is missing', () => {
  const c = config.load();
  ok(c.agentBin);
  ok(c.voice);
});

it('PLATFORM constants are exposed', () => {
  ok(['darwin', 'linux', 'win32', 'freebsd', 'openbsd'].includes(config.PLATFORM));
});

it('findWhisperModel returns null when no model is installed', () => {
  const m = config.findWhisperModel();
  // No assertion on the value (could be installed on this machine),
  // but the call must not throw.
  ok(m === null || typeof m === 'string');
});

it('listMicDevices returns an array', () => {
  const list = config.listMicDevices();
  ok(Array.isArray(list));
});