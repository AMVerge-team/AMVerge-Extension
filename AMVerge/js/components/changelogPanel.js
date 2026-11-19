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
      title: 'Your library, wherever you keep it',
      added: [
        'Follows your desktop app storage moves automatically: episodes, AI models, and previews keep working after you move them.',
        'New storage overrides in Settings if you keep things somewhere unusual.',
        'Desktop WebP episodes now sync with their animated previews.'
      ],
      fixed: [
        'WebP episodes open properly instead of showing empty pending tiles, and scenes import into After Effects trimmed and in order.',
        'Setup is easier: finds the right Python, downloads less, and skips PyTorch unless a feature needs it.',
        'Sync refreshes itself when episodes change, and folders with # or ? in the name load correctly.',
        'Cancel now actually stops an AI install.',
        'Updates are safer: the installer checks files before replacing anything and tells you if something fails.'
      ]
    },
    {
      version: '1.2.0',
      date: '2026-11-18',
      title: 'Desktop app sync and one-click updates',
      added: [
        'Switch between your own AE detections and the episode open in the desktop app, right from the Scenes tab.',
        'Live sync: the panel follows when you open or close an episode in the desktop app.',
        'One-click updates on Windows: the banner downloads and installs the new version after you approve the Windows prompt.',
        'This Changelog tab.',
        'About shows your installed version and the desktop app release notes.'
      ],
      improved: [
        'Cutting is faster: finished clips appear first and the rest fill in behind them.',
        'Episodes on slower drives are staged on a faster drive before cutting.',
        'Synced episodes reuse the desktop app previews, so they play right away.',
        'Episodes in custom storage folders load even if their manifest points at the old place.',
        'Uses the desktop app ffmpeg, so a PC without ffmpeg installed works too.'
      ],
      fixed: [
        'Preview no longer flickers in the first seconds inside After Effects.',
        'Synced episodes no longer get stuck on "Preparing preview...".',
        'Setup finds Python 3.11+ through the py launcher.'
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
