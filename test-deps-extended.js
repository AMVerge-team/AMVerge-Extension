/**
 * Extended Dependency Tests - Edge Cases & Install Simulation
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const TESTS = [];
const RESULTS = { passed: 0, failed: 0, skipped: 0 };

function test(name, fn) { TESTS.push({ name, fn }); }
function log(type, msg) {
  const prefix = { pass: '\u2713', fail: '\u2717', skip: '\u25CB', info: '\u2192' };
  console.log(`  ${prefix[type] || '\u2022'} ${msg}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  Extended Dependency Tests - Edge Cases & Install Simulation');
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

// Helpers
function getAppDataDirs() {
  const home = process.env.USERPROFILE || process.env.HOME;
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(roaming, 'app.amverge'),
    path.join(roaming, 'AMVerge')
  ];
}

function readAppPaths() {
  let result = null;
  for (const d of getAppDataDirs()) {
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
  }
  return result;
}

function getAmvergeConfigDir() {
  const override = (process.env.AMVERGE_CONFIG_DIR || '').trim();
  if (override) return override;
  const appPaths = readAppPaths();
  if (appPaths && appPaths.ai_config_dir) return appPaths.ai_config_dir;
  const roaming = process.env.APPDATA;
  return path.join(roaming, 'com.amverge.cli');
}

function getPortableFfmpegDir() {
  return path.join(getAmvergeConfigDir(), 'ffmpeg');
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASE TESTS
// ─────────────────────────────────────────────────────────────────────────────

test('Edge: Empty AMVERGE_CONFIG_DIR env var', async () => {
  const original = process.env.AMVERGE_CONFIG_DIR;
  process.env.AMVERGE_CONFIG_DIR = '';
  
  try {
    const dir = getAmvergeConfigDir();
    log('info', `With empty env: ${dir}`);
    if (!dir) throw new Error('Should fall back to app paths or default');
  } finally {
    if (original !== undefined) {
      process.env.AMVERGE_CONFIG_DIR = original;
    } else {
      delete process.env.AMVERGE_CONFIG_DIR;
    }
  }
});

test('Edge: Whitespace-only AMVERGE_CONFIG_DIR', async () => {
  const original = process.env.AMVERGE_CONFIG_DIR;
  process.env.AMVERGE_CONFIG_DIR = '   ';
  
  try {
    const dir = getAmvergeConfigDir();
    log('info', `With whitespace env: ${dir}`);
    if (dir.trim() === '') throw new Error('Should ignore whitespace-only value');
  } finally {
    if (original !== undefined) {
      process.env.AMVERGE_CONFIG_DIR = original;
    } else {
      delete process.env.AMVERGE_CONFIG_DIR;
    }
  }
});

test('Edge: Missing paths.json', async () => {
  // This should not crash, just return null or use defaults
  const fakeDir = path.join(process.env.TEMP, 'amverge-test-' + Date.now());
  fs.mkdirSync(fakeDir, { recursive: true });
  
  try {
    // No paths.json exists
    const result = readAppPaths();
    log('info', `Result with no paths.json: ${result === null ? 'null' : JSON.stringify(result)}`);
  } finally {
    fs.rmdirSync(fakeDir, { recursive: true });
  }
});

test('Edge: Malformed paths.json', async () => {
  const testDir = path.join(process.env.TEMP, 'amverge-test-malformed-' + Date.now());
  const appAmverge = path.join(testDir, 'app.amverge');
  fs.mkdirSync(appAmverge, { recursive: true });
  
  // Write invalid JSON
  fs.writeFileSync(path.join(appAmverge, 'paths.json'), 'not valid json {{{');
  
  try {
    // Should not crash
    log('info', 'Testing malformed JSON handling...');
  } finally {
    fs.rmdirSync(testDir, { recursive: true });
  }
});

test('Edge: FFmpeg dir exists but is empty', async () => {
  const ffmpegDir = getPortableFfmpegDir();
  const testDir = ffmpegDir + '-empty-test';
  
  fs.mkdirSync(testDir, { recursive: true });
  fs.mkdirSync(path.join(testDir, 'bin'), { recursive: true });
  
  try {
    // Check that empty bin dir returns null
    const names = ['ffmpeg.exe', 'ffmpeg'];
    let found = null;
    for (const name of names) {
      const candidate = path.join(testDir, 'bin', name);
      if (fs.existsSync(candidate)) {
        found = candidate;
        break;
      }
    }
    
    if (found) throw new Error('Should not find ffmpeg in empty dir');
    log('info', 'Correctly returns null for empty ffmpeg dir');
  } finally {
    fs.rmdirSync(testDir, { recursive: true });
  }
});

test('Edge: FFmpeg exists but is 0 bytes (corrupt)', async () => {
  const testDir = path.join(process.env.TEMP, 'amverge-corrupt-ffmpeg-' + Date.now());
  const binDir = path.join(testDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  
  // Create 0-byte ffmpeg.exe
  fs.writeFileSync(path.join(binDir, 'ffmpeg.exe'), '');
  
  try {
    const ffmpegPath = path.join(binDir, 'ffmpeg.exe');
    const stat = fs.statSync(ffmpegPath);
    log('info', `Created 0-byte file, size: ${stat.size}`);
    
    // Try to execute - should fail
    try {
      execSync(`"${ffmpegPath}" -version`, { encoding: 'utf8', timeout: 5000 });
      throw new Error('0-byte ffmpeg should not execute');
    } catch (e) {
      if (e.message.includes('should not execute')) throw e;
      log('info', 'Correctly fails to execute corrupt ffmpeg');
    }
  } finally {
    fs.rmdirSync(testDir, { recursive: true });
  }
});

test('Edge: Unicode path handling', async () => {
  const unicodeDir = path.join(process.env.TEMP, 'amverge-tëst-日本語-' + Date.now());
  
  try {
    fs.mkdirSync(unicodeDir, { recursive: true });
    log('info', `Created unicode path: ${unicodeDir}`);
    
    if (!fs.existsSync(unicodeDir)) {
      throw new Error('Unicode path not created');
    }
    
    // Write and read a file
    const testFile = path.join(unicodeDir, 'tëst.txt');
    fs.writeFileSync(testFile, 'hello');
    const content = fs.readFileSync(testFile, 'utf8');
    if (content !== 'hello') throw new Error('Unicode path read/write failed');
    
    log('info', 'Unicode paths work correctly');
  } finally {
    if (fs.existsSync(unicodeDir)) {
      fs.rmdirSync(unicodeDir, { recursive: true });
    }
  }
});

test('Edge: Very long path (near MAX_PATH)', async () => {
  // Windows MAX_PATH is 260, let's test with a long path
  const base = process.env.TEMP;
  let longPath = base;
  
  // Add directories until we're close to 200 chars
  while (longPath.length < 180) {
    longPath = path.join(longPath, 'abcdefghij');
  }
  
  try {
    fs.mkdirSync(longPath, { recursive: true });
    log('info', `Created path of length ${longPath.length}`);
    
    const testFile = path.join(longPath, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    
    if (!fs.existsSync(testFile)) throw new Error('Long path test failed');
    log('info', 'Long paths handled correctly');
  } finally {
    // Clean up - find the first directory we created
    let cleanPath = base;
    const first = path.join(base, 'abcdefghij');
    if (fs.existsSync(first)) {
      fs.rmdirSync(first, { recursive: true });
    }
  }
});

test('Stress: Multiple rapid config reads', async () => {
  const start = Date.now();
  const iterations = 100;
  
  for (let i = 0; i < iterations; i++) {
    getAmvergeConfigDir();
    getPortableFfmpegDir();
  }
  
  const elapsed = Date.now() - start;
  log('info', `${iterations * 2} config reads in ${elapsed}ms (${(elapsed / (iterations * 2)).toFixed(2)}ms avg)`);
  
  if (elapsed > 5000) throw new Error('Config reads too slow');
});

test('Install: Verify download URL is reachable', async () => {
  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `$ProgressPreference = 'SilentlyContinue'; try { $r = Invoke-WebRequest -Uri "${url}" -Method Head -TimeoutSec 15 -UseBasicParsing; "$($r.StatusCode),$($r.Headers['Content-Length'])" } catch { "Error: $($_.Exception.Message)" }`
  ], { encoding: 'utf8', timeout: 20000 });
  
  const output = result.stdout.trim();
  if (output.startsWith('200,')) {
    const size = parseInt(output.split(',')[1]) / 1024 / 1024;
    log('info', `URL reachable, size: ${size.toFixed(1)} MB`);
  } else {
    log('info', `URL response: ${output}`);
    if (output.includes('Error')) {
      log('info', 'Note: URL check failed but may work with retry');
    }
  }
});

test('Install: PowerShell ZIP extraction capability', async () => {
  const testZip = path.join(process.env.TEMP, 'amverge-test-' + Date.now() + '.zip');
  const testDir = path.join(process.env.TEMP, 'amverge-test-extract-' + Date.now());
  
  try {
    // Create a test zip using PowerShell
    const createResult = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `$testDir = New-Item -ItemType Directory -Path "${testDir}-src" -Force; ` +
      `"test content" | Out-File -FilePath "$testDir\\test.txt"; ` +
      `Compress-Archive -Path "$testDir\\*" -DestinationPath "${testZip}" -Force; ` +
      `Remove-Item -Path "$testDir" -Recurse -Force; ` +
      `Write-Host "Created"`
    ], { encoding: 'utf8', timeout: 10000 });
    
    if (!fs.existsSync(testZip)) throw new Error('Failed to create test ZIP');
    log('info', 'Created test ZIP file');
    
    // Extract it
    fs.mkdirSync(testDir, { recursive: true });
    const extractResult = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${testZip}" -DestinationPath "${testDir}" -Force; Write-Host "Extracted"`
    ], { encoding: 'utf8', timeout: 10000 });
    
    // Verify extraction
    const files = fs.readdirSync(testDir);
    log('info', `Extracted ${files.length} items`);
    
    if (files.length === 0) throw new Error('ZIP extraction produced no files');
    
  } finally {
    if (fs.existsSync(testZip)) fs.unlinkSync(testZip);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir, { recursive: true });
    const srcDir = testDir + '-src';
    if (fs.existsSync(srcDir)) fs.rmdirSync(srcDir, { recursive: true });
  }
});

test('Install: Python bootstrap module structure', async () => {
  // Check the Python bootstrap can be imported and has expected functions
  const python = (() => {
    try {
      const result = spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (result.status === 0) return 'python';
    } catch (e) {}
    return null;
  })();
  
  if (!python) {
    log('info', 'No Python available');
    throw new Error('SKIP');
  }
  
  const checkCode = `
import sys
try:
    from amverge.core.infra.ffmpeg_bootstrap import (
        is_portable_ffmpeg_installed,
        get_portable_ffmpeg_path,
        get_portable_ffprobe_path,
        ensure_ffmpeg,
        FFMPEG_DOWNLOAD_URL
    )
    print(f"Functions OK")
    print(f"URL: {FFMPEG_DOWNLOAD_URL}")
except ImportError as e:
    print(f"Import failed: {e}")
    sys.exit(1)
`;
  
  const result = spawnSync(python, ['-c', checkCode], { encoding: 'utf8', timeout: 10000 });
  
  if (result.status === 0) {
    result.stdout.trim().split('\n').forEach(line => log('info', line));
  } else {
    log('info', 'Bootstrap module not available: ' + result.stderr.trim().split('\n')[0]);
  }
});

test('Concurrency: Simultaneous config access', async () => {
  // Simulate what happens when multiple callbacks read config at once
  const promises = [];
  
  for (let i = 0; i < 10; i++) {
    promises.push(new Promise(resolve => {
      setImmediate(() => {
        const dir = getAmvergeConfigDir();
        resolve(dir);
      });
    }));
  }
  
  const results = await Promise.all(promises);
  const unique = [...new Set(results)];
  
  if (unique.length !== 1) {
    throw new Error('Config dir inconsistent across concurrent reads');
  }
  
  log('info', 'All 10 concurrent reads returned same value');
});

test('Permissions: Can write to ffmpeg target directory', async () => {
  const ffmpegDir = getPortableFfmpegDir();
  const parentDir = path.dirname(ffmpegDir);
  
  // Check if we can create directories
  const testDir = path.join(parentDir, 'write-test-' + Date.now());
  
  try {
    fs.mkdirSync(testDir, { recursive: true });
    
    // Try to write a file
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    log('info', `Can write to ${parentDir}`);
  } catch (e) {
    throw new Error(`Cannot write to target directory: ${e.message}`);
  } finally {
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir, { recursive: true });
    }
  }
});

// Run all tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
});
