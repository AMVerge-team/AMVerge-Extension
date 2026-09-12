// fetch-uv.js
//
// Stage the `uv` binary the extension ships inside the .zxp. At runtime it
// provisions the shared AMVerge Python runtime, so the extension can install
// AI packs whether or not the desktop app is present.
//
// Mirrors AMVerge_V2/frontend/scripts/fetch-uv.mjs. One CEP package serves
// every platform, so `--all` stages each triple for a release build.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SRC_DIR = path.join(__dirname, '..', 'AMVerge');

const ALL_TRIPLES = [
  'x86_64-pc-windows-msvc',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
];

function hostTriple() {
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  throw new Error('Unsupported platform: ' + process.platform);
}

function assetNameFor(triple) {
  return 'uv-' + triple + (triple.includes('windows') ? '.zip' : '.tar.gz');
}

function downloadUrl(triple) {
  const version = process.env.AMVERGE_UV_VERSION;
  const asset = assetNameFor(triple);
  return version
    ? 'https://github.com/astral-sh/uv/releases/download/' + version + '/' + asset
    : 'https://github.com/astral-sh/uv/releases/latest/download/' + asset;
}

// Windows ships bsdtar at System32\tar.exe, which reads .zip. Whatever `tar` is
// first on PATH may be GNU tar, which cannot, so name the system one.
function tarBinary() {
  if (process.platform !== 'win32') return 'tar';
  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(bsdtar) ? bsdtar : 'tar';
}

function findBinary(dir, exeName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full, exeName);
      if (found) return found;
    } else if (entry.name === exeName) {
      return full;
    }
  }
  return null;
}

async function stage(triple, force) {
  const exeName = triple.includes('windows') ? 'uv.exe' : 'uv';
  const destDir = path.join(SRC_DIR, 'bin', 'uv', triple);
  const destExe = path.join(destDir, exeName);

  // re-downloading on every build would break offline rebuilds for no gain
  if (!force && fs.existsSync(destExe) && fs.statSync(destExe).size > 0) {
    console.log('uv already staged: ' + destExe);
    return;
  }

  const url = downloadUrl(triple);
  console.log('Downloading uv: ' + url);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error('Failed to download uv (' + response.status + '): ' + url);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amverge-uv-'));
  try {
    const archiveName = assetNameFor(triple);
    fs.writeFileSync(path.join(workDir, archiveName), Buffer.from(await response.arrayBuffer()));
    fs.mkdirSync(path.join(workDir, 'extract'), { recursive: true });

    // paths stay relative to workDir: GNU tar reads an absolute "C:\..." as a
    // remote host and fails with "Cannot connect to C"
    const result = spawnSync(tarBinary(), ['-xf', archiveName, '-C', 'extract'], {
      cwd: workDir,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('tar exited with code ' + result.status);

    const found = findBinary(path.join(workDir, 'extract'), exeName);
    if (!found) throw new Error(exeName + ' not found inside ' + archiveName);

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(found, destExe);
    if (!triple.includes('windows')) fs.chmodSync(destExe, 0o755);

    console.log('Staged uv: ' + destExe);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const triples = process.argv.includes('--all') ? ALL_TRIPLES : [hostTriple()];
  for (const triple of triples) await stage(triple, force);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
