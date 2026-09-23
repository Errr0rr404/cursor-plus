'use strict';

/**
 * voice — record audio from the microphone and transcribe with whisper.cpp.
 *
 * Pipeline: ffmpeg → 16 kHz mono WAV → whisper-cli → text → caller.
 *
 * Two record modes:
 *   - start() / stopAndTranscribe()  →  manual start/stop (used for Ctrl+Space toggle)
 *   - startAutoStop()                →  ffmpeg silencedetect → automatic stop + transcribe
 *
 * Audio device id formats:
 *   - macOS:    ":N" (avfoundation index)
 *   - Windows:  device name string
 *   - Linux:    "pulse:<src>" or "alsa:<hw>"
 */

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

function _inputArgs(device) {
  if (IS_WIN) return ['-f', 'dshow', '-i', `audio=${device}`];
  if (IS_MAC) return ['-f', 'avfoundation', '-i', device];
  if (typeof device === 'string' && device.startsWith('alsa:')) {
    return ['-f', 'alsa', '-i', device.slice('alsa:'.length)];
  }
  const src = (typeof device === 'string' && device.startsWith('pulse:'))
    ? device.slice('pulse:'.length)
    : (device || 'default');
  return ['-f', 'pulse', '-i', src];
}

function _ignoreStdinErrors(proc) {
  if (proc && proc.stdin) proc.stdin.on('error', () => {});
}

function _forceKillFfmpeg(proc) {
  return new Promise(resolve => {
    if (!IS_WIN) {
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(resolve, 200);
      return;
    }
    const killer = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
    const done = () => { clearTimeout(fallback); resolve(); };
    const fallback = setTimeout(done, 2000);
    killer.once('exit', done);
    killer.once('error', done);
  });
}

function _waitForFfmpegStop(proc) {
  return new Promise(resolve => {
    try { proc.stdin.write('q'); proc.stdin.end(); } catch {}
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      _forceKillFfmpeg(proc).then(resolve);
    }, 3000);
    proc.once('exit', finish);
    proc.once('close', finish);
    proc.once('error', finish);
  });
}

class VoiceRecorder {
  constructor(config) {
    this.config = config || {};
    this._proc = null;
    this._audioFile = null;
  }

  get isRecording() { return this._proc !== null; }

  /**
   * Start recording from the microphone. Returns immediately.
   * Throws if no device is configured.
   */
  start() {
    if (this._proc) return;
    if (!this.config.audioDevice) {
      throw new Error('No audio device configured. Run: cursor+ --setup');
    }

    this._audioFile = path.join(os.tmpdir(), `cursor-plus-voice-${Date.now()}.wav`);
    const ffmpegArgs = [
      ..._inputArgs(this.config.audioDevice),
      '-ar', '16000', '-ac', '1', '-y', this._audioFile,
    ];
    this._proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
    _ignoreStdinErrors(this._proc);
    this._proc.on('error', () => { this._cleanup(); });
    this._proc.on('exit', () => { this._cleanup(); });
  }

  /**
   * Stop recording and transcribe. Returns the recognised text.
   */
  async stopAndTranscribe() {
    if (!this._proc) return '';
    const audioFile = this._audioFile;
    const proc = this._proc;
    this._proc = null;
    this._audioFile = null;

    if (proc.exitCode === null && proc.signalCode === null) {
      await _waitForFfmpegStop(proc);
    }

    if (!fs.existsSync(audioFile)) {
      throw new Error('Audio file was not created — is the microphone accessible?');
    }

    try {
      return await this._transcribe(audioFile);
    } finally {
      fs.unlink(audioFile, () => {});
    }
  }

  /**
   * Start recording and auto-stop on silence. Useful for "wake word +
   * auto submit" UX without explicit toggle keys.
   *
   * @returns {Promise<string>}
   */
  startAutoStop({ silenceDuration = 1.5, silenceThreshold = -35, maxSeconds = 30 } = {}) {
    if (this._proc) return Promise.reject(new Error('Already recording'));
    if (!this.config.audioDevice) {
      return Promise.reject(new Error('No audio device configured. Run: cursor+ --setup'));
    }
    this._audioFile = path.join(os.tmpdir(), `cursor-plus-voice-${Date.now()}.wav`);
    const audioFile = this._audioFile;

    const silenceFilter = `silencedetect=noise=${silenceThreshold}dB:duration=${silenceDuration}`;
    const ffmpegArgs = [
      ..._inputArgs(this.config.audioDevice),
      '-af', silenceFilter, '-t', String(maxSeconds),
      '-ar', '16000', '-ac', '1', '-y', audioFile,
    ];

    return new Promise((resolve, reject) => {
      let stderrBuf = '';
      const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
      this._proc = proc;
      _ignoreStdinErrors(proc);

      let qSent = false;
      proc.stderr.on('data', chunk => {
        stderrBuf += chunk.toString();
        if (qSent) return;
        const hasSilenceStart = stderrBuf.split('\n').some(l => {
          const m = l.match(/silence_start:\s*([\d.]+)/);
          return m && parseFloat(m[1]) > 0.5;
        });
        if (hasSilenceStart) {
          qSent = true;
          try { proc.stdin.write('q'); proc.stdin.end(); } catch {}
        }
      });

      proc.on('exit', () => {
        this._proc = null;
        this._audioFile = null;
        if (!fs.existsSync(audioFile)) {
          return reject(new Error('Audio file was not created — is the microphone accessible?'));
        }
        this._transcribe(audioFile).then(resolve).catch(reject)
          .finally(() => fs.unlink(audioFile, () => {}));
      });
      proc.on('error', err => {
        this._proc = null;
        this._audioFile = null;
        reject(err);
      });
    });
  }

  /** Cancel in-progress recording without transcribing. */
  cancel() {
    if (!this._proc) return;
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(this._proc.pid), '/f', '/t']);
    } else {
      try { this._proc.kill('SIGTERM'); } catch {}
    }
    this._cleanup();
  }

  _cleanup() {
    this._proc = null;
    if (this._audioFile) {
      fs.unlink(this._audioFile, () => {});
      this._audioFile = null;
    }
  }

  _transcribe(audioFile) {
    const modelPath = this.config.modelPath;
    if (!modelPath) {
      return Promise.reject(new Error(
        'No whisper model found. Run: cursor+ --setup'
      ));
    }
    const lang = (this.config.language || 'en').trim();
    const args = ['-m', modelPath, '-f', audioFile, '-np', '-nt'];
    if (lang && lang !== 'en') args.push('-l', lang === 'auto' ? 'auto' : lang);

    return new Promise((resolve, reject) => {
      execFile('whisper-cli', args, (err, stdout) => {
        if (err) return reject(err);
        const text = stdout
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .filter(l => !l.startsWith('[') || !l.endsWith(']'))
          .join(' ');
        resolve(text);
      });
    });
  }
}

module.exports = VoiceRecorder;
module.exports.VoiceRecorder = VoiceRecorder;
module.exports._inputArgs = _inputArgs;