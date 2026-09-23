'use strict';

/**
 * wrapper — the main PTY wrapper. Spawns `cursor-agent` in a node-pty
 * session and overlays voice, click-to-caret, TTS, screenshots, queue,
 * stash, notifications, and the cheatsheet on top.
 *
 * Architecture mirrors copilot-plus but tuned for Cursor's CLI:
 *   - hold-Space voice (Kitty protocol required; Ctrl+Space fallback)
 *   - SGR mouse click → caret reposition via shadow buffer
 *   - Ctrl+T TTS, Ctrl+P screenshot, Ctrl+Y clipboard, Ctrl+S stash,
 *     Ctrl+B bookmark last response
 *   - Ctrl+R is NEVER stolen (Cursor uses it for code review)
 *   - Ctrl+G is never stolen either (Cursor opens draft in $EDITOR)
 */

const pty = require('node-pty');
const os  = require('os');
const path = require('path');

const config   = require('./config');
const theme    = require('./theme');
const logger   = require('./logger');
const keys     = require('./keys');
const MouseCaret = require('./mouse-caret');
const VoiceRecorder = require('./voice');
const TTS      = require('./tts');
const CheatSheet = require('./cheatsheet');
const screenshot = require('./screenshot');
const clipboard  = require('./clipboard');
const safety   = require('./safety');
const promptStash = require('./prompt-stash');
const { PromptQueue } = require('./prompt-queue');
const notifyRules = require('./notify-rules');
const history  = require('./history');
const bookmarks = require('./bookmarks');
const { sanitizeInjectedText, formatAtPath } = require('./text-inject');
const { resolveCursorAgent } = require('./resolve-binary');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';

const VERSION = require('../package.json').version;

// Hotkey constants
const CTRL_CODES = keys.CTRL_CODES;
const CTRL_P = CTRL_CODES.CTRL_P;
const CTRL_Y = CTRL_CODES.CTRL_Y;
const CTRL_T = CTRL_CODES.CTRL_T;
const CTRL_S = CTRL_CODES.CTRL_S;
const CTRL_B = CTRL_CODES.CTRL_B;
const CTRL_G = CTRL_CODES.CTRL_G;
const CTRL_U = CTRL_CODES.CTRL_U;
const CTRL_C = CTRL_CODES.CTRL_C;
const CTRL_SLASH = '\x1f';
const QUESTION = '?';

const SETTLE_MS = 800;
const RESPONSE_BUF_MAX = 16_384;

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[mA-Za-z]/g, '').replace(/\x1b[()][AB012]/g, '');
}

class CursorPlusWrapper {
  constructor(args, cfg) {
    this.args = args;
    this.cfg = cfg;
    theme.set(cfg.theme || 'auto');

    this.voice = new VoiceRecorder(cfg.voice || {});
    this.tts   = new TTS(cfg.tts || {});
    this.cheatsheet = new CheatSheet();
    this.mouse = new MouseCaret({
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      onMove: (delta) => { this._onCaretMove(delta); },
    });

    const qcfg = cfg.queue || {};
    this.promptQueue = new PromptQueue({ maxSize: qcfg.maxSize || 20 });

    this._shell = null;
    this._pid = process.pid;

    this._ttsOn = !!(cfg.tts && cfg.tts.enabled);
    this._inputBuf = '';
    this._inputCursor = 0;
    this._responseBuf = '';
    this._responseSettleTimer = null;
    this._lastResponse = '';
    this._awaitingResponse = false;
    this._awaitingSince = 0;
    this._lastOutputAt = 0;
    this._onStdin = null;
    this._ttsQueue = Promise.resolve();

    // Hold-Space state
    this._spacePressed = false;
    this._holdSpaceSupported = false;
    this._holdSpaceTimer = null;
    this._holdSpaceArmed = false; // true once hold threshold elapsed & recording started
    this._holdSpaceMs = (cfg.voice && Number.isFinite(cfg.voice.holdSpaceMs))
      ? cfg.voice.holdSpaceMs
      : 180;

    // Input CSI assembly (Kitty CSI-u + SGR mouse can arrive split across reads)
    this._csiBuf = '';

    // Notifications cooldown (session_idle / waiting_input / …)
    const notifyCfg = cfg.notifications || {};
    this._notifyCooldown = notifyRules.createCooldown(notifyCfg.cooldownMs || 90_000);
  }

