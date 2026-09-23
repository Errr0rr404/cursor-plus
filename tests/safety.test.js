'use strict';

const { eq, ok, deepEq } = require('./_assert');
const safety = require('../src/safety');

it('scan finds AWS access keys', () => {
  const text = 'AKIAIOSFODNN7EXAMPLE is the key';
  const findings = safety.scan(text);
  eq(findings.length, 1);
  eq(findings[0].kind, 'aws-access-key');
});

it('scan finds GitHub PAT tokens', () => {
  const text = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const findings = safety.scan(text);
  ok(findings.some(f => f.kind === 'github-token'));
});

it('scan finds OpenAI keys', () => {
  const text = 'my key: sk-abcdefghijklmnopqrstuvwxyz0123456789';
  const findings = safety.scan(text);
  ok(findings.some(f => f.kind === 'openai-key'));
});

it('scan finds private key headers', () => {
  const text = '-----BEGIN RSA PRIVATE KEY-----';
  const findings = safety.scan(text);
  ok(findings.some(f => f.kind === 'private-key'));
});

it('scan returns empty on innocuous prompts', () => {
  const findings = safety.scan('please refactor the auth module');
  eq(findings.length, 0);
});

it('isClean mirrors scan result', () => {
  ok(safety.isClean('hello world'));
  eq(safety.isClean('AKIAIOSFODNN7EXAMPLE'), false);
});

it('redact replaces findings with [REDACTED]', () => {
  const text = 'AKIAIOSFODNN7EXAMPLE leaked';
  const r = safety.redact(text);
  ok(r.includes('[REDACTED]'));
  eq(safety.scan(r).length, 0);
});

it('redact preserves surrounding text', () => {
  const text = 'hello AKIAIOSFODNN7EXAMPLE world';
  const r = safety.redact(text);
  ok(r.startsWith('hello '));
  ok(r.endsWith(' world'));
});

it('redact wipes the full match length, not the truncated snippet', () => {
  // AWS access keys are 20 chars; the snippet stored in the finding is
  // truncated to 12. redact() must use the *actual* match length to
  // avoid leaving the tail of the secret visible.
  const fullKey = 'AKIAIOSFODNN7EXAMPLE';
  const r = safety.redact(`prefix ${fullKey} suffix`);
  eq(r.indexOf(fullKey), -1);
  ok(r.includes('[REDACTED]'));
  ok(r.startsWith('prefix '));
  ok(r.endsWith(' suffix'));
});

it('redact handles private-key blocks across multiple lines', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nAB\nCD\n-----END RSA PRIVATE KEY-----';
  const r = safety.redact(`here: ${pem} done`);
  ok(r.indexOf('AB') === -1);
  ok(r.indexOf('CD') === -1);
  ok(r.includes('[REDACTED]'));
});

it('PATTERNS covers the major credential families', () => {
  const kinds = safety.PATTERNS.map(p => p.kind);
  ok(kinds.includes('aws-access-key'));
  ok(kinds.includes('github-token'));
  ok(kinds.includes('openai-key'));
  ok(kinds.includes('anthropic-key'));
  ok(kinds.includes('private-key'));
  ok(kinds.includes('slack-token'));
});