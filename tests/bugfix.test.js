'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { eq, ok, deepEq } = require('./_assert');
const safety = require('../src/safety');
const { sanitizeInjectedText } = require('../src/text-inject');
const theme = require('../src/theme');
const config = require('../src/config');
const keys = require('../src/keys');
const clipboard = require('../src/clipboard');
const MouseCaret = require('../src/mouse-caret');
const CheatSheet = require('../src/cheatsheet');
const TTS = require('../src/tts');
const { CursorPlusWrapper, stripAnsi, SETTLE_MS, ESC_FLUSH_MS } = require('../src/wrapper');
const { PromptQueue } = require('../src/prompt-queue');
const history = require('../src/history');

function makeWrapper(extra = {}) {
  const w = new CursorPlusWrapper([], Object.assign({
    theme: 'dark',
    voice: { holdSpace: true, enabled: false },
    mouse: { enabled: true, clickToCaret: true },
    queue: { whenBusy: true, maxSize: 1 },
    safety: { enabled: false },
    notifications: { quiet: true, rules: [] },
    tts: { enabled: false },
    keys: { kitty: 'off' },
  }, extra));
  w._writes = [];
  w._shell = { write: (s) => { w._writes.push(s); } };
  return w;
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withoutHistory(fn) {
  const orig = history.append;
  history.append = () => {};
  try {
    await fn();
  } finally {
    await new Promise(r => setImmediate(r));
    history.append = orig;
  }
}

function fakeProc() {
  const handlers = {};
  const proc = {
    killed: false,
    stdin: { write() {}, end() {}, on() {} },
    stdout: { pipe() {}, unpipe() {} },
    kill() { proc.killed = true; },
    on(ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
      return proc;
    },
    emit(ev, arg) {
      for (const fn of handlers[ev] || []) fn(arg);
    },
  };
  return proc;
}

it('redact keeps text after overlapping bearer and jwt spans', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue';
  const text = `Authorization: Bearer ${jwt} tail-text-kept`;
  const findings = safety.scan(text);
  ok(findings.some(f => f.kind === 'jwt'));
  ok(findings.some(f => f.kind === 'generic-bearer'));
  const r = safety.redact(text);
  ok(r.includes('tail-text-kept'));
  ok(r.includes('[REDACTED]'));
  eq(r.includes(jwt), false);
  ok(r.startsWith('Authorization: '));
});

it('sanitizeInjectedText strips control characters after flattening newlines', () => {
  eq(sanitizeInjectedText('hi\x03\x1b\x15there\x7f'), 'hithere');
  eq(sanitizeInjectedText('foo\nbar'), 'foo bar');
});

it('NO_COLOR disables ANSI codes and an empty value does not', () => {
  const prev = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1';
    theme.set('auto');
    const t = theme.get();
    eq(t.reset, '');
    eq(t.bold, '');
    eq(t.accent, '');
    eq(t.error, '');
    theme.set('dark');
    eq(theme.get().accent, '');
    process.env.NO_COLOR = '';
    theme.set('dark');
    ok(theme.get().reset.includes('\x1b['));
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
    theme.set('dark');
  }
});

it('coerceConfig and applyPatch accept null config files', () => {
  deepEq(config.coerceConfig(null), {});
  deepEq(config.coerceConfig([]), {});
  deepEq(config.coerceConfig('nope'), {});
  deepEq(config.applyPatch(null, { theme: 'dark' }), { theme: 'dark' });
  const merged = config.applyPatch({ voice: { enabled: true } }, { voice: { language: 'es' } });
  eq(merged.voice.enabled, true);
  eq(merged.voice.language, 'es');
});

it('parseSgrMouseEvent ignores wheel and drag', () => {
  const m = new MouseCaret({ rows: 24, cols: 80 });
  eq(m.parseSgrMouseEvent('\x1b[<64;10;8M').kind, 'ignored');
  eq(m.parseSgrMouseEvent('\x1b[<65;10;8M').kind, 'ignored');
  eq(m.parseSgrMouseEvent('\x1b[<32;10;8M').kind, 'ignored');
  eq(m.parseSgrMouseEvent('\x1b[<0;10;8M').kind, 'left-press');
});

