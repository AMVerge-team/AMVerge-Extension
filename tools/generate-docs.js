const fs = require('fs');
const path = require('path');

const EXTENSION_NAME = 'AMVerge';
const BUNDLE_ID = 'com.amverge.extension';
const EXTENSION_DISPLAY_NAME = 'AMVerge Extension';

const GENERAL_INFO = `
## What is ${EXTENSION_NAME}?
${EXTENSION_NAME} is an After Effects extension that detects scene boundaries in videos and imports the detected clips directly into your composition. It uses the amverge CLI backend (PyAV/FFmpeg) for fast, lossless scene detection.

## Features
- **Scene Detection** - Automatically detect scene changes in video files using keyframe analysis or machine learning.
- **Clip Preview** - Preview each detected scene before importing.
- **Sequential Import** - Import all scenes as layers, positioned sequentially in the timeline.
- **Auto-Scale** - Automatically scale imported footage to fit your composition.
- **Multiple Detection Methods** - Choose from keyframe (fastest), edge detection, or TransNetV2 (deep learning).
`;

const ROOT_README = `<h1 align="center">
  <img src="AMVerge/AMVerge-Logo.png" height="48" alt="AMVerge"/>
  <br />
 </h1>
<p align="center">
  <b>Scene Detection & Clip Import directly in After Effects.</b><br>
  <i>Detect scene changes, preview clips, and import them as layers.</i>
</p>

<hr>

## About

**AMVerge** is a free After Effects CEP extension that detects scene boundaries in video files and imports the detected clips directly into your composition as layers. It uses the \`amverge\` CLI backend for fast, lossless scene detection.

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
2. Drag \`AMVerge_AE2026.zxp\` onto the ZXP Installer window.
3. Restart After Effects, go to \`Window > Extensions > AMVerge\`.

### Method 2: One-click script
- **Windows:** run \`Install-Windows.bat\` (elevates itself).
- **macOS:** run \`Install-macOS.command\` (double-click, or \`bash Install-macOS.command\`).

Both copy the extension into place and enable PlayerDebugMode. Restart After Effects afterwards.

### Method 3: Windows Setup Wizard (.exe)
1. Run \`AMVergeSetup_AE2026.exe\` from your version folder.
2. Follow the setup wizard.

### Method 4: Manual Folder Installation
1. Copy the \`AMVerge\` folder to the Adobe CEP extensions directory:
   - Windows: \`C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\\`
   - macOS: \`~/Library/Application Support/Adobe/CEP/extensions/\`
2. Enable PlayerDebugMode:
   - Windows: double-click \`Add-Keys.reg\`, or run \`Add-Keys.bat\` as admin.
   - macOS: run \`Enable-Debug-macOS.command\`.
3. Restart After Effects.

---

## Building from Source
\`\`\`bash
cd tools && npm install
cd .. && npm run build:all
\`\`\`

Single target: \`npm run build:2026\` (also 2018 / 2020 / 2022). The \`.exe\` installer is
only produced on Windows; every other output builds on both platforms.

---

## Requirements

- Scene detection backend: the first-run setup installs it into a private AMVerge
  runtime with the bundled \`uv\`, so no system Python is required. To supply your own
  instead, \`pip install amverge[edge]\` with Python 3.9+ (PyAV and FFmpeg).
- GPU decode (NVDEC) needs an NVIDIA GPU and is Windows only.
`;

