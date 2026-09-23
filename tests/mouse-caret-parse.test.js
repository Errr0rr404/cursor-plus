'use strict';

const { eq, ok } = require('./_assert');
const MouseCaret = require('../src/mouse-caret');

function makeMouse(opts = {}) {
  return new MouseCaret({
    cols: 6,
    rows: 12,
    promptStartRow: 7,
    promptWidth: 6,
    ...opts,
  });
}

it('parseSgrMouseEvent returns null on plain text', () => {
  const m = makeMouse();
  eq(m.parseSgrMouseEvent('hello'), null);
});

it('parseSgrMouseEvent returns null on a non-mouse CSI sequence', () => {
  // Arrow up — same CSI structure but no < and no M/m terminator.
  const m = makeMouse();
  eq(m.parseSgrMouseEvent('\x1b[A'), null);
});

it('parseSgrMouseEvent returns null when a non-mouse sequence happens to contain M', () => {
  // SGR-colored "ERROR" rendered with ANSI escapes — should not be
  // mistaken for a mouse press after the regex was anchored.
  const m = makeMouse();
  eq(m.parseSgrMouseEvent('\x1b[31;1;31mSome text\x1b[0m'), null);
});

it('parseSgrMouseEvent returns left-press for SGR mouse press', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<0;10;8M');
  eq(ev.kind, 'left-press');
  eq(ev.col, 10);
  eq(ev.row, 8);
});

it('parseSgrMouseEvent returns ignored (not left-press) for right-click', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<2;10;8M');
  eq(ev.kind, 'ignored');
});

it('parseSgrMouseEvent returns ignored for release (lowercase m)', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<0;10;8m');
  eq(ev.kind, 'ignored');
});

it('parseSgrMouseEvent returns ignored for middle-click', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<1;10;8M');
  eq(ev.kind, 'ignored');
});

it('parseSgrMouseEvent returns null for an unterminated SGR mouse event', () => {
  const m = makeMouse();
  // Missing the M/m terminator → not a complete event.
  eq(m.parseSgrMouseEvent('\x1b[<0;10;8'), null);
});

it('parseSgrMouseEvent returns null for malformed SGR mouse (missing <)', () => {
  const m = makeMouse();
  // Old xterm mouse mode: \x1b[0;10;8M — no leading < — must NOT be misdetected.
  eq(m.parseSgrMouseEvent('\x1b[0;10;8M'), null);
});