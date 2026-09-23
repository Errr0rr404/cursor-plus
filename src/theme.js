'use strict';

/**
 * theme — tiny ANSI palette helpers.
 * No state is stored; we just compute codes based on the active theme name
 * and whether the parent terminal appears to support colour.
 *
 * Supported themes: dark | light | solarized | monokai | auto
 * 'auto' (default) inspects NO_COLOR / TERM to decide between dark/light.
 */

let _name = 'dark';
let _supportsColor = true;

function set(name) {
  if (!name) return;
  if (name === 'auto') {
    _name = _pickAuto();
    return;
  }
  if (['dark', 'light', 'solarized', 'monokai'].includes(name)) {
    _name = name;
  }
}

function _pickAuto() {
  if (process.env.NO_COLOR) return 'light';
  if (process.env.COLORTERM === 'truecolor' || process.env.TERM === 'xterm-256color') return 'dark';
  return 'dark';
}

function get(/* cfg */) {
  const codes = _palette(_name);
  return {
    reset:    codes.reset,
    bold:     codes.bold,
    dim:      codes.dim,
    accent:   codes.accent,
    success:  codes.success,
    warn:     codes.warn,
    error:    codes.error,
    supportsColor: _supportsColor,
    name:     _name,
  };
}

function _palette(name) {
  if (!_supportsColor) {
    return {
      reset: '', bold: '', dim: '', accent: '', success: '', warn: '', error: '',
    };
  }
  switch (name) {
    case 'light':
      return {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        accent: '\x1b[34m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
      };
    case 'solarized':
      return {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        accent: '\x1b[36m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
      };
    case 'monokai':
      return {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        accent: '\x1b[35m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
      };
    case 'dark':
    default:
      return {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        accent: '\x1b[36m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
      };
  }
}

module.exports = { set, get };