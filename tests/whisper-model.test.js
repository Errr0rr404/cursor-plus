'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { eq, ok } = require('./_assert');
const config = require('../src/config');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-plus-whisper-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

it('isUsableWhisperModel rejects missing paths', () => {
  eq(config.isUsableWhisperModel('/no/such/ggml-base.en.bin'), false);
  eq(config.isUsableWhisperModel(''), false);
  eq(config.isUsableWhisperModel(null), false);
});

it('isUsableWhisperModel rejects empty / tiny stubs', () => {
  withTempDir((dir) => {
    const empty = path.join(dir, 'empty.bin');
    const tiny = path.join(dir, 'tiny.bin');
    fs.writeFileSync(empty, '');
    fs.writeFileSync(tiny, Buffer.alloc(512)); // far below 1 MiB threshold
    eq(config.isUsableWhisperModel(empty), false);
    eq(config.isUsableWhisperModel(tiny), false);
  });
});

it('isUsableWhisperModel accepts a file at or above the min size', () => {
  withTempDir((dir) => {
    const okPath = path.join(dir, 'ok.bin');
    // Sparse truncate to threshold without allocating a huge buffer.
    const fd = fs.openSync(okPath, 'w');
    fs.ftruncateSync(fd, config.WHISPER_MODEL_MIN_BYTES);
    fs.closeSync(fd);
    ok(config.isUsableWhisperModel(okPath));
  });
});

it('WHISPER_MODEL_MIN_BYTES is 1 MiB', () => {
  eq(config.WHISPER_MODEL_MIN_BYTES, 1024 * 1024);
});
