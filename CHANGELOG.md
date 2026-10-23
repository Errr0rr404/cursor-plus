# Changelog

All notable changes to cursor-plus are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

The project was born on **2026-09-23** (`v0.1.0`). Every published npm version is listed below. `0.1.2`, `0.1.3`, and `0.1.4` are version-only republishes; the product changes are in the other entries.

## [Unreleased]

### Fixed

- **wrapper:** `node-pty` loads when the PTY starts. The release workflow installs with `--ignore-scripts`, and node-pty 1.1.0 has no Linux prebuild, so a top-level import failed `npm test` on the runner before any test ran.

## [0.1.7] — 2026-10-23

### Fixed

- **clipboard:** Linux image paste keeps PNG bytes (`encoding: 'buffer'`) instead of UTF-8 replacement characters
- **input:** backspace and left/right arrows update the draft buffer; a bare Esc is delivered; Kitty CSI-u keys (Enter, Ctrl+T, Ctrl+/) map back to legacy bytes and key-up events are dropped
- **keys:** Ctrl+/ opens the cheatsheet again (`\x1f` is no longer treated as Ctrl+Space)
- **mouse:** wheel and drag are not left-clicks; the prompt row stays on screen when the terminal is shorter than 7 rows
- **safety:** `redact()` merges overlapping secrets so text after a bearer JWT is kept
- **queue:** a full queue no longer wipes the draft; a queued prompt is not concatenated onto text the user is still typing
- **responses:** spoken and bookmarked text is only the latest settled turn, with private CSI and window-title sequences stripped
- **inject:** clipboard and voice text cannot carry Ctrl+C, Esc, or Ctrl+U into the PTY
- **tts:** stopping Linux speech does not replay it on the next engine; a newer utterance keeps its process handle; a missing `play`/`aplay` falls back to the OS voice; text that starts with `-` is not parsed as a flag
- **config:** `null` or non-object `config.json` no longer crashes `load()` or `patch()`
- **cheatsheet:** the close hint and bottom border stay visible on a 24-row terminal
- **theme:** `NO_COLOR` disables ANSI colour
- **release:** Homebrew installs `cursor-plus@#{version}`; manual dispatch uses the typed tag and fails when the npm tarball is missing

## [0.1.6] — 2026-09-23

### Fixed

- **onboarding:** whisper model download now bridges Node's Web `ReadableStream` via `Readable.fromWeb` + `pipeline` (the old `.pipe()` path left a 0-byte stub and broke all voice transcription)
- **config / voice:** reject empty or truncated model files (`< 1 MiB`) so `--setup` re-downloads and whisper-cli no longer fails with an opaque "failed to initialize whisper context"
- **config:** also discover `~/.copilot/models/ggml-base.en.bin` as a fallback candidate

## [0.1.5] — 2026-09-23

### Fixed

- **keys:** Kitty detection waits out the probe timeout, so a late Kitty reply still wins when the terminal also answers the DEC DA1 probe
- **keys:** legacy Kitty release/repeat bits in the modifier field are recognized (a release is no longer treated as a press)
- **mouse:** SGR parsing is anchored, so a CSI sequence that merely contains `<n;n;nM` is not a click
- **voice:** hold threshold comes from `voice.holdSpaceMs` (default 180 ms)
- **doctor:** finds the node-pty spawn-helper under npm-global, Homebrew, nvm, or a source checkout and chmod's it

### Removed

- Dead `_busy` and `_recording` mirrors on the wrapper. The voice module's `isRecording` is the source of truth.

## [0.1.4] — 2026-09-23

### Changed

- No product changes from 0.1.3. The release workflow keeps going when the npm publish call returns 404, so the Homebrew formula update can still run.

## [0.1.3] — 2026-09-23

### Changed

- No product changes from 0.1.2. Republish so the release runner uses npm 12 (granular tokens).

## [0.1.2] — 2026-09-23

### Changed

- No product changes from 0.1.1. Republish from the same commit after `NODE_AUTH_TOKEN` was moved to the job environment.

## [0.1.1] — 2026-09-23

Pre-ship review of the 0.1.0 scaffold, published the same day.

### Fixed

