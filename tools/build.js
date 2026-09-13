const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');
const jsxbin = require('jsxbin');
const zxpSignCmd = require('zxp-sign-cmd');

const VERSION_PROFILES = {
    '2018': {
        label: 'AE2018',
        hostVersion: '[13.5,20.0]',
        csxsVersion: '6.0',
        description: 'After Effects CC 2017-2018 (v15.x)'
    },
    '2020': {
        label: 'AE2020',
        hostVersion: '[16.0,18.9]',
        csxsVersion: '8.0',
        description: 'After Effects CC 2019-2021 (v16.x-v18.x)'
    },
    '2022': {
        label: 'AE2022',
        hostVersion: '[22.0,99.9]',
        csxsVersion: '10.0',
        description: 'After Effects CC 2022+ (v22.x+)'
    },
    '2026': {
        label: 'AE2026',
        hostVersion: '[24.0,99.9]',
        csxsVersion: '11.0',
        description: 'After Effects 2024-2026+ (v24.x+)'
    }
};

const targetArg = process.argv.find(a => a.startsWith('--target='));
const TARGET = targetArg ? targetArg.split('=')[1] : '2020';
const PROFILE = VERSION_PROFILES[TARGET];

if (!PROFILE) {
    console.error(`Unknown target: ${TARGET}. Valid targets: ${Object.keys(VERSION_PROFILES).join(', ')}`);
    process.exit(1);
}

const SRC_DIR = path.join(__dirname, '..', 'AMVerge');
const DIST_DIR = path.join(__dirname, '..', 'dist', PROFILE.label, 'AMVerge');
const EXTENSION_NAME = 'AMVerge';
const BUNDLE_ID = 'com.amverge.extension';
const CERT_PASSWORD = 'amverge_extension_pass';

function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }
    fs.readdirSync(from).forEach(element => {
        const fromPath = path.join(from, element);
        const toPath = path.join(to, element);
        if (fs.lstatSync(fromPath).isDirectory()) {
            copyFolderSync(fromPath, toPath);
        } else {
            // .debug opens the CEF remote debugging port for the dev junction.
            // A signed package is not the place for it.
            const skip = ['.jsxbin', '.rar', '.zip'].some(ext => element.endsWith(ext)) ||
                element === '.debug';
            if (!skip) {
                fs.copyFileSync(fromPath, toPath);
            }
        }
    });
}

function getFiles(dir, extension, files_) {
    files_ = files_ || [];
    const files = fs.readdirSync(dir);
    for (const i in files) {
        const name = path.join(dir, files[i]);
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, extension, files_);
        } else if (name.endsWith(extension)) {
            files_.push(name);
        }
    }
    return files_;
}

