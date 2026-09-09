# AGENTS.md - AMVerge CEP Extension

After Effects CEP extension: scene detection via `amverge` CLI backend. Import detected clips directly into AE as layers. AMVergeApp UI design language.

## AI Agent Instructions

- **Update this file** when adding/removing files, changing architecture, adding new build steps, or introducing conventions.
- **Commit style:** prefix tag in parentheses: `(add)` new features, `(fix)` bug fixes, `(update)` refactors/formatting/chores. Title case after colon.
- **Commit author:** always commit under the user's account. Do NOT add `Co-Authored-By: Claude` trailer.
- **Commit per task:** separate commit after each logical change. Do not batch unrelated changes.
- **No code comments:** do NOT add comments when writing or modifying code. Put explanation in commit message or this file.
- **No em dashes:** never use `—`. Use comma, colon, parens, or plain hyphen `-`.
- **var only** (CC 2018+ CEP 6.0). No let/const, no arrow functions, no template literals. String concat with `+`.

## Backend

- `pip install amverge` is the backend. Spawn via `child_process.spawn('python', ['-m', 'amverge', ...])`.
- Unified CLI: `amverge detect --method <method> --ipc --output <dir> <video>` for all 3 methods (keyframe/edge/transnetv2). No more inline Python scripts.
- IPC protocol (stderr): `PROGRESS|pct|msg` only. stdout gets final JSON array of scenes.
- Default detection method: keyframe (fast, lossless, no ML deps).

## Build & Run

```bash
cd tools && npm install
cd .. && npm run build:all
```

Root `package.json` proxies to `tools/`. Commands: `build`, `build:2018|2020|2022`, `build:all`, `docs`.

- No test framework. No lint/typecheck.
- Build: copy source -> obfuscate JS -> compile JSXBIN -> patch manifest -> sign ZXP.

## Tech Stack

| Layer | Tech |
|---|---|
| Extension | Adobe CEP 6.0+, CSXS |
| UI | Vanilla JS, HTML, CSS custom properties (AMVergeApp design). Font: Jersey 10 (local). Sidebar nav. Dark-only. |
| AE bridge | CEP CSInterface.js + ExtendScript (`jsx/host.jsx`) |
| Backend | `amverge` CLI (`pip install amverge[edge]`) via child_process.spawn |
| Detection | Keyframe (PyAV, default) / Edge (OpenCV) / TransNetV2 (PyTorch, optional) |

## Directory Map

```
<repo root>/
├── package.json                # Shim -> tools scripts via --prefix
├── PROFILE.md
├── AMVERGE_APP_UI_REFERENCE.md
├── AMVERGE_CLI_BACKEND_REFERENCE.md
├── tools/
│   ├── build.js                # Obfuscate -> JSXBIN -> patch manifest -> sign ZXP
│   ├── installer.iss
│   └── cert.p12
└├── AMVerge/                    # <- the extension
├── CSXS/manifest.xml
├── index.html                  # SPA: topbar nav + dynamic tabLoader placeholders
├── tabs/
│   ├── home.html               # Home tab: import & scene grid preview
│   ├── console.html            # Console debug log tab
│   ├── settings.html           # Settings & appearance tab
│   ├── history.html            # Episodes history & desktop sync tab
│   └── setup.html              # First-run setup wizard overlay
├── css/
│   ├── base.css                # Tokens, reset, body, scrollbar, app shell, sidebar, buttons
│   ├── home.css                # Import idle, progress, split layout, clips grid, preview panel
│   ├── settings.css            # Settings page, custom checkboxes, color picker
│   ├── history.css             # Episode history items and list
│   ├── console.css             # Debug console toolbar and log entries
│   ├── setup.css               # Setup wizard overlay and step cards
│   └── common.css              # Modals, toasts, skeleton shimmer animations
├── js/
│   ├── CSInterface.js          # Adobe boilerplate (NOT obfuscated)
│   ├── console.js              # dbg() logger + ConsolePanel
│   ├── main.js                 # App singleton
│   ├── components/
│   │   ├── importPanel.js      # Video import + progress UI
│   │   ├── clipsPanel.js       # Scene grid (matching AMVergeApp layout)
│   │   ├── previewPanel.js     # Clip preview + import-to-AE controls
│   │   ├── settingsPanel.js    # Settings page + color picker
│   │   ├── historyPanel.js     # Desktop app cache episodes sync panel
│   │   └── toolsSetup.js       # Setup wizard (pip install amverge)
│   └── utils/
│       ├── storage.js          # localStorage wrapper (amverge_* keys)
│       ├── fileSystem.js       # Node fs/path/os/child_process wrappers
│       ├── tabLoader.js        # Synchronous modular tab HTML loader
│       └── amvergeHandler.js   # Spawn amverge, parse IPC events
└── jsx/host.jsx                # ExtendScript: import scenes to AE
```

