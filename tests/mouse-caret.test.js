'use strict';

const { eq, ok, deepEq } = require('./_assert');
const MouseCaret = require('../src/mouse-caret');

function makeMouse(opts = {}) {
  return new MouseCaret({
    cols: 40,
    rows: 12,
    promptStartRow: 7,    // last 5 rows are the prompt area
    promptWidth: 40,
    wrapIndent: 0,
    ...opts,
  });
}

it('parses SGR left-press', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<0;10;8M');
  deepEq(ev, { kind: 'left-press', row: 8, col: 10, button: 0 });
});

it('parses SGR left-release (lowercase m)', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<0;10;8m');
  eq(ev.kind, 'ignored');
});

it('parses SGR right-click as ignored', () => {
  const m = makeMouse();
  const ev = m.parseSgrMouseEvent('\x1b[<2;10;8M');
  eq(ev.kind, 'ignored');
});

it('handleClick outside the prompt is a no-op', () => {
  const m = makeMouse();
  m.buffer = 'hello';
  m.caret = 5;
  const delta = m.handleClick(1, 5);    // row 1 < promptStartRow
  eq(delta, 0);
});

it('handleClick on row 0 maps to caret 0 within the buffer', () => {
  const m = makeMouse({ promptStartRow: 5 });
  m.buffer = 'hello world';
  m.caret = 11;
  // Click at row 5 col 1 = start of buffer
  const delta = m.handleClick(5, 1);
  eq(delta, -11);
});

it('handleClick on the same caret offset is a no-op', () => {
  const m = makeMouse({ promptStartRow: 1 });
  m.buffer = 'hello';
  m.caret = 4;
  // Click at col 5 → offset 4, which equals caret 4.
  const delta = m.handleClick(1, 5);
  eq(delta, 0);
});

it('buildArrowKeys produces Right × N for forward moves', () => {
  const m = makeMouse();
  m.buffer = 'abc';
  // 1 → 2 is the middle character; to=3 would be End.
  eq(m.buildArrowKeys(1, 2), '\x1b[C');
});

it('buildArrowKeys produces Left × N for backward moves', () => {
  const m = makeMouse();
  m.buffer = 'abc';
  eq(m.buildArrowKeys(2, 1), '\x1b[D');
});

it('buildArrowKeys uses Home / End for absolute zero / length moves', () => {
  const m = makeMouse();
  m.buffer = 'abc';
  eq(m.buildArrowKeys(2, 0), '\x1b[H');
  eq(m.buildArrowKeys(0, 3), '\x1b[F');
});

it('trackInput accumulates characters and tracks caret', () => {
  const m = makeMouse();
  m.trackInput('a');
  m.trackInput('b');
  m.trackInput('c');
  eq(m.buffer, 'abc');
  eq(m.caret, 3);
});

it('trackInput handles Backspace', () => {
  const m = makeMouse();
  m.trackInput('ab');
  m.trackInput('\x7f');
  eq(m.buffer, 'a');
  eq(m.caret, 1);
});

it('trackInput handles Ctrl+U (clear line)', () => {
  const m = makeMouse();
  m.trackInput('hello world');
  m.trackInput('\x15');
  eq(m.buffer, '');
  eq(m.caret, 0);
});

it('trackInput handles Left arrow', () => {
  const m = makeMouse();
  m.trackInput('ab');
  m.trackInput('\x1b[D');
  eq(m.caret, 1);
});

it('trackInput handles Home / End', () => {
  const m = makeMouse();
  m.trackInput('hello');
  m.trackInput('\x1b[H');
  eq(m.caret, 0);
  m.trackInput('\x1b[F');
  eq(m.caret, 5);
});

it('setBuffer replaces the entire shadow', () => {
  const m = makeMouse();
  m.setBuffer('paste text');
  eq(m.buffer, 'paste text');
  eq(m.caret, 10);
  m.setBuffer('partial', 3);
  eq(m.buffer, 'partial');
  eq(m.caret, 3);
});

it('_offsetForVisual handles short first-row clicks', () => {
  const m = makeMouse({ promptStartRow: 1, promptWidth: 40 });
  m.buffer = 'hello world';
  eq(m._offsetForVisual(0, 5), 5);
});

it('_offsetForVisual clamps to buffer length on later rows', () => {
  const m = makeMouse({ promptStartRow: 1, promptWidth: 5 });
  m.buffer = 'abcdefghij';   // wraps after 5
  eq(m._offsetForVisual(1, 0), 5);
  eq(m._offsetForVisual(1, 4), 9);
  eq(m._offsetForVisual(2, 0), 10);
});

it('buildAbsoluteMove returns Home + Right × target', () => {
  const m = makeMouse();
  eq(m.buildAbsoluteMove(3), '\x1b[H\x1b[C\x1b[C\x1b[C');
});

it('setSize updates the wrap geometry', () => {
  const m = makeMouse({ cols: 80, rows: 24 });
  m.setSize(40, 12);
  eq(m.cols, 40);
  eq(m.promptWidth, 40);
});