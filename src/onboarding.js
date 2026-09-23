'use strict';

/**
 * onboarding — interactive first-run setup + audio device picker.
 *
 * Run via `cursor+ --setup`.  We:
 *   - check required binaries (cursor-agent, ffmpeg, whisper-cli)
 *   - download whisper base.en model if missing
 *   - list audio input devices and prompt the user to pick one
 *   - print a quick-start cheatsheet
 */

const { execFile, execFileSync, spawnSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const cfg      = require('./config');
const theme    = require('./theme');
const logger   = require('./logger');
const { resolveCursorAgent } = require('./resolve-binary');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';
const WHICH = IS_WIN ? 'where' : 'which';

const WHISPER_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const WHISPER_MODEL_FILE = 'ggml-base.en.bin';

function checkBinary(name) {
  return new Promise(resolve => {
    execFile(WHICH, [name], { timeout: 4000 }, err => resolve(!err));
  });
}

/**
 * Best-effort download of the whisper base.en model. We use Node 18+'s
 * built-in fetch; no external deps.
 */
async function downloadWhisperModel(targetDir, progressFn) {
  const target = path.join(targetDir, WHISPER_MODEL_FILE);
  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.existsSync(target) && fs.statSync(target).size > 1024 * 1024) {
    return { path: target, cached: true };
  }
  const res = await fetch(WHISPER_BASE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${WHISPER_BASE_URL}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  let received = 0;
  const file = fs.createWriteStream(target);
  await new Promise((resolve, reject) => {
    res.body.on('data', (chunk) => {
      received += chunk.length;
      if (progressFn) progressFn(received, total);
    });
    res.body.pipe(file);
    file.on('finish', resolve);
    file.on('error', reject);
  });
  return { path: target, cached: false };
}

async function prompt(question) {
  // Lazy-load readline so the wrapper can `require` this module without
  // pulling in stdio machinery during --doctor etc.
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function runOnboarding() {
  cfg.ensureDirs();
  const config = cfg.load();
  const t = theme.get(config);

  console.log(`\n${t.bold}🛠  cursor-plus setup${t.reset}\n`);
  console.log('Checking dependencies…\n');

  const checks = [
    ['cursor-agent', await checkBinary('cursor-agent'),
     'Install Cursor CLI: https://cursor.com',
     `${t.success}✅${t.reset}  cursor-agent — found`],
    ['ffmpeg', await checkBinary('ffmpeg'),
     IS_MAC ? 'brew install ffmpeg' :
       IS_WIN ? 'winget install Gyan.FFmpeg' :
       'apt install ffmpeg / dnf install ffmpeg',
     `${t.success}✅${t.reset}  ffmpeg — found`],
    ['whisper-cli', await checkBinary('whisper-cli'),
     IS_MAC ? 'brew install whisper-cpp' :
       IS_WIN ? 'Download from https://github.com/ggerganov/whisper.cpp/releases' :
       'Build from https://github.com/ggerganov/whisper.cpp',
     `${t.success}✅${t.reset}  whisper-cli — found`],
  ];

  let allGood = true;
  for (const [name, ok, installHint, successMsg] of checks) {
    if (ok) console.log(successMsg);
    else {
      console.log(`${t.error}❌${t.reset}  ${name} — not found`);
      console.log(`     Install: ${installHint}`);
      allGood = false;
    }
  }

  // Resolve `cursor-agent` via the resolver to confirm identity.
  try {
    const r = await resolveCursorAgent();
    console.log(`${t.success}✅${t.reset}  resolved cursor-agent → ${r.bin}  ${t.dim}(source: ${r.source})${t.reset}`);
  } catch (err) {
    console.log(`${t.error}❌${t.reset}  cursor-agent identity check failed`);
    console.log(`     ${err.message.split('\n')[0]}`);
    allGood = false;
  }

  // Whisper model
  const modelPath = cfg.findWhisperModel();
  if (modelPath) {
    console.log(`${t.success}✅${t.reset}  whisper model — ${modelPath}`);
  } else {
    console.log(`${t.error}❌${t.reset}  whisper model — not found`);
    console.log(`     Will download: ${WHISPER_BASE_URL}`);
    if (process.stdin.isTTY) {
      const ans = await prompt(`Download now into ${cfg.MODELS_DIR}? [Y/n] `);
      if (!ans || /^y(es)?$/i.test(ans.trim())) {
        process.stdout.write('     Downloading…\n');
        try {
          const res = await downloadWhisperModel(cfg.MODELS_DIR, (cur, total) => {
            const pct = total > 0 ? Math.floor(cur * 100 / total) : 0;
            process.stdout.write(`\r     ${pct}%`);
          });
          process.stdout.write('\n');
          console.log(`${t.success}✅${t.reset}  whisper model — ${res.path}`);
          cfg.patch({ voice: { modelPath: res.path } });
        } catch (err) {
          console.log(`\n${t.error}❌${t.reset}  download failed: ${err.message}`);
          allGood = false;
        }
      } else {
        allGood = false;
      }
    } else {
      console.log(`     Run \`cursor+ --setup\` in an interactive terminal to download.`);
      allGood = false;
    }
  }

  // Audio device picker
  const devices = cfg.listMicDevices();
  if (!devices.length) {
    console.log(`${t.warn}⚠${t.reset}    audio device — could not list (is ffmpeg on PATH?)`);
  } else {
    console.log(`\nAvailable audio input devices:`);
    devices.forEach(({ id, name }, i) => {
      const marker = id === (config.voice && config.voice.audioDevice) ? ` ${t.accent}◀ current${t.reset}` : '';
      console.log(`  [${i + 1}] ${name}  ${t.dim}(${id})${t.reset}${marker}`);
    });
    if (process.stdin.isTTY) {
      const answer = await prompt(`\nChoose audio device [1-${devices.length}] (Enter to keep current): `);
      const trimmed = answer.trim();
      if (trimmed !== '') {
        const choice = parseInt(trimmed, 10);
        if (Number.isFinite(choice) && choice >= 1 && choice <= devices.length) {
          const chosen = devices[choice - 1];
          cfg.patch({ voice: { audioDevice: chosen.id } });
          console.log(`${t.success}✅${t.reset}  audio device set to: ${chosen.name}`);
        } else {
          console.log(`${t.warn}⚠${t.reset}   Invalid choice — audio device unchanged.`);
        }
      }
    }
  }

  printHotkeys(allGood);
  cfg.patch({ firstRunComplete: true });
  process.exit(allGood ? 0 : 1);
}

function printHotkeys(allGood) {
  const t = theme.get(cfg.load());
  console.log(`\n${t.bold}Hotkeys (inside cursor+):${t.reset}`);
  const lines = [
    ['Hold Space',       'Hold-to-talk (Kitty terminals)'],
    ['Ctrl+Space',       'Toggle voice record (everywhere)'],
    ['Click in prompt',  'Reposition caret (mouse)'],
    ['?',                'Cheatsheet'],
    ['Ctrl+T',           'Toggle text-to-speech'],
    ['Ctrl+P',           'Screenshot → @path'],
    ['Ctrl+Y',           'Paste clipboard (text or image)'],
    ['Ctrl+S',           'Stash current draft'],
    ['Ctrl+G',           'Open draft in $EDITOR (Cursor native)'],
    ['Enter (busy)',     'Queue prompt until response settles'],
  ];
  for (const [k, d] of lines) console.log(`  ${k.padEnd(18)}${t.dim}${d}${t.reset}`);

  console.log(`\n${t.bold}Usage:${t.reset}`);
  console.log(`  cursor+                ${t.dim}launch with all enhancements${t.reset}`);
  console.log(`  cursor+ --setup        ${t.dim}re-run this wizard${t.reset}`);
  console.log(`  cursor+ --doctor       ${t.dim}validate environment${t.reset}`);
  console.log(`  cursor+ --help-plus    ${t.dim}full help${t.reset}\n`);

  if (allGood) console.log(`${t.success}✅  All dependencies found. Run \`cursor+\` to start!${t.reset}\n`);
  else         console.log(`${t.warn}⚠   Fix the issues above, then re-run \`cursor+ --setup\`.${t.reset}\n`);
}

module.exports = { runOnboarding, downloadWhisperModel, checkBinary };