it('promptStartRow defaults to at least 1 on a short terminal', () => {
  eq(new MouseCaret({ rows: 4, cols: 40 }).promptStartRow, 1);
  eq(new MouseCaret({ rows: 24, cols: 80 }).promptStartRow, 18);
  eq(new MouseCaret({ rows: 4, cols: 40, promptStartRow: 3 }).promptStartRow, 3);
});

it('csiUToLegacy maps Enter, Ctrl+T, and Ctrl+/ and drops releases', () => {
  eq(keys.csiUToLegacy('\x1b[13u'), '\r');
  eq(keys.csiUToLegacy('\x1b[116;5u'), '\x14');
  eq(keys.csiUToLegacy('\x1b[47;5u'), '\x1f');
  eq(keys.csiUToLegacy('\x1b[13;1:3u'), null);
  eq(keys.csiUToLegacy('\x1b[97;1:2u'), 'a');
});

it('stripAnsi removes private CSI and OSC window titles', () => {
  eq(stripAnsi('\x1b[?25lHello\x1b[?25h'), 'Hello');
  eq(stripAnsi('\x1b]0;title\x07body'), 'body');
  eq(stripAnsi('\x1b]0;title\x1b\\body'), 'body');
  eq(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

it('backspace and arrows edit the draft instead of inserting the key', () => {
  const w = makeWrapper();
  w._trackInputLine('a');
  w._trackInputLine('b');
  w._trackInputLine('\x7f');
  eq(w._inputBuf, 'a');
  eq(w._inputCursor, 1);
  w._trackInputLine('b');
  w._trackInputLine('\x1b[D');
  w._trackInputLine('c');
  eq(w._inputBuf, 'acb');
  eq(w._inputCursor, 2);
});

it('? opens help after backspace clears the line', () => {
  const w = makeWrapper();
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try {
    w._trackInputLine('a');
    w._trackInputLine('b');
    w._trackInputLine('\x7f');
    w._trackInputLine('\x7f');
    eq(w._inputBuf, '');
    w._dispatchKey('?');
    eq(w.cheatsheet.isOpen, true);
  } finally {
    process.stdout.write = orig;
    if (w.cheatsheet.isOpen) w.cheatsheet.handleInput('x');
  }
});

it('Kitty Enter submits, Ctrl+T toggles speech, and releases are dropped', () => {
  const w = makeWrapper();
  w._dispatchKey('\x1b[13u');
  eq(w._awaitingResponse, true);
  ok(w._writes.includes('\r'));
  eq(w._writes.some(s => String(s).includes('[13u')), false);

  const w2 = makeWrapper();
  eq(w2._ttsOn, false);
  w2._dispatchKey('\x1b[116;5u');
  eq(w2._ttsOn, true);
  eq(w2._writes.length, 0);

  const w3 = makeWrapper();
  w3._dispatchKey('\x1b[13;1:3u');
  w3._dispatchKey('\x1b[116;5:3u');
  eq(w3._writes.length, 0);
  eq(w3._ttsOn, false);
});

it('Ctrl+/ opens the cheatsheet and does not start voice', () => {
  const w = makeWrapper();
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try {
    w._dispatchKey('\x1f');
    eq(w.voice.isRecording, false);
    eq(w.cheatsheet.isOpen, true);
  } finally {
    process.stdout.write = orig;
    if (w.cheatsheet.isOpen) w.cheatsheet.handleInput('x');
  }
});

it('a lone Esc is flushed and a following CSI is not split into Esc', async () => {
  const w = makeWrapper();
  eq(w._assembleKeys('\x1b').length, 0);
  await wait(ESC_FLUSH_MS + 30);
  ok(w._writes.includes('\x1b'));

  const w2 = makeWrapper();
  eq(w2._assembleKeys('\x1b').length, 0);
  const rest = w2._assembleKeys('[A');
  eq(rest[0], '\x1b[A');
  await wait(ESC_FLUSH_MS + 30);
  eq(w2._writes.includes('\x1b'), false);
});

it('Enter on a full queue keeps the draft', () => {
  const w = makeWrapper();
  w._awaitingResponse = true;
  const first = w.promptQueue.enqueue('already');
  ok(first.ok);
  w._inputBuf = 'draft';
  w._inputCursor = 5;
  w._handleEnter();
  eq(w._inputBuf, 'draft');
  eq(w._writes.some(s => s === '\x15'), false);
});

it('a queued prompt is held while a draft is on screen', async () => {
  await withoutHistory(async () => {
    const w = makeWrapper();
    w.promptQueue = new PromptQueue({ maxSize: 5 });
    w._inputBuf = 'draft';
    w._inputCursor = 5;
    w.promptQueue.enqueue('queued');
    w._flushQueueNext();
    eq(w.promptQueue.length, 1);
    eq(w._inputBuf, 'draft');
    eq(w._writes.length, 0);

    w._inputBuf = '';
    w._inputCursor = 0;
    w._flushQueueNext();
    eq(w._inputBuf, 'queued');
    ok(w._writes.includes('queued'));
    eq(w._writes.some(s => String(s).includes('draftqueued')), false);
  });
});

it('settled responses do not include earlier turns', async () => {
  const w = makeWrapper();
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try {
    w._handlePtyOutput('alpha');
    await wait(SETTLE_MS + 40);
    eq(w._lastResponse, 'alpha');
    eq(w._responseBuf, '');
    w._handlePtyOutput('beta');
    await wait(SETTLE_MS + 40);
    eq(w._lastResponse, 'beta');
  } finally {
    process.stdout.write = orig;
  }
});

it('cheatsheet on a 24-row terminal still draws the close hint and border', () => {
  const sheet = new CheatSheet();
  const origWrite = process.stdout.write;
  const prevRows = process.stdout.rows;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  try {
    try {
      Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });
    } catch { /* rows may already be 24 in a non-tty */ }
    sheet._render({ voice: {}, notifications: {} });
    ok(out.includes('Press any key to close'));
    ok(out.includes('╰'));
    const hintAt = out.lastIndexOf('Press any key to close');
    const borderAt = out.lastIndexOf('╰');
    ok(borderAt > hintAt);
  } finally {
    process.stdout.write = origWrite;
    try {
      Object.defineProperty(process.stdout, 'rows', { value: prevRows, configurable: true });
    } catch {}
  }
});

it('Linux speech that was stopped does not fall through to the next engine', () => {
  const tts = new TTS({});
  const spawned = [];
  tts._spawn = (cmd, args) => {
    const proc = fakeProc();
    spawned.push({ cmd, args, proc });
    return proc;
  };
  let resolved = false;
  const done = () => { resolved = true; };
  tts._cancel = done;
  const cmds = tts._linuxCommands('hello');
  eq(cmds[0][1][cmds[0][1].length - 2], '--');
  eq(cmds[0][1][cmds[0][1].length - 1], 'hello');
  tts._tryLinuxChain(cmds, 0, done);
  eq(spawned.length, 1);
  eq(spawned[0].cmd, 'spd-say');
  tts.stop();
  spawned[0].proc.emit('exit', 1);
  eq(spawned.length, 1);
  ok(resolved);
  eq(tts.isSpeaking, false);
});

it('a newer utterance keeps its process when the previous one exits', () => {
  const tts = new TTS({});
  const spawned = [];
  tts._spawn = (cmd, args) => {
    const proc = fakeProc();
    spawned.push({ cmd, args, proc });
    return proc;
  };
  tts._tryLinuxChain([['spd-say', ['--', 'a']]], 0, () => {});
  tts._tryLinuxChain([['spd-say', ['--', 'b']]], 0, () => {});
  eq(spawned.length, 2);
  ok(tts._proc === spawned[1].proc);
  spawned[0].proc.emit('exit', 0);
  ok(tts._proc === spawned[1].proc);
  ok(tts.isSpeaking);
  tts.stop();
  ok(spawned[1].proc.killed);
  eq(tts.isSpeaking, false);
});

it('OS speech puts -- before text that starts with a dash', async () => {
  const tts = new TTS({ engine: 'os' });
  let captured = null;
  tts._spawn = (cmd, args) => {
    captured = { cmd, args };
    const proc = fakeProc();
    process.nextTick(() => proc.emit('exit', 0));
    return proc;
  };
  await tts._speakOs('-n flags');
  eq(captured.cmd, 'say');
  const dash = captured.args.indexOf('--');
  ok(dash >= 0);
  eq(captured.args[dash + 1], '-n flags');
});

it('a missing play and aplay falls back to OS speech instead of crashing', async () => {
  const tts = new TTS({ engine: 'piper', voice: __filename });
  const cmds = [];
  tts._spawn = (cmd, args) => {
    cmds.push(cmd);
    const proc = fakeProc();
    if (cmd === 'play' || cmd === 'aplay') {
      process.nextTick(() => proc.emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' })));
    }
    if (cmd === 'say') process.nextTick(() => proc.emit('exit', 0));
    return proc;
  };
  await tts._speakPiper('hello');
  ok(cmds.includes('play'));
  ok(cmds.includes('aplay'));
  ok(cmds.includes('say'));
  eq(tts.isSpeaking, false);
});

it('stop kills the Piper player as well as piper', async () => {
  const tts = new TTS({ engine: 'piper', voice: __filename });
  let player = null;
  let piper = null;
  tts._spawn = (cmd) => {
    const proc = fakeProc();
    if (cmd === 'piper') piper = proc;
    if (cmd === 'play') player = proc;
    return proc;
  };
  const pending = tts._speakPiper('hello');
  ok(tts.isSpeaking);
  tts.stop();
  ok(player.killed);
  ok(piper.killed);
  eq(tts.isSpeaking, false);
  piper.emit('exit', null);
  player.emit('exit', null);
  await pending;
});

it('readImage asks wl-paste and xclip for a raw PNG buffer', async () => {
  const out = path.join(os.tmpdir(), `cursor-plus-bugfix-${process.pid}.png`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x80, 0x01]);
  try {
    const got = await clipboard.readImage({
      platform: 'linux',
      outPath: out,
      execFile: (cmd, args, opts, cb) => {
        eq(cmd, 'wl-paste');
        eq(opts.encoding, 'buffer');
        ok(opts.maxBuffer >= 64 * 1024 * 1024);
        cb(null, png);
      },
    });
    eq(got, out);
    deepEq([...fs.readFileSync(out)], [...png]);
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
});

it('readImage uses the same buffer options for xclip', async () => {
  const out = path.join(os.tmpdir(), `cursor-plus-bugfix-xclip-${process.pid}.png`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x80]);
  const seen = [];
  try {
    await clipboard.readImage({
      platform: 'linux',
      outPath: out,
      execFile: (cmd, args, opts, cb) => {
        seen.push(cmd);
        eq(opts.encoding, 'buffer');
        if (cmd === 'wl-paste') return cb(new Error('no wl-paste'));
        cb(null, png);
      },
    });
    deepEq(seen, ['wl-paste', 'xclip']);
    deepEq([...fs.readFileSync(out)], [...png]);
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
});

it('the formula installs cursor-plus at the formula version', () => {
  const rb = fs.readFileSync(path.join(__dirname, '..', 'Formula', 'cursor-plus.rb'), 'utf8');
  ok(rb.includes('cursor-plus@#{version}'));
  eq(rb.includes('cursor-plus@0.1.6'), false);
});

it('the release workflow uses the dispatch tag and fails on an empty tarball', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  ok(yml.includes('INPUT_TAG'));
  ok(yml.includes('inputs.tag'));
  ok(yml.includes('tarball missing or empty'));
  ok(yml.includes('exit 1'));
  eq(yml.includes('VERSION="${GITHUB_REF_NAME#v}"'), false);
});
