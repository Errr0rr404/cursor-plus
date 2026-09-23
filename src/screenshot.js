'use strict';

/**
 * screenshot — capture a region screenshot via the OS native tool and
 * inject it into the Cursor prompt as @/path/to/file.png.
 *
 * macOS:    `screencapture -i` (interactive region selection)
 * Linux:    `grim` (Wayland) or `import` from ImageMagick / `scrot` (X11)
 * Windows:  PowerShell + System.Drawing
 *
 * Falls back to full-screen capture if region mode isn't available.
 */

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

const SHOT_DIR = path.join(os.homedir(), '.cursor-plus', 'screenshots');

function ensureDir() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

function newPath() {
  ensureDir();
  return path.join(SHOT_DIR, `shot-${Date.now()}.png`);
}

/**
 * Capture a region screenshot. Resolves with the absolute path of the
 * saved PNG. If the OS tool is missing, falls back to a full-screen
 * capture (or rejects if we can't get any image).
 */
function captureRegion() {
  const out = newPath();
  if (IS_MAC) {
    return _run('screencapture', ['-i', out], out);
  }
  if (IS_LINUX) {
    return new Promise((resolve, reject) => {
      // Wayland — grim is the modern tool
      execFile('which', ['grim'], (err) => {
        if (!err) {
          // slurp gives interactive region; if missing we fall back to full screen
          execFile('which', ['slurp'], (err2) => {
            if (!err2) {
              spawn('sh', ['-c', `slurp | grim -g - "${out}"`], { stdio: 'inherit' })
                .on('exit', code => code === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error('screenshot failed')));
            } else {
              _run('grim', [out], out).then(resolve, reject);
            }
          });
        } else {
          // X11 — import from ImageMagick or scrot
          execFile('which', ['import'], (err3) => {
            if (!err3) return _run('import', [out], out).then(resolve, reject);
            execFile('which', ['scrot'], (err4) => {
              if (!err4) return _run('scrot', [out], out).then(resolve, reject);
              reject(new Error('No screenshot tool installed (grim / import / scrot)'));
            });
          });
        }
      });
    });
  }
  if (IS_WIN) {
    return _run('powershell.exe', [
      '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
      `$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
      `$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); ` +
      `$g=[System.Drawing.Graphics]::FromImage($bmp); ` +
      `$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); ` +
      `$bmp.Save('${out.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png); ` +
      `$g.Dispose(); $bmp.Dispose();`,
    ], out);
  }
  return Promise.reject(new Error('Unsupported platform'));
}

/**
 * Capture full screen (no region picker).
 */
function captureFull() {
  const out = newPath();
  if (IS_MAC) return _run('screencapture', [out], out);
  if (IS_LINUX) return _run('grim', [out], out).catch(() => _run('import', ['-window', 'root', out], out));
  if (IS_WIN) return captureRegion(); // PowerShell snippet above already does full screen
  return Promise.reject(new Error('Unsupported platform'));
}

function _run(cmd, args, expectedPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0 && fs.existsSync(expectedPath)) resolve(expectedPath);
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

module.exports = { captureRegion, captureFull, SHOT_DIR };