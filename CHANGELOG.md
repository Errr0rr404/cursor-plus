# Changelog

All notable changes to cursor-plus are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-09-23

Initial scaffold. Implements the Phase 0 + Phase 1 + early Phase 2 milestone from [PLAN.md](./PLAN.md).

### Added

- **`cursor+` binary** with full flag dispatch:
  - `--setup` / `--preferences` — interactive setup wizard (downloads whisper base.en, picks mic, prints hotkey cheatsheet)
  - `--doctor` — environment + config health check (binary resolution, model/audio detection, terminal capability hints)
  - `--version`, `--help-plus`
  - `--print-bin` — emit the resolved `cursor-agent` path (handy for CI)
  - `--history` / `--snippets` — local prompt history and bookmarks
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
- **Zero-dep test runner** + 121 unit tests covering key parsing, mouse caret math, text injection, prompt queue, stash, notify, theme, config, TTS summarize, logger, and safety

### Fixed (pre-ship review)

- **safety:** private-key regex now uses `/g` (non-global `exec` loop previously OOMed `npm test` at ~4GB)
- **keys:** Kitty CSI-u parsing now uses `modifiers:event-type` (`:3` = release) per Kitty spec — hold-Space can actually stop
- **wrapper:** SGR mouse clicks are parsed from **stdin** (not PTY output); CSI sequences are reassembled across reads
- **wrapper:** Kitty protocol is enabled only after a successful probe (no longer left on for non-Kitty terminals)
- **wrapper:** Hold-Space uses a short hold threshold so taps still type a normal space
- **wrapper:** `_notifyCooldown` is wired via `notifyRules.createCooldown` (was an undefined call on settle)
- **notify / tts:** OS notification + Windows SAPI no longer interpolate untrusted strings into shell/AppleScript/PowerShell command lines
- **resolve-binary:** trust `cursor-agent` by name; reject foreign agents with tighter markers (avoid false rejects when Cursor help mentions other models)
- **keys:** `HOTKEYS` no longer maps voice → Ctrl+R (Cursor review stays untouched)

### Notes

- `Ctrl+R` is **never** stolen — Cursor CLI uses it for code review.
- Voice activation respects the plan: hold-Space in Kitty terminals, Ctrl+Space toggle fallback everywhere else.
- The wrapper never replaces Cursor's PTY session — typing into `cursor+` looks identical to typing into bare `cursor-agent` until you trigger an enhancement.
- Still deferred (Phase 3): workflows, multi-session monitor, plugins, wake word, Kokoro TTS, mlx-whisper, Homebrew tap automation.
