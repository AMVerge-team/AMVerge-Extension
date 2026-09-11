(function () {
  var HistoryPanel = {
    _runs: [],
    _appEpisodes: [],
    _syncTimer: null,

    init: function (app) {
      this.app = app;
      this._runs = window.StorageManager.loadHistory();
      this.syncFromDesktopApp();
      this.startAutoSync();
    },

    startAutoSync: function () {
      var s = this;
      if (this._syncTimer) clearInterval(this._syncTimer);
      // Poll storage every 5 seconds for newly detected episodes in desktop app
      this._syncTimer = setInterval(function () {
        s.syncFromDesktopApp();
      }, 5000);
    },

    syncFromDesktopApp: function () {
      if (!window.FileSystem || !window.FileSystem.path || !window.FileSystem.os) return;
      try {
        var appData = process.env.APPDATA || window.FileSystem.path.join(window.FileSystem.getHomeDir(), 'AppData', 'Roaming');
        var baseDir = window.FileSystem.path.join(appData, 'app.amverge', 'episodes', 'episodes_storage');

        if (!window.FileSystem.fileExists(baseDir)) {
          var altDir = window.FileSystem.path.join(appData, 'AMVerge', 'episodes', 'episodes_storage');
          if (window.FileSystem.fileExists(altDir)) baseDir = altDir;
          else return;
        }

        var dirs = window.FileSystem.fs.readdirSync(baseDir);
        var episodes = [];

        for (var i = 0; i < dirs.length; i++) {
          var episodeDir = window.FileSystem.path.join(baseDir, dirs[i]);
          var manifestPath = window.FileSystem.path.join(episodeDir, 'manifest.json');
          if (window.FileSystem.fileExists(manifestPath)) {
            var content = window.FileSystem.readFile(manifestPath);
            if (content) {
              try {
                var manifest = JSON.parse(content);
                var videoPath = (manifest.source && manifest.source.videoPath) || dirs[i];
                var scenes = manifest.scenes || [];
                var count = (manifest.summary && manifest.summary.sceneCount) || scenes.length;
                episodes.push({
                  id: 'app_' + dirs[i],
                  isAppEpisode: true,
                  episodeCacheId: dirs[i],
                  videoPath: videoPath,
                  outputDir: episodeDir,
                  manifestPath: manifestPath,
                  sceneCount: count,
                  method: (manifest.source && manifest.source.sceneDetectionMethod) || 'transnetv2_gpu',
                  date: manifest.createdAtUnix ? new Date(manifest.createdAtUnix * 1000).toISOString() : new Date().toISOString()
                });
              } catch (e) {}
            }
          }
        }

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

    addRun: function (videoPath, outputDir, sceneCount, method) {
      var run = {
        id: Date.now().toString(36),
        videoPath: videoPath,
        outputDir: outputDir,
        sceneCount: sceneCount,
        method: method || 'transnetv2_gpu',
        date: new Date().toISOString()
      };
      this._runs.unshift(run);
      if (this._runs.length > 50) this._runs = this._runs.slice(0, 50);
      window.StorageManager.saveHistory(this._runs);
      return run;
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

    loadItem: function (manifestPath, outputDir) {
      if (manifestPath && window.FileSystem && window.FileSystem.fileExists(manifestPath)) {
        try {
          var raw = window.FileSystem.readFile(manifestPath);
          var manifest = JSON.parse(raw);
          var scenes = manifest.scenes || [];
          if (scenes.length > 0) {
            // Remap scene paths if necessary
            for (var i = 0; i < scenes.length; i++) {
              if (scenes[i].clip_path && !window.FileSystem.fileExists(scenes[i].clip_path)) {
                var fileName = window.FileSystem.getFileName(scenes[i].clip_path);
                var localP = window.FileSystem.path.join(outputDir, fileName);
                if (window.FileSystem.fileExists(localP)) {
                  scenes[i].clip_path = localP;
                  scenes[i].path = localP;
                }
              }
            }
            if (window.App) {
              window.App._currentScenes = scenes;
              window.ClipsPanel.loadScenes(scenes);
              document.getElementById('importArea').style.display = 'none';
              document.getElementById('scenePanel').style.display = '';
              window.ImportPanel.hide();
              window.App.switchTab('home');
              window.showToast('Loaded ' + scenes.length + ' scenes from AMVerge App', 'success');
              return;
            }
          }
        } catch (e) {}
      }

      this.reopen(outputDir);
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
        window.ClipsPanel.loadScenes(scenes);
        document.getElementById('importArea').style.display = 'none';
        document.getElementById('scenePanel').style.display = '';
        window.ImportPanel.hide();
        window.App.switchTab('home');
        window.showToast('Loaded ' + scenes.length + ' scenes', 'success');
      }
    },

    /** the scene list the CLI leaves beside the clips, or null.
     *
     * Much better than scanning: it carries real start/end times and the
     * thumbnail each clip belongs to, neither of which a filename can say.
     */
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

    /** last resort: work the scenes out from what is on disk.
     *
     * AI detection writes its clips to `<output>/scenes/` while keyframe
     * detection writes them straight into `<output>`, so both are checked.
     * Thumbnails sit in the output root either way, keyed by trailing index.
     */
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
      window.showToast('Run deleted', 'info');
    },

    /** the Clear All button only makes sense when there is something to clear.
     *
     * App-synced episodes do not count. They belong to the desktop app, this
     * panel only mirrors them, and the next sync would bring them straight
     * back, so a button that appeared to clear them would be lying.
     */
    _updateClearButton: function () {
      var btn = document.getElementById('historyClearBtn');
      if (!btn) return;
      btn.style.display = this._runs.length ? '' : 'none';
    },

    promptClearAll: function () {
      if (!this._runs.length) return;

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

      for (var i = 0; i < runs.length; i++) {
        var dir = runs[i].outputDir;
        if (!dir || !fs || !fs.deleteFolderRecursive) continue;
        fs.deleteFolderRecursive(dir);
        // deleteFolderRecursive reports nothing, so the disk is the only honest
        // witness. a folder held open by another program survives, and saying
        // so beats claiming a clean sweep that did not happen
        if (fs.fileExists && fs.fileExists(dir)) {
          failed++;
          dbg('warn', 'History', 'Still on disk after clear: ' + dir);
        }
      }

      var cleared = runs.length;
      this._runs = [];
      window.StorageManager.saveHistory(this._runs);
      this.render();

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
