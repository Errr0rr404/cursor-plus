# Roadmap

Status of cursor-plus against the phases laid out in [PLAN.md](./PLAN.md).

**Born** 2026-09-23 (`v0.1.0`). **Current** 0.1.7, released 2026-10-23. Version history: [CHANGELOG.md](./CHANGELOG.md). Unit tests: 174.

## ✅ Phase 0 — Scaffold (complete)

- [x] `package.json`, MIT `LICENSE`, `.gitignore`
- [x] `bin/cursor+` flag dispatch
- [x] `src/wrapper.js` PTY forwarder to `cursor-agent`
- [x] Binary resolution + refusal of non-Cursor `agent`
- [x] `config.js`, `logger.js`, `cheatsheet.js`
- [x] `scripts/postinstall.js` (node-pty chmod)
- [x] `--doctor` / `--version` / `--help-plus`
- [x] Zero-dep test runner + unit tests (174 as of 0.1.7)

**Exit criteria met:** `cursor+` opens an interactive Cursor CLI session indistinguishable from bare `cursor-agent` for normal typing. ✓

## ✅ Phase 1 — Twin P0s: Voice + Click-to-caret (complete)

- [x] `voice.js` (ffmpeg + whisper.cpp, manual + auto-stop-on-silence)
- [x] `keys.js` hold-Space + Ctrl+Space
- [x] `mouse-caret.js` SGR mouse + shadow buffer + arrow injection
- [x] `text-inject.js`
- [x] `--setup` downloads Whisper `base.en` + lists audio devices
- [x] Cheatsheet entries; `--doctor` checks for Kitty protocol / mouse / binaries
- [x] Tests for key parsing, mouse CSI parse, inject sanitize, buffer math

**Exit criteria met:** Hold-Space (or Ctrl+Space) dictates into prompt; click repositions caret on short/medium single-line drafts. ✓

## ✅ Phase 2 — Hands-free + multimodal (largely complete)

- [x] Piper TTS + OS fallback; Ctrl+T
- [x] Screenshot Ctrl+P (region + full-screen fallback on all 3 OSes)
- [x] Clipboard Ctrl+Y (Windows images included)
- [x] Notifications on idle (OS / bell / webhook + cooldown)
- [x] Queue + stash
- [x] Safety scanner
- [ ] Mouse-caret multi-line / soft-wrap scroll heuristics (current: passable for short prompts, full soft-wrap with 6-line viewport scroll deferred to 0.2)

**Exit criteria met:** Can dictate → agent → hear summary; paste/screenshot images into prompt on all three OSes. ✓

### Pre-ship review (2026-09-23)

Critical path fixes before considering v0.1.0 good to go:

- [x] safety private-key `/g` (test OOM)
- [x] Kitty CSI-u event-type parse (hold-Space release)
- [x] Mouse on stdin + CSI reassembly
- [x] Notify cooldown wiring
- [x] Notification / TTS command-injection hardening
- [x] Binary resolve vs foreign `agent` CLIs
- [x] Hold-Space tap vs hold threshold
- [x] Unit tests green under a 512MB heap cap (121 at that review; 174 as of 0.1.7)

## 🚧 Phase 3 — Power pack (partial)

Shipped:

- [x] History + search (`--history [query]`). Each entry stores `ts`, the time the prompt was submitted. Log: `~/.cursor-plus/history.jsonl`
- [x] Bookmarks / snippets (`--snippets`, Ctrl+B). Each bookmark stores its own `ts`
- [x] Homebrew tap [`errr0rr404/homebrew-cursor-plus`](https://github.com/Errr0rr404/homebrew-cursor-plus) (since 0.1.1, 2026-09-23) and the tag-triggered formula update workflow

Still planned:

- [ ] Workflows (YAML chains in `~/.cursor-plus/workflows/`)
- [ ] Multi-session monitor (`--monitor`)
- [ ] File picker (Ctrl+O → `@path`)
- [ ] Git / context hotkey (avoiding Cursor's Ctrl+G conflict)
- [ ] Shell inject (`!cmd` prefix)
- [ ] Wake word ("hey cursor")
- [ ] Local usage meter (Cursor's `/usage` remains source of truth)
- [ ] Plugins (`~/.cursor-plus/plugins/*.js` hooks)
- [ ] Config share (`--export-config` / `--import-config`)
- [ ] Kokoro TTS engine (higher quality, opt-in)
- [ ] mlx-whisper path (Apple Silicon opt-in)

## Non-goals (v1)

- Replacing Cursor model picker / BYO custom models
- Full IDE↔CLI session sync
- Full hooks parity (`afterAgentResponse`, etc.)
- Patching Cursor's closed-source TUI binary directly

## Open questions

1. Confirm Ctrl+P / Ctrl+Y free on current `cursor-agent` builds (manual keymap audit).
2. Ship Piper binary download in `--setup` vs document `brew install piper-tts` where available?
3. Resolved 2026-09-23: first public tag was `v0.1.0`. Current tag is `v0.1.7` (2026-10-23).
4. Resolved: the tap is [`Errr0rr404/homebrew-cursor-plus`](https://github.com/Errr0rr404/homebrew-cursor-plus).