- **safety:** private-key regex now uses `/g` (non-global `exec` loop previously OOMed `npm test` at ~4GB); `redact()` uses the real match length so a truncated snippet does not leave the tail of a secret
- **safety:** AWS STS tokens (`ASIA…`) are detected
- **keys:** Kitty CSI-u parsing now uses `modifiers:event-type` (`:3` = release) per Kitty spec — hold-Space can actually stop
- **wrapper:** SGR mouse clicks are parsed from **stdin** (not PTY output); CSI sequences are reassembled across reads
- **wrapper:** Kitty protocol is enabled only after a successful probe (no longer left on for non-Kitty terminals)
- **wrapper:** Hold-Space uses a short hold threshold so taps still type a normal space
- **wrapper:** queued prompts are submitted through `_handleEnter()` instead of stuffing a carriage return into sanitized text
- **wrapper:** `_notifyCooldown` is wired via `notifyRules.createCooldown` (was an undefined call on settle)
- **notify / tts:** OS notification + Windows SAPI no longer interpolate untrusted strings into shell/AppleScript/PowerShell command lines
- **resolve-binary:** trust `cursor-agent` by name; reject foreign agents (grok / copilot / claude / codex) with tighter markers
- **keys:** `HOTKEYS` no longer maps voice → Ctrl+R (Cursor review stays untouched)

### Added

- Homebrew tap [`errr0rr404/homebrew-cursor-plus`](https://github.com/Errr0rr404/homebrew-cursor-plus)
- Tag-triggered release workflow: tests, npm publish, formula sha256 update

## [0.1.0] — 2026-09-23

Initial release. First commit and first npm publish, both on this date. Implements the Phase 0 + Phase 1 + early Phase 2 milestone from [PLAN.md](./PLAN.md).

### Added

- **`cursor+` binary** with full flag dispatch:
  - `--setup` / `--preferences` — interactive setup wizard (downloads whisper base.en, picks mic, prints hotkey cheatsheet)
  - `--doctor` — environment + config health check (binary resolution, model/audio detection, terminal capability hints)
  - `--version`, `--help-plus`
  - `--print-bin` — emit the resolved `cursor-agent` path (handy for CI)
  - `--history` / `--snippets` — local prompt history and bookmarks. Each prompt is stored with an ISO-8601 `ts` (the time it was submitted). Each bookmark stores its own `ts`.
- **`src/wrapper.js`** PTY wrapper around `cursor-agent` (node-pty), with key interception, idle detection, and queue flushing
- **`src/keys.js`** — Kitty keyboard protocol detection, hold-Space / Ctrl+Space parsing, mouse enable/disable, single-byte control codes
- **`src/mouse-caret.js`** — SGR mouse event parser, shadow draft buffer, soft-wrap-aware caret math, synthetic arrow-key injection
- **`src/voice.js`** — ffmpeg microphone recorder (start / stop / auto-stop-on-silence) + whisper.cpp transcriber with model + language flags
- **`src/tts.js`** — Piper (preferred) with `say` / SAPI / `spd-say` / `espeak` fallback; `summarize()` strips code fences + ANSI
- **`src/screenshot.js`** — `screencapture` / `grim` / `import` / PowerShell region picker; writes PNG to `~/.cursor-plus/screenshots/`
- **`src/clipboard.js`** — text (pbpaste / wl-paste / xclip) + image (osascript / wl-paste --type image / Win Forms Clipboard) — Windows image path covered
- **`src/safety.js`** — heuristic scanner for AWS / GitHub / OpenAI / Anthropic / Slack / private keys / JWT / Stripe credentials with `redact()`
- **`src/prompt-queue.js`** — FIFO queue with maxSize; flushed when response settles
- **`src/prompt-stash.js`** — single-user JSON file at `~/.cursor-plus/prompt-stash.json` with `current` pointer + 50-entry history
- **`src/notify-rules.js`** — OS / bell / webhook channels with per-rule cooldown
- **`src/cheatsheet.js`** — overlay TUI with in-app hotkey reference
- **`src/config.js`** — load / save / patch / validate; deep-merges nested objects; `findWhisperModel()` + mic detection
- **`src/logger.js`** — leveled logger (debug / info / warn / error) with 1MB rotation
- **`src/theme.js`** — dark / light / solarized / monokai / auto palettes
- **`src/resolve-binary.js`** — Cursor agent resolution (env > `cursor-agent` > `agent` only if it identifies as Cursor's)
- **`scripts/postinstall.js`** — chmod node-pty spawn-helper on macOS / Linux
- **Zero-dep test runner** + unit tests covering key parsing, mouse caret math, text injection, prompt queue, stash, notify, theme, config, TTS summarize, logger, and safety

### Notes

- `Ctrl+R` is **never** stolen — Cursor CLI uses it for code review.
- Voice activation respects the plan: hold-Space in Kitty terminals, Ctrl+Space toggle fallback everywhere else.
- The wrapper never replaces Cursor's PTY session — typing into `cursor+` looks identical to typing into bare `cursor-agent` until you trigger an enhancement.
- Still deferred at this version (Phase 3): workflows, multi-session monitor, plugins, wake word, Kokoro TTS, mlx-whisper. The Homebrew tap followed later the same day in 0.1.1.
