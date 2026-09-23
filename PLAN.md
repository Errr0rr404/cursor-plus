# cursor-plus — Product & Build Plan

> Living plan for **cursor-plus**: a drop-in PTY wrapper that adds voice, click-to-caret, TTS, screenshots, and power-user UX around the official Cursor Agent CLI (`cursor-agent`).
>
> Reference implementation: [`../copilot-plus`](../copilot-plus) (GitHub Copilot CLI wrapper).
>
> Status: **planning** · Target bin: `cursor+` · Config: `~/.cursor-plus/`

---

## 1. Problem statement

Cursor’s desktop Agent has Voice Mode and a rich chat input. The **Cursor CLI** (`cursor-agent` / `agent`) is text/keyboard-first and is missing several UX pieces that users already expect from Claude Code / Copilot CLI / the Cursor IDE.

**cursor-plus does not replace Cursor CLI.** Users still need a Cursor subscription and `cursor-agent` on `PATH`. We wrap the process, intercept stdin/stdout, and inject enhancements.

---

## 2. What people complain about (Cursor CLI gaps)

Sources: Cursor forum feature requests / bug reports, staff replies, and gaps vs `copilot-plus` / Claude Code.

| Gap | Evidence / notes | In cursor-plus? |
|-----|------------------|-----------------|
| **No voice dictation** | [CLI Voice Input](https://forum.cursor.com/t/cursor-cli-voice-input/165368) — staff: “haven’t gotten around to it yet” | **P0 — yes** |
| **No click-to-position caret** | [Cursor position in CLI](https://forum.cursor.com/t/cursor-position-in-cli/162547) — users compare to Claude Code | **P0 — yes** |
| **Long-prompt editing pain** | Fixed ~6-line input; caret follow / scroll bugs ([169212](https://forum.cursor.com/t/cursor-cli-is-not-scrolling-appropriate-to-the-size-of-the-prompt/169212), [167532](https://forum.cursor.com/t/cli-input-window-jumps-cant-see-caret/167532), [165923](https://forum.cursor.com/t/cli-regression-in-2026-07-08-multi-line-prompt-cursor-navigation-broken/165923)) | **P0/P1** — click-to-caret + `$EDITOR` escape hatch |
| **No local TTS / hands-free loop** | IDE has mic; CLI has neither STT nor TTS | **P1 — yes** |
| **Screenshot → attach hotkey** | `@path` / drag-drop only; no region picker | **P1 — yes** |
| **Clipboard images flaky / missing** | Windows still broken; mac/Linux improved but bugs reported | **P1 — yes** (esp. Windows) |
| **Hooks parity incomplete** | `afterAgentResponse` / `afterAgentThought` still missing in local CLI; cloud worse | Partial via PTY sniffing only — **not full hooks** |
| **Custom / BYO models on CLI** | IDE yes, CLI no | **Out of scope** (needs Cursor) |
| **Done / idle notifications** | Common ask for long agent runs | **P1 — yes** |
| **Prompt queue, stash, workflows, safety, multi-session monitor** | Loved in copilot-plus; thin in Cursor CLI | **P1–P2 — port** |

### What Cursor CLI already does well (do not reinvent)

- Plan / Ask modes, Shift+Tab mode rotate
- Cloud handoff (`&` prefix)
- `--worktree`, resume / `agent ls`
- MCP, rules, `/usage`, Mermaid ASCII
- Shell command approval, sandbox flags
- Image paste on macOS/Linux (recent fixes)

---

## 3. Product definition

| Item | Value |
|------|--------|
| Name | **cursor-plus** |
| Binaries | `cursor+` (primary) |
| Wraps | `cursor-agent` (preferred); never confuse with unrelated `agent` CLIs (e.g. Grok) |
| Runtime | Node ≥ 18 |
| Platforms | macOS, Linux, Windows |
| License | MIT (planned) |
| Config dir | `~/.cursor-plus/` |
| Config file | `~/.cursor-plus/config.json` |
| Models dir | `~/.cursor-plus/models/` |
| Agent state | `~/.cursor-plus/agents/*.json` |
| Log | `~/.cursor-plus/cursor-plus.log` |

### Binary resolution order

1. `CURSOR_AGENT_BIN` env override  
2. `cursor-agent` on `PATH`  
3. `agent` **only if** version/about output identifies as Cursor (reject Grok / other `agent` tools)

---

## 4. Architecture

Same pattern as copilot-plus: **Node.js PTY wrapper** (`node-pty`).

```
cursor+  →  node-pty  →  cursor-agent (official Cursor CLI)
              ↑
     hold-Space STT · mouse caret · TTS · hotkeys · queue · …
```

```
bin/cursor+
src/
  wrapper.js       # PTY + key/mouse dispatch
  keys.js          # Kitty keyboard protocol + hold-Space state machine
  mouse-caret.js   # SGR mouse → caret move via arrow injection
  voice.js         # ffmpeg record + whisper.cpp STT
  tts.js           # Piper (default) + OS fallback
  piper.js         # download / invoke Piper voices
  text-inject.js   # sanitize + inject into child PTY
  screenshot.js
  clipboard.js
  safety.js
  prompt-queue.js
  prompt-stash.js
  notify-rules.js
  history.js
  bookmarks.js
  workflows.js
  monitor.js
  worktree.js      # thin helper; prefer Cursor’s --worktree when possible
  config.js
  onboarding.js
  cheatsheet.js
  plugin.js
  logger.js
  doctor.js        # or --doctor in bin
scripts/
  postinstall.js   # chmod node-pty spawn-helper (macOS/Linux)
Formula/
  cursor-plus.rb   # Homebrew
.github/workflows/
  release.yml      # npm publish + tap formula update
```

### Injection strategy

- Typed / voice / clipboard / screenshot content is written into the **child PTY** as if the user typed it.
- Optional `autoSubmit` sends `\r` after voice.
- Mouse caret moves by injecting Left/Right (or Home + N× Right) after computing a target index from a **shadow draft buffer**.

---

## 5. P0 features (detailed)

### 5.1 Hold-Space voice dictation (STT)

| Action | Behavior |
|--------|----------|
| **Hold Space** | Start mic → record while held → release → transcribe → inject into prompt |
| **Ctrl+Space** | Toggle record (works in all terminals) |
| **Ctrl+C** | Cancel active recording |
| Config | `autoSubmit`, `voicePreview`, `voiceLanguage`, `audioDevice`, `modelPath` |

**Terminal constraint:** classic TTYs do **not** send key-up. True hold-to-talk requires the **Kitty keyboard protocol** (Kitty, WezTerm, Ghostty, and similarly capable terminals).

| Mode | Terminals | Behavior |
|------|-----------|----------|
| Hold Space | Kitty protocol enabled | Press = start, release = stop + transcribe |
| Ctrl+Space toggle | Everywhere | Start/stop |
| Empty-prompt Space + silence | Optional fallback | Start on Space when buffer empty; stop on silence or second Space |

**Do not** bind voice to **Ctrl+R** — Cursor CLI already uses Ctrl+R for change review (unlike copilot-plus).

#### Local STT stack (default)

| Tier | Engine / model | Notes |
|------|----------------|-------|
| **Default** | **whisper.cpp** + `ggml-base.en` | Same proven path as copilot-plus; ~140MB; offline |
| Quality | `ggml-small.en` or multilingual `base` | Config swap |
| Apple Silicon optional | mlx-whisper | Faster on M-series; phase 1.1+ |

Pipeline: `ffmpeg` → 16 kHz mono WAV → `whisper-cli` / whisper.cpp → text → inject.

Deps: `ffmpeg`, `whisper-cpp` (or bundled/downloaded CLI), mic permission for the terminal app.

### 5.2 Click-to-caret in the type bar

**Problem:** After ~300 characters, users must arrow-key back; clicking does nothing. Confirmed feature request vs Claude Code.

**Solution module:** `mouse-caret.js`

1. **Enable mouse reporting** on start: SGR `1006h` + button tracking `1000h` (or `1002h`). Disable on exit.
2. **Shadow draft buffer:** track typed chars, Backspace/Delete, arrows, Home/End, multi-line (Shift+Enter / Ctrl+J), and all injected text (voice, clipboard, etc.).
3. **On left-click** in the input region `(x, y)`:
   - Map to target character index (soft-wrap aware; unicode width via a small width helper).
   - Inject `|delta|` Left/Right (or Home + N× Right if shadow drifted).
   - Update shadow caret.
4. **Ignore** clicks outside the input region (don’t break transcript scroll).
5. **Fallbacks:**
   - Shadow desync → absolute move from line start.
   - Surface Cursor’s **Ctrl+G** (`$VISUAL` / `$EDITOR`) in the cheatsheet for huge prompts.
   - Disable or carefully handle when CLI vim mode is on.

| Version | Mouse-caret capability |
|---------|-------------------------|
| **v0.1** | Single-line + short wrapped prompts |
| **v0.2** | Multi-line + soft-wrap + 6-line viewport scroll heuristics |

### 5.3 Scaffold + doctor

- Launch wrapper that fully forwards to `cursor-agent` when no enhancement triggers.
- `cursor+ --setup` — mic, ffmpeg, whisper model, Piper voice.
- `cursor+ --doctor` — binaries, model files, terminal capabilities (Kitty protocol? mouse?).
- `cursor+ --help-plus`, `--version`, `--preferences`.

---

## 6. P1 features

### 6.1 Local TTS (speak agent replies)

| Engine | Role | Size / speed |
|--------|------|----------------|
| **Piper (default)** | Best local CPU TTS for a CLI | ~20–50MB/voice; ~10–20× realtime |
| **Kokoro-82M (optional)** | Higher quality | ~120–330MB; slower on CPU |
| **OS fallback** | Zero install | macOS `say`, Windows SAPI, Linux `spd-say` / `espeak-ng` |

- Toggle: **Ctrl+T**
- Strip code fences / ANSI before speaking (port `summarizeResponse` from copilot-plus).
- Barge-in: starting a new recording stops TTS.

### 6.2 Screenshot + clipboard

| Hotkey | Action |
|--------|--------|
| **Ctrl+P** | OS region screenshot → temp PNG → inject `@/abs/path` |
| **Ctrl+Y** | Paste clipboard text or image (Windows image path is a priority fix) |

### 6.3 Notifications

- Idle / waiting-for-input / optional quota-style local alerts.
- Channels: OS notification, terminal bell, optional webhook.
- Port `notify-rules.js` patterns from copilot-plus.

### 6.4 Queue & stash

- **Enter while busy** → enqueue prompt (config `queue.whenBusy`).
- **Ctrl+S** → stash draft (`~/.cursor-plus/prompt-stash.json`).

### 6.5 Safety scanner

- Scan outgoing prompts for common secrets / private-key headers.
- Prompt: send / redact / cancel; optional `autoRedact`.

---

## 7. P2 features (port from copilot-plus)

| Feature | Notes |
|---------|--------|
| History + search | `cursor+ --history` |
| Bookmarks / snippets | `cursor+ --snippets` |
| Workflows (YAML chains) | `~/.cursor-plus/workflows/` |
| Multi-session monitor | `cursor+ --monitor` |
| File picker | Ctrl+O → `@path` |
| Git / context hotkey | Ctrl+G — **avoid conflict** with Cursor’s Ctrl+G editor open; pick alternate (e.g. Ctrl+Shift+G) or palette-only |
| Shell inject | `!cmd` prefix |
| Theme engine | dark / light / solarized / monokai / auto |
| Plugins | `~/.cursor-plus/plugins/*.js` hooks |
| Config share | `--export-config` / `--import-config` |
| Wake word | optional “hey cursor” |
| Usage meter | local history burn (Cursor `/usage` remains source of truth for account) |

### Hotkey conflict matrix (must resolve in implementation)

| Key | Cursor CLI native | cursor-plus plan |
|-----|-------------------|------------------|
| Ctrl+R | Review changes | **Passthrough** — never steal for voice |
| Ctrl+G | Open draft in `$EDITOR` | **Passthrough**; cheatsheet documents it; context inject uses another binding |
| Ctrl+O | Toggle Mermaid source (docs) | Prefer palette / alternate for file picker if conflict confirmed |
| Space | Type space | Hold only when Kitty protocol + (empty buffer or explicit hold state) |
| Ctrl+Space | — | Voice toggle |
| Ctrl+T | — | TTS toggle |
| Ctrl+P | — | Screenshot (verify no Cursor conflict) |
| Ctrl+Y | — | Clipboard |
| ? / Ctrl+/ | — | Cheatsheet |

---

## 8. Default config (v0.1 target)

```json
{
  "agentBin": "cursor-agent",
  "voice": {
    "holdSpace": true,
    "fallbackToggle": "ctrl-space",
    "modelPath": "~/.cursor-plus/models/ggml-base.en.bin",
    "audioDevice": null,
    "autoSubmit": false,
    "voicePreview": false,
    "language": "en"
  },
  "mouse": {
    "clickToCaret": true,
    "enabled": true
  },
  "tts": {
    "enabled": false,
    "engine": "piper",
    "voice": "en_US-lessac-medium",
    "fallback": "os",
    "rate": 1.0
  },
  "queue": { "whenBusy": true, "maxSize": 20 },
  "safety": { "enabled": true, "autoRedact": false },
  "notifications": {
    "quiet": false,
    "rules": [
      { "when": "session_idle", "channels": ["os"] }
    ]
  },
  "theme": "auto"
}
```

---

## 9. Phased delivery

### Phase 0 — Scaffold (empty repo → runnable wrapper)

- [ ] `package.json`, MIT `LICENSE`, `.gitignore`
- [ ] `bin/cursor+` flag dispatch
- [ ] `src/wrapper.js` PTY forwarder to `cursor-agent`
- [ ] Binary resolution + refusal of non-Cursor `agent`
- [ ] `config.js`, logger, cheatsheet stub
- [ ] `scripts/postinstall.js` (node-pty chmod)
- [ ] `cursor+ --doctor` / `--version` / `--help-plus`
- [ ] Zero-dep unit test runner (mirror copilot-plus)

**Exit criteria:** `cursor+` opens an interactive Cursor CLI session indistinguishable from bare `cursor-agent` for normal typing.

### Phase 1 — Twin P0s: Voice + Click-to-caret

- [ ] Port/adapt `voice.js` (ffmpeg + whisper.cpp)
- [ ] `keys.js` hold-Space + Ctrl+Space
- [ ] `mouse-caret.js` SGR mouse + shadow buffer + arrow injection
- [ ] `text-inject.js`
- [ ] `--setup` downloads Whisper `base.en` + lists audio devices
- [ ] Cheatsheet entries; doctor checks for Kitty protocol / mouse
- [ ] Tests: key parsing, mouse CSI parse, inject sanitize, buffer math

**Exit criteria:** Hold-Space (or Ctrl+Space) dictates into prompt; click repositions caret on short/medium single-line drafts.

### Phase 2 — Hands-free + multimodal

- [ ] Piper TTS + OS fallback; Ctrl+T
- [ ] Screenshot Ctrl+P
- [ ] Clipboard Ctrl+Y (Windows images)
- [ ] Notifications on idle
- [ ] Queue + stash
- [ ] Safety scanner
- [ ] Mouse-caret multi-line / wrap improvements

**Exit criteria:** Can dictate → agent → hear summary; paste/screenshot images into prompt on all three OSes.

### Phase 3 — Power pack

- [ ] History, bookmarks, workflows, monitor, plugins, config share
- [ ] Optional wake word, Kokoro TTS engine, mlx-whisper path
- [ ] Homebrew formula + release automation live

**Exit criteria:** Feature parity with copilot-plus v1.2 where it makes sense for Cursor (minus Copilot-specific quota APIs).

### Explicit non-goals (v1)

- Replacing Cursor model picker / BYO custom models
- Full IDE↔CLI session sync
- Full hooks parity (`afterAgentResponse`, etc.)
- Patching Cursor’s closed-source TUI binary directly

---

## 10. Dependencies

### Runtime (npm)

| Package | Why |
|---------|-----|
| `node-pty` | PTY wrapper (only hard dependency, like copilot-plus) |

Keep the dependency tree minimal. Prefer Node stdlib + shelling out to platform tools.

### System / optional binaries

| Tool | Required for |
|------|----------------|
| Node ≥ 18 | Always |
| `cursor-agent` | Always |
| `ffmpeg` | Voice record |
| whisper.cpp (`whisper-cli` / equivalent) | STT |
| Piper | Local neural TTS |
| grim+slurp / scrot / macOS screencapture / Win APIs | Screenshots |
| wl-clipboard / xclip / pbcopy / PowerShell | Clipboard |
| Terminal with Kitty keyboard protocol | True hold-Space |
| Terminal with mouse reporting | Click-to-caret |

### Model downloads (`cursor+ --setup`)

```bash
mkdir -p ~/.cursor-plus/models

# STT — Whisper base.en (default)
curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
  -o ~/.cursor-plus/models/ggml-base.en.bin

# TTS — Piper voice (default); exact URL pinned in setup script
# e.g. en_US-lessac-medium.onnx + .json → ~/.cursor-plus/models/piper/
```

---

## 11. Deploy & distribution

Mirror the battle-tested **copilot-plus** release path.

### 11.1 Package identity

| Field | Planned value |
|-------|----------------|
| npm name | `cursor-plus` |
| bin | `cursor+` → `bin/cursor+` |
| Engines | `"node": ">=18"` |
| files | `bin/`, `src/`, `scripts/` |
| Registry | https://registry.npmjs.org (public) |

### 11.2 Install channels

**A. npm (primary, all platforms)**

```bash
npm install -g cursor-plus
cursor+ --setup
cursor+ --doctor
cursor+
```

**B. Homebrew (macOS / Linuxbrew)**

```bash
brew tap <OWNER>/cursor-plus
brew install cursor-plus
cursor+ --setup
```

- Formula lives in a separate tap repo: `homebrew-cursor-plus` (same pattern as `homebrew-copilot-plus`).
- Formula `depends_on`: `node`, `ffmpeg`, `whisper-cpp`.
- Piper may be downloaded by `--setup` rather than a brew dep (faster iteration).
- `caveats` block documents model download + hotkeys + `--doctor`.

**C. From source (dev)**

```bash
cd cursor-plus
npm install
npm link          # exposes cursor+ globally
cursor+ --doctor
```

### 11.3 CI / release automation

File: `.github/workflows/release.yml`

**Triggers**

- Push tag `v*` (e.g. `v0.1.0`)
- `workflow_dispatch` with tag input

**Jobs**

1. **publish-npm**
   - checkout
   - setup-node 20 + npm registry
   - `npm ci --ignore-scripts`
   - `npm publish --access public` with `NPM_TOKEN` secret

2. **update-formula** (needs publish-npm; `continue-on-error: true`)
   - checkout tap repo with `HOMEBREW_TAP_TOKEN`
   - compute sha256 of npm tarball `https://registry.npmjs.org/cursor-plus/-/cursor-plus-${VERSION}.tgz`
   - patch `Formula/cursor-plus.rb` url + sha256
   - commit + push

**Secrets required**

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Publish to npm |
| `HOMEBREW_TAP_TOKEN` | Push formula updates to tap |

### 11.4 Versioning & tagging

- SemVer: `0.x` while P0/P1 stabilize; `1.0.0` when Phase 2 exit criteria met.
- Tag format: `v0.1.0` (leading `v` for workflow).
- `CHANGELOG.md` required for every release (Keep a Changelog style).
- GitHub Release notes: highlight hotkeys + OS caveats.

### 11.5 Release checklist (human)

1. [ ] `npm test` green locally  
2. [ ] Manual smoke: voice, click-to-caret, TTS, screenshot on at least one OS  
3. [ ] Bump `package.json` version  
4. [ ] Update `CHANGELOG.md`  
5. [ ] Commit on `main`  
6. [ ] `git tag vX.Y.Z && git push origin main --tags`  
7. [ ] Confirm GitHub Action: npm publish + formula update  
8. [ ] `npm view cursor-plus version` matches tag  
9. [ ] `brew update && brew upgrade cursor-plus` smoke (if tap live)  
10. [ ] Spot-check `cursor+ --doctor` on clean machine notes in release

### 11.6 Postinstall / install pitfalls

| Issue | Mitigation |
|-------|------------|
| `posix_spawnp failed` (node-pty) | `scripts/postinstall.js` chmod spawn-helper; Homebrew formula chmod in `install` |
| Mic permission | Document: enable terminal app in OS Privacy → Microphone |
| Wrong `agent` binary | Resolver prefers `cursor-agent`; doctor prints resolved path + identity |
| Hold-Space silent | Doctor warns if Kitty keyboard protocol unsupported; tell user to use Ctrl+Space |
| Mouse clicks do nothing | Doctor checks mouse reporting; document terminal settings (e.g. iTerm report mouse) |
| Whisper model missing | `--setup` + clear error on first Ctrl+Space / hold-Space |
| npm global on macOS permissions | Document `npm prefix` or prefer Homebrew |

### 11.7 Uninstall

```bash
npm uninstall -g cursor-plus
# or
brew uninstall cursor-plus

# optional user data
rm -rf ~/.cursor-plus
```

Does **not** uninstall `cursor-agent` or Cursor itself.

### 11.8 Security / trust for distribute

- No telemetry by default (log local only).
- Config export must **not** include tokens / webhook secrets (same rule as copilot-plus).
- Voice audio processed **locally** (whisper.cpp / Piper); do not upload WAVs.
- Document that prompts still go to Cursor’s agent cloud as usual when using Cursor CLI.
- Pin model download URLs + checksums in `--setup` where practical.

---

## 12. Testing plan

| Layer | What |
|-------|------|
| Unit | keys hold/release parse, SGR mouse parse, caret index math, unicode width, text-inject sanitize, config load/migrate, safety patterns |
| Integration (manual) | Full PTY session against real `cursor-agent` |
| Doctor CI | Run `--doctor` in CI without mic (expect soft warnings, not crash) |
| Fixture audio | Short WAV → whisper stub or skip if binary absent |

Command: `npm test` (zero-dep runner, mirror copilot-plus `tests/run.js`).

---

## 13. Docs to ship with the product

| File | Purpose |
|------|---------|
| `PLAN.md` | This document (build + deploy plan) |
| `README.md` | Install, hotkeys, requirements, troubleshooting |
| `ROADMAP.md` | Status board after v0.1 exists |
| `CHANGELOG.md` | Release history |
| `docs/` | Optional deeper specs (hold-Space, mouse-caret) |

---

## 14. Decisions locked (as of plan write-up)

| Decision | Choice |
|----------|--------|
| Architecture | PTY wrapper (not a Cursor fork) |
| STT default | whisper.cpp + `ggml-base.en` |
| TTS default | Piper; OS fallback; Kokoro optional later |
| Voice primary UX | Hold Space (Kitty protocol) + Ctrl+Space fallback |
| Caret UX | Click-to-position via mouse reporting + shadow buffer |
| Ctrl+R | Never steal (Cursor review) |
| Package name / bin | `cursor-plus` / `cursor+` |
| Deploy | npm global + Homebrew tap + tag-triggered GitHub Actions |

---

## 15. Open questions (resolve before or during Phase 0)

1. npm / GitHub org owner name for `cursor-plus` and `homebrew-cursor-plus` tap?  
2. Confirm Ctrl+P / Ctrl+Y free on current `cursor-agent` builds (manual keymap audit).  
3. Ship Piper binary download in `--setup` vs document `brew install piper-tts` where available?  
4. First public version tag: `v0.1.0` (voice + mouse only) or wait for Phase 2?

---

## 16. Immediate next implementation step

When implementation starts:

1. Initialize `package.json` + `bin/cursor+` + minimal `wrapper.js`.  
2. Prove passthrough to `cursor-agent`.  
3. Implement Phase 1 (voice + mouse-caret) before porting the full copilot-plus feature set.

---

*Last updated: 2026-09-23*
