(function () {
  var HistoryPanel = {
    _runs: [],
    _appEpisodes: [],
    _syncTimer: null,
    _search: '',
    _sortDir: null,

    init: function (app) {
      this.app = app;
      this._runs = window.StorageManager.loadHistory();
      this.syncFromDesktopApp();
      this.startAutoSync();
      this.render();
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
      if (!this.app || !this.app.settings || !this.app.settings.syncThemeWithApp) {
        if (this._appEpisodes.length) {
          this._appEpisodes = [];
          this.render();
        }
        return;
      }
      if (!window.FileSystem || !window.FileSystem.path || !window.FileSystem.os) return;
      try {
        var appData = window.FileSystem.getAppDataDir();
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
        this.render();
      } catch (e) {
        dbg('debug', 'History', 'App sync: ' + e.message);
      }
    },

    setSearch: function (value) {
      this._search = String(value || '');
      var clearBtn = document.getElementById('epLibSearchClear');
      if (clearBtn) clearBtn.style.display = this._search ? '' : 'none';
      this.render();
    },

    clearSearch: function () {
      var input = document.getElementById('epLibSearchInput');
      if (input) input.value = '';
      this.setSearch('');
    },

    toggleSort: function () {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
      var btn = document.getElementById('epLibSortBtn');
      if (btn) {
        btn.classList.add('active');
        btn.title = this._sortDir === 'asc' ? 'Sorted A-Z (click for Z-A)' : 'Sorted Z-A (click for A-Z)';
      }
      this.render();
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

      var countEl = document.getElementById('epLibCount');
      if (countEl) countEl.textContent = allItems.length;

      var query = this._search.trim().toLowerCase();
      var items = query
        ? allItems.filter(function (item) {
            var name = item.videoPath.split('\\').pop().split('/').pop() || item.videoPath;
            return name.toLowerCase().indexOf(query) !== -1;
          })
        : allItems;

      if (this._sortDir) {
        var dir = this._sortDir === 'asc' ? 1 : -1;
        items = items.slice().sort(function (a, b) {
          var an = (a.videoPath.split('\\').pop().split('/').pop() || a.videoPath).toLowerCase();
          var bn = (b.videoPath.split('\\').pop().split('/').pop() || b.videoPath).toLowerCase();
          return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
        });
      }

      if (allItems.length === 0) {
        container.innerHTML = '<div class="ep-lib-empty">' +
          '<svg class="icon ep-lib-empty-icon"><use href="#icon-video"/></svg>' +
          '<p class="ep-lib-empty-title">No episodes yet</p>' +
          '<p class="ep-lib-empty-desc">Imported episodes and scene detection runs show up here for instant re-opening.</p>' +
        '</div>';
        return;
      }

      if (items.length === 0) {
        container.innerHTML = '<div class="ep-lib-empty">' +
          '<svg class="icon ep-lib-empty-icon"><use href="#icon-search"/></svg>' +
          '<p class="ep-lib-empty-title">No matches</p>' +
        '</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var date = new Date(item.date);
        var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var videoName = item.videoPath.split('\\').pop().split('/').pop() || item.videoPath;
        var methodLabel = item.method === 'keyframe_detection' || item.method === 'keyframe' ? 'Keyframe' : 'AI TransNetV2';
        var manifestArg = item.manifestPath ? this._jsArg(item.manifestPath) : '';
        var outputArg = this._jsArg(item.outputDir);

        html += '<div class="ep-lib-row" data-id="' + item.id + '" onclick="HistoryPanel.loadItem(\'' + manifestArg + '\', \'' + outputArg + '\')">';
        html += '<svg class="icon ep-lib-media-icon"><use href="#icon-video"/></svg>';
        html += '<div class="ep-lib-main">';
        html += '<div class="ep-lib-name" title="' + this._escHtml(item.videoPath) + '">' + this._escHtml(videoName) + '</div>';
        html += '<div class="ep-lib-meta-row">';
        if (item.isAppEpisode) {
          html += '<span class="ep-lib-app-badge">AMVerge App</span>';
        }
        html += '<span class="method-badge ' + item.method + '">' + methodLabel + '</span>';
        html += '<span class="ep-lib-meta-text">' + item.sceneCount + ' scenes &middot; ' + dateStr + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<div class="ep-lib-row-actions">';
        html += '<button type="button" class="ep-lib-icon-btn" title="Show in file manager" ' +
          'onclick="event.stopPropagation();HistoryPanel.revealItem(\'' + outputArg + '\')">' +
          '<svg class="icon"><use href="#icon-folder"/></svg></button>';
        if (!item.isAppEpisode) {
          html += '<button type="button" class="ep-lib-icon-btn danger" title="Delete" ' +
            'onclick="event.stopPropagation();HistoryPanel.promptDeleteRun(\'' + item.id + '\', \'' + outputArg + '\')">' +
            '<svg class="icon"><use href="#icon-trash"/></svg></button>';
        }
        html += '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    },

    /** a path or id dropped into a single-quoted onclick="" attribute */
    _jsArg: function (value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    },

    revealItem: function (outputDir) {
      if (window.FileSystem && window.FileSystem.revealInFileManager) {
        window.FileSystem.revealInFileManager(outputDir);
      }
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
              window.App.setSceneView(true);
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
        window.App._currentOutputDir = outputDir;
        window.ClipsPanel.loadScenes(scenes);
        window.App.setSceneView(true);
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
