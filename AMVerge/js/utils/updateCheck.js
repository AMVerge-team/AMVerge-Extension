/**
 * updateCheck.js - tells the user when a newer extension release exists, and
 * on Windows can install it from the banner.
 *
 * The panel reads the repo's latest GitHub release (published by
 * .github/workflows/release.yml on a version tag) and compares its tag with
 * this build's manifest version. Pre-releases are skipped by /releases/latest.
 *
 * In-panel install only runs when this panel was itself installed by
 * AMVergeSetup.exe (Common Files\Adobe\CEP\extensions\AMVerge). A ZXP install
 * or a dev checkout lives elsewhere, and running the installer there would put
 * a second copy with the same bundle id beside it, so those get the browser.
 */
(function () {
  'use strict';

  var REPO_PAGE = 'https://github.com/AMVerge-team/AMVerge-Extension';
  var FEED_URL = 'https://api.github.com/repos/AMVerge-team/AMVerge-Extension/releases/latest';
  var DEFAULT_PAGE = REPO_PAGE + '/releases/latest';
  var CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/AMVerge-team/AMVerge/main/frontend/src/data/CHANGELOG.md';
  var TIMEOUT_MS = 8000;
  // a stalled socket, not a slow one: reset on every chunk
  var DOWNLOAD_IDLE_MS = 30000;
  // only GitHub's own hosts may serve the installer we run elevated
  var ALLOWED_DOWNLOAD_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com)$/i;

  // banner states: what the button does when clicked
  var STATE_READY = 'ready';         // offer the update
  var STATE_BUSY = 'busy';           // downloading / installing, button disabled
  var STATE_RELOAD = 'reload';       // installed, reload the panel
  var STATE_BROWSER = 'browser';     // anything went wrong: send to the release page

  function nodeRequire(mod) {
    try { return window.cep_node.require(mod); } catch (e) {}
    try { return window.__adobe_cep__.node.require(mod); } catch (e) {}
    try { return require(mod); } catch (e) {}
    return null;
  }

  /** -1, 0 or 1; numeric parts only, so "1.2.0" beats "1.10" correctly */
  function compareVersions(a, b) {
    var pa = String(a).split(/[.-]/);
    var pb = String(b).split(/[.-]/);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i], 10) || 0;
      var nb = parseInt(pb[i], 10) || 0;
      if (na !== nb) return na > nb ? 1 : -1;
    }
    return 0;
  }

  /** this build's version, read from the manifest so there is one place to bump */
  function installedVersion() {
    try {
      var fs = window.FileSystem;
      var manifest = fs.path.join(fs.getExtensionRoot(), 'CSXS', 'manifest.xml');
      var xml = fs.readFile(manifest) || '';
      var match = xml.match(/ExtensionBundleVersion="([^"]+)"/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  function fetchText(url, redirectsLeft, done) {
    var https = nodeRequire('https');
    if (!https) return done(null);

    var finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      done(value);
    }

    try {
      var headers = { 'User-Agent': 'AMVerge-Extension' };
      var req = https.get(url, { headers: headers }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return fetchText(res.headers.location, redirectsLeft - 1, finish);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return finish(null);
        }
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { body += chunk; });
        res.on('end', function () { finish(body); });
      });
      req.on('error', function () { finish(null); });
      req.setTimeout(TIMEOUT_MS, function () { req.abort(); finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  function fetchJson(url, redirectsLeft, done) {
    fetchText(url, redirectsLeft, function (body) {
      if (!body) return done(null);
      try { done(JSON.parse(body)); } catch (e) { done(null); }
    });
  }

  function normDir(p) {
    return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  }

  /** where AMVergeSetup.exe puts the extension ({commoncf}\Adobe\CEP\extensions\AMVerge) */
  function installerTargetDir() {
    var common = process.env.CommonProgramFiles || process.env.COMMONPROGRAMFILES ||
      'C:\\Program Files\\Common Files';
    return common + '\\Adobe\\CEP\\extensions\\AMVerge';
  }

  /** true only when the running panel IS the copy the installer would overwrite */
  function installedByInstaller() {
    if (process.platform !== 'win32') return false;
    try {
      var root = window.FileSystem && window.FileSystem.getExtensionRoot
        ? window.FileSystem.getExtensionRoot() : '';
      return !!root && normDir(root) === normDir(installerTargetDir());
    } catch (e) {
      return false;
    }
  }

  function pickInstallerAsset(assets) {
    if (!assets || !assets.length) return null;
    var fallback = null;
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a || !a.name || !a.browser_download_url) continue;
      var name = String(a.name).toLowerCase();
      if (name === 'amvergesetup.exe') return a;
      if (!fallback && /\.exe$/.test(name)) fallback = a;
    }
    return fallback;
  }

  function hostAllowed(url) {
    var m = String(url || '').match(/^https:\/\/([^/:?#]+)/i);
    return !!m && ALLOWED_DOWNLOAD_HOSTS.test(m[1]);
  }

  var UpdateCheck = {
    _latest: null,
    _changelogCache: null,

    getInstalledVersion: installedVersion,

    fetchSharedChangelog: function (done) {
      var s = this;
      if (s._changelogCache) return done(s._changelogCache);
      fetchText(CHANGELOG_RAW_URL, 3, function (raw) {
        if (!raw) return done(null);
        var lines = String(raw).split(/\r?\n/);
        var title = '';
        var bullets = [];
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (/^#{1,2}\s+/.test(line)) {
            if (title) break;
            title = line.replace(/^#+\s*/, '').trim();
            continue;
          }
          if (title && /^[-*]\s+/.test(line)) {
            bullets.push(line.replace(/^[-*]\s+/, '').trim());
          }
        }
        if (!title) return done(null);
        s._changelogCache = { version: title, bullets: bullets };
        done(s._changelogCache);
      });
    },

    /** runs once per panel open; silent on any failure, since offline is normal */
    run: function () {
      var s = this;
      var current = installedVersion();
      if (!current) return;

      fetchJson(FEED_URL, 3, function (release) {
        if (!release || !release.tag_name || release.draft || release.prerelease) return;
        var feed = {
          version: String(release.tag_name).replace(/^v/i, ''),
          url: release.html_url,
          notes: release.body || '',
          assets: release.assets || []
        };
        if (compareVersions(feed.version, current) <= 0) return;

        dbg('info', 'Update', 'Extension ' + feed.version + ' is available (installed ' + current + ')');
        // dismissing hides this version only; a later release shows again
        if (window.StorageManager.getItem('dismissedUpdate', '') === feed.version) return;

        s._latest = feed;
        s._show(current, feed);
      });
    },

    _state: STATE_READY,

    /** in-panel install is possible: Windows, installed by AMVergeSetup.exe, and the release ships it */
    _canAutoInstall: function () {
      return installedByInstaller() && !!pickInstallerAsset(this._latest && this._latest.assets);
    },

    _setBanner: function (text, buttonLabel, state, disabled) {
      var textEl = document.getElementById('updateBannerText');
      var btn = document.getElementById('updateBannerBtn');
      if (textEl && text !== null) textEl.textContent = text;
      if (btn) {
        if (buttonLabel !== null) btn.textContent = buttonLabel;
        btn.disabled = !!disabled;
      }
      this._state = state;
    },

    /** any failure lands here: say what happened and make the button open the release page */
    _fail: function (message, detail) {
      if (detail) dbg('warn', 'Update', message + ': ' + detail);
      this._setBanner(message, 'Open Release Page', STATE_BROWSER, false);
    },

    _show: function (current, feed) {
      var bar = document.getElementById('updateBanner');
      if (!bar) return;
      this._latest = feed;
      this._setBanner(
        'AMVerge extension ' + feed.version + ' is available',
        this._canAutoInstall() ? 'Update Now' : 'Download',
        STATE_READY,
        false
      );
      bar.title = feed.notes || '';
      bar.style.display = 'flex';
    },

    handleAction: function () {
      switch (this._state) {
        case STATE_BUSY:
          return;
        case STATE_RELOAD:
          window.location.reload();
          return;
        case STATE_BROWSER:
          this.openDownload();
          return;
      }

      var asset = this._canAutoInstall() ? pickInstallerAsset(this._latest.assets) : null;
      if (asset) {
        this._startAutoUpdate(asset);
        return;
      }
      this.openDownload();
    },

    _startAutoUpdate: function (asset) {
      var s = this;
      var os = nodeRequire('os');
      var path = nodeRequire('path');
      var fs = nodeRequire('fs');
      var https = nodeRequire('https');
      var cp = nodeRequire('child_process');
      var crypto = nodeRequire('crypto');

      if (!os || !path || !fs || !https || !cp || !crypto) {
        s.openDownload();
        return;
      }

      // github publishes "sha256:<hex>" per asset; without it we refuse to run anything elevated
      var expected = String(asset.digest || '').replace(/^sha256:/i, '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expected)) {
        s._fail('This release has no checksum to verify. Download it manually:', 'missing asset.digest');
        return;
      }
      if (!hostAllowed(asset.browser_download_url)) {
        s._fail('Unexpected download location. Download it manually:', asset.browser_download_url);
        return;
      }

      var version = String((s._latest && s._latest.version) || 'latest').replace(/[^0-9a-z.\-]/gi, '');
      var finalFile = path.join(os.tmpdir(), 'AMVergeSetup-' + version + '.exe');
      var partFile = finalFile + '.part';
      var settled = false;
      var activeReq = null;
      var file = null;

      function cleanup() {
        try { if (file) file.destroy(); } catch (e) {}
        try { fs.unlinkSync(partFile); } catch (e) {}
      }

      function fail(message, detail) {
        if (settled) return;
        settled = true;
        try { if (activeReq) activeReq.abort(); } catch (e) {}
        cleanup();
        s._fail(message, detail);
      }

      s._setBanner('Downloading update... 0%', 'Downloading...', STATE_BUSY, true);

      try {
        file = fs.createWriteStream(partFile);
      } catch (e) {
        fail('Could not write the installer to disk. Download it manually:', String(e));
        return;
      }
      // disk full, temp folder locked, antivirus holding the file
      file.on('error', function (err) {
        fail('Could not write the installer to disk. Download it manually:', String(err));
      });

      var hash = crypto.createHash('sha256');

      function downloadStream(url, redirectsLeft) {
        if (!hostAllowed(url)) {
          fail('Unexpected download location. Download it manually:', url);
          return;
        }
        var headers = { 'User-Agent': 'AMVerge-Extension' };
        activeReq = https.get(url, { headers: headers }, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            res.resume();
            downloadStream(res.headers.location, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            fail('Download failed (HTTP ' + res.statusCode + '). Download it manually:');
            return;
          }

          var totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          var downloaded = 0;
          var lastPct = -1;

          res.on('data', function (chunk) {
            downloaded += chunk.length;
            hash.update(chunk);
            if (totalBytes > 0) {
              var pct = Math.floor((downloaded / totalBytes) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                s._setBanner('Downloading update... ' + pct + '%', null, STATE_BUSY, true);
              }
            }
          });
          res.on('error', function (err) { fail('Download interrupted. Download it manually:', String(err)); });
          res.on('aborted', function () { fail('Download interrupted. Download it manually:'); });

          res.pipe(file);

          file.on('finish', function () {
            if (settled) return;
            file.close(function (closeErr) {
              if (settled) return;
              if (closeErr) {
                fail('Could not write the installer to disk. Download it manually:', String(closeErr));
                return;
              }
              if (totalBytes > 0 && downloaded !== totalBytes) {
                fail('Download was incomplete. Download it manually:', downloaded + '/' + totalBytes + ' bytes');
                return;
              }
              var actual = hash.digest('hex');
              if (actual !== expected) {
                fail('Installer failed its checksum. Download it manually:', 'expected ' + expected + ' got ' + actual);
                return;
              }
              try {
                try { fs.unlinkSync(finalFile); } catch (e) {}
                fs.renameSync(partFile, finalFile);
              } catch (e) {
                fail('Could not prepare the installer. Download it manually:', String(e));
                return;
              }
              runInstaller();
            });
          });
        });

        // a socket that stops delivering bytes, not a slow one
        activeReq.setTimeout(DOWNLOAD_IDLE_MS, function () {
          fail('Download stalled. Download it manually:', 'no data for ' + (DOWNLOAD_IDLE_MS / 1000) + 's');
        });
        activeReq.on('error', function (err) {
          fail('Download error. Download it manually:', String(err));
        });
      }

      function runInstaller() {
        if (window.PreviewProxy) window.PreviewProxy.cancel();
        if (window.AmvergeHandler) window.AmvergeHandler.cancel();
        settled = true;
        // the installer is PrivilegesRequired=admin, so Windows asks first: say so instead of "silent"
        s._setBanner('Approve the Windows prompt to install ' + version + '...', 'Installing...', STATE_BUSY, true);

        var proc;
        try {
          // /VERYSILENT: no wizard; /SUPPRESSMSGBOXES: takes the default (IDYES) on the overwrite prompt;
          // /NORESTART: never asks to reboot
          proc = cp.spawn(finalFile, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
            stdio: 'ignore',
            windowsHide: true
          });
        } catch (e) {
          try { fs.unlinkSync(finalFile); } catch (e2) {}
          s._fail('Could not start the installer. Download it manually:', String(e));
          return;
        }

        var done = false;
        proc.on('error', function (err) {
          if (done) return;
          done = true;
          try { fs.unlinkSync(finalFile); } catch (e) {}
          // ERROR_CANCELLED (1223) when UAC is declined surfaces here on some Node builds
          var declined = err && (err.errno === -4094 || /1223|cancel/i.test(String(err.message || err)));
          s._fail(declined ? 'Install cancelled at the Windows prompt.' : 'Could not start the installer. Download it manually:', String(err));
        });
        proc.on('close', function (code) {
          if (done) return;
          done = true;
          try { fs.unlinkSync(finalFile); } catch (e) {}
          if (code === 0) {
            s._setBanner('Update ' + version + ' installed.', 'Reload Panel', STATE_RELOAD, false);
            return;
          }
          // Inno Setup: 2 = cancelled before install (includes UAC "No"), 5 = cancelled during
          var message = (code === 2 || code === 5)
            ? 'Install cancelled.'
            : 'Installer exited with code ' + code + '. Download it manually:';
          s._fail(message, 'exit ' + code);
        });
      }

      downloadStream(asset.browser_download_url, 5);
    },

    openDownload: function () {
      var url = (this._latest && this._latest.url) || DEFAULT_PAGE;
      // only this repo's pages, so a bad response can't send users anywhere else
      if (url.indexOf(REPO_PAGE + '/') !== 0) url = DEFAULT_PAGE;
      // the bundled CSInterface.js checks window.__adobe_cep_ (one underscore short) and no-ops,
      // so go to cep's own api, then the os
      try {
        if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
          var code = window.cep.util.openURLInDefaultBrowser(url);
          if (!code || code === 0 || (code.err === 0)) return;
        }
      } catch (e) {
        dbg('warn', 'Update', 'cep.util could not open the browser: ' + e);
      }

      var cp = nodeRequire('child_process');
      if (!cp) return;
      try {
        // no shell, so the url is never parsed as a command
        var child = process.platform === 'win32'
          ? cp.spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
          : cp.spawn('open', [url], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch (e) {
        dbg('warn', 'Update', 'Could not open browser: ' + e);
      }
    },

    dismiss: function () {
      if (this._latest) window.StorageManager.setItem('dismissedUpdate', this._latest.version);
      var bar = document.getElementById('updateBanner');
      if (bar) bar.style.display = 'none';
    }
  };

  window.UpdateCheck = UpdateCheck;
})();
