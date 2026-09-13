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

Root `package.json` proxies to `tools/`. Commands: `build`, `build:2018|2020|2022|2026`, `build:all`, `docs`, `fetch:uv`.

- Targets are AE version profiles in `tools/build.js`. `2026` covers AE 2024-2026+ (host `[24.0,99.9]`, CSXS 11.0). AE 2026 is v26.5 and runs CEP 12.
- The manifest's root `Version` attribute is patched to the same CSXS version as `RequiredRuntime`; CEP 12 wants them to agree.
- Builds run on Windows and macOS. The Inno Setup `.exe` is Windows only and is skipped elsewhere; ZXP signing and JSXBIN compilation work on both.
- `npm run build:2026` / `build:all` stage `uv` first via `fetch:uv` (host triple only, `--all` for a release).
- No test framework. No lint/typecheck.
- Build: copy source -> obfuscate JS -> compile JSXBIN -> patch manifest -> sign ZXP -> write per-platform install scripts.

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
│   │   ├── videoPlayer.js      # Preview playback surface
│   │   ├── cutProgressCard.js  # Streaming cut/re-encode progress card
│   │   ├── settingsPanel.js    # Settings page + color picker
│   │   ├── historyPanel.js     # Desktop app cache episodes sync panel
│   │   ├── aiInstallModal.js   # AI pack / runtime install dialog
│   │   └── toolsSetup.js       # Setup wizard (provisions the shared runtime)
│   └── utils/
│       ├── storage.js          # localStorage wrapper (amverge_* keys)
│       ├── fileSystem.js       # Node wrappers, platform paths, PATH fixup, file dialogs
│       ├── tabLoader.js        # Synchronous modular tab HTML loader
│       ├── customSelect.js     # Styled <select> replacement
│       ├── previewProxy.js     # preview-proxy spawns for unplayable codecs
│       ├── amvergeRuntime.js   # Shared Python runtime provisioning via bundled uv
│       └── amvergeHandler.js   # Spawn amverge, parse IPC events
├── bin/uv/<triple>/uv          # Bundled uv, staged by `npm run fetch:uv` (gitignored)
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
| `js/utils/fileSystem.js` | Every platform difference the panel sees: PATH fixup at load, native file dialogs, app data and runtime roots, `ensureExecutable` |
| `js/utils/amvergeRuntime.js` | Shared runtime via bundled `uv`. `install()` for AI packs, `installBase()` for the CLI alone |

## Storage

- `localStorage` keys: `amverge_*` (settings, setup_complete, setup_skipped)
- Output: user-configurable, defaults to `~/Downloads/AMVerge/<video_stem>/`
- Scene cache: `.npy` files in output dir (TransNetV2 only)

## CEP Quirks

- Must have `PlayerDebugMode = 1` for unsigned extensions: registry `HKCU\Software\Adobe\CSXS.*` on Windows, `defaults write com.adobe.CSXS.<n> PlayerDebugMode 1` plus `killall cfprefsd` on macOS
- Four AE targets need different manifest version ranges, patched at build
- CSP restricts to `'self'` except Font Awesome CDN

## Platform Support

Windows and macOS. Every platform branch keys off `process.platform`; Windows stays the default path.

| Concern | Windows | macOS |
|---|---|---|
| File / folder pickers | PowerShell `System.Windows.Forms` dialogs | `osascript` `choose file` / `choose folder` (`FileSystem._chooseFileMac`) |
| Killing a run | `taskkill /F /T` | `SIGTERM` |
| Extension install dir | `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\` | `~/Library/Application Support/Adobe/CEP/extensions/` |
| App data (`FileSystem.getAppDataDir`) | `%APPDATA%` | `~/Library/Application Support` |
| Shared runtime | `%LOCALAPPDATA%\AMVerge\runtime` | `~/Library/Application Support/AMVerge/runtime` |
| GPU decode (Nelux / NVDEC) | supported | unavailable, hidden and never requested |
| Installer | `Install-Windows.bat`, Inno Setup `.exe` | `Install-macOS.command` |

macOS specifics worth knowing before touching this code:

- **PATH.** After Effects launched from the Finder gives children `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew, uv and pipx installs are invisible and every `spawn('python')` is an ENOENT. `fileSystem.js` prepends the usual bin dirs to `process.env.PATH` at load, which every child process then inherits.
- **No bare `python`.** macOS has `python3` only, so interpreter lookups walk `App._pythonNames()` (`python3` first off Windows).
- **Executable bits.** A `.zxp` install drops them, so the bundled `uv` is chmodded via `FileSystem.ensureExecutable` before use; the installer script also clears `com.apple.quarantine` (with `/usr/bin/xattr`, since a Homebrew `xattr` on PATH lacks `-r`).
- **PEP 668.** A system Python refuses `pip install`, so first-run setup calls `AmvergeRuntime.installBase()`, which provisions the shared runtime with the bundled `uv` instead. No system Python is needed at all.