async function runBuild() {
    console.log('Starting ' + EXTENSION_NAME + ' ' + PROFILE.label + ' Build (' + PROFILE.description + ')...');

    if (fs.existsSync(DIST_DIR)) {
        console.log('Cleaning existing dist directory...');
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }

    console.log('Copying files to dist...');
    copyFolderSync(SRC_DIR, DIST_DIR);

    const compatDir = path.join(__dirname, 'compat', TARGET);
    if (fs.existsSync(compatDir)) {
        console.log('Applying compatibility overlay for ' + PROFILE.label + ' (' + TARGET + ')...');
        copyFolderSync(compatDir, DIST_DIR);
    }

    console.log('Obfuscating JavaScript files...');
    const jsFiles = getFiles(DIST_DIR, '.js');

    for (const file of jsFiles) {
        const filename = path.basename(file);
        if (filename === 'CSInterface.js') {
            console.log(' - Skipping library: ' + filename);
            continue;
        }

        console.log(' - Obfuscating: ' + path.relative(DIST_DIR, file));
        const originalCode = fs.readFileSync(file, 'utf8');

        try {
            const obfuscated = JavaScriptObfuscator.obfuscate(originalCode, {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.5,
                deadCodeInjection: false,
                debugProtection: false,
                disableConsoleOutput: false,
                identifierNamesGenerator: 'hexadecimal',
                log: false,
                numbersToExpressions: true,
                renameGlobals: false,
                selfDefending: false,
                simplify: true,
                splitStrings: true,
                stringArray: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.75,
                transformObjectKeys: false,
                unicodeEscapeSequence: false
            }).getObfuscatedCode();

            fs.writeFileSync(file, obfuscated, 'utf8');
        } catch (err) {
            console.error('Failed to obfuscate ' + filename + ': ' + err.message);
        }
    }

    const jsxPath = path.join(DIST_DIR, 'jsx', 'host.jsx');
    const jsxbinPath = path.join(DIST_DIR, 'jsx', 'host.jsxbin');

    if (fs.existsSync(jsxPath)) {
        console.log('Compiling host.jsx to host.jsxbin...');
        try {
            await jsxbin(jsxPath, jsxbinPath);
            console.log(' - Compilation successful!');
            fs.unlinkSync(jsxPath);
            console.log(' - Removed original host.jsx');
        } catch (err) {
            console.error('ExtendScript binary compilation failed: ' + err.message);
            console.log(' - Using uncompiled host.jsx instead');
        }
    } else {
        console.warn('host.jsx not found in dist/jsx/');
    }

    var jsxCompiled = fs.existsSync(jsxbinPath);
    var manifestPath = path.join(DIST_DIR, 'CSXS', 'manifest.xml');
    if (fs.existsSync(manifestPath)) {
        console.log('Patching manifest.xml for ' + PROFILE.label + '...');
        let manifestContent = fs.readFileSync(manifestPath, 'utf8');

        manifestContent = manifestContent.replace(
            /host\.jsx<\/ScriptPath>/g,
            jsxCompiled ? 'host.jsxbin</ScriptPath>' : 'host.jsx</ScriptPath>'
        );

        manifestContent = manifestContent.replace(
            /<Host Name="AEFT" Version="[^"]*"/g,
            '<Host Name="AEFT" Version="' + PROFILE.hostVersion + '"'
        );

        manifestContent = manifestContent.replace(
            /<RequiredRuntime Name="CSXS" Version="[^"]*"/g,
            '<RequiredRuntime Name="CSXS" Version="' + PROFILE.csxsVersion + '"'
        );

        manifestContent = manifestContent.replace(
            /(<ExtensionManifest[^>]*?)\sVersion="[^"]*"/,
            '$1 Version="' + PROFILE.csxsVersion + '"'
        );

        fs.writeFileSync(manifestPath, manifestContent, 'utf8');
        console.log(' - Host: ' + PROFILE.hostVersion + ', CSXS: ' + PROFILE.csxsVersion);
    } else {
        console.error('manifest.xml not found!');
    }

    console.log('');
    console.log('Build process completed! Extension files in "dist/' + PROFILE.label + '/' + EXTENSION_NAME + '".');

    console.log('');
    console.log('Packaging and signing ZXP...');
    const certPath = path.join(__dirname, 'cert.p12');
    const versionDir = path.join(__dirname, '..', 'dist', PROFILE.label);
    const zxpOutputPath = path.join(versionDir, EXTENSION_NAME + '_' + PROFILE.label + '.zxp');

    if (!fs.existsSync(versionDir)) {
        fs.mkdirSync(versionDir, { recursive: true });
    }

    try {
        if (!fs.existsSync(certPath)) {
            console.log(' - Certificate not found. Generating a self-signed certificate...');
            await zxpSignCmd.selfSignedCert({
                country: 'US',
                province: 'NY',
                org: 'AMVerge',
                name: 'AMVerge',
                password: CERT_PASSWORD,
                output: certPath
            });
            console.log(' - Certificate successfully created!');
        }

        // ZXPSignCmd will not overwrite an existing package, and resolves
        // without saying so, so every build after the first one reported
        // success while leaving the previous zxp untouched
        if (fs.existsSync(zxpOutputPath)) {
            fs.rmSync(zxpOutputPath);
        }

        console.log(' - Packaging to ZXP...');
        await zxpSignCmd.sign({
            input: DIST_DIR,
            output: zxpOutputPath,
            cert: certPath,
            password: CERT_PASSWORD
        });
        console.log('Signed package: dist/' + PROFILE.label + '/' + EXTENSION_NAME + '_' + PROFILE.label + '.zxp');
    } catch (signErr) {
        console.error('Failed to package and sign ZXP: ' + signErr.message);
        console.log('     The extension folder is still available in dist/ for manual packaging.');
    }

    console.log('');
    if (process.platform !== 'win32') {
        console.log('Skipping the Inno Setup EXE installer: it can only be compiled on Windows.');
        writeMacInstaller(versionDir);
        writeBatInstaller(versionDir);
        console.log('');
        console.log(EXTENSION_NAME + ' ' + PROFILE.label + ' build complete!');
        return;
    }

    console.log('Building Inno Setup EXE Installer...');
    const isccPaths = [
        'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
        'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
        'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe'
    ];
    if (process.env.LOCALAPPDATA) {
        isccPaths.unshift(path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'));
        isccPaths.unshift(path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 5', 'ISCC.exe'));
    }
    let isccPath = null;
    const { execSync } = require('child_process');

    try {
        execSync('iscc /?', { stdio: 'ignore' });
        isccPath = 'iscc';
    } catch (e) {
        for (const p of isccPaths) {
            if (fs.existsSync(p)) {
                isccPath = p;
                break;
            }
        }
    }

    if (isccPath) {
        try {
            console.log(' - Compiling installer script...');
            const issPath = path.join(__dirname, 'installer.iss');
            const outputName = EXTENSION_NAME + 'Setup_' + PROFILE.label;
            const cmd = isccPath === 'iscc'
                ? 'iscc /DSourcePath="' + DIST_DIR + '" /DOutputDir="' + versionDir + '" /DOutputName="' + outputName + '" "' + issPath + '"'
                : '"' + isccPath + '" /DSourcePath="' + DIST_DIR + '" /DOutputDir="' + versionDir + '" /DOutputName="' + outputName + '" "' + issPath + '"';
            execSync(cmd, { stdio: 'inherit' });
            console.log('Successfully compiled installer EXE!');
        } catch (execErr) {
            console.error('Failed to compile installer EXE: ' + execErr.message);
        }
    } else {
        console.log(' - Inno Setup compiler (ISCC.exe) not found. Skipping automatic EXE generation.');
        console.log('     Please compile tools/installer.iss manually using Inno Setup on Windows to create the EXE.');
    }

    writeBatInstaller(versionDir);
    writeMacInstaller(versionDir);

    console.log('');
    console.log(EXTENSION_NAME + ' ' + PROFILE.label + ' build complete!');
}

function writeBatInstaller(versionDir) {
    const batPath = path.join(versionDir, 'Install-Windows.bat');
    console.log('');
    console.log('Generating Windows batch installer...');
    fs.writeFileSync(batPath, [
        '@echo off',
        ':: Self-elevate to Administrator',
        'net session >nul 2>&1',
        'if %errorLevel% neq 0 (',
        '    echo Requesting administrator privileges...',
        '    goto UACPrompt',
        ') else (',
        '    goto gotAdmin',
        ')',
        '',
        ':UACPrompt',
        '    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\\getadmin.vbs"',
        '    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\\getadmin.vbs"',
        '    "%temp%\\getadmin.vbs"',
        '    exit /B',
        '',
        ':gotAdmin',
        '    if exist "%temp%\\getadmin.vbs" ( del "%temp%\\getadmin.vbs" )',
        '    pushd "%~dp0"',
        '',
        'echo ==========================================================',
        'echo ' + EXTENSION_NAME + ' After Effects Extension - Windows Installer',
        'echo ==========================================================',
        'echo.',
        '',
        'set "SRC_DIR=%~dp0' + EXTENSION_NAME + '"',
        'set "DEST_DIR=C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\' + EXTENSION_NAME + '"',
        '',
        'if not exist "%SRC_DIR%" (',
        '    echo [ERROR] Could not find ' + EXTENSION_NAME + ' folder next to this batch file.',
        '    echo Please make sure the folder exists.',
        '    pause',
        '    exit /b',
        ')',
        '',
        'echo [1/3] Copying extension files...',
        'if exist "%DEST_DIR%" (',
        '    rmdir /s /q "%DEST_DIR%"',
        ')',
        'mkdir "%DEST_DIR%"',
        'xcopy /s /e /y "%SRC_DIR%\\*" "%DEST_DIR%\\" >nul',
        '',
        'echo [2/3] Registering debug keys for After Effects...',
        'reg add "HKCU\\Software\\Adobe\\CSXS.8" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        'reg add "HKCU\\Software\\Adobe\\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        'reg add "HKCU\\Software\\Adobe\\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        'reg add "HKCU\\Software\\Adobe\\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        'reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        'reg add "HKCU\\Software\\Adobe\\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul',
        '',
        'echo [3/3] Finalizing installation...',
        'echo.',
        'echo ==========================================================',
        'echo [SUCCESS] ' + EXTENSION_NAME + ' Extension has been successfully installed!',
        'echo Please restart After Effects and open it from Window ^> Extensions.',
        'echo ==========================================================',
        'echo.',
        'pause'
    ].join('\r\n'), 'utf8');
    console.log(' - Generated batch installer');
}

function writeMacInstaller(versionDir) {
    const cmdPath = path.join(versionDir, 'Install-macOS.command');
    console.log('');
    console.log('Generating macOS installer script...');
    fs.writeFileSync(cmdPath, [
        '#!/bin/bash',
        'set -e',
        '',
        'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'SRC="$HERE/' + EXTENSION_NAME + '"',
        'DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/' + EXTENSION_NAME + '"',
        '',
        'echo "=========================================================="',
        'echo "' + EXTENSION_NAME + ' After Effects Extension - macOS Installer"',
        'echo "=========================================================="',
        'echo',
        '',
        'if [ ! -d "$SRC" ]; then',
        '  echo "[ERROR] Could not find the ' + EXTENSION_NAME + ' folder next to this script."',
        '  exit 1',
        'fi',
        '',
        'echo "[1/4] Copying extension files..."',
        'rm -rf "$DEST"',
        'mkdir -p "$DEST"',
        'cp -R "$SRC/." "$DEST/"',
        '',
        'echo "[2/4] Clearing quarantine and restoring executable bits..."',
        '/usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true',
        'if [ -d "$DEST/bin" ]; then',
        '  find "$DEST/bin" -type f -name uv -exec chmod 755 {} \\;',
        'fi',
        '',
        'echo "[3/4] Enabling PlayerDebugMode for CEP..."',
        'for v in 9 10 11 12 13; do',
        '  defaults write com.adobe.CSXS.$v PlayerDebugMode 1',
        'done',
        'killall cfprefsd 2>/dev/null || true',
        '',
        'echo "[4/4] Finalizing installation..."',
        'echo',
        'echo "=========================================================="',
        'echo "[SUCCESS] ' + EXTENSION_NAME + ' installed to:"',
        'echo "$DEST"',
        'echo "Restart After Effects, then open Window > Extensions > ' + EXTENSION_NAME + '."',
        'echo "=========================================================="',
        'echo'
    ].join('\n'), 'utf8');
    fs.chmodSync(cmdPath, 0o755);
    console.log(' - Generated macOS installer script');
}

runBuild().catch(err => {
    console.error('Build crashed: ' + err);
    process.exit(1);
});
