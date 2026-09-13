<h1 align="center">
  <img src="AMVerge/AMVerge-Logo.png" height="48" alt="AMVerge"/>
  <br />
 </h1>
<p align="center">
  <b>Scene Detection & Clip Import directly in After Effects.</b><br>
  <i>Detect scene changes, preview clips, and import them as layers.</i>
</p>

<hr>

## About

**AMVerge** is a free After Effects CEP extension that detects scene boundaries in video files and imports the detected clips directly into your composition as layers. It uses the `amverge` CLI backend for fast, lossless scene detection.

> **Compatibility:** Supports After Effects CC 2017 through 2026+ (v15.0+), on Windows and macOS.

---

## Features

- **Scene Detection** - Automatically detect cuts and scene changes.
- **Clip Preview** - Thumbnail grid with click-to-preview.
- **Batch Import** - Import all scenes into your composition at once.
- **Auto-Scale** - Clips automatically scaled to fit comp dimensions.
- **Multiple Methods** - Keyframe (fast), Edge (OpenCV), TransNetV2 (deep learning).

---

## Installation

Pick the folder that matches your After Effects release: AE2018 / AE2020 / AE2022 / AE2026 (use AE2026 for After Effects 2024 and newer).

### Method 1: ZXP Installer (Easiest, Windows & macOS)
1. Download [ZXP Installer](https://aescripts.com/learn/post/zxp-installer).
2. Drag `AMVerge_AE2026.zxp` onto the ZXP Installer window.
3. Restart After Effects, go to `Window > Extensions > AMVerge`.

### Method 2: One-click script
- **Windows:** run `Install-Windows.bat` (elevates itself).
- **macOS:** run `Install-macOS.command` (double-click, or `bash Install-macOS.command`).

Both copy the extension into place and enable PlayerDebugMode. Restart After Effects afterwards.

### Method 3: Windows Setup Wizard (.exe)
1. Run `AMVergeSetup_AE2026.exe` from your version folder.
2. Follow the setup wizard.

### Method 4: Manual Folder Installation
1. Copy the `AMVerge` folder to the Adobe CEP extensions directory:
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
2. Enable PlayerDebugMode:
   - Windows: double-click `Add-Keys.reg`, or run `Add-Keys.bat` as admin.
   - macOS: run `Enable-Debug-macOS.command`.
3. Restart After Effects.

---

## Building from Source
```bash
cd tools && npm install
cd .. && npm run build:all
```

Single target: `npm run build:2026` (also 2018 / 2020 / 2022). The `.exe` installer is
only produced on Windows; every other output builds on both platforms.

---

## Requirements

- Scene detection backend: the first-run setup installs it into a private AMVerge
  runtime with the bundled `uv`, so no system Python is required. To supply your own
  instead, `pip install amverge[edge]` with Python 3.9+ (PyAV and FFmpeg).
- GPU decode (NVDEC) needs an NVIDIA GPU and is Windows only.