## Key Architecture

### Data Flow
```
1. User clicks "Import Video" -> PowerShell OpenFileDialog
2. spawn("python", ["-m", "amverge", "detect", "--method", method, "--ipc", "--output", dir, video])
3. stderr: PROGRESS|pct|msg -> progress bar
4. stdout: JSON array of scenes -> ClipsPanel renders grid
5. PreviewPanel shows selected clip, "Import to AE" button
6. evalScript('importSceneToAE(json)') per clip
7. Clips positioned sequentially in timeline, trimmed to scene duration
```

### IPC Protocol
```
PROGRESS|pct|msg  -> progress bar
stdout: JSON array of scene objects [{scene_index,start,end,duration,path,thumbnail,original_file}]
```

### AE Import (host.jsx)
- `importSceneToAE(jsonStr)` parses JSON `{filePath, layerName, autoScale, offset, prevDuration}`
- Captures selection BEFORE `layers.add()` (AE bug: add reselects)
- Sequential positioning: each scene placed after previous
- Auto-scale to comp via `Math.min(compW/footageW, compH/footageH) * 100`
- Returns JSON `{"ok":true/false, "message":"...", "filePath":"...", "name":"..."}`

## Code Conventions

- **All JS:** IIFE-wrapped globals on `window`, no ES modules, no bundler
- **Indentation:** 2-space, K&R braces
- **Naming:** camelCase vars/fns, PascalCase modules, snake_case localStorage keys
- **Async:** callbacks only, no Promises, no async/await
- **DOM:** vanilla `document.getElementById`, `addEventListener`, `classList`
- **Logging:** `dbg(level, source, message)`; levels: debug, info, warn, error, success
- **`var` only** (no let/const, CEP Chromium 53)
- **`var self = this`** inside callbacks

## Critical Paths

| File | Role |
|---|---|
| `js/main.js` | App singleton. Tab switching, import flow, settings, theme/accent |
| `js/utils/amvergeHandler.js` | Spawns `amverge detect --method <method> --ipc` for all methods. Single code path `_runDetect()` parses PROGRESS| stderr events + final JSON array from stdout |
| `js/components/clipsPanel.js` | Scene grid rendering, selection state, click-to-select |
| `jsx/host.jsx` | `importSceneToAE()`: footage import, sequential layering, auto-scale. Selection capture ordering is critical (capture before add) |

## Storage

- `localStorage` keys: `amverge_*` (settings, setup_complete, setup_skipped)
- Output: user-configurable, defaults to `~/Downloads/AMVerge/<video_stem>/`
- Scene cache: `.npy` files in output dir (TransNetV2 only)

## CEP Quirks

- Must have `PlayerDebugMode = 1` in registry for unsigned extensions
- Three AE targets need different manifest version ranges, patched at build
- CSP restricts to `'self'` except Font Awesome CDN
- No macOS support, Windows-only (PowerShell dialogs, taskkill)
