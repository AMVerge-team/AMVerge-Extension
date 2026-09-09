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

> **Compatibility:** Supports After Effects CC 2017 through CC 2026+ (v15.0+). Windows only.

---

## Features

- **Scene Detection** - Automatically detect cuts and scene changes.
- **Clip Preview** - Thumbnail grid with click-to-preview.
- **Batch Import** - Import all scenes into your composition at once.
- **Auto-Scale** - Clips automatically scaled to fit comp dimensions.
- **Multiple Methods** - Keyframe (fast), Edge (OpenCV), TransNetV2 (deep learning).

---

## Installation

### Method 1: ZXP Installer (Easiest)
1. Pick your After Effects version folder (AE2018 / AE2020 / AE2022).
2. Download [ZXP Installer](https://aescripts.com/learn/post/zxp-installer).
3. Drag `AMVerge_AE2020.zxp` onto the ZXP Installer window.
4. Restart After Effects, go to `Window > Extensions > AMVerge`.

### Method 2: Windows Setup Wizard (.exe)
1. Run `AMVergeSetup_AE2020.exe` from your version folder.
2. Follow the setup wizard.

### Method 3: Manual Folder Installation
1. Copy the `AMVerge` folder to: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
2. Enable PlayerDebugMode: run `Install-Windows.bat` as admin or double-click `Add-Keys.reg`.
3. Restart After Effects.

---

## Building from Source
```bash
cd tools && npm install
cd .. && npm run build:all
```

---

## Requirements

- `pip install amverge[edge]` for scene detection backend.
- Python 3.9+ with PyAV and FFmpeg.
