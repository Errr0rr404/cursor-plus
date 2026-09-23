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
  }

  get isSpeaking() { return this._proc !== null; }

  /** Speak `text`. Returns when the utterance ends or is cancelled. */
  speak(text) {
    if (!text) return Promise.resolve();
    this.stop();
    const engine = (this.config.engine || 'piper');
    if (engine === 'piper' && this._hasPiper()) return this._speakPiper(text);
    return this._speakOs(text);
  }

  stop() {
    if (!this._proc) return;
    try { this._proc.kill('SIGTERM'); } catch {}
    this._proc = null;
  }

  _hasPiper() {
    return !!(this.config.voice && this.config.voice.length > 0 && fs.existsSync(this.config.voice));
  }

  _speakPiper(text) {
    return new Promise((resolve) => {
      const args = ['--model', this.config.voice, '--output-raw'];
      const piper = spawn('piper', args, { stdio: ['pipe', 'pipe', 'ignore'] });
      const aplay = spawn('play', ['-q', '-t', 'raw', '-r', '22050', '-e', 's', '-b', '16', '-c', '1', '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
      this._proc = piper;
      piper.stdout.pipe(aplay.stdin);
      piper.stdin.write(text);
      piper.stdin.end();
      const done = () => { this._proc = null; resolve(); };
      aplay.on('exit', done);
      piper.on('exit', () => { try { aplay.kill(); } catch {} });
      piper.on('error', () => this._speakOs(text).then(resolve));
    });
  }

  _speakOs(text) {
    return new Promise((resolve) => {
      if (IS_MAC) {
        const proc = spawn('say', ['-r', String(this._rateWpm() || 200), text], { stdio: 'ignore' });
        this._proc = proc;
        proc.on('exit', () => { this._proc = null; resolve(); });
        proc.on('error', () => { this._proc = null; resolve(); });
        return;
      }
      if (IS_WIN) {
        const psCmd = `Add-Type -AssemblyName System.Speech; ` +
          `$sp = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
          `$sp.Rate = ${this._rateOffset()}; ` +
          `$sp.Speak('${text.replace(/'/g, "''")}'); ` +
          `$sp.Dispose()`;
        const proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
        this._proc = proc;
        proc.on('exit', () => { this._proc = null; resolve(); });
        proc.on('error', () => { this._proc = null; resolve(); });
        return;
      }
      // Linux — try spd-say, then espeak-ng, then espeak
      const cmds = [
        ['spd-say', ['-w', text]],
        ['espeak-ng', ['-s', String(this._rateWpm() || 175), text]],
        ['espeak',    ['-s', String(this._rateWpm() || 175), text]],
      ];
      this._tryLinuxChain(cmds, 0, resolve);
    });
  }

  _tryLinuxChain(cmds, idx, resolve) {
    if (idx >= cmds.length) { resolve(); return; }
    const [cmd, args] = cmds[idx];
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    this._proc = proc;
    proc.on('error', () => this._tryLinuxChain(cmds, idx + 1, resolve));
    proc.on('exit', code => {
      if (code === 0) { this._proc = null; resolve(); }
      else this._tryLinuxChain(cmds, idx + 1, resolve);
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