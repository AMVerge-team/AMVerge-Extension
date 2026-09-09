# Moongetsu Profile — AE CEP Extension Builder

You build Adobe After Effects CEP extensions. Four active repos:

| Repo | Purpose | JS Files | Python Backend |
|---|---|---|---|
| **AniSmooth** | AI frame interpolation + upscaling + deadframe removal | 14 files, 8 components, 7 utils | PyTorch CUDA (RIFE, ShuffleCUGAN) |
| **SakugaFlow** | Sakugabooru browser: search, preview, download, import | 18 files, 12 components, 3 utils | Real-ESRGAN upscale |
| **OpenPaste** | Paste images from clipboard into AE + bg removal | 5 files, 1 component, 3 utils | rembg ONNX |
| **AMVerge-Extension** | Scene detection via amverge CLI, import clips into AE | 5 components, 3 utils | amverge (pip package, PyAV/FFmpeg) |

---

## Working Style

### Commits
```
(type) Short description under 50 chars

- (add) new features
- (fix) bug fixes
- (update) refactors, formatting, chores
- docs: / ci: / fix: (colon style also used)
```

One commit per logical change. No batching. No `Co-Authored-By` attribution.

### Code, No Comments
- **Zero inline comments** in JS/Python code. If something needs explaining, put it in AGENTS.md or commit message.
- Exception: algorithmic sections in Python (RIFE arch, duplicate detection) may have brief comments.

### No Em Dashes
- Never use `—` in docs, READMEs, commits. Use comma, colon, parens, or plain hyphen `-`.

### No Tests, No Lint, No Typecheck
- No test framework in any project. No linter configs. No TypeScript.

---

## CEP Extension Architecture (All Three)

### JS Module Pattern
```js
// Every file wraps in IIFE, exports to window, no ES modules
(function () {
  const Panel = {
    init(app) { this.app = app; this.view = document.getElementById('view'); this.bindEvents(); },
    bindEvents() { var s = this; el.addEventListener('click', () => s.doSomething()); }
  };
  window.Panel = Panel;
})();
```

- `var` for CEP Chromium < 69 (AniSmooth). `const`/`let` OK for newer CEP (SakugaFlow).
- `var self = this` or `var s = this` inside callbacks. No arrow functions for event listeners.
- No Promises, no async/await. Pure callbacks.
- 2-space indent, K&R braces.
- camelCase methods/props, PascalCase module names, `_underscore` private members.

### Build Pipeline (Identical Across All Three)
```
tools/
├── build.js            # Copy → obfuscate (skip CSInterface.js) → jsxbin → patch manifest → sign ZXP
├── generate-docs.js    # Auto-generate documentation
├── installer.iss       # Inno Setup EXE compiler
├── cert.p12            # Self-signed ZXP cert (auto-generated if missing)
└── compat/             # Per-target overlays (2018/2020/2022)
```

Build targets: `2018` (CSXS 6.0), `2020` (CSXS 8.0/10.0), `2022` (CSXS 10.0/12.0).

Commands: `npm run build`, `npm run build:2018|2020|2022`, `npm run build:all`, `npm run docs`.

### CEP Config (Shared)
- `--enable-nodejs --mixed-context` in manifest CEF flags.
- `CSInterface.js` (Adobe boilerplate, NOT obfuscated).
- `host.jsx` compiled to `host.jsxbin` at build.
- Window: 500x700–550x750, min 400x500–420x500.
- `PlayerDebugMode = 1` required for unsigned extensions.

### CSS Architecture
- CSS custom properties for theming: `--bg`, `--surface`, `--text`, `--accent`, etc.
- `[data-theme="dark"]` / `[data-theme="light"]` blocks.
- Glassmorphism with `backdrop-filter`.
- Font: Archivo family (Regular, Medium, SemiBold, Bold).
- Icons: Font Awesome 6.5.1 CDN.

### Storage
- `localStorage` via `StorageManager` singleton.
- Key pattern: `anismooth_*`, `sakugaboru_*`, `sakugaflow_*`, `openpaste_*`.

### Console / Debug
- `dbg(level, source, msg)` global function. Levels: debug, info, warn, error, success.
- `ConsolePanel` singleton: filtered log viewer, clear button, auto-scroll.

---

## Python Backend Pattern (AniSmooth, OpenPaste)

