'use strict';

/**
 * doctor — print a friendly environment + config health report.
 *
 * Always succeeds (exit 0) but flags warnings the user should fix.
 * Reuses the resolver / mic detection helpers so the report is
 * actually grounded in real probes.
 */

const { execFile } = require('child_process');
const os = require('os');

const cfg    = require('./config');
const theme  = require('./theme');
const logger = require('./logger');
const { resolveCursorAgent } = require('./resolve-binary');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const WHICH = IS_WIN ? 'where' : 'which';
const VERSION = require('../package.json').version;

function checkBinary(name) {
  return new Promise(resolve => {
    execFile(WHICH, [name], { timeout: 4000 }, err => resolve(!err));
  });
}

async function runDoctor() {
  const t = theme.get(cfg.load());
  const config = cfg.load();
  console.log(`\n${t.bold}cursor+ doctor${t.reset} ${t.dim}v${VERSION}${t.reset}\n`);

  // Binaries
  const bins = ['cursor-agent', 'ffmpeg', 'whisper-cli'];
  for (const b of bins) {
    const ok = await checkBinary(b);
    console.log(`  ${ok ? `${t.success}✓${t.reset}` : `${t.error}✗${t.reset}`}  ${b}`);
  }

  // Binary identity
  try {
    const r = await resolveCursorAgent();
    console.log(`  ${t.success}✓${t.reset}  resolved cursor-agent → ${r.bin}  ${t.dim}(source: ${r.source})${t.reset}`);
  } catch (err) {
    console.log(`  ${t.error}✗${t.reset}  cursor-agent identity: ${err.message.split('\n')[0]}`);
  }

  // Model
  const model = cfg.findWhisperModel();
  console.log(`  ${model ? `${t.success}✓${t.reset}` : `${t.error}✗${t.reset}`}  whisper model${model ? ` — ${model}` : ' — not found (run cursor+ --setup)'}`);

  // Audio device
  const dev = config.voice && config.voice.audioDevice;
  console.log(`  ${dev ? `${t.success}✓${t.reset}` : `${t.warn}!${t.reset}`}  audio device — ${dev || '(not set; --setup will detect)'}`);

  // Terminal capability hints (we can't probe Kitty without disturbing stdin)
  const TERM = process.env.TERM || '';
  const kittyLikely = /kitty|wezterm|ghostty/i.test(TERM);
  console.log(`  ${kittyLikely ? `${t.success}✓${t.reset}` : `${t.warn}!${t.reset}`}  Kitty protocol (Hold Space) — ${
    kittyLikely ? `TERM=${TERM} detected` : `TERM=${TERM}; Ctrl+Space fallback will be used`
  }`);
  const mouseLikely = process.stdout.isTTY;   // SGR works on every modern terminal when enabled
  console.log(`  ${mouseLikely ? `${t.success}✓${t.reset}` : `${t.warn}!${t.reset}`}  Mouse reporting (click-to-caret) — ${
    mouseLikely ? 'enabled' : 'no TTY; mouse events will be ignored'
  }`);

  // Piper voice (TTS)
  const piper = cfg.findPiperVoice();
  console.log(`  ${piper ? `${t.success}✓${t.reset}` : `${t.warn}!${t.reset}`}  Piper voice — ${
    piper || 'not installed; will fall back to OS TTS'
  }`);

  // Config validation
  const warns = cfg.validate(config);
  if (warns.length) {
    console.log(`\n${t.warn}Config warnings:${t.reset}`);
    for (const w of warns) console.log(`  · ${w}`);
  } else {
    console.log(`\n${t.success}Config validates clean.${t.reset}`);
  }

  console.log(`\n${t.dim}Config: ${cfg.CONFIG_PATH}${t.reset}`);
  console.log(`${t.dim}Log:    ${logger.LOG_PATH}${t.reset}\n`);

  process.exit(warns.length ? 1 : 0);
}

module.exports = { runDoctor };