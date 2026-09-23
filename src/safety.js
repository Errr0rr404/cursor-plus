'use strict';

/**
 * safety — heuristic secrets scanner for outgoing prompts.
 *
 * We try not to be paranoid. The patterns here flag the highest-signal
 * private-key headers and cloud credentials; everything else is left
 * to the user.
 *
 * Returns { findings: [{ kind, length, snippet, index }], redact: (s) => s }.
 *
 * `length` is the *full* length of the matched secret so `redact()` can
 * wipe the entire match (not just the truncated snippet used in
 * notifications).
 */

const PATTERNS = [
  { kind: 'aws-access-key',   re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'aws-sts-token',    re: /ASIA[0-9A-Z]{16}/g },
  { kind: 'aws-secret-key',   re: /aws_secret_access_key\s*=\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { kind: 'github-token',     re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: 'github-fine',      re: /github_pat_[A-Za-z0-9_]{36,}/g },
  { kind: 'openai-key',       re: /sk-[A-Za-z0-9]{32,}/g },
  { kind: 'anthropic-key',    re: /sk-ant-[A-Za-z0-9-]{32,}/g },
  { kind: 'slack-token',      re: /xox[abpr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'private-key',      re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END/ },
  { kind: 'jwt',              re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { kind: 'generic-bearer',   re: /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/g },
  { kind: 'stripe-key',       re: /sk_live_[A-Za-z0-9]{24,}/g },
];

function scan(text) {
  const findings = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        kind,
        length: m[0].length,
        snippet: m[0].slice(0, 12) + '…',
        index: m.index,
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return findings;
}

function redact(text, findings = scan(text)) {
  let out = text;
  // Walk findings in reverse so indices stay valid.
  for (const f of [...findings].sort((a, b) => b.index - a.index)) {
    const start = f.index;
    const len = (typeof f.length === 'number' && f.length > 0) ? f.length : Math.max(8, (f.snippet || '').length);
    out = out.slice(0, start) + '[REDACTED]' + out.slice(start + len);
  }
  return out;
}

function isClean(text) {
  return scan(text).length === 0;
}

module.exports = { scan, redact, isClean, PATTERNS };