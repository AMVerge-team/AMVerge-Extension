/**
 * Dependency Installation Test Suite
 * Tests all dependency checks and installers in the AMVerge Extension
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const TESTS = [];
const RESULTS = { passed: 0, failed: 0, skipped: 0 };

function test(name, fn) {
  TESTS.push({ name, fn });
}

function log(type, msg) {
  const prefix = { pass: '\u2713', fail: '\u2717', skip: '\u25CB', info: '\u2192' };
  console.log(`  ${prefix[type] || '\u2022'} ${msg}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  AMVerge Extension Dependency Test Suite');
  console.log('===============================================================\n');

  for (const t of TESTS) {
    console.log(`\n> ${t.name}`);
    try {
      await t.fn();
      RESULTS.passed++;
      log('pass', 'PASSED');
    } catch (e) {
      if (e.message === 'SKIP') {
        RESULTS.skipped++;
        log('skip', 'SKIPPED');
      } else {
        RESULTS.failed++;
        log('fail', `FAILED: ${e.message}`);
      }
    }
  }

  console.log('\n===============================================================');
  console.log(`  Results: ${RESULTS.passed} passed, ${RESULTS.failed} failed, ${RESULTS.skipped} skipped`);
  console.log('===============================================================\n');
  
  return RESULTS.failed === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS (simulate what the extension JS does)
// ─────────────────────────────────────────────────────────────────────────────

function getAppDataDirs() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const appSupport = path.join(home, 'Library', 'Application Support');
  return [
    path.join(roaming, 'app.amverge'),
    path.join(appSupport, 'app.amverge'),
    path.join(home, '.local', 'share', 'app.amverge'),
    path.join(roaming, 'AMVerge')
  ];
}

function readAppPaths() {
  let result = null;
  const dirs = getAppDataDirs();
  for (const d of dirs) {
    const p = path.join(d, 'paths.json');
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (!result) result = {};
          for (const key in parsed) {
            if (parsed[key] && result[key] === undefined) result[key] = parsed[key];
          }
        }
      } catch (e) {}
    }
    const pointerFile = path.join(d, 'ai_storage_path.txt');
    if (fs.existsSync(pointerFile)) {
      try {
        const root = fs.readFileSync(pointerFile, 'utf8').trim();
        if (root) {
          if (!result) result = {};
          if (!result.ai_config_dir) result.ai_config_dir = path.join(root, 'config');
          if (!result.hf_home_dir) result.hf_home_dir = path.join(root, 'hf-cache');
          if (!result.runtime_dir) result.runtime_dir = path.join(root, 'runtime');
        }
      } catch (e) {}
    }
  }
  return result;
}

function getAmvergeConfigDir() {
  const home = process.env.USERPROFILE || process.env.HOME;
  
  // Check AMVERGE_CONFIG_DIR env var first (highest priority)
  const override = (process.env.AMVERGE_CONFIG_DIR || '').trim();
  if (override) return override;
  
  // Check if app paths has ai_config_dir (from paths.json or ai_storage_path.txt)
  const appPaths = readAppPaths();
  if (appPaths && appPaths.ai_config_dir) {
    return appPaths.ai_config_dir;
  }
  
  // Default locations (matches Python's config.py fallback)
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'win32') {
    return path.join(roaming, 'com.amverge.cli');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'com.amverge.cli');
  }
  return path.join(home, '.config', 'com.amverge.cli');
}

function getPortableFfmpegDir() {
  return path.join(getAmvergeConfigDir(), 'ffmpeg');
}

function getPortableFfmpeg() {
  const ffmpegDir = getPortableFfmpegDir();
  const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  
  for (const name of names) {
    const binCandidate = path.join(ffmpegDir, 'bin', name);
    if (fs.existsSync(binCandidate)) return binCandidate;
    
    const rootCandidate = path.join(ffmpegDir, name);
    if (fs.existsSync(rootCandidate)) return rootCandidate;
  }
  return null;
}

function getPortableFfprobe() {
  const ffmpegDir = getPortableFfmpegDir();
  const names = process.platform === 'win32' ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe'];
  
  for (const name of names) {
    const binCandidate = path.join(ffmpegDir, 'bin', name);
    if (fs.existsSync(binCandidate)) return binCandidate;
    
    const rootCandidate = path.join(ffmpegDir, name);
    if (fs.existsSync(rootCandidate)) return rootCandidate;
  }
  return null;
}

function getRuntimeRoots() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  
  return [
    path.join(local, 'AMVerge', 'runtime'),
    path.join(roaming, 'app.amverge'),
  ];
}

function findPython() {
  for (const root of getRuntimeRoots()) {
    const pyPath = path.join(root, 'pyenv', 'Scripts', 'python.exe');
    if (fs.existsSync(pyPath)) return pyPath;
  }
  
  // Check PATH
  try {
    const result = spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return 'python';
  } catch (e) {}
  
  try {
    const result = spawnSync('py', ['-3', '--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return 'py';
  } catch (e) {}
  
  return null;
}

function checkFfmpegInPath() {
  try {
    execSync('ffmpeg -version', { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

function checkAmvergePackage(pythonCmd) {
  if (!pythonCmd) return null;
  try {
    const args = pythonCmd === 'py' ? ['-3', '-c'] : ['-c'];
    args.push('import importlib.metadata as m; print(m.version("amverge"))');
    const result = spawnSync(pythonCmd, args, { encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) return result.stdout.trim();
  } catch (e) {}
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('Config directory path resolution', async () => {
  const configDir = getAmvergeConfigDir();
  log('info', `Config dir: ${configDir}`);
  
  if (!configDir) throw new Error('Config dir is empty');
  if (!path.isAbsolute(configDir)) throw new Error('Config dir is not absolute');
  
  // Check if parent exists (AppData/Roaming should exist)
  const parent = path.dirname(configDir);
  if (!fs.existsSync(parent)) throw new Error(`Parent dir does not exist: ${parent}`);
});

test('FFmpeg directory path resolution', async () => {
  const ffmpegDir = getPortableFfmpegDir();
  log('info', `FFmpeg dir: ${ffmpegDir}`);
  
  if (!ffmpegDir) throw new Error('FFmpeg dir is empty');
  if (!ffmpegDir.includes('ffmpeg')) throw new Error('FFmpeg dir does not contain "ffmpeg"');
});

test('Portable FFmpeg detection (current state)', async () => {
  const ffmpeg = getPortableFfmpeg();
  const ffprobe = getPortableFfprobe();
  
  if (ffmpeg) {
    log('info', `Found portable ffmpeg: ${ffmpeg}`);
    log('info', `Found portable ffprobe: ${ffprobe || 'NOT FOUND'}`);
    
    // Verify it actually runs
    try {
      execSync(`"${ffmpeg}" -version`, { encoding: 'utf8', timeout: 5000 });
      log('info', 'Portable ffmpeg executes OK');
    } catch (e) {
      throw new Error('Portable ffmpeg exists but fails to execute');
    }
  } else {
    log('info', 'No portable FFmpeg installed');
    
    // Check if it's in PATH instead
    if (checkFfmpegInPath()) {
      log('info', 'FFmpeg found in PATH (fallback works)');
    } else {
      log('info', 'FFmpeg not in PATH either - install would be required');
    }
  }
});

test('Runtime roots enumeration', async () => {
  const roots = getRuntimeRoots();
  log('info', `Found ${roots.length} runtime root candidates`);
  
  for (const root of roots) {
    const exists = fs.existsSync(root);
    log('info', `  ${exists ? '\u2713' : '\u25CB'} ${root}`);
  }
});

test('Python detection', async () => {
  const python = findPython();
  
  if (python) {
    log('info', `Found Python: ${python}`);
    
    // Get version
    try {
      const args = python === 'py' ? ['-3', '--version'] : ['--version'];
      const result = spawnSync(python, args, { encoding: 'utf8', timeout: 5000 });
      log('info', `Version: ${result.stdout.trim() || result.stderr.trim()}`);
    } catch (e) {}
  } else {
    log('info', 'No Python found - amverge install would provision one via uv');
  }
});

test('amverge package detection', async () => {
  const python = findPython();
  
  if (!python) {
    log('info', 'No Python available, skipping amverge check');
    throw new Error('SKIP');
  }
  
  const version = checkAmvergePackage(python);
  if (version) {
    log('info', `amverge version: ${version}`);
  } else {
    log('info', 'amverge package not installed');
  }
});

test('PyTorch/CUDA detection', async () => {
  const python = findPython();
  
  if (!python) {
    log('info', 'No Python available');
    throw new Error('SKIP');
  }
  
  try {
    const args = python === 'py' ? ['-3', '-c'] : ['-c'];
    args.push('import torch; print(f"torch {torch.__version__}, CUDA: {torch.cuda.is_available()}")');
    const result = spawnSync(python, args, { encoding: 'utf8', timeout: 15000 });
    if (result.status === 0) {
      log('info', result.stdout.trim());
    } else {
      log('info', 'PyTorch not installed');
    }
  } catch (e) {
    log('info', 'PyTorch check failed');
  }
});

test('uv binary availability', async () => {
  const extRoot = path.resolve(__dirname, 'AMVerge');
  const uvPath = path.join(extRoot, 'bin', 'uv', 'x86_64-pc-windows-msvc', 'uv.exe');
  
  if (fs.existsSync(uvPath)) {
    log('info', `Bundled uv found: ${uvPath}`);
    
    try {
      const result = spawnSync(uvPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
      log('info', `Version: ${result.stdout.trim()}`);
    } catch (e) {
      throw new Error('uv exists but fails to execute');
    }
  } else {
    log('info', 'No bundled uv (will fall back to PATH)');
    
    try {
      execSync('uv --version', { encoding: 'utf8', timeout: 5000 });
      log('info', 'uv found in PATH');
    } catch (e) {
      log('info', 'uv not in PATH either - will need to be downloaded');
    }
  }
});

test('Extension file structure integrity', async () => {
  const extRoot = path.resolve(__dirname, 'AMVerge');
  
  const requiredFiles = [
    'index.html',
    'js/main.js',
    'js/utils/fileSystem.js',
    'js/utils/amvergeRuntime.js',
    'js/utils/amvergeHandler.js',
    'js/utils/previewProxy.js',
    'js/components/toolsSetup.js',
    'CSXS/manifest.xml'
  ];
  
  let missing = 0;
  for (const file of requiredFiles) {
    const fullPath = path.join(extRoot, file);
    if (!fs.existsSync(fullPath)) {
      log('fail', `Missing: ${file}`);
      missing++;
    }
  }
  
  if (missing > 0) throw new Error(`${missing} required files missing`);
  log('info', `All ${requiredFiles.length} required files present`);
});

test('JavaScript syntax validation', async () => {
  const jsFiles = [
    'AMVerge/js/utils/fileSystem.js',
    'AMVerge/js/utils/amvergeRuntime.js',
    'AMVerge/js/utils/amvergeHandler.js',
    'AMVerge/js/utils/previewProxy.js',
    'AMVerge/js/components/toolsSetup.js',
    'AMVerge/js/main.js'
  ];
  
  let errors = 0;
  for (const file of jsFiles) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      // Basic syntax check - try to parse as a function body
      new Function(content);
      log('info', `\u2713 ${file}`);
    } catch (e) {
      log('fail', `\u2717 ${file}: ${e.message}`);
      errors++;
    }
  }
  
  if (errors > 0) throw new Error(`${errors} files have syntax errors`);
});

test('Portable FFmpeg folder simulation (missing -> detect failure)', async () => {
  const ffmpegDir = getPortableFfmpegDir();
  const backupDir = ffmpegDir + '.backup-test';
  let renamed = false;
  
  // If portable ffmpeg exists, temporarily rename it
  if (fs.existsSync(ffmpegDir)) {
    log('info', 'Temporarily hiding existing FFmpeg folder...');
    fs.renameSync(ffmpegDir, backupDir);
    renamed = true;
  }
  
  try {
    const ffmpeg = getPortableFfmpeg();
    if (ffmpeg) {
      throw new Error('Should not find portable FFmpeg after hiding folder');
    }
    log('info', 'Correctly returns null when folder missing');
    
    // Test that PATH fallback still works if available
    const inPath = checkFfmpegInPath();
    log('info', `PATH fallback: ${inPath ? 'available' : 'not available'}`);
    
  } finally {
    if (renamed) {
      log('info', 'Restoring FFmpeg folder...');
      fs.renameSync(backupDir, ffmpegDir);
    }
  }
});

test('amverge import paths in Python', async () => {
  const python = findPython();
  if (!python) {
    log('info', 'No Python available');
    throw new Error('SKIP');
  }
  
  const imports = [
    'amverge',
    'amverge.core.infra.binaries',
    'amverge.core.infra.ffmpeg_bootstrap',
    'amverge.core.infra.config'
  ];
  
  for (const mod of imports) {
    try {
      const args = python === 'py' ? ['-3', '-c'] : ['-c'];
      args.push(`import ${mod}; print('OK')`);
      const result = spawnSync(python, args, { encoding: 'utf8', timeout: 10000 });
      if (result.status === 0) {
        log('info', `\u2713 ${mod}`);
      } else {
        log('info', `\u25CB ${mod} (not installed)`);
      }
    } catch (e) {
      log('info', `\u25CB ${mod} (error)`);
    }
  }
});

test('FFmpeg bootstrap ensure_ffmpeg simulation', async () => {
  const python = findPython();
  if (!python) {
    log('info', 'No Python available');
    throw new Error('SKIP');
  }
  
  // Check if the bootstrap module exists
  try {
    const args = python === 'py' ? ['-3', '-c'] : ['-c'];
    args.push('from amverge.core.infra.ffmpeg_bootstrap import is_portable_ffmpeg_installed, get_portable_ffmpeg_path; installed = is_portable_ffmpeg_installed(); path = get_portable_ffmpeg_path(); print(f"Installed: {installed}, Path: {path}")');
    const result = spawnSync(python, args, { encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) {
      log('info', result.stdout.trim());
    } else {
      log('info', 'Bootstrap module not available: ' + result.stderr.trim().split('\n')[0]);
    }
  } catch (e) {
    log('info', 'Could not test bootstrap: ' + e.message);
  }
});

test('Cross-reference: Python config matches JS config', async () => {
  const python = findPython();
  if (!python) throw new Error('SKIP');
  
  const jsConfigDir = getAmvergeConfigDir();
  
  try {
    const args = python === 'py' ? ['-3', '-c'] : ['-c'];
    args.push('from amverge.core.infra.config import get_amverge_config_dir; print(get_amverge_config_dir())');
    const result = spawnSync(python, args, { encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) {
      const pyConfigDir = result.stdout.trim();
      log('info', `JS config dir:  ${jsConfigDir}`);
      log('info', `Python config:  ${pyConfigDir}`);
      
      if (path.normalize(jsConfigDir).toLowerCase() !== path.normalize(pyConfigDir).toLowerCase()) {
        throw new Error('Config directories do not match!');
      }
      log('info', 'Config directories match \u2713');
    } else {
      log('info', 'Could not get Python config dir');
      throw new Error('SKIP');
    }
  } catch (e) {
    if (e.message === 'SKIP') throw e;
    throw e;
  }
});

test('Direct download fallback simulation (PowerShell)', async () => {
  if (process.platform !== 'win32') {
    log('info', 'Skipping on non-Windows');
    throw new Error('SKIP');
  }
  
  // Test that PowerShell can run the download commands
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      '$ProgressPreference = "SilentlyContinue"; Write-Host "PowerShell OK"'
    ], { encoding: 'utf8', timeout: 10000 });
    
    if (result.status !== 0) throw new Error('PowerShell test failed');
    log('info', 'PowerShell available for direct download fallback');
    
    // Test Expand-Archive availability
    const result2 = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-Command Expand-Archive | Select-Object -ExpandProperty Version'
    ], { encoding: 'utf8', timeout: 10000 });
    
    if (result2.status === 0) {
      log('info', 'Expand-Archive available for ZIP extraction');
    }
  } catch (e) {
    throw new Error('PowerShell not available: ' + e.message);
  }
});

test('Network connectivity to FFmpeg download URL', async () => {
  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
  
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `$ProgressPreference = 'SilentlyContinue'; try { $r = Invoke-WebRequest -Uri "${url}" -Method Head -TimeoutSec 10 -UseBasicParsing; $r.StatusCode } catch { 'Error: ' + $_.Exception.Message }`
    ], { encoding: 'utf8', timeout: 15000 });
    
    const output = result.stdout.trim();
    if (output === '200') {
      log('info', 'FFmpeg download URL reachable');
    } else {
      log('info', 'FFmpeg URL response: ' + output);
    }
  } catch (e) {
    log('info', 'Could not check FFmpeg download URL');
  }
});

test('Disk space check for FFmpeg download', async () => {
  const ffmpegDir = getPortableFfmpegDir();
  const targetDrive = path.parse(ffmpegDir).root;
  
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-PSDrive ${targetDrive.replace(':\\', '')}).Free / 1GB`
    ], { encoding: 'utf8', timeout: 5000 });
    
    const freeGB = parseFloat(result.stdout.trim());
    log('info', `Free space on ${targetDrive}: ${freeGB.toFixed(2)} GB`);
    
    // FFmpeg download is ~100MB, need at least 500MB
    if (freeGB < 0.5) {
      throw new Error('Less than 500MB free - may not have room for FFmpeg');
    }
  } catch (e) {
    log('info', 'Could not check disk space: ' + e.message);
  }
});

test('Temp directory accessibility', async () => {
  const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
  log('info', `Temp dir: ${tempDir}`);
  
  if (!fs.existsSync(tempDir)) {
    throw new Error('Temp directory does not exist');
  }
  
  // Try to write a test file
  const testFile = path.join(tempDir, 'amverge-test-' + Date.now() + '.txt');
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    log('info', 'Temp directory is writable');
  } catch (e) {
    throw new Error('Cannot write to temp directory: ' + e.message);
  }
});

// Run all tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
});
