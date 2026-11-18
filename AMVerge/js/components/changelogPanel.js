/**
 * changelog.js - the extension's own release notes, newest first.
 *
 * Shipped inside the panel so it reads offline, unlike the About modal which
 * pulls the desktop app's CHANGELOG.md from GitHub. Add an entry at the top
 * when bumping ExtensionBundleVersion in CSXS/manifest.xml; an entry whose
 * version is newer than the installed one is shown as "Unreleased".
 *
 * sections: added | improved | fixed (any may be omitted)
 */
(function () {
  'use strict';

  var CHANGELOG = [
    {
      version: '1.2.1',
      date: '2026-11-19',
      title: 'Moved storage and WebP sync fixes',
      added: [
        'Automatic discovery of moved desktop runtime, episodes, CLI config, and Hugging Face storage, plus manual runtime and episodes overrides in Settings.',
        'Desktop WebP episodes now sync their generated WebP and JPG previews through per-episode sync metadata.'
      ],
      fixed: [
        'WebP-mode desktop episodes load as source ranges instead of empty pending re-encode tiles, and selected ranges import into AE trimmed and sequential.',
        'The setup wizard requires Python 3.11+, works with app-managed uv environments without pip, and only downloads PyTorch for features that need it.',
        'Detection, preview proxies, diagnostics, and runtime installs all inherit the moved CLI config and model cache.',
        'Auto-update stops active detection and preview jobs before replacing extension files.'
      ]
    },
    {
      version: '1.2.0',
      date: '2026-11-18',
      title: 'Desktop app sync and one-click updates',
      added: [
        'AE Local / AMVerge App switch at the top of the Scenes tab. AMVerge App shows whatever episode is open in the desktop app, and AE Local keeps your own detections untouched while you flip between them.',
        'Live sync: open a different episode in the desktop app and the AMVerge App view follows it within a few seconds. Closing the episode in the desktop app clears it here too.',
        'One-click updates on Windows: the update banner downloads the new installer, checks its SHA-256 against the GitHub release, and installs it after you approve the Windows prompt. Then just reload the panel.',
        'This Changelog tab.',
        'About now shows the installed version and the latest desktop app release notes.'
      ],
      improved: [
        'Keyframe detection cuts in two phases: lossless stream-copied clips show up in the grid first, and re-encodes fill in behind them.',
        'Episodes on another drive (e.g. a D: HDD) are staged onto the fast temp drive before cutting.',
        'Preview proxies reuse the ones the desktop app already built, so synced episodes start playing without a re-encode.',
        'Desktop episodes moved to a custom storage folder still load: clips and thumbnails are found inside the episode folder even if the manifest still points at the old location.',
        'ffmpeg and ffprobe bundled with the desktop app are put on PATH for detection, so clean machines without ffmpeg installed work.'
      ],
      fixed: [
        'Preview no longer flickers for the first couple of seconds inside After Effects; frames are drawn to a canvas instead of a hardware video overlay.',
        'Synced desktop episodes no longer try to build a preview from the entire source video, which left "Preparing preview..." spinning for minutes.',
        'The setup check now asks for Python 3.11 or newer, and finds it through the py launcher.'
      ]
    },
    {
      version: '1.1.5',
      date: '2026-11-15',
      title: 'Universal AE 2018+ build',
      improved: [
        'One release covers After Effects CC 2018 and newer instead of separate builds per version.'
      ]
    },
    {
      version: '1.1.1',
      date: '2026-11-15',
      title: 'Stability',
      improved: [
        'Interface adjustments across the panel.',
        'Theme sync with the desktop app reads theme.json reliably.'
      ],
      fixed: [
        'Video sources are released when you leave an episode, so files are not held open.',
        'History caches manifest timestamps instead of re-reading every episode.',
        'The console throttles redraws during long detection runs.'
      ]
    },
    {
      version: '1.1.0',
      date: '2026-11-09',
      title: 'First public release'
    }
  ];

  var SECTION_LABELS = { added: 'Added', improved: 'Improved', fixed: 'Fixed' };

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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  var ChangelogPanel = {
    entries: CHANGELOG,
    _rendered: false,

    render: function () {
      var list = document.getElementById('changelogList');
      if (!list) return;
      var installed = window.UpdateCheck && window.UpdateCheck.getInstalledVersion
        ? window.UpdateCheck.getInstalledVersion() : null;

      var badge = document.getElementById('changelogInstalled');
      if (badge) badge.textContent = installed ? 'Installed v' + installed : '';

      // static content, so one build per panel load is enough
      if (this._rendered) return;
      this._rendered = true;
      list.innerHTML = '';

      for (var i = 0; i < CHANGELOG.length; i++) {
        var entry = CHANGELOG[i];
        var card = el('article', 'changelog-entry');
        var cmp = installed ? compareVersions(entry.version, installed) : -1;
        if (cmp === 0) card.classList.add('is-current');
        if (cmp > 0) card.classList.add('is-unreleased');

        var head = el('div', 'changelog-entry-head');
        head.appendChild(el('span', 'changelog-version', 'v' + entry.version));
        if (cmp === 0) head.appendChild(el('span', 'changelog-tag changelog-tag-current', 'Installed'));
        else if (cmp > 0) head.appendChild(el('span', 'changelog-tag', 'Unreleased'));
        else if (i === 0) head.appendChild(el('span', 'changelog-tag', 'Latest'));
        head.appendChild(el('span', 'changelog-date', formatDate(entry.date)));
        card.appendChild(head);

        if (entry.title) card.appendChild(el('div', 'changelog-title', entry.title));

        var keys = ['added', 'improved', 'fixed'];
        for (var k = 0; k < keys.length; k++) {
          var items = entry[keys[k]];
          if (!items || !items.length) continue;
          var section = el('div', 'changelog-section changelog-section-' + keys[k]);
          section.appendChild(el('div', 'changelog-section-label', SECTION_LABELS[keys[k]]));
          var ul = el('ul', 'changelog-items');
          for (var j = 0; j < items.length; j++) ul.appendChild(el('li', null, items[j]));
          section.appendChild(ul);
          card.appendChild(section);
        }

        list.appendChild(card);
      }
    }
  };

  window.ChangelogPanel = ChangelogPanel;
})();
