'use strict';

/**
 * cheatsheet — overlay that lists every hotkey cursor-plus provides.
 *
 * Toggled with `?` (printable) or Ctrl+/ (\x1f). While open, all stdin
 * is consumed. Closes on any key. The list is generated dynamically so
 * it always reflects the active config.
 */

const theme = require('./theme');

const TL = '╭', TR = '╮', BL = '╰', BR = '╯', H = '─', V = '│';

class CheatSheet {
  constructor() {
    this._open = false;
    this._resolve = null;
  }

  get isOpen() { return this._open; }

  open(cfg) {
    if (this._open) return Promise.resolve();
    this._open = true;
    this._render(cfg);
    return new Promise(res => { this._resolve = res; });
  }

  handleInput(/* data */) {
    if (!this._open) return false;
    this._close();
    return true;
  }

  _close() {
    if (!this._open) return;
    this._open = false;
    process.stdout.write('\x1b8');
    process.stdout.write('\x1b[J');
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(); }
  }

  _render(cfg) {
    const t = theme.get(cfg);
    const rows  = process.stdout.rows    || 24;
    const cols  = process.stdout.columns || 80;
    const title = ' cursor+ cheatsheet ';
    const w     = Math.min(74, Math.max(0, cols - 4));
    const inner = Math.max(title.length, w - 2);
    const startRow = 2;
    const startCol = Math.max(1, Math.floor((cols - w) / 2));

    const sections = [
      { title: 'Voice', items: [
        ['Hold Space',       cfg && cfg.voice && cfg.voice.holdSpace !== false
                              ? 'Hold-to-talk (Kitty terminals)'
                              : 'Disabled — Ctrl+Space toggle fallback'],
        ['Ctrl+Space',       'Toggle voice record (everywhere)'],
        ['Ctrl+C (recording)','Cancel active recording'],
      ]},
      { title: 'Editor', items: [
        ['Click in type bar','Reposition caret (Kitty/SGR mouse)'],
        ['Ctrl+T',        'Toggle text-to-speech'],
        ['Ctrl+P',        'Capture screenshot → @path'],
        ['Ctrl+Y',        'Paste clipboard (text or image)'],
        ['Ctrl+S',        'Stash current prompt draft'],
        ['Ctrl+G',        'Cursor native: open draft in $EDITOR'],
      ]},
      { title: 'Output', items: [
        ['Idle notify',  cfg && cfg.notifications && !cfg.notifications.quiet
                              ? 'OS notification when agent finishes'
                              : 'Disabled'],
      ]},
      { title: 'Queue', items: [
        ['Enter (busy)', 'Queue prompt until response settles'],
      ]},
      { title: 'Tools', items: [
        ['cursor+ --setup',         'Check dependencies + pick mic'],
        ['cursor+ --doctor',        'Validate config + environment'],
        ['cursor+ --help-plus',     'Full help'],
        ['cursor+ --version',       'Print version'],
      ]},
    ];

    const lines = [];
    const padL = Math.max(0, Math.floor((inner - title.length) / 2));
    const padR = Math.max(0, inner - title.length - padL);
    lines.push(`${TL}${H.repeat(padL)}${t.bold}${title}${t.reset}${H.repeat(padR)}${TR}`);

    for (let s = 0; s < sections.length; s++) {
      const sec = sections[s];
      const sLabel = `  ${t.accent}${sec.title}${t.reset}`;
      lines.push(`${V}${_pad(sLabel, inner)}${V}`);
      for (const [k, desc] of sec.items) {
        const left  = `    ${t.bold}${k}${t.reset}`;
        const right = `${t.dim}${desc}${t.reset}`;
        const gap   = Math.max(2, inner - _vlen(left) - _vlen(right) - 2);
        lines.push(`${V}${_truncPad(left + ' '.repeat(gap) + right, inner)}${V}`);
      }
      if (s < sections.length - 1) {
        lines.push(`${V}${' '.repeat(inner)}${V}`);
      }
    }
    lines.push(`${V}${' '.repeat(inner)}${V}`);
    const hint = `${t.dim}  Press any key to close${t.reset}`;
    lines.push(`${V}${_pad(hint, inner)}${V}`);
    lines.push(`${BL}${H.repeat(inner)}${BR}`);

    const maxRows = Math.max(8, rows - startRow - 1);
    const rendered = lines.slice(0, maxRows);

    let out = '\x1b7';
    for (let i = 0; i < rendered.length; i++) {
      out += `\x1b[${startRow + i};${startCol}H${rendered[i]}`;
    }
    process.stdout.write(out);
  }
}

function _vlen(s) { return s.replace(/\x1b\[[0-9;]*[mA-Za-z]/g, '').length; }
function _pad(s, w) { return s + ' '.repeat(Math.max(0, w - _vlen(s))); }
function _truncPad(s, w) {
  if (_vlen(s) <= w) return _pad(s, w);
  let vis = 0, i = 0, out = '';
  while (i < s.length && vis < w) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*[mA-Za-z]/);
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    out += s[i]; vis++; i++;
  }
  return out + '\x1b[0m';
}

module.exports = CheatSheet;
module.exports.CheatSheet = CheatSheet;