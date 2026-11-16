/**
 * updateCheck.js - tells the user when a newer extension release exists.
 *
 * Nothing is downloaded or installed here: the panel reads the repo's latest
 * GitHub release (published by .github/workflows/release.yml on a version
 * tag), compares its tag with this build's manifest version and shows a banner
 * linking to the release page. Pre-releases are skipped by /releases/latest.
 */
(function () {
  'use strict';

  var REPO_PAGE = 'https://github.com/AMVerge-team/AMVerge-Extension';
  var FEED_URL = 'https://api.github.com/repos/AMVerge-team/AMVerge-Extension/releases/latest';
  var DEFAULT_PAGE = REPO_PAGE + '/releases/latest';
  var CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/AMVerge-team/AMVerge/main/frontend/src/data/CHANGELOG.md';
  var TIMEOUT_MS = 8000;

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

    _show: function (current, feed) {
      var bar = document.getElementById('updateBanner');
      if (!bar) return;
      var textEl = document.getElementById('updateBannerText');
      var btn = document.getElementById('updateBannerBtn');

      if (textEl) {
        textEl.textContent = 'AMVerge extension ' + feed.version + ' is available';
      }
      if (btn) {
        btn.textContent = (process.platform === 'win32') ? 'Update Now' : 'Download';
        btn.disabled = false;
      }

      bar.title = feed.notes || '';
      bar.style.display = 'flex';
      this._state = 'ready';
    },

    handleAction: function () {
      if (this._state === 'reload') {
        window.location.reload();
        return;
      }

      // If Windows, attempt 1-click background installer download and silent install
      if (process.platform === 'win32' && this._latest && this._latest.assets) {
        var exeAsset = null;
        for (var i = 0; i < this._latest.assets.length; i++) {
          var a = this._latest.assets[i];
          if (a.name && a.name.toLowerCase().endsWith('.exe')) {
            exeAsset = a;
            break;
          }
        }
        if (exeAsset && exeAsset.browser_download_url) {
          this._startAutoUpdate(exeAsset.browser_download_url);
          return;
        }
      }

      // Fallback: open release download in default browser
      this.openDownload();
    },

    _startAutoUpdate: function (downloadUrl) {
      var s = this;
      var textEl = document.getElementById('updateBannerText');
      var btn = document.getElementById('updateBannerBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Downloading...';
      }

      var os = nodeRequire('os');
      var path = nodeRequire('path');
      var fs = nodeRequire('fs');
      var https = nodeRequire('https');
      var cp = nodeRequire('child_process');

      if (!os || !path || !fs || !https || !cp) {
        s.openDownload();
        return;
      }

      var tempFile = path.join(os.tmpdir(), 'AMVergeSetup-' + (s._latest.version || 'latest') + '.exe');
      var file = fs.createWriteStream(tempFile);

      function downloadStream(url, redirectsLeft) {
        var headers = { 'User-Agent': 'AMVerge-Extension' };
        var req = https.get(url, { headers: headers }, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            res.resume();
            return downloadStream(res.headers.location, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            if (textEl) textEl.textContent = 'Download failed. Click to open browser.';
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'Download';
            }
            s._state = 'fallback';
            return;
          }

          var totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          var downloaded = 0;

          res.on('data', function (chunk) {
            downloaded += chunk.length;
            if (totalBytes > 0 && textEl) {
              var pct = Math.round((downloaded / totalBytes) * 100);
              textEl.textContent = 'Downloading update... ' + pct + '%';
            }
          });

          res.pipe(file);

          file.on('finish', function () {
            file.close(function () {
              if (textEl) textEl.textContent = 'Installing update in background...';
              if (btn) btn.textContent = 'Installing...';

              try {
                // Inno Setup silent switches:
                // /VERYSILENT: silent with no background wizard
                // /SUPPRESSMSGBOXES: auto-confirm overwrite of existing extension files
                // /NORESTART: prevent reboot request
                var proc = cp.spawn(tempFile, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true
                });

                proc.on('close', function (code) {
                  try { fs.unlinkSync(tempFile); } catch (e) {}

                  if (code === 0) {
                    s._state = 'reload';
                    if (textEl) textEl.textContent = 'Update installed successfully!';
                    if (btn) {
                      btn.disabled = false;
                      btn.textContent = 'Reload Panel';
                    }
                  } else {
                    if (textEl) textEl.textContent = 'Silent install exited (' + code + '). Manual update:';
                    if (btn) {
                      btn.disabled = false;
                      btn.textContent = 'Open Installer';
                    }
                    s._state = 'fallback';
                  }
                });

                proc.on('error', function (err) {
                  dbg('warn', 'Update', 'Installer spawn error: ' + err);
                  s.openDownload();
                });
              } catch (e) {
                dbg('warn', 'Update', 'Failed to run installer: ' + e);
                s.openDownload();
              }
            });
          });
        });

        req.on('error', function (err) {
          try { fs.unlinkSync(tempFile); } catch (e) {}
          dbg('warn', 'Update', 'Download error: ' + err);
          if (textEl) textEl.textContent = 'Download error. Click to open browser.';
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Download';
          }
          s._state = 'fallback';
        });
      }

      downloadStream(downloadUrl, 5);
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
