'use strict';

/**
 * config — load / save / patch the cursor-plus user config.
 *
 * Storage: ~/.cursor-plus/config.json
 *
 * The schema mirrors the plan §8 defaults. We deep-merge known nested
 * objects so partial overrides never blow away sibling keys.
 *
 * Also exposes a few helpers that other modules use to discover binaries
 * and audio devices without re-implementing the platform dance.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync, spawnSync } = require('child_process');

const CONFIG_DIR  = path.join(os.homedir(), '.cursor-plus');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const MODELS_DIR  = path.join(CONFIG_DIR, 'models');
const AGENTS_DIR  = path.join(CONFIG_DIR, 'agents');
const LOG_PATH    = path.join(CONFIG_DIR, 'cursor-plus.log');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

const WHISPER_MODEL_CANDIDATES = [
  path.join(MODELS_DIR, 'ggml-base.en.bin'),
  path.join(MODELS_DIR, 'ggml-small.en.bin'),
  path.join(MODELS_DIR, 'ggml-tiny.en.bin'),
  path.join(MODELS_DIR, 'ggml-base.bin'),
  path.join(__dirname, '..', 'models', 'ggml-base.en.bin'),
  // macOS Homebrew paths
  '/opt/homebrew/share/whisper.cpp/models/ggml-base.en.bin',
  '/usr/local/share/whisper.cpp/models/ggml-base.en.bin',
  // Windows common paths
  path.join(os.homedir(), 'AppData', 'Local', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
  'C:\\whisper.cpp\\models\\ggml-base.en.bin',
];

const PIPER_VOICE_CANDIDATES = [
  path.join(MODELS_DIR, 'piper', 'en_US-lessac-medium.onnx'),
  path.join(MODELS_DIR, 'piper', 'en_US-amy-medium.onnx'),
];

function defaultConfig() {
  return {
    agentBin: 'cursor-agent',
    voice: {
      holdSpace: true,
      holdSpaceMs: 180,        // press duration that triggers record; taps below this type a literal space
      fallbackToggle: 'ctrl-space',
      modelPath: findWhisperModel() || path.join(MODELS_DIR, 'ggml-base.en.bin'),
      audioDevice: null,
      autoSubmit: false,
      voicePreview: false,
      language: 'en',
      enabled: true,
    },
    mouse: {
      clickToCaret: true,
      enabled: true,
      reportMode: 'sgr',     // 'sgr' | 'normal' | 'off'
    },
    keys: {
      kitty: 'auto',         // 'auto' | 'on' | 'off'
    },
    tts: {
      enabled: false,
      engine: 'piper',         // 'piper' | 'os'
      voice: 'en_US-lessac-medium',
      fallback: 'os',
      rate: 1.0,
    },
    queue: {
      whenBusy: true,
      maxSize: 20,
    },
    safety: {
      enabled: true,
      autoRedact: false,
    },
    notifications: {
      quiet: false,
      sound: false,
      webhookUrl: '',
      rules: [
        { when: 'session_idle', channels: ['os'] },
        { when: 'waiting_input', afterMs: 60000, channels: ['os'] },
      ],
    },
    theme: 'auto',
    historyEnabled: true,
    firstRunComplete: false,
  };
}

function load() {
  const fileConfig = fs.existsSync(CONFIG_PATH)
    ? (() => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } })()
    : {};

  const defaults = defaultConfig();

  const audioDevice = fileConfig.voice && fileConfig.voice.audioDevice
    ? fileConfig.voice.audioDevice
    : detectMicrophone();

  const modelPath = (fileConfig.voice && fileConfig.voice.modelPath && fs.existsSync(fileConfig.voice.modelPath))
    ? fileConfig.voice.modelPath
    : (findWhisperModel() || defaults.voice.modelPath);

  const merged = Object.assign({}, defaults, fileConfig);
  merged.voice         = Object.assign({}, defaults.voice, fileConfig.voice, { audioDevice, modelPath });
  merged.mouse         = Object.assign({}, defaults.mouse, fileConfig.mouse);
  merged.keys          = Object.assign({}, defaults.keys,  fileConfig.keys);
  merged.tts           = Object.assign({}, defaults.tts,   fileConfig.tts);
  merged.queue         = Object.assign({}, defaults.queue, fileConfig.queue);
  merged.safety        = Object.assign({}, defaults.safety, fileConfig.safety);
  merged.notifications = Object.assign({}, defaults.notifications, fileConfig.notifications);
  if (Array.isArray(fileConfig.notifications && fileConfig.notifications.rules)) {
    merged.notifications.rules = fileConfig.notifications.rules;
  }

  merged.agentBin = process.env.CURSOR_AGENT_BIN || fileConfig.agentBin || 'cursor-agent';
  return merged;
}

function validate(cfg) {
  const warns = [];
  if (cfg.theme && !['dark', 'light', 'solarized', 'monokai', 'auto'].includes(cfg.theme)) {
    warns.push(`unknown theme: ${cfg.theme}`);
  }
  if (cfg.voice && cfg.voice.language && !/^([a-z]{2,3}|auto)$/.test(cfg.voice.language)) {
    warns.push(`voice.language should be ISO 639-1 or 'auto', got: ${cfg.voice.language}`);
  }
  if (cfg.tts && cfg.tts.rate != null && (typeof cfg.tts.rate !== 'number' || cfg.tts.rate < 0.5 || cfg.tts.rate > 3)) {
    warns.push(`tts.rate must be 0.5–3.0, got: ${cfg.tts.rate}`);
  }
  if (cfg.queue && cfg.queue.maxSize != null && (typeof cfg.queue.maxSize !== 'number' || cfg.queue.maxSize < 1)) {
    warns.push(`queue.maxSize must be a positive number`);
  }
  if (cfg.voice && cfg.voice.modelPath && !fs.existsSync(cfg.voice.modelPath)) {
    warns.push(`voice.modelPath does not exist: ${cfg.voice.modelPath}`);
  }
  if (cfg.mouse && cfg.mouse.reportMode && !['sgr', 'normal', 'off'].includes(cfg.mouse.reportMode)) {
    warns.push(`mouse.reportMode must be sgr|normal|off`);
  }
  return warns;
}

function save(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function patch(updates) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
        && raw[key] !== null && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
      raw[key] = Object.assign({}, raw[key], value);
    } else {
      raw[key] = value;
    }
  }
  save(raw);
}

function findWhisperModel() {
  return WHISPER_MODEL_CANDIDATES.find(p => fs.existsSync(p)) || null;
}

function findPiperVoice() {
  return PIPER_VOICE_CANDIDATES.find(p => fs.existsSync(p)) || null;
}

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR,  { recursive: true });
  fs.mkdirSync(AGENTS_DIR,  { recursive: true });
}

// ── Microphone detection ────────────────────────────────────────────────────

function scoreMicDevice(name) {
  const n = name.toLowerCase();
  if (/teams|zoom|loopback|soundflower|blackhole|virtual|aggregate|multi.output|stereo mix|wave out/.test(n)) return -1;
  if (n.includes('built-in')) return 100;
  if (n.includes('macbook') && n.includes('microphone')) return 90;
  if (n.includes('microphone') || n.includes('mic')) return 80;
  if (n.includes('iphone') || n.includes('ipad')) return 50;
  return 10;
}

function detectMicrophone() {
  if (IS_WIN) return detectMicrophoneWindows();
  if (IS_LINUX) return detectMicrophoneLinux();
  try {
    const output = execFileSync('ffmpeg', [
      '-f', 'avfoundation', '-list_devices', 'true', '-i', '',
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return parseBestMicMac(output);
  } catch (err) {
    return parseBestMicMac(err.stderr || '');
  }
}

function detectMicrophoneLinux() {
  try {
    const r = spawnSync('pactl', ['info'], { encoding: 'utf8', timeout: 1500 });
    if (r.status === 0) return 'pulse:default';
  } catch {}
  try {
    const r = spawnSync('pactl', ['list', 'short', 'sources'], { encoding: 'utf8', timeout: 1500 });
    if (r.status === 0) {
      const line = r.stdout.split('\n').map(l => l.trim()).find(l => l && !/\.monitor\b/.test(l));
      if (line) {
        const cols = line.split(/\s+/);
        if (cols[1]) return `pulse:${cols[1]}`;
      }
    }
  } catch {}
  try {
    const r = spawnSync('arecord', ['-l'], { encoding: 'utf8', timeout: 1500 });
    const m = (r.stdout || '').match(/card (\d+):.*device (\d+):/);
    if (m) return `alsa:hw:${m[1]},${m[2]}`;
  } catch {}
  return null;
}

function detectMicrophoneWindows() {
  try {
    const result = spawnSync('ffmpeg', [
      '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy',
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return parseBestMicWindows(result.stderr || '');
  } catch {
    return null;
  }
}

function parseBestMicMac(output) {
  const devices = parseMicDevicesMac(output);
  if (!devices.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const { id, name } of devices) {
    const score = scoreMicDevice(name);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

function parseBestMicWindows(output) {
  const devices = parseMicDevicesWindows(output);
  if (!devices.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const { id, name } of devices) {
    const score = scoreMicDevice(name);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

function parseMicDevicesMac(output) {
  const deviceRe = /\[AVFoundation.*?\]\s+\[(\d+)\]\s+(.+)/g;
  const devices = [];
  let inAudioSection = false;
  for (const line of output.split('\n')) {
    if (line.includes('AVFoundation audio devices')) { inAudioSection = true; continue; }
    if (line.includes('AVFoundation video devices')) { inAudioSection = false; continue; }
    if (!inAudioSection) continue;
    deviceRe.lastIndex = 0;
    const m = deviceRe.exec(line);
    if (!m) continue;
    devices.push({ id: `:${m[1]}`, name: m[2].trim() });
  }
  return devices;
}

function parseMicDevicesWindows(output) {
  const deviceRe = /\[dshow.*?\]\s+"([^"]+)"\s+\(audio\)/g;
  const devices = [];
  let m;
  while ((m = deviceRe.exec(output)) !== null) {
    devices.push({ id: m[1].trim(), name: m[1].trim() });
  }
  return devices;
}

function parseMicDevicesLinux() {
  const out = [];
  try {
    const r = spawnSync('pactl', ['list', 'short', 'sources'], { encoding: 'utf8', timeout: 1500 });
    if (r.status === 0) {
      for (const line of r.stdout.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 2) continue;
        const name = cols[1];
        if (!name || /\.monitor\b/.test(name)) continue;
        out.push({ id: `pulse:${name}`, name: `(pulse) ${name}` });
      }
    }
  } catch {}
  try {
    const r = spawnSync('arecord', ['-l'], { encoding: 'utf8', timeout: 1500 });
    if (r.status === 0) {
      const re = /card (\d+):\s+([^,]+?),\s+device (\d+):\s+(.+)$/gm;
      let m;
      while ((m = re.exec(r.stdout)) !== null) {
        out.push({ id: `alsa:hw:${m[1]},${m[3]}`, name: `(alsa) ${m[2].trim()} — ${m[4].trim()}` });
      }
    }
  } catch {}
  return out;
}

function listMicDevices() {
  if (IS_WIN) {
    try {
      const result = spawnSync('ffmpeg', [
        '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy',
      ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
      return parseMicDevicesWindows(result.stderr || '');
    } catch {
      return [];
    }
  }
  if (IS_LINUX) return parseMicDevicesLinux();
  try {
    const output = execFileSync('ffmpeg', [
      '-f', 'avfoundation', '-list_devices', 'true', '-i', '',
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return parseMicDevicesMac(output);
  } catch (err) {
    return parseMicDevicesMac(err.stderr || '');
  }
}

module.exports = {
  load, save, patch, validate, ensureDirs,
  defaultConfig,
  findWhisperModel, findPiperVoice,
  detectMicrophone, listMicDevices,
  CONFIG_DIR, CONFIG_PATH, MODELS_DIR, AGENTS_DIR, LOG_PATH,
  PLATFORM, IS_WIN, IS_MAC, IS_LINUX,
  WHISPER_MODEL_CANDIDATES, PIPER_VOICE_CANDIDATES,
};