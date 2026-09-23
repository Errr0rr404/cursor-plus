'use strict';

/**
 * keys — terminal capability detection + key event parsing.
 *
 * The Cursor CLI is text/keyboard first, so a lot of cursor-plus's UX
 * hinges on terminals that support richer protocols. We only sniff —
 * we don't try to reimplement the protocol from scratch.
 *
 *  - Kitty keyboard protocol (CSI u): enables true key-up events, which
 *    lets us implement hold-to-talk without a fallback toggle. Detect
 *    by writing the Kitty enable sequence and waiting for the DA1 reply.
 *
 *  - Mouse reporting (SGR 1006 + 1000): lets us click in the type bar
 *    to move the caret. Detect by writing the enable sequence and
 *    checking for the matching reply (or just trust the user's config).
 *
 * The cursor-plus wrapper tries to enable both on launch and disables
 * them on exit so we don't leave the terminal in a weird state if the
 * user Ctrl+C's out.
 */

// ── Kitty keyboard protocol ─────────────────────────────────────────────────

/**
 * Detect whether the parent terminal supports the Kitty keyboard protocol.
 * Returns true / false. Timeout-safe: never blocks longer than `timeoutMs`.
 *
 * We write the Kitty query (`\x1b[?u`) and a primary-DA request (`\x1b[c`),
 * then watch stdin for up to `timeoutMs` looking for the Kitty reply
 * `\x1b[?<flags>u`. We deliberately don't short-circuit on the DEC DA1
 * reply alone — a Kitty-speaking terminal can legitimately send BOTH
 * (DA1 first, Kitty reply second), and we don't want to mis-detect.
 */