  async start() {
    const resolved = await resolveCursorAgent().catch((err) => {
      console.error(`\x1b[31m[error]\x1b[0m ${err.message}`);
      process.exit(2);
    });
    logger.info(`spawning cursor-agent: ${resolved.bin} (source=${resolved.source})`);

    const shell = pty.spawn(resolved.bin, this.args, {
      name: process.env.TERM || 'xterm-256color',
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: process.env,
    });
    this._shell = shell;

    shell.onData(data => this._handlePtyOutput(data));
    shell.onExit(({ exitCode }) => {
      try { this._cleanup(); } catch {}
      process.exit(exitCode == null ? 0 : exitCode);
    });

    process.stdout.on('resize', () => {
      this.mouse.setSize(process.stdout.columns || 80, process.stdout.rows || 24);
      try { shell.resize(process.stdout.columns, process.stdout.rows); } catch {}
    });

    // Disable Win32 Input Mode (sends keys as CSI sequences and breaks raw input)
    if (IS_WIN && process.stdout.isTTY) process.stdout.write('\x1b[?9001l');

    // Enable mouse reporting (always — terminal degrades gracefully)
    if (this.cfg.mouse && this.cfg.mouse.enabled !== false && this.cfg.mouse.reportMode !== 'off') {
      keys.enableMouse(process.stdout, this.cfg.mouse.reportMode || 'sgr');
    }

    // Enable Kitty keyboard protocol only when the terminal actually speaks it.
    // Enabling blindly leaves non-Kitty terminals in a broken input mode.
    const wantKitty = (this.cfg.keys && this.cfg.keys.kitty !== 'off');
    if (wantKitty) {
      const ok = await keys.detectKitty(process.stdin, process.stdout).catch(() => false);
      this._holdSpaceSupported = ok;
      if (ok) {
        keys.enableKitty(process.stdout);
        try { process.stdin.removeAllListeners('data'); } catch {}
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(true);
        }
      }
    }

