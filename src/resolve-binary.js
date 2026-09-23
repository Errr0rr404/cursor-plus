'use strict';

/**
 * resolve-binary — locate the `cursor-agent` binary, refusing to fall
 * back to an unrelated `agent` CLI (e.g. Grok).
 *
 * Resolution order (per PLAN §3):
 *   1. $CURSOR_AGENT_BIN
 *   2. `cursor-agent` on PATH
 *   3. `agent` ONLY if its --version output identifies as Cursor's CLI
 *
 * The identity check runs `cursor-agent --version` and looks for a
 * stable Cursor CLI marker ("cursor", "Cursor Agent", etc.). If none
 * match, we refuse rather than launch something dangerous.
 */

const { execFile, execFileSync } = require('child_process');
const os = require('os');

const IS_WIN = os.platform() === 'win32';

function _which(name) {
  try {
    const cmd = IS_WIN ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { encoding: 'utf8', timeout: 4000 })
      .trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!out.length) return null;
    if (IS_WIN) {
      const withExt = out.find(l => /\.(cmd|exe|bat)$/i.test(l));
      return withExt || out[0];
    }
    return out[0];
  } catch {
    return null;
  }
}

const CURSOR_MARKERS = [
  /cursor/i,
  /agent\s*cli/i,
  /@cursor\/agent/i,
];

async function _identify(binPath) {
  if (!binPath) return false;
  // Try a few flags in order — most CLIs accept --version, --help, or just bare invocation.
  const probes = [
    ['--version'],
    ['version'],
    ['-v'],
    ['--help'],
    [],
  ];
  for (const args of probes) {
    try {
      const out = await new Promise((resolve, reject) => {
        execFile(binPath, args, { encoding: 'utf8', timeout: 3000 }, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve(`${stdout || ''}\n${stderr || ''}`);
        });
      });
      if (CURSOR_MARKERS.some(re => re.test(out))) return true;
    } catch (err) {
      // Some CLIs exit non-zero on --help — still got output, check it.
      const out = (err && (err.stdout || err.stderr)) || '';
      if (typeof out === 'string' && CURSOR_MARKERS.some(re => re.test(out))) return true;
    }
  }
  return false;
}

/**
 * Returns { bin: string, source: 'env' | 'cursor-agent' | 'agent-as-cursor' }
 * or throws if nothing usable was found.
 */
async function resolveCursorAgent() {
  const envOverride = process.env.CURSOR_AGENT_BIN;
  if (envOverride) {
    const ok = await _identify(envOverride);
    if (ok) return { bin: envOverride, source: 'env' };
  }
  const direct = _which('cursor-agent');
  if (direct) {
    const ok = await _identify(direct);
    if (ok) return { bin: direct, source: 'cursor-agent' };
  }
  // Last-ditch: an `agent` binary that identifies as Cursor's.
  const generic = _which('agent');
  if (generic) {
    const ok = await _identify(generic);
    if (ok) return { bin: generic, source: 'agent-as-cursor' };
  }
  const error = new Error(
    'Could not locate the Cursor Agent CLI.\n' +
    'Install it from https://cursor.com and ensure `cursor-agent` is on your PATH.\n' +
    'You can also set $CURSOR_AGENT_BIN to override.'
  );
  error.code = 'CURSOR_AGENT_NOT_FOUND';
  throw error;
}

/** Synchronous best-effort: returns `bin` without identity check. */
function whichQuick(name) { return _which(name); }

module.exports = { resolveCursorAgent, whichQuick, _identify };