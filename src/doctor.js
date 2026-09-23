'use strict';

/**
 * doctor — print a friendly environment + config health report.
 *
 * Also fixes the common node-pty "posix_spawnp failed" trap (no
 * executable bit on the prebuilt spawn-helper on macOS / Linux) by
 * chmod'ing it in place. That's why every install flow ends with
 * `cursor+ --doctor && cursor+` instead of just `cursor+`.
 */

const { execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const cfg    = require('./config');
const theme  = require('./theme');
const logger = require('./logger');
const { resolveCursorAgent } = require('./resolve-binary');

const PLATFORM = os.platform();
const ARCH     = os.arch();           // arm64 | x64 | x86_64 | ...
const IS_WIN   = PLATFORM === 'win32';
const WHICH = IS_WIN ? 'where' : 'which';
const VERSION = require('../package.json').version;

function checkBinary(name) {
  return new Promise(resolve => {
    execFile(WHICH, [name], { timeout: 4000 }, err => resolve(!err));
  });
}

/**
 * Find the node-pty package from any plausible install location.
 *
 * The user is invoking `cursor+ --doctor` from some location, but
 * `node-pty` lives inside the `cursor-plus` install directory — which
 * might be global, local-dev, or via nvm/Homebrew. We resolve from
 * the running script's path so npm-global / brew installs all hit the
 * right prebuilds.
 */
function findNodePtyDir() {
  // 1. The directory of the cursor-plus that's actually running. Works
  //    for `npm i -g cursor-plus`, `brew install cursor-plus`, and any
  //    other deployment that puts node_modules next to the bin script.
  const candidates = [];
  try {
    const main = process.argv[1] || __filename;
    // Walk up from the running script looking for a node_modules/node-pty.
    let dir = path.dirname(path.resolve(main));
    for (let i = 0; i < 8 && dir !== path.dirname(dir); i++) {
      const candidate = path.join(dir, 'node_modules', 'node-pty');
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      candidates.push(candidate);
      dir = path.dirname(dir);
    }
  } catch {}

  // 2. require.resolve from the wrapper source — works for the dev case
  //    where you run `node bin/cursor+ --doctor` from the source repo.
  try {
    return path.dirname(require.resolve('node-pty/package.json'));
  } catch {}

  // 3. Well-known global locations.
  if (IS_WIN) {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'npm', 'node_modules', 'node-pty');
  }
  for (const root of [
    path.join(process.execPath, '..', '..', 'lib', 'node_modules'),
    path.join(os.homedir(), '.nvm', 'versions', 'node', process.version, 'lib', 'node_modules'),
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
  ]) {
    const candidate = path.join(root, 'node-pty');
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/**
 * Detect and (best-effort) fix node-pty's spawn-helper permissions.
 *
 * Returns one of:
 *   { status: 'ok'       } — already executable, nothing to do
 *   { status: 'fixed'    } — was non-executable, chmod'd to 0o755
 *   { status: 'absent'   } — node-pty isn't installed in any known location
 *   { status: 'failed'   , error } — node-pty found but chmod failed (EPERM, …)
 *
 * No-op on Windows — node-pty uses a .node addon there, no spawn-helper
 * to chmod.
 */
function fixNodePtyPermissions() {
  if (IS_WIN) return { status: 'ok', skipped: 'windows' };

  const dir = findNodePtyDir();
  if (!dir) return { status: 'absent' };

  const platformKey = `${PLATFORM}-${ARCH}`;
  const helper = path.join(dir, 'prebuilds', platformKey, 'spawn-helper');
  if (!fs.existsSync(helper)) return { status: 'absent', path: helper };

  try {
    fs.accessSync(helper, fs.constants.X_OK);
    return { status: 'ok', path: helper };
  } catch {
    try {
      fs.chmodSync(helper, 0o755);
      return { status: 'fixed', path: helper };
    } catch (err) {
      return { status: 'failed', path: helper, error: err };
    }
  }
}

async function runDoctor({ autoFix = true } = {}) {
  const t = theme.get(cfg.load());
  const config = cfg.load();
  console.log(`\n${t.bold}cursor+ doctor${t.reset} ${t.dim}v${VERSION}${t.reset}\n`);

  // ── node-pty spawn-helper — auto-fix the posix_spawnp trap ────────────
  const helperCheck = fixNodePtyPermissions();
  switch (helperCheck.status) {
    case 'ok':
      if (helperCheck.path) {
        console.log(`  ${t.success}✓${t.reset}  node-pty spawn-helper — ${t.dim}${helperCheck.path}${t.reset}`);
      } else {
        console.log(`  ${t.success}✓${t.reset}  node-pty spawn-helper — executable (Windows / n/a)`);
      }
      break;
    case 'fixed':
      console.log(`  ${t.warn}!${t.reset}  node-pty spawn-helper — ${t.dim}was not executable; auto-fixed chmod 0755${t.reset}`);
      console.log(`             ${t.dim}${helperCheck.path}${t.reset}`);
      break;
    case 'absent':
      console.log(`  ${t.warn}!${t.reset}  node-pty spawn-helper — not found${helperCheck.path ? ` (looked at ${helperCheck.path})` : ''}`);
      break;
    case 'failed':
      console.log(`  ${t.error}✗${t.reset}  node-pty spawn-helper — chmod failed: ${helperCheck.error && helperCheck.error.message}`);
      console.log(`             ${t.dim}Manual fix: chmod +x ${helperCheck.path}${t.reset}`);
      break;
  }

  // ── Binaries ───────────────────────────────────────────────────────────
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

  // Summary / next-step hint
  console.log(`\n${t.dim}Config: ${cfg.CONFIG_PATH}${t.reset}`);
  console.log(`${t.dim}Log:    ${logger.LOG_PATH}${t.reset}\n`);

  const anyFailure = helperCheck.status === 'failed'
    || !await checkBinary('cursor-agent')
    || !cfg.findWhisperModel();
  if (anyFailure) {
    console.log(`${t.warn}Next steps:${t.reset}`);
    if (!await checkBinary('cursor-agent')) {
      console.log(`  · install the Cursor Agent CLI: ${t.dim}https://cursor.com${t.reset}`);
    }
    if (!cfg.findWhisperModel()) {
      console.log(`  · download the whisper base.en model: ${t.dim}cursor+ --setup${t.reset}`);
    }
    if (helperCheck.status === 'failed') {
      console.log(`  · chmod the spawn-helper manually, see above`);
    }
    console.log();
  } else {
    console.log(`${t.success}Ready. Run \`cursor+\` to launch.${t.reset}\n`);
  }

  // Doctor only ever returns 0 — it's advisory, not blocking. We exit
  // non-zero from --doctor in the wrapper if config is invalid, but
  // individual warnings don't fail the run.
  void autoFix; // reserved for `--doctor --no-fix` later
  process.exit(warns.length ? 1 : 0);
}

module.exports = { runDoctor, fixNodePtyPermissions, findNodePtyDir };