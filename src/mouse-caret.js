'use strict';

/**
 * mouse-caret — track the user's prompt draft and reposition the caret
 * on mouse click via synthetic arrow-key injection.
 *
 * Cursor CLI ignores mouse events while the user types, but its fixed
 * ~6-line input area is painful for long prompts. We:
 *
 *   1. Maintain a *shadow buffer* of every character the user (or
 *      voice / clipboard / screenshot injection) typed, including
 *      edits and arrow-key movements.
 *
 *   2. Listen for SGR-encoded left-clicks (CSI M / CSI M with ;).
 *
 *   3. Translate (col, row) → caret offset inside the current draft
 *      using a soft-wrap-aware width helper, then send |delta| Left or
 *      Right keys into the PTY.
 *
 * The shadow is best-effort. If it drifts from what the CLI actually
 * rendered (e.g. a bracket-paste that we didn't see), the wrapper
 * detects desync on the next click and falls back to Home + N× Right.
 */

const KITTY_HALF_BLOCK_W = 1;     // approximate visual width for fallback math

class MouseCaret {
  constructor(opts = {}) {
    this.cols = opts.cols || 80;
    this.rows = opts.rows || 24;
    // The CLI draws the prompt area at the bottom. We track where it
    // starts (1-indexed row) and refresh on resize.
    this.promptStartRow = opts.promptStartRow || (this.rows - 6);
    this.promptWidth    = opts.promptWidth    || this.cols;
    this.wrapIndent     = opts.wrapIndent     || 0;

    // Shadow buffer (a JS string of every char we believe is in the draft)
    // and the caret offset within it.
    this.buffer = '';
    this.caret  = 0;

    // Pending injection: when a click resolves, we ask the wrapper to
    // write synthetic arrow keys into the PTY.
    this._onMove = opts.onMove || (() => {});
  }

