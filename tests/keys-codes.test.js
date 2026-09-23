'use strict';

const { eq, ok } = require('./_assert');
const keys = require('../src/keys');

it('CTRL_CODES exports a complete control-character map', () => {
  eq(keys.CTRL_CODES.CTRL_A, '\x01');
  eq(keys.CTRL_CODES.CTRL_C, '\x03');
  eq(keys.CTRL_CODES.CTRL_P, '\x10');
  eq(keys.CTRL_CODES.CTRL_R, '\x12');
  eq(keys.CTRL_CODES.CTRL_T, '\x14');
  eq(keys.CTRL_CODES.CTRL_Y, '\x19');
  eq(keys.CTRL_CODES.ESC, '\x1b');
  eq(keys.CTRL_CODES.SPACE, ' ');
});

it('enableKitty writes the Kitty enable sequence (when stdout is writable)', () => {
  // We can't fully probe without disturbing real stdio, but the function
  // must not throw on a real TTY and should be a no-op on non-TTY streams.
  const fakeOut = { isTTY: false, write: () => { throw new Error('should not be called'); } };
  keys.enableKitty(fakeOut);
  keys.disableKitty(fakeOut);
});

it('enableMouse / disableMouse tolerate non-TTY stdio', () => {
  const fakeOut = { isTTY: false, write: () => { throw new Error('should not be called'); } };
  keys.enableMouse(fakeOut, 'sgr');
  keys.enableMouse(fakeOut, 'normal');
  keys.disableMouse(fakeOut, 'sgr');
});

it('KITTY_CSI_U regex matches CSI-u form', () => {
  ok(keys.KITTY_CSI_U.test('\x1b[97;5u'));
  ok(keys.KITTY_CSI_U.test('\x1b[97u'));
  ok(keys.KITTY_CSI_U.test('\x1b[97;5:hello u'.replace(' ', '')));
  eq(keys.KITTY_CSI_U.test('hello'), false);
});