async function detectKitty(stdin, stdout, timeoutMs = 250) {
  return new Promise(resolve => {
    if (!stdin || !stdout || !stdin.isTTY) return resolve(false);

    let buffer = '';
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      try { stdin.removeListener('data', onData); } catch {}
      clearTimeout(timer);
      resolve(val);
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      // Kitty reply: CSI ? <flags> u  (e.g. \x1b[?<digit>u or \x1b[?<flags>u).
      // Match "u" as the terminator so we don't false-match on DA1.
      if (/\x1b\[\?[0-9;]+u/.test(buffer)) {
        finish(true);
        return;
      }
      // Don't conclude false on a DA1 reply alone — wait for the timer
      // so a late Kitty reply still wins.
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    stdin.on('data', onData);
    try {
      stdin.pause();
      stdin.resume();
      stdout.write('\x1b[?u\x1b[c');
    } catch {
      finish(false);
    }
  });
}

/**
 * Best-effort enable of the Kitty keyboard protocol.
 * Sends push + flags: report all keys as escape codes, report key-up,
 * report associated text, report alternate keys.
 */
function enableKitty(stdout) {
  if (!stdout || !stdout.isTTY) return;
  try { stdout.write('\x1b[>1u'); } catch {}
  // Flag 1: report event types
  // Flag 2: report key-up
  // Flag 4: report associated text
  // Flag 8: report alternate keys
  try { stdout.write('\x1b[=15u'); } catch {}
}

function disableKitty(stdout) {
  if (!stdout || !stdout.isTTY) return;
  try { stdout.write('\x1b[<u'); } catch {}
}

// ── Mouse reporting (SGR) ───────────────────────────────────────────────────

/**
 * Enable SGR (1006) + button-event tracking (1000) on the parent terminal.
 * Cursor CLI itself ignores mouse events while the user is typing, so
 * this is a safe overlay as long as we disable on exit.
 */
function enableMouse(stdout, mode = 'sgr') {
  if (!stdout || !stdout.isTTY) return;
  try {
    if (mode === 'sgr') {
      stdout.write('\x1b[?1006h'); // SGR encoding
    }
    stdout.write('\x1b[?1000h');   // button-event tracking
  } catch {}
}

/**
 * Disable all mouse reporting. Called on wrapper exit so the terminal
 * isn't left in "all mouse events captured" mode.
 */
function disableMouse(stdout, mode = 'sgr') {
  if (!stdout || !stdout.isTTY) return;
  try {
    stdout.write('\x1b[?1000l');
    stdout.write('\x1b[?1002l');
    stdout.write('\x1b[?1003l');
    if (mode === 'sgr') stdout.write('\x1b[?1006l');
  } catch {}
}

// ── Key parsing helpers ─────────────────────────────────────────────────────

// Single-byte control codes for the special keys cursor-plus intercepts.
// We never send these to the child unless we're passing them through
// intentionally (e.g. Ctrl+C when not recording).
const CTRL_CODES = {
  NUL: '\x00',
  CTRL_A: '\x01', CTRL_B: '\x02', CTRL_C: '\x03', CTRL_D: '\x04',
  CTRL_E: '\x05', CTRL_F: '\x06', CTRL_G: '\x07', CTRL_H: '\x08',
  TAB:   '\x09', CTRL_J: '\x0a', CTRL_K: '\x0b', CTRL_L: '\x0c',
  CR:    '\x0d', CTRL_N: '\x0e', CTRL_O: '\x0f', CTRL_P: '\x10',
  CTRL_Q: '\x11', CTRL_R: '\x12', CTRL_S: '\x13', CTRL_T: '\x14',
  CTRL_U: '\x15', CTRL_V: '\x16', CTRL_W: '\x17', CTRL_X: '\x18',
  CTRL_Y: '\x19', CTRL_Z: '\x1a', ESC: '\x1b',
  FS:    '\x1c', GS:    '\x1d', RS:    '\x1e', US:    '\x1f',
  SPACE: ' ',
};

// Map our named hotkeys to byte sequences.
// IMPORTANT: never map voice → Ctrl+R. Cursor CLI uses Ctrl+R for review.
const HOTKEYS = {
  voiceToggle: '\x00',            // Ctrl+Space (xterm NUL) — see isCtrlSpace()
  tts:       CTRL_CODES.CTRL_T,
  screenshot:CTRL_CODES.CTRL_P,
  clipboard: CTRL_CODES.CTRL_Y,
  editor:    CTRL_CODES.CTRL_G,   // Cursor's $EDITOR escape hatch — passthrough
  stash:     CTRL_CODES.CTRL_S,
  file:      CTRL_CODES.CTRL_O,
  cheatsheet:'?',
  esc:      CTRL_CODES.ESC,
};

/**
 * Match an "Ctrl+Space" key press. Terminals encode this inconsistently:
 *  - some emit \x00 (NUL)
 *  - some emit \x1f
 *  - some emit the Kitty CSI-u form: \x1b[32;5u (space + ctrl)
 * The Kitty form carries the base key (space=32) plus modifier 5 (Ctrl).
 */
function isCtrlSpace(key) {
  if (!key) return false;
  if (key === '\x00') return true;                // xterm
  if (key === '\x1f') return true;                // rxvt
  if (/\x1b\[32;5u/.test(key)) return true;       // Kitty CSI-u
  if (/\x1b\[32;5;u/.test(key)) return true;      // Kitty with sub-form
  return false;
}

/**
 * True when the terminal emitted a Kitty CSI-u *release* event for Space.
 * Format: \x1b[<key>;1u (default) or \x1b[<key>;1:<text>u.
 *
 * The Kitty protocol encodes release as the absence of the "press" type
 * bit (1) — see https://sw.kovidgoyal.net/kitty/keyboard-protocol/.
 * We match both press (with all subforms) and release.
 */
// CSI unicode ; modifiers[:event-type] u  — optional alternate-key colons after codepoint.
const KITTY_CSI_U = /^\x1b\[(\d+)(?::[^;]*)?(?:;([^u]*))?u$/;

/**
 * Try to parse a Kitty CSI-u encoded key event. Returns:
 *   { kind: 'press' | 'release' | 'repeat', codepoint, modifiers, text? }
 * or null if `key` doesn't look like CSI-u.
 *
 * Kitty has two ways to encode the event type:
 *
 *   (1) Progressive enhancement:  CSI <key>;<mod>:event-type u
 *       event-type: 1=press (default if absent), 2=repeat, 3=release
 *
 *   (2) Legacy bit in modifiers field:
 *       bit 4 (value 16) in (modsRaw-1) → release
 *       bit 5 (value 32) in (modsRaw-1) → repeat
 *
 * Some terminals only emit the legacy form. We honour both.
 * See https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */
function parseKittyCsiU(key) {
  const m = KITTY_CSI_U.exec(key);
  if (!m) return null;
  const codepoint = parseInt(m[1], 10);
  const modsField = m[2] != null ? m[2] : '1';
  const [modsRawStr, eventRawStr] = modsField.split(':');
  const modsRaw = parseInt(modsRawStr || '1', 10);
  const modifierBits = Math.max(0, modsRaw - 1);
  // Strip event-type bits from the modifier bitmask (shift/alt/ctrl/super = 0-8).
  const modifiers = modifierBits & 0x0F;
  const eventType = eventRawStr != null ? parseInt(eventRawStr, 10) : 1;
  let kind = 'press';
  // (1) progressive enhancement sub-field wins when present
  if (eventRawStr != null) {
    if (eventType === 3) kind = 'release';
    else if (eventType === 2) kind = 'repeat';
  } else if (modifierBits & 0x10) {
    // (2) legacy release bit
    kind = 'release';
  } else if (modifierBits & 0x20) {
    // (2) legacy repeat bit
    kind = 'repeat';
  }
  return { kind, codepoint, modifiers, text: null };
}

/**
 * Returns true if `key` represents a Space *press* event, regardless of
 * how the terminal encoded it. Used for the hold-to-talk path.
 * Plain ASCII space counts as press; Kitty release events do not.
 */
function isSpacePress(key) {
  if (key === ' ') return true;
  const parsed = parseKittyCsiU(key);
  // Only unmodified Space — Ctrl+Space is handled separately via isCtrlSpace.
  if (parsed && parsed.kind === 'press' && parsed.codepoint === 32 && parsed.modifiers === 0) {
    return true;
  }
  return false;
}

/**
 * Returns true if `key` represents a Space *release* event.
 */
function isSpaceRelease(key) {
  const parsed = parseKittyCsiU(key);
  return !!(parsed && parsed.kind === 'release' && parsed.codepoint === 32);
}

/**
 * Convenience: detect whether a chunk looks like the start of a CSI
 * sequence (ESC + `[` or ESC + `O`). The wrapper uses this to decide
 * whether to forward input byte-by-byte or buffer until terminator.
 */
function startsWithCsi(buf) {
  return buf.length >= 2 && buf[0] === '\x1b' && (buf[1] === '[' || buf[1] === 'O');
}

/**
 * Strip a final byte off an ANSI / CSI escape sequence terminator.
 * Most cursor+ hotkeys are single-byte, but if the user is running
 * in a Kitty-protocol-aware terminal we may see longer keys.
 */
function matchesHotkey(key, name) {
  const target = HOTKEYS[name];
  if (!target) return false;
  return key === target;
}

module.exports = {
  detectKitty, enableKitty, disableKitty,
  enableMouse, disableMouse,
  CTRL_CODES, HOTKEYS,
  isCtrlSpace, isSpacePress, isSpaceRelease,
  parseKittyCsiU, startsWithCsi,
  matchesHotkey, KITTY_CSI_U,
};