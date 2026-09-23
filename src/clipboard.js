'use strict';

/**
 * clipboard — read text or image data from the system clipboard.
 *
 * The Windows image path is notoriously flaky in Cursor CLI. We work
 * around it by saving the image to a temp PNG and injecting @path,
 * which Cursor handles uniformly across OSes.
 *
 *   macOS:   pbpaste (text) / osascript (image → png)
 *   Linux:   wl-paste / xclip
 *   Windows: PowerShell Get-Clipboard -Format Image
 */

const { execFile, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PLATFORM = os.platform();
const IS_WIN   = PLATFORM === 'win32';
const IS_MAC   = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

function readText() {
  return new Promise((resolve, reject) => {
    if (IS_MAC) {
      return execFile('pbpaste', (err, stdout) => err ? reject(err) : resolve(stdout));
    }
    if (IS_LINUX) {
      // Wayland first, then X11
      execFile('wl-paste', [], (err, stdout) => {
        if (!err) return resolve(stdout);
        execFile('xclip', ['-selection', 'clipboard', '-o'], (err2, stdout2) => {
          if (!err2) return resolve(stdout2);
          execFile('xsel', ['--clipboard', '--output'], (err3, stdout3) => {
            if (!err3) return resolve(stdout3);
            reject(err3);
          });
        });
      });
      return;
    }
    if (IS_WIN) {
      return execFile('powershell.exe', [
        '-NoProfile', '-Command', 'Get-Clipboard -Raw',
      ], (err, stdout) => err ? reject(err) : resolve(stdout));
    }
    reject(new Error('Unsupported platform'));
  });
}

function readImage() {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `cursor-plus-clip-${Date.now()}.png`);
    if (IS_MAC) {
      // osascript: write clipboard PNG to file
      const script = `set theFile to (open for access POSIX file "${out}" with write permission)
set theData to the clipboard as «class PNGf»
write theData to theFile
close access theFile
return POSIX path of theFile`;
      const proc = spawn('osascript', ['-e', script], { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('exit', code => {
        if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) resolve(out);
        else reject(new Error('osascript failed or clipboard has no image'));
      });
      return;
    }
    if (IS_LINUX) {
      execFile('wl-paste', ['--type', 'image/png'], (err, stdout) => {
        if (!err && stdout && stdout.length) {
          fs.writeFileSync(out, stdout);
          return resolve(out);
        }
        execFile('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], (err2, stdout2) => {
          if (!err2 && stdout2 && stdout2.length) {
            fs.writeFileSync(out, stdout2);
            return resolve(out);
          }
          reject(new Error('No image in clipboard'));
        });
      });
      return;
    }
    if (IS_WIN) {
      const psCmd = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
        `if (Get-Clipboard -Format Image) { ` +
        `  $img = Get-Clipboard -Format Image; ` +
        `  $img.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); ` +
        `  Write-Output 'OK' ` +
        `} else { Write-Output 'NONE' }`;
      execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], (err, stdout) => {
        if (err) return reject(err);
        if (/OK/.test(stdout) && fs.existsSync(out)) resolve(out);
        else reject(new Error('No image in clipboard'));
      });
      return;
    }
    reject(new Error('Unsupported platform'));
  });
}

module.exports = { readText, readImage };