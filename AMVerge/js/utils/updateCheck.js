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

  function fetchJson(url, redirectsLeft, done) {
    var https = nodeRequire('https');
    if (!https) return done(null);

    var finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      done(value);
    }

    try {
      // github's api rejects requests without a user agent
      var headers = { 'User-Agent': 'AMVerge-Extension', 'Accept': 'application/vnd.github+json' };
      var req = https.get(url, { headers: headers }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return fetchJson(res.headers.location, redirectsLeft - 1, finish);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return finish(null);
        }
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { body += chunk; });
        res.on('end', function () {
          try { finish(JSON.parse(body)); } catch (e) { finish(null); }
        });
      });
      req.on('error', function () { finish(null); });
      req.setTimeout(TIMEOUT_MS, function () { req.abort(); finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  var UpdateCheck = {
    _latest: null,

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
          notes: release.body || ''
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
      document.getElementById('updateBannerText').textContent =
        'AMVerge extension ' + feed.version + ' is available (you have ' + current + ').';
      bar.title = feed.notes || '';
      bar.style.display = 'flex';
    },

    openDownload: function () {
      var url = (this._latest && this._latest.url) || DEFAULT_PAGE;
      // only this repo's pages, so a bad response can't send users anywhere else
      if (url.indexOf(REPO_PAGE + '/') !== 0) url = DEFAULT_PAGE;
      try {
        new CSInterface().openURLInDefaultBrowser(url);
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
