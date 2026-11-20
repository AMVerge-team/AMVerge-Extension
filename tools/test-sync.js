const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function makeElement(tag) {
  const classes = new Set();
  return {
    tag,
    style: {},
    dataset: {},
    children: [],
    _classes: classes,
    className: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    value: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name)
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 100, height: 100 }; }
  };
}

function makeContext() {
  const elements = {};
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElement(id);
      return elements[id];
    },
    createElement(tag) {
      return makeElement(tag);
    },
    addEventListener() {}
  };
  const window = {
    App: null,
    addEventListener() {},
    location: { href: 'file:///C:/AMVerge/index.html' },
    StorageManager: {
      loadHistory: () => [],
      saveHistory() {},
      getItem: (_key, fallback) => fallback,
      setItem() {},
      loadSettings: () => ({}),
      saveSettings() {},
      removeItem() {}
    }
  };
  const context = {
    window,
    document,
    process: { env: {}, platform: 'win32' },
    require,
    console,
    dbg() {},
    escHtmlLog: (value) => String(value),
    $: { writeln() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => fn()
  };
  vm.createContext(context);
  return context;
}

function load(context, relative, transform) {
  const filename = path.join(ROOT, relative);
  let source = fs.readFileSync(filename, 'utf8');
  if (transform) source = transform(source);
  vm.runInContext(source, context, { filename: relative });
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function testFileSystemDiscovery() {
  const context = makeContext();
  const root = tempDir('amverge-fs-');
  const appData = path.join(root, 'roaming', 'app.amverge');
  const episodes = path.join(root, 'moved', 'episodes_storage');
  const config = path.join(root, 'moved-ai', 'config');
  const hf = path.join(root, 'moved-ai', 'hf-cache');
  const runtime = path.join(root, 'moved-ai', 'runtime');
  const python = path.join(runtime, 'pyenv', 'Scripts', 'python.exe');
  fs.mkdirSync(episodes, { recursive: true });
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  writeJson(path.join(appData, 'paths.json'), {
    runtime_dir: runtime,
    ai_config_dir: config,
    hf_home_dir: hf,
    episodes_storage_dir: episodes,
    scene_scout_dir: path.join(root, 'moved', 'amverge-scene-scout')
  });
  context.process.env.APPDATA = path.join(root, 'roaming');
  context.window.App = { settings: { appRuntimePath: '', appEpisodesPath: '' } };
  load(context, 'AMVerge/js/utils/fileSystem.js');
  const fileSystem = context.window.FileSystem;
  assert.strictEqual(fileSystem.getAppEpisodesStorageDir(), episodes);
  assert.strictEqual(fileSystem.getAppAiPython(), python);
  const env = fileSystem.getAppProcessEnv();
  assert.strictEqual(env.AMVERGE_CONFIG_DIR, config);
  assert.strictEqual(env.HF_HOME, hf);
  assert.strictEqual(env.AMVERGE_SCENE_SCOUT_DIR, path.join(root, 'moved', 'amverge-scene-scout'));
  assert.strictEqual(env.PYTHONUTF8, '1');

  const manual = path.join(root, 'manual-episodes');
  fs.mkdirSync(manual, { recursive: true });
  context.window.App.settings.appEpisodesPath = manual;
  assert.strictEqual(fileSystem.getAppEpisodesStorageDir(), manual);
  context.window.App.settings.appRuntimePath = runtime;
  assert.strictEqual(fileSystem.getRuntimeRoots()[0], runtime);

  const legacyRoot = path.join(root, 'legacy-ai');
  writeJson(path.join(appData, 'paths.json'), { ai_config_dir: null, hf_home_dir: null });
  fs.writeFileSync(path.join(appData, 'ai_storage_path.txt'), legacyRoot);
  const legacyPaths = fileSystem.readAppPaths();
  assert.strictEqual(legacyPaths.ai_config_dir, path.join(legacyRoot, 'config'));
  assert.strictEqual(legacyPaths.hf_home_dir, path.join(legacyRoot, 'hf-cache'));
  assert.strictEqual(legacyPaths.runtime_dir, path.join(legacyRoot, 'runtime'));
  assert.strictEqual(
    fileSystem.fileUrl('D:\\AMVerge #1\\scene?cover.jpg'),
    'file:///D:/AMVerge%20%231/scene%3Fcover.jpg'
  );
}

function testWebpManifestSync() {
  const context = makeContext();
  const root = tempDir('amverge-webp-');
  const episodeDir = path.join(root, 'episodes_storage', 'episode_1');
  const scenesDir = path.join(episodeDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  const sourceVideo = path.join(root, 'source.mkv');
  const webp = path.join(scenesDir, 'scene_hash.webp');
  const poster = path.join(scenesDir, 'scene_hash.jpg');
  fs.writeFileSync(webp, 'webp');
  fs.writeFileSync(poster, 'jpg');
  const manifest = {
    source: {
      videoPath: sourceVideo,
      importMethod: 'webp_files',
      sceneDetectionMethod: 'keyframe_detection'
    },
    summary: { sceneCount: 2 },
    scenes: [
      { scene_index: 0, start_sec: 10, end_sec: 12.5, duration_sec: 2.5 },
      { scene_index: 1, start_sec: 20, end_sec: 23, duration_sec: 3 }
    ]
  };
  const manifestPath = path.join(episodeDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  writeJson(path.join(episodeDir, 'sync_preview.json'), {
    previews: [{
      scene_index: 0,
      preview_webp_path: webp,
      preview_poster_path: poster
    }]
  });

  let loaded = null;
  context.window.App = {
    settings: { historyLimit: 10 },
    _activeSource: 'app',
    _currentScenes: [],
    _currentVideo: null,
    _currentOutputDir: null,
    switchTab() {}
  };
  context.window.ClipsPanel = {
    loadScenes(scenes) {
      loaded = scenes;
      context.window.App._currentScenes = scenes;
    }
  };
  context.window.ImportPanel = { hide() {} };
  context.window.showToast = () => {};
  load(context, 'AMVerge/js/utils/fileSystem.js');
  load(context, 'AMVerge/js/components/historyPanel.js');
  const ok = context.window.HistoryPanel.loadItem(manifestPath, episodeDir, { silentToast: true });
  assert.strictEqual(ok, true);
  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].source_range, true);
  assert.strictEqual(loaded[0].clip_path, null);
  assert.strictEqual(loaded[0].path, '');
  assert.strictEqual(loaded[0].thumbnail, poster);
  assert.strictEqual(loaded[0].preview_webp_path, webp);
  assert.strictEqual(loaded[0].original_path, sourceVideo);
  assert.strictEqual(loaded[1].source_range, true);

  context.window.PreviewProxy = { reset() {} };
  load(context, 'AMVerge/js/components/clipsPanel.js');
  const webpTile = context.window.ClipsPanel._buildTile(loaded[0], 0);
  assert.strictEqual(webpTile._classes.has('is-pending-reencode'), false);
  const pendingTile = context.window.ClipsPanel._buildTile({
    scene_index: 2,
    start_sec: 0,
    end_sec: 1,
    path: '',
    clip_path: null,
    source_range: false,
    thumbnail: ''
  }, 2);
  assert.strictEqual(pendingTile._classes.has('is-pending-reencode'), true);

  manifest.source.importMethod = 'video_files';
  writeJson(manifestPath, manifest);
  loaded = null;
  context.window.HistoryPanel.loadItem(manifestPath, episodeDir, { silentToast: true });
  assert.strictEqual(context.window.App._currentScenes[0].source_range, false);
}

function testSourceRangeImportArguments() {
  const context = makeContext();
  const sourceVideo = 'D:\\Library\\source.mkv';
  const scenes = [
    { scene_index: 0, start_sec: 10, end_sec: 12.5, source_range: true, original_path: sourceVideo, path: '', clip_path: null },
    { scene_index: 1, start_sec: 20, end_sec: 23, source_range: true, original_path: sourceVideo, path: '', clip_path: null }
  ];
  const scripts = [];
  context.window.__adobe_cep__ = {
    evalScript(script, done) {
      scripts.push(script);
      done('{"ok":true}');
    }
  };
  context.window.ClipsPanel = { getSelectedScenes: () => scenes };
  context.window.showToast = () => {};
  context.window.addEventListener = (event, done) => {
    if (event === 'DOMContentLoaded') done();
  };
  load(context, 'AMVerge/js/main.js', (source) => source.replace('App.init();', ''));
  context.window.App.switchTab = () => {};
  context.window.App._currentVideo = sourceVideo;
  context.window.App.importSelectedToAE();
  assert.strictEqual(scripts.length, 2);
  assert.ok(scripts[0].includes(',10,2.5,0)'));
  assert.ok(scripts[1].includes(',20,3,2.5)'));
}

function testExtendScriptTrimming() {
  const context = makeContext();
  const layers = [];
  function CompItem() {}
  function FolderItem() {}
  function FootageItem() {}
  const comp = new CompItem();
  comp.width = 1920;
  comp.height = 1080;
  comp.layers = {
    add() {
      const layer = {
        property() {
          return { setValue() {} };
        }
      };
      layers.push(layer);
      return layer;
    }
  };
  const folder = new FolderItem();
  const footage = new FootageItem();
  footage.width = 1920;
  footage.height = 1080;
  context.CompItem = CompItem;
  context.FolderItem = FolderItem;
  context.FootageItem = FootageItem;
  context.File = function (filePath) {
    this.exists = true;
    this.fsName = filePath;
  };
  context.ImportOptions = function () {};
  context.app = {
    project: {
      activeItem: comp,
      numItems: 0,
      items: {
        addFolder: () => folder,
        addComp: () => comp
      },
      item() { return null; },
      importFile: () => footage
    }
  };
  load(context, 'AMVerge/jsx/host.jsx');
  context.importClipToAE('D:\\source.mkv', 'scene 1', false, false, 0, 10, 2.5, 0);
  context.importClipToAE('D:\\source.mkv', 'scene 2', false, true, 2.5, 20, 3, 2.5);
  assert.strictEqual(layers[0].startTime, -10);
  assert.strictEqual(layers[0].inPoint, 0);
  assert.strictEqual(layers[0].outPoint, 2.5);
  assert.strictEqual(layers[1].startTime, -17.5);
  assert.strictEqual(layers[1].inPoint, 2.5);
  assert.strictEqual(layers[1].outPoint, 5.5);
}

function testSetupAndRuntime() {
  const context = makeContext();
  const calls = [];
  context.window.App = { settings: { pythonPath: '' } };
  context.window.FileSystem = {
    path,
    getAppAiPython: () => null,
    getAppProcessEnv: () => ({}),
    fileExists: () => false,
    childProcess: {
      spawnSync(command, args) {
        if (command === 'py' && args[0] === '-3.12') return { stdout: 'Python 3.12.8', stderr: '' };
        return { stdout: 'Python 3.10.9', stderr: '' };
      },
      execFileSync(command, args) {
        calls.push({ command, args });
        return '1.3.4';
      }
    }
  };
  context.window.AmvergeRuntime = {
    install(opts, callbacks) {
      calls.push({ install: opts });
      callbacks.onDone(true, 'ok');
    }
  };
  load(context, 'AMVerge/js/components/toolsSetup.js');
  const setup = context.window.ToolsSetup;
  const resolved = setup._resolvePythonCandidate();
  assert.strictEqual(resolved.cmd, 'py');
  assert.deepStrictEqual(Array.from(resolved.args), ['-3.12']);
  setup._addTimer = () => {};
  setup._markCheck = () => {};
  setup._checkAmverge();
  assert.ok(calls[0].args.includes('import importlib.metadata as m; print(m.version("amverge"))'));
  setup._showStep = () => {};
  setup._addTimer = (fn) => fn();
  let finished = false;
  setup.installAmverge((ok) => { finished = ok; });
  assert.strictEqual(finished, true);
  assert.deepStrictEqual(Array.from(calls[calls.length - 1].install.extras), ['edge']);

  const runtimeContext = makeContext();
  const runtimeDir = tempDir('amverge-runtime-');
  runtimeContext.window.FileSystem = {
    path,
    getExtensionRoot: () => runtimeDir,
    getRuntimeRoots: () => [runtimeDir],
    getAppProcessEnv: () => ({}),
    getHomeDir: () => runtimeDir,
    fileExists: () => false,
    createFolder() {},
    childProcess: {}
  };
  load(runtimeContext, 'AMVerge/js/utils/amvergeRuntime.js');
  const runtime = runtimeContext.window.AmvergeRuntime;
  runtime.pythonVersionOf = () => '3.12';
  runtime.hasNelux = () => false;
  runtime.isEditableCheckout = () => false;
  let installArgs = null;
  runtime._run = (_command, args, _env, _line, onClose) => {
    installArgs = args;
    onClose(0, '');
  };
  let installOk = false;
  runtime.install({ extras: ['edge'], gpu: false }, {
    onDone(ok) { installOk = ok; }
  });
  assert.strictEqual(installOk, true);
  assert.ok(installArgs.includes('amverge[edge]'));
  assert.strictEqual(installArgs.includes('torch'), false);
  assert.strictEqual(installArgs.includes('torchvision'), false);
}

async function testCliCandidateFallback() {
  const context = makeContext();
  const commands = [];
  context.window.FileSystem = {
    fs: {},
    path,
    createFolder() {},
    getAppProcessEnv: () => ({}),
    childProcess: {
      spawn(command) {
        commands.push(command);
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        if (command === 'amverge') {
          setImmediate(() => proc.emit('error', { code: 'ENOENT', message: 'missing' }));
        } else {
          setImmediate(() => {
            proc.stdout.emit('data', JSON.stringify({ scenes: [] }));
            proc.emit('close', 0);
          });
        }
        return proc;
      }
    }
  };
  load(context, 'AMVerge/js/utils/amvergeHandler.js');
  let completed = false;
  let failed = null;
  context.window.AmvergeHandler.detect('video.mp4', tempDir('amverge-cli-'), {
    method: 'keyframe',
    cli: [
      { command: 'amverge', prefix: [] },
      { command: 'python', prefix: ['-m', 'amverge'] }
    ]
  }, {
    onComplete: () => { completed = true; },
    onError: (error) => { failed = error; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(failed, null);
  assert.strictEqual(completed, true);
  assert.deepStrictEqual(commands, ['amverge', 'python']);
}

function testRuntimeCancellation() {
  const context = makeContext();
  const runtimeDir = tempDir('amverge-cancel-');
  const proc = new EventEmitter();
  proc.pid = 4321;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  let killed = '';
  context.window.FileSystem = {
    path,
    getExtensionRoot: () => runtimeDir,
    getRuntimeRoots: () => [runtimeDir],
    getAppProcessEnv: () => ({}),
    getHomeDir: () => runtimeDir,
    fileExists: () => false,
    createFolder() {},
    childProcess: {
      spawn: () => proc,
      execSync: (command) => { killed = command; }
    }
  };
  load(context, 'AMVerge/js/utils/amvergeRuntime.js');
  const runtime = context.window.AmvergeRuntime;
  runtime.pythonVersionOf = () => '3.12';
  runtime.hasNelux = () => false;
  runtime.isEditableCheckout = () => false;
  let completed = false;
  runtime.install({ extras: ['edge'], gpu: false }, {
    onDone: () => { completed = true; }
  });
  runtime.cancel();
  proc.emit('close', 1);
  assert.ok(killed.includes('taskkill /F /T /PID 4321'));
  assert.strictEqual(completed, false);
}

function testBatchInstallerGuards() {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'build.js'), 'utf8');
  assert.ok(source.includes('STAGE_DIR'));
  assert.ok(source.includes('goto fail'));
  assert.ok(source.includes('exit /b 1'));
  assert.ok(source.includes(String.raw`C:\\Program Files\\Common Files\\Adobe`));
  assert.strictEqual(source.includes(String.raw`C:\\Program Files (x86)\\Common Files\\Adobe`), false);
}

function testPremiereSelection() {
  const context = makeContext();
  const clipItem = {
    name: 'Sukuna.mp4',
    getMediaPath: () => 'D:\\Videos\\Sukuna.mp4'
  };
  const trackClip = {
    name: 'Sukuna.mp4',
    mediaType: 'Video',
    duration: { seconds: 36.28 },
    projectItem: clipItem
  };
  context.BridgeTalk = { appName: 'premierepro' };
  context.ProjectItemType = { BIN: 2 };
  context.app = {
    project: {
      rootItem: { children: { numItems: 0 } },
      activeSequence: {
        name: 'Edit_AMV',
        getSelection: () => [trackClip]
      }
    }
  };
  load(context, 'AMVerge/jsx/host.jsx');
  const raw = context.getSelectedLayerInfo();
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.filePath, 'D:\\Videos\\Sukuna.mp4');
  assert.strictEqual(parsed.layerIndex, 1);
  assert.strictEqual(parsed.layerName, 'Sukuna.mp4');
}

const tests = [
  testFileSystemDiscovery,
  testWebpManifestSync,
  testSourceRangeImportArguments,
  testExtendScriptTrimming,
  testPremiereSelection,
  testSetupAndRuntime,
  testCliCandidateFallback,
  testRuntimeCancellation,
  testBatchInstallerGuards
];

(async () => {
  for (const test of tests) {
    await test();
    process.stdout.write(`PASS ${test.name}\n`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