const INSTALL_GUIDE_TXT = `================================================================================
${EXTENSION_NAME.toUpperCase()} AFTER EFFECTS EXTENSION - COMPLETE INSTALLATION GUIDE
================================================================================

${GENERAL_INFO}

Each version folder (AE2018 / AE2020 / AE2022 / AE2026) contains:
 - AMVerge/           Unpacked extension files
 - AMVerge_AEXXXX.zxp Signed ZXP package
 - AMVergeSetup_AEXXXX.exe Windows setup wizard (built on Windows only)
 - Install-Windows.bat  One-click batch installer (copies files + enables debug mode)
 - Install-macOS.command One-click macOS installer (copies files + enables debug mode)

Use AE2026 for After Effects 2024 and newer, including After Effects 2026 (v26.x).

Root-level helper files (version-agnostic):
 - Add-Keys.reg         Double-click to enable PlayerDebugMode (CSXS.9-13)
 - Add-Keys.bat         Run as admin to enable PlayerDebugMode (CSXS.9-13)
 - Enable-Debug-macOS.command  Enable PlayerDebugMode on macOS (CSXS.9-13)

--------------------------------------------------------------------------------
METHOD 1: ZXP INSTALLATION (Easiest & Most Recommended)
--------------------------------------------------------------------------------
1. Open your After Effects version folder (AE2018 / AE2020 / AE2022 / AE2026).
2. Download the free ZXP Installer utility:
   --> https://aescripts.com/learn/post/zxp-installer (Windows & macOS)
3. Launch ZXP Installer.
4. Drag "AMVerge_AEXXXX.zxp" into the ZXP Installer window.
5. Restart After Effects.
6. Open the extension from: Window > Extensions > ${EXTENSION_NAME}.

--------------------------------------------------------------------------------
METHOD 2: ONE-CLICK SCRIPT (Windows or macOS)
--------------------------------------------------------------------------------
Windows: run "Install-Windows.bat" from your version folder. It asks for
administrator rights, copies the extension to the system CEP folder and adds the
PlayerDebugMode keys.

macOS: run "Install-macOS.command" from your version folder (double-click it, or
run "bash Install-macOS.command" in Terminal). It copies the extension to
~/Library/Application Support/Adobe/CEP/extensions/${EXTENSION_NAME}, clears the
download quarantine flag, restores the executable bit on the bundled uv binary and
writes the PlayerDebugMode defaults. No administrator rights are needed.

Restart After Effects, then: Window > Extensions > ${EXTENSION_NAME}.

--------------------------------------------------------------------------------
METHOD 3: WINDOWS SETUP WIZARD (.exe Installer)
--------------------------------------------------------------------------------
1. Open your version folder and run "AMVergeSetup_AEXXXX.exe".
2. Follow the setup wizard instructions.
3. The installer handles file placement and registry configuration.
4. Open After Effects, go to: Window > Extensions > ${EXTENSION_NAME}.

--------------------------------------------------------------------------------
METHOD 4: MANUAL FOLDER INSTALLATION
--------------------------------------------------------------------------------
1. Copy the "AMVerge" folder from your desired version folder to the Adobe CEP extensions dir:
  - Windows: C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\${EXTENSION_NAME}\\
  - macOS:   ~/Library/Application Support/Adobe/CEP/extensions/${EXTENSION_NAME}/

2. Enable PlayerDebugMode (so Adobe loads unsigned extensions):
   Windows, choose one of the following:
  - Double-click "Add-Keys.reg" (recommended, one-click)
  - Run "Add-Keys.bat" as administrator
  - Run "Install-Windows.bat" from your version folder (copies files + keys in one step)
  - Or add the keys manually (Command Prompt as Admin):
      reg add "HKCU\\Software\\Adobe\\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
      reg add "HKCU\\Software\\Adobe\\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
      reg add "HKCU\\Software\\Adobe\\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
      reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
      reg add "HKCU\\Software\\Adobe\\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f

   macOS, choose one of the following:
  - Run "Enable-Debug-macOS.command"
  - Run "Install-macOS.command" from your version folder (copies files + defaults in one step)
  - Or write the defaults manually (Terminal):
      defaults write com.adobe.CSXS.12 PlayerDebugMode 1
      killall cfprefsd
    (repeat for CSXS.9 through CSXS.13 to cover every CEP version)

   macOS note: files unpacked from a downloaded archive carry a quarantine flag that
   can stop the bundled uv binary from running. Clear it with:
      /usr/bin/xattr -dr com.apple.quarantine ~/Library/Application\\ Support/Adobe/CEP/extensions/${EXTENSION_NAME}

3. Restart After Effects and launch via: Window > Extensions > ${EXTENSION_NAME}.
================================================================================
`;