  setSize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.promptWidth = cols;
    this.promptStartRow = Math.max(1, rows - 6);
  }

  /**
   * Feed every key the user (or any other injector) sent through.
   * Updates the shadow buffer to match what the CLI should be showing.
   */
  trackInput(key) {
    if (!key) return;
    // Special-case editing keys first so they don't fall through to the
    // printable branch (e.g. \x7f has charCode 127 which would otherwise
    // be inserted into the buffer).
    switch (key) {
      case '\x15': // Ctrl+U — clear line
        this.buffer = '';
        this.caret = 0;
        return;
      case '\x17': // Ctrl+W — word backspace
        this._wordBackspace();
        return;
      case '\x08': // Backspace
      case '\x7f':
        if (this.caret > 0) {
          this.buffer = this.buffer.slice(0, this.caret - 1) + this.buffer.slice(this.caret);
          this.caret -= 1;
        }
        return;
      case '\x01': // Ctrl+A → Home
        this.caret = 0;
        return;
      case '\x05': // Ctrl+E → End
        this.caret = this.buffer.length;
        return;
      case '\x1b[D': // Left
        if (this.caret > 0) this.caret -= 1;
        return;
      case '\x1b[C': // Right
        if (this.caret < this.buffer.length) this.caret += 1;
        return;
      case '\x1b[H': // Home
      case '\x1b[1~':
        this.caret = 0;
        return;
      case '\x1b[F': // End
      case '\x1b[4~':
        this.caret = this.buffer.length;
        return;
      case '\r':
      case '\n':
        // Submit — leave buffer as-is; wrapper clears on enter handling.
        return;
      case '\x1b':  // bare ESC — don't change anything
        return;
    }
    // Other CSI / mouse / Kitty sequences are not draft text.
    if (key.charCodeAt(0) === 0x1b) return;
    // Control bytes (except those handled above) are not draft text.
    if (key.length === 1 && key.charCodeAt(0) < 0x20) return;
    // Otherwise: printable ASCII / multi-byte chars (after sanitizeInjectedText).
    if (key.length >= 1) {
      this.buffer = this.buffer.slice(0, this.caret) + key + this.buffer.slice(this.caret);
      this.caret += key.length;
    }
  }

  _wordBackspace() {
    let i = this.caret;
    while (i > 0 && /\s/.test(this.buffer[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.buffer[i - 1])) i--;
    this.buffer = this.buffer.slice(0, i) + this.buffer.slice(this.caret);
    this.caret = i;
  }

  /**
   * Replace the entire shadow buffer (e.g. after a paste that we know
   * came from voice or clipboard). Caret moves to end.
   */
  setBuffer(text, caret = null) {
    this.buffer = String(text || '');
    this.caret = (caret == null) ? this.buffer.length : Math.min(Math.max(0, caret), this.buffer.length);
  }

  /**
   * Parse an SGR-encoded mouse event from the PTY stream.
   * Returns { kind, row, col } or null.
   *
   * SGR format:  CSI < button ; col ; row M | m
   *   press   → ends in M
   *   release → ends in m
   *   wheel / drag codes have button bits set.
   *
   * We only care about left-press for now; hover / drag are ignored.
   */
  parseSgrMouseEvent(buf) {
    // Match ESC [ <button> ; <col> ; <row> M
    const m = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(buf);
    if (!m) return null;
    const button = parseInt(m[1], 10);
    const col    = parseInt(m[2], 10);
    const row    = parseInt(m[3], 10);
    const release = m[4] === 'm';

    // Button bitmask (low bits):
    //   0 = left, 1 = middle, 2 = right, 3 = release
    // We accept left-press only.
    const baseBtn = button & 0x3;
    const pressed = !release && baseBtn === 0;
    if (!pressed) return { kind: 'ignored', row, col, button };
    return { kind: 'left-press', row, col, button };
  }

  /**
   * Handle a parsed left-press. Returns the number of synthetic arrow
   * keys the wrapper should inject (positive = Right, negative = Left,
   * 0 = no-op / fall back to absolute reposition).
   */
  handleClick(row, col) {
    // Ignore clicks outside the prompt area.
    if (row < this.promptStartRow) return 0;

    const offsetWithinRow = Math.max(0, col - 1 - this.wrapIndent);
    const rowIndex = row - this.promptStartRow;
    const targetCaret = this._offsetForVisual(rowIndex, offsetWithinRow);

    if (targetCaret === this.caret) return 0;
    const delta = targetCaret - this.caret;
    this.caret = targetCaret;
    this._onMove(delta, targetCaret);
    return delta;
  }

  /**
   * Convert (rowIndex, offsetWithinRow) — both 0-based within the prompt
   * area — into an offset into the buffer, assuming soft-wrap at
   * `this.promptWidth` columns.
   */
  _offsetForVisual(rowIndex, offsetInRow) {
    if (!this.buffer) return 0;
    const width = this.promptWidth;
    let cur = 0;
    let row = 0;
    while (cur < this.buffer.length) {
      if (row === rowIndex) {
        return Math.min(this.buffer.length, cur + offsetInRow);
      }
      const remaining = this.buffer.length - cur;
      const step = Math.min(width, remaining);
      cur += step;
      row += 1;
      if (step < width) {
        // Last line ends here; no more rows.
        return this.buffer.length;
      }
    }
    return this.buffer.length;
  }

  /**
   * Build the synthetic arrow-key sequence to move from `from` to `to`.
   * Public so tests / wrapper can call it directly.
   */
  buildArrowKeys(from, to) {
    if (to === from) return '';
    if (to === 0) return '\x1b[H';                          // Home
    if (to === this.buffer.length) return '\x1b[F';         // End
    const right = '\x1b[C';
    const left  = '\x1b[D';
    if (to > from) return right.repeat(to - from);
    return left.repeat(from - to);
  }

  /**
   * Absolute fallback when the shadow drifts past a threshold.
   * Returns Home + (to) × Right.
   */
  buildAbsoluteMove(to) {
    const right = '\x1b[C';
    return '\x1b[H' + right.repeat(Math.max(0, to));
  }
}

module.exports = MouseCaret;
module.exports.MouseCaret = MouseCaret;