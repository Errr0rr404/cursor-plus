# cursor-plus

> Voice + click-to-caret + TTS + screenshots — drop-in PTY wrapper for the Cursor Agent CLI.

`cursor-plus` (bin: `cursor+`) wraps the official Cursor CLI (`cursor-agent`) without replacing it. You still need a Cursor subscription and `cursor-agent` on `PATH`. We spawn the agent in a node-pty session and overlay:

- **Hold-Space voice dictation** (Kitty-protocol terminals) with **Ctrl+Space toggle** fallback
- **Click-to-caret** in the prompt area (SGR mouse + shadow buffer)
- **TTS** for spoken agent replies (Piper preferred, OS fallback)
- **Screenshots** via OS tool, injected as `@/path/to/file.png`
- **Clipboard** paste — text or image (Windows image path is patched)
- **Prompt queue** when the agent is busy
- **Stash** drafts to `~/.cursor-plus/prompt-stash.json`
- **Idle notifications** via OS / bell / webhook
- **Safety scanner** for common secret formats
- **`?` cheatsheet** for in-app help
- **`--setup` / `--doctor` / `--preferences` / `--version`** subcommands

Inspired by the proven [copilot-plus](https://github.com/Errr0rr404/copilot-plus) architecture, but tuned for Cursor CLI gaps (no voice, broken mouse positioning, ~6-line input viewport).

## Install

```bash
npm install -g cursor-plus
cursor+ --setup       # picks mic, downloads whisper base.en
cursor+ --doctor      # validate config + environment (auto-fixes the node-pty perm trap)
cursor+               # launch
```

> **Always run `cursor+ --doctor` once right after install** (and any time you upgrade). It fixes the common `posix_spawnp failed` error (npm 11+ blocks postinstall scripts by default, so node-pty's spawn-helper ships without the executable bit). `--doctor` detects and chmod's it automatically.

### From source (dev)

```bash
git clone https://github.com/<owner>/cursor-plus.git
cd cursor-plus
npm install
npm link
cursor+ --setup
cursor+ --doctor
```

### Homebrew (when tap is live)

```bash
brew tap <owner>/cursor-plus
brew install cursor-plus
cursor+ --setup
cursor+ --doctor
```

## Requirements

| Tool | Required for |
|------|--------------|
| Node ≥ 18 | always |
| `cursor-agent` | always (Cursor CLI) |
| `ffmpeg` | voice record + screenshot tools |
| `whisper-cpp` (`whisper-cli`) | STT |
| Terminal with Kitty keyboard protocol | true hold-Space (Kitty, WezTerm, Ghostty) |
| Terminal with SGR mouse reporting | click-to-caret |

`ffmpeg` and `whisper-cpp` are optional — `--setup` will tell you when they're missing and how to install. The wrapper still runs as a passthrough without them.

## Hotkeys

| Key | Action |
|-----|--------|
| **Hold Space** | hold-to-talk (Kitty terminals) |
| **Ctrl+Space** | toggle voice record (everywhere) |
| **Click in prompt** | reposition caret (SGR mouse) |
| **`?`** | open in-app cheatsheet |
| **Ctrl+T** | toggle text-to-speech |
| **Ctrl+P** | screenshot → `@path` |
| **Ctrl+Y** | paste clipboard (text or image) |
| **Ctrl+S** | stash current prompt draft |
| **Ctrl+G** | open draft in `$EDITOR` (passthrough) |
| **Ctrl+C** *(recording)* | cancel active recording |
| **Enter** *(busy)* | queue prompt until response settles |

`Ctrl+R` is **never** stolen — Cursor CLI uses it for the code-review overlay.

## Configuration

Config lives at `~/.cursor-plus/config.json`. The full default schema (PLAN §8):

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
    "language": "en",
    "enabled": true
  },
  "mouse": {
    "clickToCaret": true,
    "enabled": true,
    "reportMode": "sgr"
  },
  "keys": { "kitty": "auto" },
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
    "sound": false,
    "webhookUrl": "",
    "rules": [
      { "when": "session_idle", "channels": ["os"] },
      { "when": "waiting_input", "afterMs": 60000, "channels": ["os"] }
    ]
  },
  "theme": "auto"
}
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `posix_spawnp failed` from node-pty | Run `cursor+ --doctor` — it auto-fixes the spawn-helper permission. If `--doctor` can't write to it (Homebrew install, read-only prefix): `chmod +x "$(npm root -g)/cursor-plus/node_modules/node-pty/prebuilds/*/spawn-helper"` |
| `Could not locate cursor-agent` | Install Cursor CLI: https://cursor.com. Or `export CURSOR_AGENT_BIN=/path/to/cursor-agent` |
| Hold-Space does nothing | Your terminal doesn't support the Kitty keyboard protocol. Use **Ctrl+Space** toggle instead, or switch to Kitty / WezTerm / Ghostty. |
| Mouse clicks do nothing | Confirm your terminal supports SGR mouse reporting and `mouse.enabled` is `true` in config. |
| Whisper transcription empty | `cursor+ --doctor` will show the model path. Re-run `--setup` to download. |
| Mic permission denied | Enable terminal app in OS Privacy → Microphone. |
| `findWhisperModel` finds nothing | Run `cursor+ --setup` to download. |

First-line debugging: **`cursor+ --doctor`** is the canonical starting point — it reports every missing dep, validates the config, and auto-fixes the most common install-time trap. Run it after every install / upgrade.

## Privacy

- **Voice audio is local.** ffmpeg → whisper.cpp, never uploaded.
- **No telemetry by default.** Logs only land in `~/.cursor-plus/cursor-plus.log`.
- **Prompts still go to Cursor's agent cloud** as usual when using Cursor CLI — cursor-plus is a UX wrapper, not a privacy boundary.

## License

MIT. See [LICENSE](./LICENSE).

## See also

- [PLAN.md](./PLAN.md) — the full build plan and decision log
- [CHANGELOG.md](./CHANGELOG.md) — release history
- [ROADMAP.md](./ROADMAP.md) — what's coming next
- [Copilot CLI](https://github.com/github/copilot-cli) — the upstream this project mirrors
- [Cursor CLI](https://cursor.com) — `cursor-agent`