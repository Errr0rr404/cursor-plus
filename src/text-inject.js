'use strict';

/**
 * text-inject — sanitize and inject user-generated text into the Cursor PTY.
 *
 * Newlines become spaces: Cursor's prompt treats Enter as submit, so any
 * literal \n would split a single voice-paste into multiple submissions.
 * Paths with spaces must be quoted so the @-attachment stays one token.
 */

function sanitizeInjectedText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ');
}

function formatAtPath(abs) {
  const p = String(abs || '');
  if (!p) return '';
  return /\s/.test(p) ? `@"${p}" ` : `@${p} `;
}

module.exports = { sanitizeInjectedText, formatAtPath };