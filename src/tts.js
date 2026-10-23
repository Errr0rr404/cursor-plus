'use strict';

/**
 * tts — speak agent responses with Piper (preferred) or the OS fallback.
 *
 * Piper is the default; if its binary isn't found we fall through to
 * `say` (macOS), SAPI (Windows) or `spd-say`/`espeak-ng` (Linux).
 *
 * Barge-in: if a new recording starts we stop the current utterance
 * via the optional `onBargeIn` callback the wrapper registers.
 */

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';

class TTS {
  constructor(config) {
    this.config = config || {};
    this._proc = null;
    this._player = null;
    this._cancel = null;
    this._spawn = spawn;
  }

  get isSpeaking() { return this._proc !== null || this._player !== null; }

  /** Speak `text`. Returns when the utterance ends or is cancelled. */
  speak(text) {
    if (!text) return Promise.resolve();
    this.stop();
    const engine = (this.config.engine || 'piper');
    if (engine === 'piper' && this._hasPiper()) return this._speakPiper(text);
    return this._speakOs(text);
  }

  stop() {
    const finish = this._cancel;
    this._cancel = null;
    const proc = this._proc;
    const player = this._player;
    this._proc = null;
    this._player = null;
    try { if (player) player.kill('SIGTERM'); } catch {}
    try { if (proc) proc.kill('SIGTERM'); } catch {}
    if (finish) finish();
  }

  _hasPiper() {
    return !!(this.config.voice && this.config.voice.length > 0 && fs.existsSync(this.config.voice));
  }

  _ignoreStreamError(stream) {
    if (stream && typeof stream.on === 'function') stream.on('error', () => {});
  }

  _owned(proc) {
    return this._proc === proc;
  }

  _speakPiper(text) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this._cancel === finish) this._cancel = null;
        resolve();
      };
      this._cancel = finish;

      const piper = this._spawn('piper', ['--model', this.config.voice, '--output-raw'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      this._proc = piper;
      this._player = null;
      this._ignoreStreamError(piper.stdin);
      this._ignoreStreamError(piper.stdout);

      const handOff = () => {
        if (!this._owned(piper)) return;
        this._proc = null;
        const player = this._player;
        this._player = null;
        try { if (player) player.kill('SIGTERM'); } catch {}
        try { piper.kill('SIGTERM'); } catch {}
        this._speakOs(text).then(finish, finish);
      };

      piper.on('error', () => {
        if (!this._owned(piper)) return;
        handOff();
      });
      // Leave `_proc` pointing at piper until the player exits, so a late
      // piper exit cannot clear a newer utterance's handle.
      piper.on('exit', () => {});

      try {
        piper.stdin.write(String(text));
        piper.stdin.end();
      } catch {}

      const playArgs = ['-q', '-t', 'raw', '-r', '22050', '-e', 's', '-b', '16', '-c', '1', '-'];
      const aplayArgs = ['-q', '-t', 'raw', '-f', 'S16_LE', '-r', '22050', '-c', '1', '-'];
      const startPlayer = (cmd, args, onMissing) => {
        if (!this._owned(piper)) return;
        const player = this._spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        this._player = player;
        this._ignoreStreamError(player.stdin);
        try { piper.stdout.pipe(player.stdin); } catch {}
        player.on('error', () => {
          if (this._player === player) this._player = null;
          try { piper.stdout.unpipe(player.stdin); } catch {}
          if (!this._owned(piper)) return;
          onMissing();
        });
        player.on('exit', () => {
          // A failed `play` also exits. Only the player we still own ends speech.
          if (this._player !== player) return;
          this._player = null;
          if (this._proc === piper) this._proc = null;
          finish();
        });
      };

      startPlayer('play', playArgs, () => {
        startPlayer('aplay', aplayArgs, () => handOff());
      });
    });
  }

  _speakOs(text) {
    return new Promise((resolve) => {
      const done = () => {
        if (this._cancel === done) this._cancel = null;
        resolve();
      };
      this._cancel = done;

      if (IS_MAC) {
        // `--` so a reply that starts with "-" is spoken, not parsed as a flag.
        const proc = this._spawn('say', ['-r', String(this._rateWpm() || 200), '--', String(text)], { stdio: 'ignore' });
        this._proc = proc;
        proc.on('exit', () => { if (this._proc !== proc) return; this._proc = null; done(); });
        proc.on('error', () => { if (this._proc !== proc) return; this._proc = null; done(); });
        return;
      }
      if (IS_WIN) {
        // Feed speech text on stdin — never interpolate into -Command.
        const psCmd =
          "Add-Type -AssemblyName System.Speech; " +
          "$sp = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
          `$sp.Rate = ${this._rateOffset()}; ` +
          "$t = [Console]::In.ReadToEnd(); $sp.Speak($t); $sp.Dispose()";
        const proc = this._spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        this._proc = proc;
        this._ignoreStreamError(proc.stdin);
        try { proc.stdin.write(String(text)); proc.stdin.end(); } catch {}
        proc.on('exit', () => { if (this._proc !== proc) return; this._proc = null; done(); });
        proc.on('error', () => { if (this._proc !== proc) return; this._proc = null; done(); });
        return;
      }
      // Linux — try spd-say, then espeak-ng, then espeak
      this._tryLinuxChain(this._linuxCommands(text), 0, done);
    });
  }

  _linuxCommands(text) {
    const rate = String(this._rateWpm() || 175);
    return [
      ['spd-say', ['-w', '--', text]],
      ['espeak-ng', ['-s', rate, '--', text]],
      ['espeak', ['-s', rate, '--', text]],
    ];
  }

  _tryLinuxChain(cmds, idx, resolve) {
    if (idx >= cmds.length) {
      this._proc = null;
      if (this._cancel === resolve) this._cancel = null;
      resolve();
      return;
    }
    const [cmd, args] = cmds[idx];
    const proc = this._spawn(cmd, args, { stdio: 'ignore' });
    this._proc = proc;
    const next = () => {
      // stop() or a newer speak() already replaced this process. A killed
      // spd-say exits non-zero; chaining here would replay the same line.
      if (this._proc !== proc) return;
      this._tryLinuxChain(cmds, idx + 1, resolve);
    };
    proc.on('error', next);
    proc.on('exit', code => {
      if (this._proc !== proc) return;
      if (code === 0) {
        this._proc = null;
        if (this._cancel === resolve) this._cancel = null;
        resolve();
      } else {
        next();
      }
    });
  }

  _rateWpm() {
    const rate = this.config.rate;
    if (typeof rate === 'number') return Math.round(200 * rate);
    return 200;
  }

  _rateOffset() {
    const rate = this.config.rate;
    if (typeof rate === 'number') return Math.round((rate - 1) * 5);   // SAPI Rate -10..10
    return 0;
  }

  /** Strip code fences / ANSI before speaking. */
  static summarize(text, maxLen = 600) {
    if (!text) return '';
    let clean = String(text)
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')     // ANSI
      .replace(/```[\s\S]*?```/g, ' ')            // fenced code
      .replace(/`[^`]*`/g, ' ')                   // inline code
      .replace(/^#{1,6}\s+/gm, '')                // markdown headers
      .replace(/[*_~]+/g, '');                    // emphasis markers
    clean = clean.replace(/\s+/g, ' ').trim();
    if (clean.length > maxLen) clean = clean.slice(0, maxLen - 1) + '…';
    return clean;
  }
}

module.exports = TTS;
module.exports.TTS = TTS;
module.exports.summarize = TTS.summarize;