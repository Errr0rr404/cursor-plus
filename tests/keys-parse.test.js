'use strict';

const { eq, ok } = require('./_assert');
const keys = require('../src/keys');

it('isSpacePress accepts plain ASCII space', () => {
  ok(keys.isSpacePress(' '));
});

it('isSpacePress accepts un-modified Kitty CSI-u space', () => {
  ok(keys.isSpacePress('\x1b[32u'));
});

it('isSpacePress REJECTS Shift+Space (modifier bitmask 1)', () => {
  eq(keys.isSpacePress('\x1b[32;2u'), false);
});

it('isSpacePress REJECTS Ctrl+Space (modifier bitmask 4)', () => {
  // This is the encoding terminals send for Ctrl+Space (mod=5 = 1+4).
  // It must NOT look like a hold-space trigger — Ctrl+Space is the toggle.
  eq(keys.isSpacePress('\x1b[32;5u'), false);
});

it('isSpacePress REJECTS Alt+Space (modifier bitmask 8)', () => {
  eq(keys.isSpacePress('\x1b[32;9u'), false);
});

it('isSpaceRelease only matches the release variant', () => {
  // Legacy: release bit (value 16) is added to modifiers — 1+16 = 17.
  ok(keys.isSpaceRelease('\x1b[32;17u'));
  // Press of plain Space is not a release.
  eq(keys.isSpaceRelease('\x1b[32u'), false);
  // Press with Shift is not a release.
  eq(keys.isSpaceRelease('\x1b[32;2u'), false);
  // Press with Ctrl is not a release.
  eq(keys.isSpaceRelease('\x1b[32;5u'), false);
  // Progressive-enhancement colon form: CSI <key>;1:3u is a release.
  ok(keys.isSpaceRelease('\x1b[32;1:3u'));
});

it('parseKittyCsiU returns null on plain ASCII', () => {
  eq(keys.parseKittyCsiU('hello'), null);
});

it('parseKittyCsiU parses bare CSI-u (no modifier segment)', () => {
  const r = keys.parseKittyCsiU('\x1b[97u');
  eq(r.codepoint, 97);
  eq(r.kind, 'press');
  eq(r.modifiers, 0);
});

it('parseKittyCsiU decodes modifier 5 as Ctrl (bitmask 4)', () => {
  // 1+4 = 5 = ctrl press, no event-type sub-field.
  const r = keys.parseKittyCsiU('\x1b[97;5u');
  eq(r.modifiers, 4);
  eq(r.kind, 'press');
});

it('parseKittyCsiU decodes the legacy release bit (mod=17)', () => {
  // 1 + 16 = 17 → modifier bitmask 16 = release flag.
  const r = keys.parseKittyCsiU('\x1b[97;17u');
  eq(r.kind, 'release');
  // The release flag should be stripped from `modifiers`.
  eq(r.modifiers, 0);
});

it('parseKittyCsiU decodes the colon-subfield event-type', () => {
  // CSI <key>;1:3u  →  modifiers=1 (none), event-type=3 (release).
  const r = keys.parseKittyCsiU('\x1b[97;1:3u');
  eq(r.modifiers, 0);
  eq(r.kind, 'release');
});

it('parseKittyCsiU: colon event-type wins over legacy release bit', () => {
  // Release bit set + colon says "repeat" → repeat (most specific wins).
  const r = keys.parseKittyCsiU('\x1b[97;17:2u');
  eq(r.kind, 'repeat');
});

it('parseKittyCsiU strips release bit from modifier bitmask', () => {
  // Ctrl release (mod 1+4+16 = 21) → modifiers should be 4 (ctrl), not 20.
  const r = keys.parseKittyCsiU('\x1b[97;21u');
  eq(r.modifiers, 4);
  eq(r.kind, 'release');
});

it('isCtrlSpace covers xterm NUL, rxvt US, and Kitty CSI-u', () => {
  ok(keys.isCtrlSpace('\x00'));
  ok(keys.isCtrlSpace('\x1f'));
  ok(keys.isCtrlSpace('\x1b[32;5u'));
  ok(keys.isCtrlSpace('\x1b[32;5;u'));
  // Plain space is NOT Ctrl+Space.
  eq(keys.isCtrlSpace(' '), false);
  // Random CSI is not Ctrl+Space.
  eq(keys.isCtrlSpace('\x1b[97u'), false);
});