(function () {
  var HistoryPanel = {
    _runs: [],
    _appEpisodes: [],
    _manifestCache: {},
    _syncTimer: null,

    init: function (app) {
      this.app = app;
      this._runs = this._dedupe(window.StorageManager.loadHistory());
      // older versions kept 50 runs, often several of one episode sharing a folder
      this.enforceLimit();
      this.syncFromDesktopApp();
      this.startAutoSync();
    },

    startAutoSync: function () {
      var s = this;
      if (this._syncTimer) clearInterval(this._syncTimer);
      // Poll storage every 5 seconds for newly detected episodes in desktop app
      this._syncTimer = setInterval(function () {
        if (!document.hidden) s.syncFromDesktopApp();
      }, 5000);
    },

    syncFromDesktopApp: function () {
      if (!window.FileSystem || !window.FileSystem.path || !window.FileSystem.os) return;
      try {
        // Always check active_episode.json first so custom desktop storage paths still live-sync
        this._checkActiveEpisodeSync();

        var baseDir = window.FileSystem.getAppEpisodesStorageDir
          ? window.FileSystem.getAppEpisodesStorageDir()
          : null;
        if (!baseDir) {
          this._manifestCache = {};
          this._manifestCacheBaseDir = null;
          this._appEpisodes = [];
          var missingPage = document.getElementById('page-history');
          if (missingPage && missingPage.classList.contains('active')) this.render();
          return;
        }
        var rootChanged = this._manifestCacheBaseDir !== baseDir;
        if (rootChanged) {
          this._manifestCache = {};
          this._manifestCacheBaseDir = baseDir;
        }

        var dirs = window.FileSystem.fs.readdirSync(baseDir);
        var episodes = [];
        var nextCache = {};
        var changed = rootChanged || dirs.length !== Object.keys(this._manifestCache).length;

        for (var i = 0; i < dirs.length; i++) {
          var dirName = dirs[i];
          var episodeDir = window.FileSystem.path.join(baseDir, dirName);
          var manifestPath = window.FileSystem.path.join(episodeDir, 'manifest.json');
          if (!window.FileSystem.fileExists(manifestPath)) continue;

          var stat = window.FileSystem.fs.statSync(manifestPath);
          var mtimeMs = stat ? stat.mtimeMs : 0;
          var cached = this._manifestCache[dirName];
          if (cached && cached.mtimeMs === mtimeMs) {
            nextCache[dirName] = cached;
            episodes.push(cached.entry);
            continue;
          }

          changed = true;
          var content = window.FileSystem.readFile(manifestPath);
          if (!content) continue;
          try {
            var manifest = JSON.parse(content);
            var videoPath = (manifest.source && manifest.source.videoPath) || dirName;
            var scenes = manifest.scenes || [];
            var count = (manifest.summary && manifest.summary.sceneCount) || scenes.length;
            var entry = {
              id: 'app_' + dirName,
              isAppEpisode: true,
              episodeCacheId: dirName,
              videoPath: videoPath,
              outputDir: episodeDir,
              manifestPath: manifestPath,
              sceneCount: count,
              method: (manifest.source && manifest.source.sceneDetectionMethod) || 'transnetv2_gpu',
              date: manifest.createdAtUnix ? new Date(manifest.createdAtUnix * 1000).toISOString() : new Date().toISOString()
            };
            nextCache[dirName] = { mtimeMs: mtimeMs, entry: entry };
            episodes.push(entry);
          } catch (e) {}
        }

        this._manifestCache = nextCache;

        if (!changed) return;

        episodes.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        this._appEpisodes = episodes;

        var historyPage = document.getElementById('page-history');
        if (historyPage && historyPage.classList.contains('active')) {
          this.render();
        }
      } catch (e) {
        dbg('debug', 'History', 'App sync: ' + e.message);
      }
    },

    _activeEpisodePointer: null,
    _activeEpisodeKey: null,

    _findActiveEpisodePointerPath: function () {
      if (!window.FileSystem || !window.FileSystem.path) return null;
      var p = window.FileSystem.path;
      var home = window.FileSystem.getHomeDir ? window.FileSystem.getHomeDir() : '';
      var roaming = process.env.APPDATA || (home ? p.join(home, 'AppData', 'Roaming') : '');
      var candidates = [];

      if (roaming) {
        candidates.push(p.join(roaming, 'app.amverge', 'episodes', 'active_episode.json'));
        candidates.push(p.join(roaming, 'AMVerge', 'episodes', 'active_episode.json'));
      }
      if (home) {
        candidates.push(p.join(home, 'Library', 'Application Support', 'app.amverge', 'episodes', 'active_episode.json'));
        candidates.push(p.join(home, '.local', 'share', 'app.amverge', 'episodes', 'active_episode.json'));
      }

      for (var i = 0; i < candidates.length; i++) {
        if (window.FileSystem.fileExists(candidates[i])) {
          return candidates[i];
        }
      }
      return null;
    },

    _checkActiveEpisodeSync: function () {
      var pointerPath = this._findActiveEpisodePointerPath();

      if (!pointerPath) {
        var hadPointer = this._activeEpisodePointer !== null;
        this._activeEpisodePointer = null;
        this._activeEpisodeKey = null;
        if (window.App && window.App.updateAppBadge) {
          window.App.updateAppBadge(0);
        }
        if (hadPointer && window.App && window.App._activeSource === 'app') {
          window.App._appSavedState = null;
          window.App.closeEpisode();
        }
        return;
      }

      var raw = window.FileSystem.readFile(pointerPath);
      if (!raw) return;

      try {
        var pointer = JSON.parse(raw);
        var prevKey = this._activeEpisodeKey;
        var manifestMtime = 0;
        var previewMtime = 0;
        try {
          if (pointer.manifest_path) {
            manifestMtime = window.FileSystem.fs.statSync(pointer.manifest_path).mtimeMs;
            var previewPath = window.FileSystem.path.join(
              window.FileSystem.path.dirname(pointer.manifest_path),
              'sync_preview.json'
            );
            if (window.FileSystem.fileExists(previewPath)) {
              previewMtime = window.FileSystem.fs.statSync(previewPath).mtimeMs;
            }
          }
        } catch (e) {}
        var nextKey = [
          pointer.episode_id || '',
          pointer.manifest_path || '',
          pointer.updated_at || 0,
          pointer.scene_count || 0,
          manifestMtime,
          previewMtime
        ].join('|');

        this._activeEpisodePointer = pointer;
        this._activeEpisodeKey = nextKey;

        if (window.App && window.App.updateAppBadge) {
          window.App.updateAppBadge(pointer.scene_count || 0);
        }

        // If AMVerge App source pill is active, reload whenever the desktop episode changes or nothing is loaded yet
        if (window.App && window.App._activeSource === 'app') {
          var isEmpty = !window.App._currentScenes || window.App._currentScenes.length === 0;
          if (nextKey !== prevKey || isEmpty) {
            this.loadActiveDesktopEpisode({ silentToast: nextKey === prevKey && isEmpty });
          }
        }
      } catch (e) {}
    },

    loadActiveDesktopEpisode: function (opts) {
      if (!this._activeEpisodePointer) return false;
      var p = this._activeEpisodePointer;
      var manifestPath = p.manifest_path;
      if (!manifestPath || !window.FileSystem || !window.FileSystem.fileExists(manifestPath)) {
        return false;
      }
      var outputDir = window.FileSystem.path ?
        window.FileSystem.path.dirname(manifestPath) : '';

      return this.loadItem(manifestPath, outputDir, opts);
    },

    addRun: function (videoPath, outputDir, sceneCount, method) {
      var run = {
        id: Date.now().toString(36),
        videoPath: videoPath,
        outputDir: outputDir,
        sceneCount: sceneCount,
        method: method || 'transnetv2_gpu',
        date: new Date().toISOString()
      };
      // a re-import writes over the same folder, so its older entries point at these files now
      var s = this;
      this._runs = this._runs.filter(function (r) { return !s._samePath(r.outputDir, outputDir); });
      this._runs.unshift(run);
      window.StorageManager.saveHistory(this._runs);
      this.enforceLimit();
      return run;
    },

    /** deletes the oldest runs (entry and files) past the settings' history limit; 0 means no limit */
    enforceLimit: function () {
      var limit = this.app && this.app.settings ? this.app.settings.historyLimit : 10;
      if (!limit || this._runs.length <= limit) return;

      var kept = this._runs.slice(0, limit);
      var evicted = this._runs.slice(limit);
      var open = window.App && window.App._currentOutputDir;
      var s = this;
      for (var i = 0; i < evicted.length; i++) {
        var dir = evicted[i].outputDir;
        // never a folder a kept run or the open episode still uses
        var inUse = (open && this._samePath(dir, open)) ||
          kept.some(function (r) { return s._samePath(r.outputDir, dir); });
        if (!dir || inUse || !window.FileSystem || !window.FileSystem.deleteFolderRecursive) continue;
        try {
          window.FileSystem.deleteFolderRecursive(dir);
        } catch (e) {
          dbg('warn', 'History', 'Could not delete ' + dir + ': ' + e);
        }
      }
      dbg('info', 'History', 'Deleted ' + evicted.length + ' oldest run(s) past the limit of ' + limit);
      this._runs = kept;
      window.StorageManager.saveHistory(this._runs);
      if (document.getElementById('page-history') && document.getElementById('page-history').classList.contains('active')) {
        this.render();
      }
    },

    render: function () {
      var container = document.getElementById('historyList');
      if (!container) return;
      this._runs = window.StorageManager.loadHistory();

      var allItems = this._appEpisodes.concat(this._runs);

      this._updateClearButton();

      if (allItems.length === 0) {
        container.innerHTML = '<div class="history-empty">' +
          '<svg class="icon history-empty-icon"><use href="#icon-history"/></svg>' +
          '<h3 class="history-empty-title">No History Found</h3>' +
          '<p class="history-empty-desc">Imported episodes and scene detection runs will show up here for instant re-opening.</p>' +
        '</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        var date = new Date(item.date);
        var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var videoName = item.videoPath.split('\\').pop().split('/').pop() || item.videoPath;
        var methodLabel = item.method === 'keyframe_detection' || item.method === 'keyframe' ? 'Keyframe' : 'AI TransNetV2';

        html += '<div class="history-item' + (item.isAppEpisode ? ' app-synced' : '') + '" data-id="' + item.id + '">';
        html += '<div class="history-item-main">';
        html += '<div class="history-item-name">';
        if (item.isAppEpisode) {
          html += '<span class="badge badge-accent" style="font-size:9px;margin-right:6px;padding:1px 5px">AMVerge App</span>';
        }
        html += this._escHtml(videoName) + '</div>';
        html += '<div class="history-item-meta">';
        html += '<span>' + item.sceneCount + ' scenes</span>';
        html += '<span class="method-badge ' + item.method + '">' + methodLabel + '</span>';
        html += '<span>' + dateStr + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<div class="history-item-actions">';
        html += '<button class="button button-small button-accent" onclick="HistoryPanel.loadItem(\'' + (item.manifestPath ? item.manifestPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '') + '\', \'' + item.outputDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')" title="Open in AE Extension"><svg class="icon"><use href="#icon-folder"/></svg> Open</button>';
        if (!item.isAppEpisode) {
          html += '<button class="button button-small button-danger" onclick="HistoryPanel.promptDeleteRun(\'' + item.id + '\', \'' + item.outputDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')" title="Delete"><svg class="icon"><use href="#icon-trash"/></svg></button>';
        }
        html += '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    },

    _pad4: function (n) {
      var str = String(n);
      while (str.length < 4) str = '0' + str;
      return str;
    },

    /** `p` if it exists, else the same file name (or a fallback name) inside the episode folder */
    _resolveEpisodeFile: function (p, outputDir, fallbackNames) {
      var fs = window.FileSystem;
      if (!fs || !fs.fileExists) return '';
      if (p && fs.fileExists(p)) return p;
      if (!outputDir || !fs.path) return '';

      var names = [];
      if (p) names.push(fs.getFileName(p));
      for (var n = 0; n < (fallbackNames || []).length; n++) names.push(fallbackNames[n]);

      var dirs = [fs.path.join(outputDir, 'scenes'), fs.path.join(outputDir, 'clips'), outputDir];
      for (var i = 0; i < names.length; i++) {
        if (!names[i]) continue;
        for (var d = 0; d < dirs.length; d++) {
          var candidate = fs.path.join(dirs[d], names[i]);
          if (fs.fileExists(candidate)) return candidate;
        }
      }
      return '';
    },

    _readPreviewSync: function (outputDir) {
      var previews = {};
      if (!outputDir || !window.FileSystem || !window.FileSystem.path) return previews;
      var syncPath = window.FileSystem.path.join(outputDir, 'sync_preview.json');
      if (!window.FileSystem.fileExists(syncPath)) return previews;
      try {
        var parsed = JSON.parse(window.FileSystem.readFile(syncPath));
        var items = parsed && parsed.previews ? parsed.previews : [];
        for (var i = 0; i < items.length; i++) {
          previews[String(items[i].scene_index)] = items[i];
        }
      } catch (e) {}
      return previews;
    },

    loadItem: function (manifestPath, outputDir, opts) {
      var silentToast = opts && opts.silentToast;
      if (manifestPath && window.FileSystem && window.FileSystem.fileExists(manifestPath)) {
        try {
          var raw = window.FileSystem.readFile(manifestPath);
          var manifest = JSON.parse(raw);
          var rawScenes = (manifest.scenes && manifest.scenes.length > 0)
            ? manifest.scenes
            : (manifest.initialClips || []);

          if (rawScenes.length > 0) {
            var sourceVideo = (manifest.source && manifest.source.videoPath) || '';
            var webpEpisode = !!(manifest.source && manifest.source.importMethod === 'webp_files');
            var previewSync = this._readPreviewSync(outputDir);
            var scenes = [];
            for (var i = 0; i < rawScenes.length; i++) {
              var s = rawScenes[i];
              var sceneIdx = s.scene_index !== undefined ? s.scene_index : i;
              var stem = 'scene_' + this._pad4(sceneIdx);

              // the desktop manifest leaves clip_path null and puts the SOURCE video in `path`;
              // treating that as the clip made every preview proxy the whole episode
              var clip = s.clip_path || '';
              if (!clip && s.path && !(sourceVideo && this._samePath(s.path, sourceVideo))) clip = s.path;
              clip = this._resolveEpisodeFile(clip, outputDir, [stem + '.mp4']);

              // thumbnails can point at an old storage root after a move, so fall back to scenes/scene_NNNN.jpg
              var thumb = this._resolveEpisodeFile(s.thumbnail || '', outputDir, [stem + '.jpg']);
              var preview = previewSync[String(sceneIdx)];
              var webp = preview ? this._resolveEpisodeFile(preview.preview_webp_path || '', outputDir, []) : '';
              var poster = preview ? this._resolveEpisodeFile(preview.preview_poster_path || '', outputDir, []) : '';
              if (webp || poster) thumb = poster || webp;

              var startSec = s.start_sec !== undefined ? s.start_sec : (s.start || 0);
              var endSec = s.end_sec !== undefined ? s.end_sec : (s.end || startSec);
              var sourceRange = webpEpisode && !clip && !!sourceVideo;
              scenes.push({
                scene_index: s.scene_index !== undefined ? s.scene_index : i,
                start_sec: startSec,
                end_sec: endSec,
                duration_sec: s.duration_sec !== undefined ? s.duration_sec : Math.max(0, endSec - startSec),
                path: sourceRange ? '' : clip,
                clip_path: sourceRange ? null : (clip || null),
                original_path: s.original_path || sourceVideo,
                source_range: sourceRange,
                preview_webp_path: webp,
                clip_mode: s.clip_mode || '',
                thumbnail: thumb,
                original_file: s.original_file || (sourceVideo ? window.FileSystem.getFileName(sourceVideo) : '')
              });
            }

            if (window.App) {
              window.App._currentScenes = scenes;
              window.App._currentVideo = sourceVideo || null;
              window.App._currentOutputDir = outputDir || null;
              window.App._gridLive = false;
              window.ClipsPanel.loadScenes(scenes);
              document.getElementById('importArea').style.display = 'none';
              document.getElementById('scenePanel').style.display = '';
              window.ImportPanel.hide();
              window.App.switchTab('home');
              if (!silentToast) {
                window.showToast('Loaded ' + scenes.length + ' scenes from AMVerge App', 'success');
              }
              return true;
            }
          }
        } catch (e) {}
      }

      if (outputDir && window.FileSystem && window.FileSystem.fileExists(outputDir)) {
        this.reopen(outputDir);
        return !!(window.App && window.App._currentScenes && window.App._currentScenes.length > 0);
      }
      return false;
    },

    reopen: function (outputDir) {
      var fs = window.FileSystem;
      if (!fs || !fs.fileExists) return;

      var scenes = this._readScenesJson(outputDir) || this._scanForScenes(outputDir);
      if (!scenes || scenes.length === 0) {
        window.showToast('No clip files found in output', 'error');
        return;
      }

      if (window.App) {
        window.App._currentScenes = scenes;
        window.App._currentOutputDir = outputDir;
        window.ClipsPanel.loadScenes(scenes);
        document.getElementById('importArea').style.display = 'none';
        document.getElementById('scenePanel').style.display = '';
        window.ImportPanel.hide();
        window.App.switchTab('home');
        window.showToast('Loaded ' + scenes.length + ' scenes', 'success');
      }
    },

    /** the CLI's scenes.json, which carries real timings and thumbnails a filename cannot */
    _readScenesJson: function (outputDir) {
      var fs = window.FileSystem;
      var manifest = fs.path.join(outputDir, 'scenes.json');
      if (!fs.fileExists(manifest)) return null;

      var parsed;
      try {
        parsed = JSON.parse(fs.readFile(manifest));
      } catch (e) {
        dbg('warn', 'History', 'Unreadable scenes.json, scanning instead');
        return null;
      }
      if (!parsed || !parsed.length) return null;

      var scenes = [];
      for (var i = 0; i < parsed.length; i++) {
        var s = parsed[i];
        var clip = s.path || s.clip_path || '';
        // a run whose output was moved or partly deleted should fall back to a
        // scan rather than filling the grid with paths that resolve to nothing
        if (clip && !fs.fileExists(clip)) return null;

        scenes.push({
          scene_index: s.scene_index !== undefined ? s.scene_index : i,
          start_sec: s.start || s.start_sec || 0,
          end_sec: s.end || s.end_sec || 0,
          duration_sec: s.duration || s.duration_sec || 0,
          path: clip,
          clip_path: clip,
          thumbnail: s.thumbnail && fs.fileExists(s.thumbnail) ? s.thumbnail : '',
          original_file: s.original_file || ''
        });
      }
      return scenes;
    },

    /** last resort: scan `<output>/scenes/` (AI) then `<output>` (keyframe), thumbnails from the root */
    _scanForScenes: function (outputDir) {
      var fs = window.FileSystem;

      var sceneDir = fs.path.join(outputDir, 'scenes');
      var files = fs.fileExists(sceneDir) ? fs.listFiles(sceneDir, '.mp4') : [];
      if (files.length === 0) files = fs.listFiles(outputDir, '.mp4');
      if (files.length === 0) return [];

      var thumbs = {};
      var jpgs = fs.listFiles(outputDir, '.jpg');
      for (var t = 0; t < jpgs.length; t++) {
        var tm = fs.getFileNameWithoutExtension(jpgs[t]).match(/(\d+)$/);
        if (tm) thumbs[parseInt(tm[1], 10)] = jpgs[t];
      }

      var scenes = [];
      for (var i = 0; i < files.length; i++) {
        var name = fs.getFileNameWithoutExtension(files[i]);
        // `scene_0007` from AI runs, `<video stem>_0007` from keyframe runs
        var match = name.match(/(\d+)$/);
        var idx = match ? parseInt(match[1], 10) : i;
        scenes.push({
          scene_index: idx,
          start_sec: 0,
          end_sec: 0,
          duration_sec: 0,
          path: files[i],
          clip_path: files[i],
          thumbnail: thumbs[idx] || '',
          original_file: ''
        });
      }
      scenes.sort(function (a, b) { return a.scene_index - b.scene_index; });
      return scenes;
    },

    promptDeleteRun: function (id, outputDir) {
      this._pendingDelete = { id: id, outputDir: outputDir };
      var modal = document.getElementById('deleteRunConfirmModal');
      if (modal) modal.style.display = '';
    },

    closeDeleteModal: function () {
      this._pendingDelete = null;
      var modal = document.getElementById('deleteRunConfirmModal');
      if (modal) modal.style.display = 'none';
    },

    confirmDeleteRun: function () {
      if (!this._pendingDelete) return;
      var id = this._pendingDelete.id;
      var outputDir = this._pendingDelete.outputDir;
      this.closeDeleteModal();

      if (window.FileSystem && window.FileSystem.deleteFolderRecursive) {
        try {
          window.FileSystem.deleteFolderRecursive(outputDir);
        } catch (e) {}
      }

      for (var i = 0; i < this._runs.length; i++) {
        if (this._runs[i].id === id) {
          this._runs.splice(i, 1);
          break;
        }
      }
      window.StorageManager.saveHistory(this._runs);
      this.render();
      this._closeIfOpen([outputDir]);
      window.showToast('Run deleted', 'info');
    },

    /** the clips of a deleted run are gone from disk, so an open grid pointing at
     *  them is dead: every tile, preview and import would fail. close it */
    _closeIfOpen: function (dirs) {
      var open = window.App && window.App._currentOutputDir;
      if (!open) return;
      for (var i = 0; i < dirs.length; i++) {
        if (dirs[i] && this._samePath(dirs[i], open)) {
          window.App.closeEpisode();
          return;
        }
      }
    },

    /** newest entry per output folder; the rest point at files a later run replaced */
    _dedupe: function (runs) {
      var s = this;
      var seen = [];
      var out = [];
      for (var i = 0; i < runs.length; i++) {
        var dir = runs[i].outputDir;
        if (seen.some(function (d) { return s._samePath(d, dir); })) continue;
        seen.push(dir);
        out.push(runs[i]);
      }
      if (out.length !== runs.length) window.StorageManager.saveHistory(out);
      return out;
    },

    _samePath: function (a, b) {
      return String(a).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() ===
             String(b).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
    },

    /** app-synced episodes do not count: the next sync would bring them straight back */
    _updateClearButton: function () {
      var btn = document.getElementById('historyClearBtn');
      if (!btn) return;
      btn.style.display = this._runs.length ? '' : 'none';
    },

    promptClearAll: function () {
      this._runs = window.StorageManager.loadHistory();
      if (!this._runs.length) {
        window.showToast('No stored episodes to clear', 'info');
        return;
      }

      var desc = document.getElementById('clearHistoryDesc');
      if (desc) {
        var n = this._runs.length;
        var text = 'This will remove ' + n + ' extension run' + (n !== 1 ? 's' : '') +
                   ' from history and delete their cached clips from disk.';
        if (this._appEpisodes.length) {
          text += ' Episodes synced from the AMVerge app are left alone.';
        }
        desc.textContent = text;
      }

      var modal = document.getElementById('clearHistoryConfirmModal');
      if (modal) modal.style.display = '';
    },

    closeClearAllModal: function () {
      var modal = document.getElementById('clearHistoryConfirmModal');
      if (modal) modal.style.display = 'none';
    },

    confirmClearAll: function () {
      this.closeClearAllModal();

      var fs = window.FileSystem;
      var runs = this._runs;
      var failed = 0;
      var dirs = [];

      for (var i = 0; i < runs.length; i++) {
        var dir = runs[i].outputDir;
        dirs.push(dir);
        if (!dir || !fs || !fs.deleteFolderRecursive) continue;
        fs.deleteFolderRecursive(dir);
        // deleteFolderRecursive reports nothing, so check the disk instead
        if (fs.fileExists && fs.fileExists(dir)) {
          failed++;
          dbg('warn', 'History', 'Still on disk after clear: ' + dir);
        }
      }

      var cleared = runs.length;
      this._runs = [];
      window.StorageManager.saveHistory(this._runs);
      this.render();
      this._closeIfOpen(dirs);

      if (failed) {
        window.showToast('Cleared ' + cleared + ' runs, ' + failed + ' folders left on disk', 'error');
      } else {
        window.showToast('Cleared ' + cleared + ' run' + (cleared !== 1 ? 's' : ''), 'info');
      }
    },

    _escHtml: function (s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };

  window.HistoryPanel = HistoryPanel;
})();
