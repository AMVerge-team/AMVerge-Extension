#!/usr/bin/env node
'use strict';

/**
 * Packages the DaVinci Resolve Studio Workflow Integration plugin into
 * dist/com.amverge.resolve/ by combining AMVerge-Resolve/ with the shared UI
 * from AMVerge/ (leaving AMVerge/ completely untouched).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESOLVE_SRC = path.join(ROOT, 'AMVerge-Resolve');
const UI_SRC = path.join(ROOT, 'AMVerge');
const OUT_DIR = path.join(ROOT, 'dist', 'com.amverge.resolve');
const UI_OUT = path.join(OUT_DIR, 'ui');

const SHARED_UI_ENTRIES = [
  'index.html',
  'tabs',
  'css',
  'js',
  'fonts',
  'LogoAMVerge.png',
  'LogoAMVergeFull.png',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(UI_OUT, { recursive: true });

  // 1. Copy Resolve plugin files
  for (const file of ['manifest.xml', 'package.json', 'main.js', 'resolveBridge.js']) {
    copyRecursive(path.join(RESOLVE_SRC, file), path.join(OUT_DIR, file));
  }

  // 2. Copy shared UI assets from AMVerge/
  for (const entry of SHARED_UI_ENTRIES) {
    const srcPath = path.join(UI_SRC, entry);
    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, path.join(UI_OUT, entry));
    }
  }

  // 3. Inject resolveBridge.js before CSInterface.js in ui/index.html
  const indexPath = path.join(UI_OUT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const bridgeTag = '<script src="../resolveBridge.js"></script>\n  ';
  if (html.includes('CSInterface.js')) {
    html = html.replace('<script src="js/CSInterface.js"></script>', bridgeTag + '<script src="js/CSInterface.js"></script>');
  } else {
    html = html.replace('</head>', '  ' + bridgeTag + '\n</head>');
  }
  fs.writeFileSync(indexPath, html, 'utf8');

  console.log('Built DaVinci Resolve plugin at:', OUT_DIR);
}

build();
