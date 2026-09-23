'use strict';

const { eq, ok } = require('./_assert');
const keys = require('../src/keys');

it('isCtrlSpace accepts NUL (xterm)', () => {
  ok(keys.isCtrlSpace('\x00'));
});

it('isCtrlSpace accepts US (rxvt)', () => {
  ok(keys.isCtrlSpace('\x1f'));
});

it('isCtrlSpace accepts Kitty CSI-u form', () => {
  ok(keys.isCtrlSpace('\x1b[32;5u'));
  ok(keys.isCtrlSpace('\x1b[32;5;u'));
});

it('isCtrlSpace rejects plain space and Ctrl-A', () => {
  eq(keys.isCtrlSpace(' '), false);
  eq(keys.isCtrlSpace('\x01'), false);
});

it('parseKittyCsiU parses a press event', () => {
  const r = keys.parseKittyCsiU('\x1b[32;5u');
  eq(r.kind, 'press');
  eq(r.codepoint, 32);
  eq(r.modifiers, 4);
});

it('parseKittyCsiU parses a release event (modifier bit 0)', () => {
  const r = keys.parseKittyCsiU('\x1b[32;6u');
  eq(r.kind, 'release');
  eq(r.codepoint, 32);
});

it('parseKittyCsiU parses a repeat event (modifier bit 1)', () => {
  const r = keys.parseKittyCsiU('\x1b[97;3u');   // 'a' with Shift
  // bits: base 1, +2 = repeat, +1 (modifier 2 - 1) is shift, + 1 = shift+repeat
  eq(r.kind, 'repeat');
});

it('parseKittyCsiU returns null on plain ASCII', () => {
  eq(keys.parseKittyCsiU('hello'), null);
});

it('isSpacePress matches plain space and Kitty press of 32', () => {
  ok(keys.isSpacePress(' '));
  ok(keys.isSpacePress('\x1b[32;5u'));
  eq(keys.isSpacePress('\x1b[97;5u'), false);   // 'a'
});

it('isSpaceRelease only matches release events for space', () => {
  ok(keys.isSpaceRelease('\x1b[32;6u'));
  eq(keys.isSpaceRelease('\x1b[32;5u'), false);  // press
  eq(keys.isSpaceRelease(' '), false);
});

it('startsWithCsi detects ESC [ sequences', () => {
  ok(keys.startsWithCsi('\x1b[A'));
  ok(keys.startsWithCsi('\x1b[100;5;10M'));
  eq(keys.startsWithCsi('hello'), false);
  eq(keys.startsWithCsi('\x1bX'), false);
});

it('HOTKEYS map covers Ctrl+T / Ctrl+P / Ctrl+Y / Ctrl+S / Ctrl+G', () => {
  eq(keys.HOTKEYS.tts, '\x14');
  eq(keys.HOTKEYS.screenshot, '\x10');
  eq(keys.HOTKEYS.clipboard, '\x19');
  eq(keys.HOTKEYS.stash, '\x13');
  eq(keys.HOTKEYS.editor, '\x07');
});

it('matchesHotkey returns true for the matching byte', () => {
  ok(keys.matchesHotkey('\x14', 'tts'));
  eq(keys.matchesHotkey('\x15', 'tts'), false);
});