    process.stdin.resume();
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
      process.on('exit', () => {
        try { process.stdin.setRawMode(false); } catch {}
        try { keys.disableKitty(process.stdout); } catch {}
        try { keys.disableMouse(process.stdout); } catch {}
      });
      this._onStdin = data => this._handleInput(data);
      process.stdin.on('data', this._onStdin);
    } else {
      process.stdin.on('data', data => shell.write(data.toString()));
    }

    process.on('SIGTERM', () => process.exit(0));

    // Friendly first-screen hint nudging discoverability.
    setTimeout(() => {
      if (!this.voice.isRecording && !this.cheatsheet.isOpen) {
        process.stderr.write(
          `\x1b[2m  cursor+ ready · press ? for help, Hold Space to dictate (Ctrl+Space fallback)\x1b[0m\n`
        );
      }
    }, 500);
  }

  _cleanup() {
    try { keys.disableKitty(process.stdout); } catch {}
    try { keys.disableMouse(process.stdout); } catch {}
    try { this.voice.cancel(); } catch {}
    try { this.tts.stop(); } catch {}
  }

  // ── Output handling ──────────────────────────────────────────────────────

  _handlePtyOutput(data) {
    const s = typeof data === 'string' ? data : data.toString();
    if (!this.cheatsheet.isOpen) process.stdout.write(s);

    // Mouse events arrive on stdin (not PTY output) — do not parse here.

    const plain = stripAnsi(s);
    this._responseBuf = (this._responseBuf + plain).slice(-RESPONSE_BUF_MAX);
    this._lastOutputAt = Date.now();
    this._waitingNotified = false;

    // Once output goes quiet, settle the response and trigger notifications.
    clearTimeout(this._responseSettleTimer);
    this._responseSettleTimer = setTimeout(() => {
      const settled = this._responseBuf.trim();
      if (settled && settled !== this._lastResponse) {
        this._lastResponse = settled;
        if (this._ttsOn) {
          this._ttsQueue = this._ttsQueue.then(() =>
            this.tts.speak(TTS.summarize(settled)).catch(() => {})
          );
        }
      }
      if (this._awaitingResponse) {
        this._awaitingResponse = false;
        this._waitingNotified = false;
        const rule = notifyRules.matchRule((this.cfg.notifications || {}).rules, 'session_idle');
        if (rule && this._notifyCooldown('session_idle') && !(this.cfg.notifications || {}).quiet) {
          notifyRules.fire(rule, {
            title: 'cursor+ idle',
            body: 'Response ready',
            webhookUrl: (this.cfg.notifications || {}).webhookUrl,
          });
        }
        this._flushQueueNext();
      }
    }, SETTLE_MS);
  }

  // ── Mouse / click ────────────────────────────────────────────────────────

  _handleClick(col, row) {
    const from = this.mouse.caret;
    const delta = this.mouse.handleClick(row, col);
    if (delta === 0) return;
    const arrows = this.mouse.buildArrowKeys(from, this.mouse.caret);
    if (arrows) this._shell.write(arrows);
  }

  _onCaretMove(/* delta, targetCaret */) {
    // Hook for future hook points (bookmarks, history, plugins).
  }

  // ── Input handling ───────────────────────────────────────────────────────

  _handleInput(data) {
    const chunk = data.toString();
    // Assemble split CSI sequences (Kitty CSI-u, SGR mouse) across reads.
    for (const key of this._assembleKeys(chunk)) {
      this._dispatchKey(key);
    }
  }

  /**
   * Yield complete key events from a raw stdin chunk. Incomplete CSI
   * sequences are buffered in `this._csiBuf` until a terminator arrives.
   */
  _assembleKeys(chunk) {
    const out = [];
    let i = 0;
    while (i < chunk.length) {
      if (this._csiBuf) {
        this._csiBuf += chunk[i];
        i++;
        if (this._csiComplete(this._csiBuf)) {
          out.push(this._csiBuf);
          this._csiBuf = '';
        } else if (this._csiBuf.length > 64) {
          // Garbage — flush as literal so we don't wedge the input path.
          out.push(this._csiBuf);
          this._csiBuf = '';
        }
        continue;
      }
      if (chunk[i] === '\x1b') {
        this._csiBuf = '\x1b';
        i++;
        continue;
      }
      out.push(chunk[i]);
      i++;
    }
    return out;
  }

  _csiComplete(buf) {
    if (buf.length < 2) return false;
    // SGR mouse: ESC [ < … M|m
    if (/^\x1b\[</.test(buf)) return /[Mm]$/.test(buf);
    // CSI / SS3 terminated by a final byte in @-~ (includes Kitty `u`)
    if (buf[1] === '[' || buf[1] === 'O') {
      return buf.length >= 3 && /[\x40-\x7e]$/.test(buf);
    }
    // ESC + single char (Alt-key) — treat as complete after 2 bytes
    return buf.length >= 2;
  }

  _dispatchKey(key) {
    // Cheatsheet overlay swallows all keys until closed.
    if (this.cheatsheet.isOpen) {
      this.cheatsheet.handleInput(key);
      return;
    }

    // SGR mouse events (stdin) — never forward into the agent.
    const mouseEv = this.mouse.parseSgrMouseEvent(key);
    if (mouseEv) {
      if (
        mouseEv.kind === 'left-press' &&
        this.cfg.mouse &&
        this.cfg.mouse.enabled !== false &&
        this.cfg.mouse.clickToCaret !== false
      ) {
        this._handleClick(mouseEv.col, mouseEv.row);
      }
      return;
    }

    // ── Voice toggle (Ctrl+Space) ───────────────────────────────────────
    if (keys.isCtrlSpace(key)) {
      this._toggleVoice();
      return;
    }

    // ── Hold-Space state machine (Kitty protocol) ──────────────────────
    // Short taps (< voice.holdSpaceMs) inject a normal space so typing still works.
    // Holding past the threshold starts recording; release stops + transcribes.
    if (this._holdSpaceSupported && this.cfg.voice && this.cfg.voice.holdSpace !== false) {
      if (keys.isSpacePress(key) && !keys.isCtrlSpace(key)) {
        if (this._spacePressed) return; // ignore repeat while held
        this._spacePressed = true;
        this._holdSpaceArmed = false;
        clearTimeout(this._holdSpaceTimer);
        this._holdSpaceTimer = setTimeout(() => {
          this._holdSpaceArmed = true;
          this._startVoice();
        }, this._holdSpaceMs);
        return;
      }
      if (keys.isSpaceRelease(key)) {
        clearTimeout(this._holdSpaceTimer);
        this._holdSpaceTimer = null;
        if (!this._spacePressed) return;
        this._spacePressed = false;
        if (this._holdSpaceArmed || this.voice.isRecording) {
          this._holdSpaceArmed = false;
          this._stopVoice();
        } else {
          // Tap — type a space instead of recording.
          this._forwardText(' ');
        }
        return;
      }
    }

    // ── TTS / screenshot / clipboard / stash / bookmark ────────────────────
    if (key === CTRL_T) { this._toggleTTS(); return; }
    if (key === CTRL_P) { this._doScreenshot(); return; }
    if (key === CTRL_Y) { this._pasteClipboard(); return; }
    if (key === CTRL_S) { this._stashPrompt(); return; }
    if (key === CTRL_B) { this._bookmarkLast(); return; }
    // Ctrl+R / Ctrl+G intentionally NOT intercepted — Cursor owns them.
    if (key === CTRL_C && this.voice.isRecording) {
      clearTimeout(this._holdSpaceTimer);
      this._spacePressed = false;
      this._holdSpaceArmed = false;
      this.voice.cancel();
      this._notify('🚫 Recording cancelled', '');
      return;
    }

    // ── Cheatsheet toggle ──────────────────────────────────────────────
    if (key === CTRL_SLASH || (key === QUESTION && this._inputBuf === '')) {
      this._openCheatSheet();
      return;
    }

    if (key === '\r' || key === '\n') {
      this._trackInputLine(key);
      this._handleEnter();
      return;
    }

    this._forwardText(key);
  }

  /** Track + write a normal key / injected chunk into the child PTY. */
  _forwardText(key) {
    this._trackInputLine(key);
    if (this.cfg.mouse && this.cfg.mouse.enabled !== false) {
      this.mouse.trackInput(key);
    }
    this._shell.write(key);
  }

  _trackInputLine(key) {
    if (!key) return;
    if (key === '\r' || key === '\n') {
      // Don't reset yet — _handleEnter decides.
      return;
    }
    if (key === CTRL_U) { this._inputBuf = ''; this._inputCursor = 0; return; }
    if (key === CTRL_C) { return; }
    if (key.length === 1 && key.charCodeAt(0) >= 0x20) {
      this._inputBuf = this._inputBuf.slice(0, this._inputCursor) + key + this._inputBuf.slice(this._inputCursor);
      this._inputCursor += key.length;
    }
  }

  _handleEnter() {
    const qcfg = this.cfg.queue || {};
    if (qcfg.whenBusy !== false && this._awaitingResponse) {
      const pending = this._inputBuf.trim();
      if (pending) {
        const res = this.promptQueue.enqueue(pending);
        this._shell.write('\x15');  // clear the line on screen
        this._inputBuf = '';
        this._inputCursor = 0;
        if (res.ok) this._notify('📥 Queued', `#${res.size} — will send when idle`);
        else this._notify('📥 Queue full', res.reason || '');
        return;
      }
    }
    // Normal submit — scan for secrets before forwarding.
    const text = this._inputBuf;
    if (text.trim() && this.cfg.safety && this.cfg.safety.enabled !== false) {
      const findings = safety.scan(text);
      if (findings.length && !this.cfg.safety.autoRedact) {
        const short = findings.slice(0, 3).map(f => f.kind).join(', ');
        this._notify('⚠️ Possible secrets', short);
        logger.warn(`safety findings on submit: ${short}`);
      }
    }
    if (text.trim()) {
      try {
        history.append({
          pid: this._pid,
          cwd: process.cwd(),
          prompt: text,
        });
      } catch {}
    }
    this._inputBuf = '';
    this._inputCursor = 0;
    this._awaitingResponse = true;
    this._awaitingSince = Date.now();
    if (this.cfg.mouse && this.cfg.mouse.enabled !== false) {
      this.mouse.setBuffer('');
    }
    this._shell.write('\r');
  }

  _flushQueueNext() {
    const next = this.promptQueue.dequeue();
    if (!next) return;
    const safe = sanitizeInjectedText(next);
    this._injectUserText(safe);
    // Send Enter on the next tick so the PTY paints the text first,
    // then run the safety / history / busy state through _handleEnter.
    setImmediate(() => this._handleEnter());
    this._notify('📤 Queue → prompt', safe.slice(0, 40) + (safe.length > 40 ? '…' : ''));
  }

  _injectUserText(text) {
    const safe = sanitizeInjectedText(text);
    if (!safe) return;
    this._shell.write(safe);
    this._inputBuf = (this._inputBuf || '') + safe.replace(/\r$/, '');
    this._inputCursor = this._inputBuf.length;
    if (this.cfg.mouse && this.cfg.mouse.enabled !== false) {
      // Prefer setBuffer so we don't re-parse injected chunks as keystrokes.
      this.mouse.setBuffer(this._inputBuf);
    }
  }

  // ── Voice ────────────────────────────────────────────────────────────────

  async _toggleVoice() {
    if (this.voice.isRecording) {
      await this._stopVoice();
    } else {
      this._startVoice();
    }
  }

  _startVoice() {
    if (this.voice.isRecording) return;
    try {
      this.voice.start();
      this._notify('🎙 Recording', 'Hold Space / Ctrl+Space to stop');
      // Barge-in: stop any in-flight TTS.
      try { this.tts.stop(); } catch {}
    } catch (err) {
      this._notify('🎙 Voice unavailable', logger.forUser(err));
      logger.error('voice start:', err);
    }
  }

  async _stopVoice() {
    if (!this.voice.isRecording) return;
    this._notify('🛑 Transcribing…', '');
    let text = '';
    try {
      text = await this.voice.stopAndTranscribe();
    } catch (err) {
      this._notify('🎙 Voice failed', logger.forUser(err));
      logger.error('voice stop:', err);
      return;
    }
    const clean = sanitizeInjectedText(text);
    if (!clean) {
      this._notify('🎙 No speech detected', '');
      return;
    }
    this._injectUserText(clean);
    this._notify('🎙 Heard', clean.length > 60 ? clean.slice(0, 57) + '…' : clean);
    if (this.cfg.voice && this.cfg.voice.autoSubmit) {
      // Send Enter on next tick so the PTY paints the text first.
      setTimeout(() => this._handleEnter(), 30);
    }
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  _bookmarkLast() {
    if (!this._lastResponse) {
      this._notify('🔖 Nothing to bookmark', 'no response yet');
      return;
    }
    try {
      const b = bookmarks.add({ body: this._lastResponse });
      this._notify('🔖 Bookmarked', b.title || '(untitled)');
    } catch (err) {
      this._notify('🔖 Bookmark failed', logger.forUser(err));
    }
  }

  // ── TTS ──────────────────────────────────────────────────────────────────

  _toggleTTS() {
    this._ttsOn = !this._ttsOn;
    this._notify(this._ttsOn ? '🔊 TTS on' : '🔇 TTS off',
                 this._ttsOn ? 'agent replies will be spoken' : 'silent');
    if (!this._ttsOn) this.tts.stop();
  }

  // ── Screenshot ───────────────────────────────────────────────────────────

  async _doScreenshot() {
    this._notify('📸 Capturing…', 'select a region');
    try {
      const file = await screenshot.captureRegion();
      this._injectUserText(formatAtPath(file));
      this._notify('📸 Screenshot attached', path.basename(file));
    } catch (err) {
      this._notify('📸 Screenshot failed', logger.forUser(err));
      logger.error('screenshot:', err);
    }
  }

  // ── Clipboard ────────────────────────────────────────────────────────────

  async _pasteClipboard() {
    try {
      let file;
      try {
        file = await clipboard.readImage();
      } catch {
        // No image — try text.
        const text = await clipboard.readText();
        if (!text) {
          this._notify('📋 Clipboard empty', '');
          return;
        }
        this._injectUserText(text);
        this._notify('📋 Pasted text', text.length > 60 ? text.slice(0, 57) + '…' : text);
        return;
      }
      this._injectUserText(formatAtPath(file));
      this._notify('📋 Pasted image', path.basename(file));
    } catch (err) {
      this._notify('📋 Clipboard failed', logger.forUser(err));
      logger.error('clipboard:', err);
    }
  }

  // ── Stash ────────────────────────────────────────────────────────────────

  _stashPrompt() {
    const text = this._inputBuf;
    if (!text) {
      this._notify('💾 Stash empty', 'nothing to save');
      return;
    }
    const saved = promptStash.saveDraft(text);
    this._notify('💾 Draft stashed', saved.label || new Date(saved.ts).toLocaleTimeString());
    this._shell.write('\x15');   // clear line on screen
    this._inputBuf = '';
    this._inputCursor = 0;
    if (this.cfg.mouse && this.cfg.mouse.enabled !== false) {
      this.mouse.setBuffer('');
    }
  }

  // ── Cheatsheet ───────────────────────────────────────────────────────────

  _openCheatSheet() {
    this.cheatsheet.open(this.cfg).catch(() => {});
  }

  // ── Notifications ────────────────────────────────────────────────────────

  _notify(title, body) {
    if (!this.cfg.notifications || this.cfg.notifications.quiet) {
      // Still log to stderr so the user sees it during interactive sessions.
      try { process.stderr.write(`\x1b[2m  [${title}] ${body}\x1b[0m\n`); } catch {}
      return;
    }
    const rule = notifyRules.matchRule(this.cfg.notifications.rules, 'session_idle') || { channels: ['os'] };
    notifyRules.fire(rule, {
      title, body,
      webhookUrl: this.cfg.notifications.webhookUrl,
    });
  }
}

module.exports = CursorPlusWrapper;
module.exports.CursorPlusWrapper = CursorPlusWrapper;
module.exports.VERSION = VERSION;