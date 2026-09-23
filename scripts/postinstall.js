'use strict';

// postinstall — fix node-pty spawn-helper permissions on macOS / Linux.
// node-pty ships prebuilt binaries without the executable bit set on POSIX,
// which causes "posix_spawnp failed" at runtime without this fix.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

if (os.platform() !== 'darwin' && os.platform() !== 'linux') process.exit(0);

let nodePtyDir;
try {
  nodePtyDir = path.dirname(require.resolve('node-pty/package.json'));
} catch {
  process.exit(0);
}

const platform = `${os.platform()}-${os.arch()}`;
const targets = [
  path.join(nodePtyDir, 'prebuilds', platform, 'spawn-helper'),
  path.join(nodePtyDir, 'prebuilds', platform, 'pty.node'),
];

let fixed = 0;
for (const t of targets) {
  if (!fs.existsSync(t)) continue;
  try {
    fs.chmodSync(t, 0o755);
    fixed++;
  } catch (err) {
    console.warn(`[cursor-plus] chmod ${t} skipped (${err.code || err.message})`);
  }
}

if (fixed > 0) {
  console.log(`[cursor-plus] Fixed node-pty permissions for ${platform} (${fixed} files)`);
}