const AESCRIPTS_SUBMISSION_INFO = `# aescripts + aeplugins Submission Metadata

Use this info when submitting the extension to aescripts.com:

================================================================================
PRODUCT INFORMATION
================================================================================
- **Product Name:** ${EXTENSION_DISPLAY_NAME}
- **Extension Bundle ID:** ${BUNDLE_ID}
- **Extension Type:** After Effects CEP Panel
- **Required Run Time:** CSXS 6.0 or newer
- **Host Compatibility:** Adobe After Effects CC 2017 (14.0) to CC 2026+ (99.9)

================================================================================
INSTALLATION TEXT FOR CUSTOMERS
================================================================================
To install the ${EXTENSION_NAME} extension:
1. Download and run the aescripts + aeplugins manager app OR the ZXP Installer.
2. Pick your AE version, drag the ZXP package onto the installer.
3. Restart After Effects and launch the extension from Window > Extensions > ${EXTENSION_NAME}.

Refer to the guide: https://aescripts.com/learn/post/zxp-installer
`;

const REG_KEYS = `Windows Registry Editor Version 5.00

; Enable PlayerDebugMode for After Effects CEP extensions (CSXS.9 - CSXS.13)
; Double-click this file and confirm to add the keys, then restart After Effects.

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.9]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.10]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.11]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.12]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.13]
"PlayerDebugMode"="1"
`;

const REG_BAT = `@echo off
:: Enable PlayerDebugMode for After Effects CEP extensions (CSXS.9 - CSXS.13)
:: Right-click and "Run as administrator", then restart After Effects.

reg add "HKCU\\Software\\Adobe\\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\\Software\\Adobe\\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\\Software\\Adobe\\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\\Software\\Adobe\\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f

echo.
echo PlayerDebugMode keys added successfully.
echo Restart After Effects for changes to take effect.
echo.
pause
`;

const DEBUG_COMMAND = `#!/bin/bash
# Enable PlayerDebugMode for After Effects CEP extensions (CSXS.9 - CSXS.13)
# Double-click this file, then restart After Effects.

for v in 9 10 11 12 13; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
killall cfprefsd 2>/dev/null || true

echo
echo "PlayerDebugMode enabled for CSXS.9 - CSXS.13."
echo "Restart After Effects for the change to take effect."
echo
`;

function generateDocs() {
    const rootDir = path.join(__dirname, '..');
    const distDir = path.join(rootDir, 'dist');

    console.log('Generating documentation files...');

    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    fs.writeFileSync(path.join(rootDir, 'README.md'), ROOT_README.trim() + '\n', 'utf8');
    console.log(' - Generated: README.md (Root)');

    fs.writeFileSync(path.join(distDir, 'INSTALL_GUIDE.txt'), INSTALL_GUIDE_TXT.trim() + '\n', 'utf8');
    console.log(' - Generated: dist/INSTALL_GUIDE.txt');

    fs.writeFileSync(path.join(distDir, 'aescripts_submission_info.txt'), AESCRIPTS_SUBMISSION_INFO.trim() + '\n', 'utf8');
    console.log(' - Generated: dist/aescripts_submission_info.txt');

    fs.writeFileSync(path.join(distDir, 'Add-Keys.reg'), REG_KEYS.trim() + '\r\n', 'utf8');
    console.log(' - Generated: dist/Add-Keys.reg');

    fs.writeFileSync(path.join(distDir, 'Add-Keys.bat'), REG_BAT.trim() + '\r\n', 'utf8');
    console.log(' - Generated: dist/Add-Keys.bat');

    const debugCommandPath = path.join(distDir, 'Enable-Debug-macOS.command');
    fs.writeFileSync(debugCommandPath, DEBUG_COMMAND.trim() + '\n', 'utf8');
    fs.chmodSync(debugCommandPath, 0o755);
    console.log(' - Generated: dist/Enable-Debug-macOS.command');

    console.log('Documentation generation complete!');
}

module.exports = { generateDocs };

if (require.main === module) {
    generateDocs();
}