### Communication Protocol
```
JS (Node child_process.spawn) → Python main.py --mode X --arg1 val ...
Python stdout: {"type":"info|warn|error|success|progress","msg":"...","pct":N}
JS reads line-by-line from proc.stdout.on('data')
```

### Python Structure
```
python/
├── main.py             # argparse CLI, mode dispatch
├── setup.py            # venv bootstrap, pip install, FFmpeg download
├── processor.py        # Core pipeline logic (per project)
├── models/             # Model architectures (RIFE, ShuffleCUGAN)
└── utils/              # device.py (GPU detection), video.py (FFmpeg/OpenCV I/O)
```

- snake_case functions, PascalCase classes.
- 4-space indent, single quotes for strings.
- Lazy model loading, cached weights, SHA-256 verification.
- No type hints (or very sparse).
- Custom `log()` prints JSON to stdout. `sys.exit(1)` on fatal.

---

## AE Communication (ExtendScript)

### Pattern
```js
// JS → CEP evalScript → ExtendScript → AE DOM → JSON callback
window.__adobe_cep__.evalScript('fnName(arg1, arg2)', function(result) {
  var data = JSON.parse(result || '{}');
  // handle data.ok, data.filePath, etc.
});
```

### host.jsx Conventions
- All JSX functions return JSON string (hand-built, no JSON.stringify — ES3).
- Prefix function names per extension: `getSelectedLayerInfo()`, `renderSelectedLayer()`, `importToAE()`.
- `jsonEscape()` helper for manual JSON construction.

---

## Tab / Panel Pattern

```js
// All components follow init + bindEvents lifecycle
Panel.init(app) → cache DOM refs → bindEvents() → render initial state
Panel.bindEvents() → addEventListeners + QueueManager.onUpdate → _updateButtons
Panel.addToQueue() → QueueManager.add({ mode, task, name, ... }) → app.switchTab('queue')
```

Tabs loaded one of two ways:
1. Inline content divs with `display:none/block` (OpenPaste, SakugaFlow).
2. Fragment HTML loaded via `tabLoader.js` into `<div data-tab>` placeholders (AniSmooth).

---

## Key Differences Between Projects

| Aspect | AniSmooth | SakugaFlow | OpenPaste | AMVerge-Extension |
|---|---|---|---|---|
| Network | None | HTTP sakugabooru API | None | None |
| Queue | Full persistent queue mgr | Per-session upscale queue | None | None |
| Flowframes | Full integration | None | None | None |
| Image editor | None | None | Canvas editor | None |
| Detection | Deadframe (pixel diff) | None | None | Scene detection (amverge CLI) |
| AE import | Rendered output per job | Downloads -> import | Paste -> import | Scene clips -> sequential import |
| Backend | Python CLI (torch) | External binary (real-esrgan) | Python CLI (rembg) | pip amverge (PyAV/FFmpeg/torch) |
| CSS files | 2 | 14 | 3 | 3 |
| Min AE version | 15.0 (CC 2018) | 15.0 (CC 2018) | 22.0 (CC 2022) | 15.0 (CC 2018) |
| Nav style | Topbar tabs | Topbar tabs | Topbar tabs | Topbar tabs |
|---|---|---|---|
| Network | None | HTTP sakugabooru API + video preload | None |
| Queue | Full persistent queue manager | Per-session upscale queue | None |
| Flowframes | Full integration (exe, AI, encoders) | None | None |
| Image editor | None | None | Canvas brush/restore/eraser |
| Presets | Save/load JSON | None | None |
| GPU monitor | Live polling (CPU/RAM/disk) | None | None |
| Search | None | Tag autocomplete, pagination | None |
| Video player | None | Canvas player + playlist | None |
| CSS files | 2 | 14 (one per component) | 3 |
| Min AE version | 15.0 (CC 2018) | 15.0 (CC 2018) | 22.0 (CC 2022) |

---

## Filename & ID Conventions

- Extension IDs: `com.anismooth.extension`, `com.sakugaflow.extension`, `com.openpaste.extension`, `com.amverge.extension`
- Storage keys prefix: `anismooth_`, `sakugaboru_`, `sakugaflow_`, `openpaste_`, `amverge_`
- Tools folder: `%APPDATA%/com.moongetsu.extensions/<ExtensionName>/backend/`
- Output default: `~/Downloads/<ExtensionName>/`
- Python venv: `%APPDATA%/com.moongetsu.extensions/<ExtensionName>/backend/.venv/`
