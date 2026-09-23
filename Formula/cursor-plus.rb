class CursorPlus < Formula
  desc "Voice + click-to-caret + TTS + screenshots — drop-in wrapper for the Cursor Agent CLI"
  homepage "https://github.com/Errr0rr404/cursor-plus"
  url "https://registry.npmjs.org/cursor-plus/-/cursor-plus-0.1.6.tgz"
  version "0.1.6"
  sha256 "b3241c5b5f2d99030b5fab4c6029e851471ec295bb8986eedf34cddde2f09bdc"
  license "MIT"

  depends_on "node" => :build
  depends_on "ffmpeg"
  depends_on "whisper-cpp"

  def install
    # Install from the npm registry (not from the local tarball) so the
    # bin shim resolves to a real node_modules/cursor-plus directory
    # rather than a symlink into a brew-temp scratch dir.
    system "npm", "install", "--prefix", libexec, "cursor-plus@0.1.6"

    # npm --prefix installs the package into libexec/node_modules/<pkg> and
    # creates bin shims in libexec/node_modules/.bin. Symlink them into
    # Homebrew's bin/ so `cursor+` ends up on PATH.
    bin.install_symlink Dir["#{libexec}/node_modules/.bin/*"]

    # node-pty ships a prebuilt spawn-helper without the executable bit on
    # macOS / Linux. Mirror copilot-plus and chmod it as part of install so
    # Homebrew users don't hit "posix_spawnp failed" on first run.
    platform = "#{OS.mac? ? "darwin" : "linux"}-#{Hardware::CPU.arm? ? "arm64" : "x64"}"
    helper = "#{libexec}/node_modules/node-pty/prebuilds/#{platform}/spawn-helper"
    if File.exist?(helper)
      File.chmod(0755, helper)
    end
  end

  def caveats
    <<~EOS
      cursor-plus needs the Cursor Agent CLI (`cursor-agent`) on PATH.
      Install it from https://cursor.com and sign in, then run:

        cursor+ --setup      # picks mic, downloads whisper model
        cursor+ --doctor     # validate environment (auto-fixes the node-pty perm trap)
        cursor+

      Hotkeys (in-app):
        Hold Space         hold-to-talk (Kitty terminals — Kitty / WezTerm / Ghostty)
        Ctrl+Space         toggle voice record (everywhere)
        Click in prompt    reposition caret (SGR mouse)
        ?                  open in-app cheatsheet

      Config:  ~/.cursor-plus/config.json
      Log:     ~/.cursor-plus/cursor-plus.log

      Hold-Space requires the Kitty keyboard protocol. If your terminal
      doesn't support it, Ctrl+Space is the universal fallback.
    EOS
  end

  test do
    assert_match "cursor-plus v#{version}", shell_output("#{bin}/cursor+ --version")
  end
end
