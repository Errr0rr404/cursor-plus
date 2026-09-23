'use strict';

/**
 * notify-rules — fire OS / bell / webhook notifications on events.
 *
 * Each rule is:
 *   { when: 'session_idle' | 'waiting_input' | 'recording_started', channels: [...], afterMs? }
 *
 * The wrapper calls `fire(type, ctx)` after its response-settle timer
 * resolves. Notifications are throttled per `cooldownMs` so a flurry
 * of partial tokens doesn't spam the user.
 */

const { spawn } = require('child_process');
const os = require('os');
const PLATFORM = os.platform();
const IS_MAC = PLATFORM === 'darwin';
const IS_WIN = PLATFORM === 'win32';
const IS_LINUX = PLATFORM === 'linux';

function createCooldown(cooldownMs = 90_000) {
  const last = new Map();
  return function allow(key) {
    const now = Date.now();
    const t = last.get(key) || 0;
    if (now - t < cooldownMs) return false;
    last.set(key, now);
    return true;
  };
}

function fire(rule, ctx) {
  if (!rule || !Array.isArray(rule.channels)) return;
  for (const ch of rule.channels) {
    try {
      switch (ch) {
        case 'os':    _osNotify(ctx.title || 'cursor+', ctx.body || ''); break;
        case 'bell':  process.stdout.write('\x07'); break;
        case 'webhook': _webhook(rule, ctx); break;
      }
    } catch {}
  }
}

function _osNotify(title, body) {
  if (IS_MAC) {
    spawn('osascript', ['-e', `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`], { stdio: 'ignore' });
    return;
  }
  if (IS_LINUX) {
    spawn('notify-send', [title, body], { stdio: 'ignore' });
    return;
  }
  if (IS_WIN) {
    const psCmd = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null; ` +
      `[reflection.assembly]::loadwithpartialname('System.Drawing') | Out-Null; ` +
      `$n = new-object system.windows.forms.notifyicon; ` +
      `$n.icon = [System.Drawing.SystemIcons]::Information; ` +
      `$n.visible = $true; ` +
      `$n.showballoontip(10, '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}', [system.windows.forms.tooltipicon]::None); ` +
      `Start-Sleep -s 3; $n.dispose()`;
    spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
  }
}

function _webhook(rule, ctx) {
  const url = ctx.webhookUrl || (rule.options && rule.options.url);
  if (!url) return;
  // Dynamic import-free fetch (Node 18+).
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: ctx.title, body: ctx.body, ts: new Date().toISOString() }),
    }).catch(() => {});
  } catch {}
}

function matchRule(rules, type) {
  if (!Array.isArray(rules)) return null;
  return rules.find(r => r && r.when === type) || null;
}

module.exports = { fire, matchRule, createCooldown };