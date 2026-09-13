(function () {
  var App = {
    settings: {
      pythonPath: '',
      outputDir: '',
      detectionMethod: 'keyframe_detection',
      layerPrefix: 'AMVerge_',
      autoScale: true,
      accentColor: '#22c55e',
      backgroundGradient: '#001a00',
      backgroundImagePath: null,
      backgroundOpacity: 1.0,
      backgroundBlur: 0,
      gridPreviewSpeed: 1.0,
      showClipTimestamps: true,
      syncThemeWithApp: false,
      theme: 'dark'
    },

    _currentVideo: null,
    _currentOutputDir: null,
    _currentScenes: [],
    _importedCount: 0,
    _selectedLayerInfo: null,
    _layerPollTimer: null,
    _fetchingLayer: false,
    _lastLayerRaw: '',

    init: function () {
      dbg('info', 'App', 'Initializing AMVerge...');

      this.loadSettings();
      this.initModules();
      window.SettingsPanel.populate(this.settings);
      this.bindEvents();
      this.bindColorPickerEvents();
      this.applyAccentColor(this.settings.accentColor, this.settings.backgroundGradient);
      this.applyBackgroundMedia();
      this.applyTimestampVisibility(this.settings.showClipTimestamps !== false);
      if (this.settings.syncThemeWithApp) {
        this.syncThemeFromApp(false);
        this.startThemeSyncWatcher();
      }
      this.startLayerPoll();

      var s = this;
      window.addEventListener('focus', function () {
        if (s.settings.syncThemeWithApp) {
          s.syncThemeFromApp(false);
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && s.settings.syncThemeWithApp) {
          s.syncThemeFromApp(false);
        }
      });

      // closing the panel (or AE quitting) tears down this page, but nothing
      // upstream tells a spawned CLI process to stop: it's the only place
      // that had a handle on it. Left alone, a detect run or a preview-proxy
      // batch keeps running orphaned in the background, still contending for
      // CPU/GPU with AE itself.
      window.addEventListener('unload', function () {
        if (window.AmvergeHandler && window.AmvergeHandler.isRunning()) {
          window.AmvergeHandler.cancel();
        }
        if (window.PreviewProxy && window.PreviewProxy.cancel) {
          window.PreviewProxy.cancel();
        }
      });

      if (!window.ToolsSetup.isComplete()) {
        window.ToolsSetup.show();
      } else {
        document.getElementById('app').style.display = '';
        this.switchTab('home');
        this.runDoctor();
      }

      dbg('info', 'App', 'AMVerge ready');
    },

    initModules: function () {
      window.ConsolePanel.init();
      window.ImportPanel.init(this);
      window.ClipsPanel.init(this);
      window.PreviewPanel.init(this);
      window.SettingsPanel.init(this);
      window.AiInstallModal.init(this);
      window.ToolsSetup.init(this);
      window.HistoryPanel.init(this);
      window.CutProgressCard.init();
      window.CustomSelect.enhanceAll();

      var s = this;
      window.ClipsPanel.onSelectionChange(function (count) {
        window.PreviewPanel.updateImportBtn(count);
      });
    },

    bindEvents: function () {
      var s = this;
      this.bindPreviewResizer();

      document.addEventListener('mousedown', function (e) {
        var popover = document.getElementById('colorPickerPopover');
        var container = document.getElementById('colorPickerContainer');
        if (popover && container && popover.style.display !== 'none') {
          if (!container.contains(e.target)) {
            popover.style.display = 'none';
            s._setPickerOpen(popover, false);
          }
        }
        var about = document.getElementById('aboutModal');
        if (about && about.style.display !== 'none') {
          var content = about.querySelector('.modal-content');
          if (content && !content.contains(e.target)) {
            about.style.display = 'none';
          }
        }
      });
    },

    _PREVIEW_MIN: 150,
    _PREVIEW_MAX: 520,
    _previewHeight: 260,

    bindPreviewResizer: function () {
      var s = this;
      var divider = document.getElementById('mainDivider');
      var layout = document.getElementById('splitLayout');
      if (!divider || !layout) return;

      var stored = parseInt(window.StorageManager.getItem('previewHeight', ''), 10);
      if (!isNaN(stored)) this._previewHeight = stored;
      var collapsed = window.StorageManager.getItem('previewCollapsed', '0') === '1';
      this.setPreviewHeight(collapsed ? 0 : this._previewHeight);
      this.watchPlayerWidth();

      divider.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        divider.classList.add('dragging');

        var pane = document.getElementById('rightPane');
        var startY = e.clientY;
        var startHeight = collapsed ? 0 : pane.offsetHeight;

        function onMove(e2) {
          s.setPreviewHeight(startHeight + (e2.clientY - startY));
        }
        function onUp() {
          divider.classList.remove('dragging');
          collapsed = layout.classList.contains('preview-collapsed');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          window.StorageManager.setItem('previewCollapsed', collapsed ? '1' : '0');
          if (!collapsed) {
            window.StorageManager.setItem('previewHeight', String(s._previewHeight));
          }
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // double click toggles, for anyone who would rather not drag
      divider.addEventListener('dblclick', function () {
        var isCollapsed = layout.classList.contains('preview-collapsed');
        s.setPreviewHeight(isCollapsed ? s._previewHeight : 0);
        collapsed = !isCollapsed;
        window.StorageManager.setItem('previewCollapsed', collapsed ? '1' : '0');
      });
    },

    setPreviewHeight: function (px) {
      var layout = document.getElementById('splitLayout');
      if (!layout) return;

      // anything under the minimum snaps shut, so there is no unusable sliver
      if (px < this._PREVIEW_MIN) {
        layout.classList.add('preview-collapsed');
        layout.style.setProperty('--preview-height', '0px');
        if (window.VideoPlayer) window.VideoPlayer.clear();
        return;
      }

      var height = Math.min(this._PREVIEW_MAX, px);
      this._previewHeight = height;
      layout.classList.remove('preview-collapsed');
      layout.style.setProperty('--preview-height', height + 'px');
      this.syncPlayerWidth();
    },

    // the player gets its width from 16:9 against the pane height, so matching
    // it means measuring. drives --player-width for the import button
    syncPlayerWidth: function () {
      var win = document.getElementById('previewWindow');
      var container = document.getElementById('previewContainer');
      if (!win || !container) return;
      var width = win.offsetWidth;
      if (width > 0) container.style.setProperty('--player-width', width + 'px');
    },

    watchPlayerWidth: function () {
      var s = this;
      var win = document.getElementById('previewWindow');
      if (!win) return;
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(function () { s.syncPlayerWidth(); }).observe(win);
      } else {
        window.addEventListener('resize', function () { s.syncPlayerWidth(); });
      }
      s.syncPlayerWidth();
    },

    bindColorPickerEvents: function () {
      var hexInput = document.getElementById('hexInput');
      if (!hexInput) return;
      var debouncedSet = window._debounce(function () {
        App.setAccentColor('#' + this.value);
      }, 100);
      hexInput.addEventListener('input', debouncedSet);
    },

    // --- Tab switching ---
    switchTab: function (tab) {
      var pages = ['home', 'console', 'settings'];
      for (var i = 0; i < pages.length; i++) {
        var el = document.getElementById('page-' + pages[i]);
        if (el) el.classList.toggle('active', pages[i] === tab);
      }
      var btns = document.querySelectorAll('.sidebar-btn[data-page]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].dataset.page === tab);
      }
      if (tab === 'console') {
        if (window.ConsolePanel) window.ConsolePanel.activate();
      } else {
        if (window.ConsolePanel) window.ConsolePanel.deactivate();
      }
    },

    /** logo: back to the import screen, keeping the episode loaded so the home
     *  button can return to it. a run in progress owns the screen and is left alone */
    showImportScreen: function () {
      this.switchTab('home');
      if (window.AmvergeHandler && window.AmvergeHandler.isRunning()) return;
      document.getElementById('scenePanel').style.display = 'none';
      document.getElementById('importArea').style.display = '';
      window.ImportPanel.showIdle();
    },

    /** home button: back to the grid of the last episode, or the import screen if none */
    goHome: function () {
      this.switchTab('home');
      if (window.AmvergeHandler && window.AmvergeHandler.isRunning()) return;
      if (!this._currentScenes || !this._currentScenes.length) return;
      document.getElementById('importArea').style.display = 'none';
      document.getElementById('scenePanel').style.display = '';
      window.ImportPanel.hide();
    },

    showAbout: function () {
      document.getElementById('aboutModal').style.display = '';
    },

    cancelDetection: function () {
      if (window.AmvergeHandler && window.AmvergeHandler.isRunning()) {
        window.AmvergeHandler.cancel();
        document.getElementById('importArea').style.display = '';
        window.ImportPanel.showIdle();
        document.getElementById('scenePanel').style.display = 'none';
        window.showToast('Detection cancelled', 'info');
      }
    },

    startLayerPoll: function () {
      var s = this;
      if (s._layerPollTimer) clearInterval(s._layerPollTimer);
      s._layerPollTimer = setInterval(function () { s.refreshSelectedLayer(); }, 2000);
      s.refreshSelectedLayer();
    },

    stopLayerPoll: function () {
      if (this._layerPollTimer) {
        clearInterval(this._layerPollTimer);
        this._layerPollTimer = null;
      }
    },

    refreshSelectedLayer: function () {
      var s = this;
      if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) return;
      if (this._fetchingLayer) return;
      this._fetchingLayer = true;
      window.__adobe_cep__.evalScript('getSelectedLayerInfo()', function (raw) {
        s._fetchingLayer = false;
        raw = raw || '{}';
        if (raw === s._lastLayerRaw) return;
        s._lastLayerRaw = raw;
        try {
          s._selectedLayerInfo = JSON.parse(raw);
        } catch (e) {
          s._selectedLayerInfo = null;
        }
        s.updateLayerInfoDisplay();
      });
    },

    updateLayerInfoDisplay: function () {
      var wrap = document.getElementById('aeLayerActionWrap');
      var btnName = document.getElementById('aeLayerBtnName');
      var layer = this._selectedLayerInfo;

      if (!layer || !layer.ok || !layer.filePath) {
        if (wrap) wrap.style.display = 'none';
        return;
      }

      // the resolution/fps pill is gone; the layer name on the button is the
      // only thing the card needs to say about what is selected
      var name = layer.layerName || layer.name || 'Footage';
      if (btnName) btnName.textContent = name;
      // the name is ellipsised on the button, so the whole of it lives on hover
      var btn = document.getElementById('detectActiveLayerBtn');
      if (btn) btn.title = 'Detect scenes in ' + name;
      if (wrap) wrap.style.display = 'flex';
    },

    startImportFromActiveLayer: function () {
      var layer = this._selectedLayerInfo;
      if (layer && layer.ok && layer.filePath) {
        this.runDetection(layer.filePath);
      } else {
        window.showToast('Select a video layer in After Effects first', 'warn');
      }
    },

    // --- Import video ---
    startImport: function () {
      var homeDir = window.FileSystem ? window.FileSystem.getHomeDir() : '';
      var videoPath = window.FileSystem ? window.FileSystem.chooseFile('Select video to detect scenes', homeDir) : '';
      if (!videoPath) return;
      this.runDetection(videoPath);
    },

    runDetection: function (videoPath) {
      var s = this;
      this._currentVideo = videoPath;
      this._currentScenes = [];
      this._importedCount = 0;

      var outputDir = this.settings.outputDir;
      if (!outputDir && window.FileSystem && window.FileSystem.path && window.FileSystem.os) {
        outputDir = window.FileSystem.path.join(window.FileSystem.getTempDir(), 'AMVerge', window.FileSystem.getFileNameWithoutExtension(videoPath));
      }
      // kept so deleting this run from history can close the open episode
      this._currentOutputDir = outputDir;

      window.ImportPanel.showProgress();
      document.getElementById('scenePanel').style.display = 'none';

      // set once phase 1 hands the grid over, so the completion path knows to
      // merge into a grid the user may already have been picking clips in
      this._gridLive = false;
      window.CutProgressCard.reset();

      window.AmvergeHandler.detect(videoPath, outputDir, {
        method: this.settings.detectionMethod,
        threshold: this.settings.threshold || 0.5,
        // unset by default, which the handler reads as "use NVDEC if the shared
        // environment has it". set it to 'ffmpeg' to force the software path
        decodeMethod: this.settings.decodeMethod || '',
        cli: this._resolveCli()
      }, {
        onProgress: function (pct, msg, stage) {
          window.ImportPanel.setProgress(pct, msg);
        },

        // the full scene list arrives before any clip is cut. held until phase
        // 1, because a grid of tiles with nothing behind them is not useful
        onInitialClips: function (clips) {
          s._currentScenes = clips;
        },

        onClipReady: function (idx, clipPath, mode) {
          for (var i = 0; i < s._currentScenes.length; i++) {
            var sc = s._currentScenes[i];
            var sIdx = sc.scene_index !== undefined ? sc.scene_index : i;
            if (sIdx !== idx) continue;
            sc.clip_path = clipPath;
            sc.path = clipPath;
            break;
          }
          // anything arriving after the grid is live belongs to the slow phase,
          // whatever cut mode it used, so the log follows the phase not the mode
          if (s._gridLive) {
            window.ClipsPanel.applyClip(idx, clipPath, mode);
            window.CutProgressCard.log('scene ' + (idx + 1) + ' · ' + (mode || 'done'));
          }
        },

        onThumbnail: function (idx) {
          if (s._gridLive) window.ClipsPanel.markThumbnail(idx);
        },

        // the lossless clips are all cut. everything left is a re-encode, which
        // is the slow half, so the grid opens now and that runs behind it
        onPhase1Complete: function () {
          s._gridLive = true;
          window.ClipsPanel.loadScenes(s._currentScenes);
          document.getElementById('importArea').style.display = 'none';
          document.getElementById('scenePanel').style.display = '';
          window.ImportPanel.hide();
        },

        onReencodeProgress: function (done, total) {
          if (!total) return;
          if (!window.CutProgressCard.isVisible() && done < total) {
            window.CutProgressCard.show('Re-encoding ' + total + ' clips');
          }
          window.CutProgressCard.setProgress(done, total);
        },

        onComplete: function (result) {
          var scenes = result.scenes || [];

          if (s._gridLive) {
            // the grid has been up since phase 1, so fold the finished paths
            // and thumbnails in rather than rebuilding and losing the selection
            window.ClipsPanel.mergeScenes(scenes);
            s._currentScenes = window.ClipsPanel._scenes;
            if (window.CutProgressCard.isVisible()) {
              window.CutProgressCard.finish('Clips ready');
            }
          } else {
            if (scenes.length > 0) {
              s._currentScenes = scenes;
              window.ClipsPanel.loadScenes(scenes);
            }
            document.getElementById('importArea').style.display = 'none';
            document.getElementById('scenePanel').style.display = '';
            window.ImportPanel.hide();
          }

          window.HistoryPanel.addRun(videoPath, outputDir, scenes.length, s.settings.detectionMethod);
          window.showToast('Detected ' + scenes.length + ' scenes', 'success');
        },
        onError: function (err) {
          window.CutProgressCard.hide();

          // the lossless clips still work, so keep the grid and just report
          if (s._gridLive) {
            window.showToast('Some clips failed to cut: ' + err, 'error');
            dbg('error', 'App', err);
            return;
          }

          document.getElementById('importArea').style.display = '';
          document.getElementById('scenePanel').style.display = 'none';
          // restore the idle controls, not just the container that holds them
          window.ImportPanel.showIdle();

          // a missing AI pack is a setup problem, not a failure to report as
          // one, so it offers the install instead of a red toast
          if (window.AiInstallModal && window.AiInstallModal.looksLikeMissingMlPack(err)) {
            window.AiInstallModal.open();
            dbg('warn', 'App', 'AI pack missing: ' + err);
            return;
          }

          window.showToast('Detection failed: ' + err, 'error');
          dbg('error', 'App', err);
        }
      });
    },

    /** how to invoke the CLI: `{ command, prefix }`.
     *
     * The console script is preferred over `python -m amverge` everywhere it
     * exists. A wheel install does not necessarily ship `amverge/__main__.py`,
     * and `-m` then fails outright with "package cannot be directly executed",
     * which is exactly what the app's own venv does. The script is generated
     * from the project entry point, so it is always present.
     *
     * Order: an explicit setting, then the desktop app's AI venv so a pack
     * installed in the app is shared here, then PATH.
     */
    _resolveCli: function () {
      return this._resolveCliCandidates()[0];
    },

    /** every CLI worth trying, in the same preference order.
     *
     * Detection has to run in one specific environment, the one holding the AI
     * packs, so it takes the first of these and stops. Preview proxies only
     * need ffmpeg, and the preferred CLI is often an older release than a local
     * checkout, so that path walks the whole list until one knows the command.
     */
    _resolveCliCandidates: function () {
      var fs = window.FileSystem;
      var list = [];

      if (this.settings.pythonPath) {
        var sibling = fs && fs.siblingCliFor ? fs.siblingCliFor(this.settings.pythonPath) : null;
        if (sibling) list.push({ command: sibling, prefix: [] });
        else list.push({ command: this.settings.pythonPath, prefix: ['-m', 'amverge'] });
      }

      if (fs && fs.getAppAiCli) {
        var shared = fs.getAppAiCli();
        if (shared) {
          dbg('info', 'App', 'Using desktop app AI environment: ' + shared);
          list.push({ command: shared, prefix: [] });
        }
      }

      // PATH, console script first. spawning a name that is not installed just
      // raises ENOENT, which the caller treats as "try the next one"
      list.push({ command: 'amverge', prefix: [] });
      var names = this._pythonNames();
      for (var i = 0; i < names.length; i++) {
        list.push({ command: names[i], prefix: ['-m', 'amverge'] });
      }
      return list;
    },

    _pythonNames: function () {
      return process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    },

    /** the interpreter behind `_resolveCli`, for anything that needs pip */
    _resolvePython: function () {
      if (this.settings.pythonPath) return this.settings.pythonPath;
      if (window.FileSystem && window.FileSystem.getAppAiPython) {
        var shared = window.FileSystem.getAppAiPython();
        if (shared) return shared;
      }
      return this._pythonNames()[0];
    },

    // --- Scene selection & preview ---
    selectScene: function (idx) {
      var scene = null;
      for (var i = 0; i < this._currentScenes.length; i++) {
        var s = this._currentScenes[i];
        var sidx = s.scene_index !== undefined ? s.scene_index : i;
        if (sidx === idx) { scene = s; break; }
      }
      if (scene) {
        window.PreviewPanel.showScene(scene);
      } else {
        // a silent miss here was indistinguishable from a broken preview
        dbg('error', 'App', 'No scene matching idx=' + idx +
            ' among ' + this._currentScenes.length + ' scenes');
      }
      // deliberately does not touch the selection: focusing a clip to look at
      // it must not discard what the user has ticked for export
    },

    /** back to the import screen, dropping the loaded episode.
     *
     * The panel otherwise has no way out of a loaded episode: once the scene
     * grid is up it stays up for the session, and the only route back is
     * reloading the extension.
     */
    closeEpisode: function () {
      this._currentScenes = [];
      this._currentVideo = null;
      this._currentOutputDir = null;
      this._gridLive = false;
      window.CutProgressCard.hide();

      window.ClipsPanel.loadScenes([]);
      window.PreviewPanel.clearPreview();

      document.getElementById('scenePanel').style.display = 'none';
      document.getElementById('importArea').style.display = '';
      window.ImportPanel.showIdle();
    },

    // --- Import to AE ---
    importSelectedToAE: function () {
      var s = this;
      var selected = window.ClipsPanel.getSelectedScenes();
      if (selected.length === 0) {
        window.showToast('No scenes selected', 'error');
        return;
      }

      this._importedCount = 0;
      var total = selected.length;

      function importNext(i) {
        if (i >= selected.length) {
          window.showToast('Imported ' + total + ' scene' + (total !== 1 ? 's' : '') + ' to AE', 'success');
          s.switchTab('home');
          return;
        }

        var scene = selected[i];
        var clipPath = scene.clip_path || scene.path || '';
        dbg('debug', 'App', 'Scene ' + i + ' clip_path=' + (scene.clip_path || 'null') + ' path=' + (scene.path || 'null'));
        if (!clipPath) {
          importNext(i + 1);
          return;
        }

        var layerName = s.settings.layerPrefix + (scene.scene_index !== undefined ? scene.scene_index + 1 : i + 1);

        var escapedPath = clipPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var escapedName = layerName.replace(/"/g, '\\"');
        var autoScale = s.settings.autoScale !== false;
        var offset = i > 0;
        var prevDuration = i > 0 ? (selected[i - 1].end_sec || selected[i - 1].end || 0) - (selected[i - 1].start_sec || selected[i - 1].start || 0) : 0;

        dbg('debug', 'App', 'Importing scene ' + i + ' path=' + clipPath);

        if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
          var finished = false;
          function finish(result) {
            if (finished) return;
            finished = true;
            dbg('debug', 'App', 'evalScript result raw: ' + (result || 'null'));
            var res = {};
            try { res = JSON.parse(result || '{}'); } catch (e) {}
            if (res.ok) {
              s._importedCount++;
            } else {
              dbg('warn', 'App', 'Import failed: ' + (res.message || 'unknown'));
            }
            importNext(i + 1);
          }
          window.__adobe_cep__.evalScript('importClipToAE("' + escapedPath + '","' + escapedName + '",' + (autoScale ? 'true' : 'false') + ',' + (offset ? 'true' : 'false') + ',' + prevDuration + ')', finish);
          setTimeout(function () { finish(null); }, 30000);
        } else {
          dbg('warn', 'App', 'AE bridge not available');
          importNext(i + 1);
        }
      }

      importNext(0);
    },

    // --- Settings ---
    loadSettings: function () {
      var saved = window.StorageManager.loadSettings();
      for (var key in this.settings) {
        if (saved[key] !== undefined) this.settings[key] = saved[key];
      }
    },

    saveSettings: function () {
      this.settings.pythonPath = document.getElementById('settingsPythonPath').value;
      this.settings.outputDir = document.getElementById('settingsOutputDir').value;
      this.settings.detectionMethod = document.getElementById('settingsDetectionMethod').value;
      this.settings.layerPrefix = document.getElementById('settingsLayerPrefix').value;
      this.settings.autoScale = document.getElementById('settingsAutoScale').checked;
      var showTimestampsBox = document.getElementById('settingsShowTimestamps');
      this.settings.showClipTimestamps = showTimestampsBox ? showTimestampsBox.checked : true;
      var syncBox = document.getElementById('settingsSyncTheme');
      this.settings.syncThemeWithApp = syncBox ? syncBox.checked : false;

      if (this.settings.syncThemeWithApp) {
        // clearing the hash forces the pull. the watcher skips a theme it has
        // already seen, so re-enabling after picking a colour by hand would
        // otherwise match the last sync and quietly do nothing
        this._lastSyncedThemeHash = null;
        this.syncThemeFromApp(false);
        this.startThemeSyncWatcher();
      } else {
        this.stopThemeSyncWatcher();
      }
      if (window.HistoryPanel) window.HistoryPanel.syncFromDesktopApp();

      this.applyTimestampVisibility(this.settings.showClipTimestamps);
      window.StorageManager.saveSettings(this.settings);
    },

    applyAccentColor: function (color, gradient) {
      this.settings.accentColor = color;
      if (gradient) this.settings.backgroundGradient = gradient;
      document.documentElement.style.setProperty('--accent', color);
      var rgb = this._hexToRgb(color);
      document.documentElement.style.setProperty('--accent-rgb', rgb.r + ' ' + rgb.g + ' ' + rgb.b);
      if (this.settings.backgroundGradient) {
        document.documentElement.style.setProperty('--bg-accent', this.settings.backgroundGradient);
      }

      var logoFilter = this._computeLogoFilter(rgb.r, rgb.g, rgb.b);
      document.documentElement.style.setProperty('--logo-filter', logoFilter);

      var previewBox = document.getElementById('colorPreviewBox');
      if (previewBox) previewBox.style.background = color;
      window.StorageManager.saveSettings(this.settings);
    },

    applyBackgroundMedia: function () {
      var img = document.getElementById('appBgImage');
      var vid = document.getElementById('appBgVideo');
      var clearBtn = document.getElementById('clearBgMediaBtn');
      var btnLabel = document.getElementById('bgMediaBtnLabel');

      if (!img || !vid) return;

      var mediaPath = this.settings.backgroundImagePath;
      if (!mediaPath) {
        img.style.display = 'none';
        img.src = '';
        vid.style.display = 'none';
        vid.src = '';
        if (clearBtn) clearBtn.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Upload';
        return;
      }

      var isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(mediaPath);
      var fileUrl = 'file:///' + encodeURI(mediaPath.replace(/\\/g, '/'));

      if (isVideo) {
        img.style.display = 'none';
        vid.src = fileUrl;
        vid.style.display = 'block';
        vid.style.opacity = this.settings.backgroundOpacity !== undefined ? this.settings.backgroundOpacity : 1;
        vid.style.filter = 'blur(' + (this.settings.backgroundBlur || 0) + 'px)';
        var playP = vid.play();
        if (playP && playP.catch) playP.catch(function () {});
      } else {
        vid.style.display = 'none';
        vid.pause();
        img.src = fileUrl;
        img.style.display = 'block';
        img.style.opacity = this.settings.backgroundOpacity !== undefined ? this.settings.backgroundOpacity : 1;
        img.style.filter = 'blur(' + (this.settings.backgroundBlur || 0) + 'px)';
      }

      if (clearBtn) clearBtn.style.display = 'inline-flex';
      if (btnLabel) btnLabel.textContent = 'Change';
    },

    pickBackgroundMedia: function () {
      var mediaPath = window.FileSystem.chooseFile('Select background image or video', '', 'Media files|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.mp4;*.webm;*.mov|All files|*.*');
      if (mediaPath) {
        this.settings.backgroundImagePath = mediaPath;
        this.applyBackgroundMedia();
        window.StorageManager.saveSettings(this.settings);
        if (window.SettingsPanel) window.SettingsPanel.populate(this.settings);
        window.showToast('Background media applied', 'success');
      }
    },

    clearBackgroundMedia: function () {
      this.settings.backgroundImagePath = null;
      this.applyBackgroundMedia();
      window.StorageManager.saveSettings(this.settings);
      if (window.SettingsPanel) window.SettingsPanel.populate(this.settings);
      window.showToast('Background media cleared', 'info');
    },

    onBgOpacityChange: function (val) {
      var num = parseFloat(val);
      this.settings.backgroundOpacity = num;
      var lbl = document.getElementById('bgOpacityValue');
      if (lbl) lbl.textContent = Math.round(num * 100) + '%';
      var img = document.getElementById('appBgImage');
      var vid = document.getElementById('appBgVideo');
      if (img) img.style.opacity = num;
      if (vid) vid.style.opacity = num;
      window.StorageManager.saveSettings(this.settings);
    },

    onBgBlurChange: function (val) {
      var num = parseInt(val, 10);
      this.settings.backgroundBlur = num;
      var lbl = document.getElementById('bgBlurValue');
      if (lbl) lbl.textContent = num + 'px';
      var img = document.getElementById('appBgImage');
      var vid = document.getElementById('appBgVideo');
      if (img) img.style.filter = 'blur(' + num + 'px)';
      if (vid) vid.style.filter = 'blur(' + num + 'px)';
      window.StorageManager.saveSettings(this.settings);
    },

    onPreviewSpeedChange: function (val) {
      var num = parseFloat(val);
      this.settings.gridPreviewSpeed = num;
      var lbl = document.getElementById('previewSpeedValue');
      if (lbl) lbl.textContent = num.toFixed(1) + 'x';
      window.StorageManager.saveSettings(this.settings);
    },

    applyTimestampVisibility: function (visible) {
      var overlays = document.querySelectorAll('.clip-time');
      for (var i = 0; i < overlays.length; i++) {
        overlays[i].style.display = visible ? '' : 'none';
      }
    },

    resetThemeToDefaults: function () {
      this.settings.accentColor = '#22c55e';
      this.settings.backgroundGradient = '#001a00';
      this.settings.backgroundImagePath = null;
      this.settings.backgroundOpacity = 1.0;
      this.settings.backgroundBlur = 0;
      this.settings.gridPreviewSpeed = 1.0;
      this.settings.showClipTimestamps = true;

      this.applyAccentColor(this.settings.accentColor, this.settings.backgroundGradient);
      this.applyBackgroundMedia();
      this.applyTimestampVisibility(true);

      if (window.SettingsPanel) window.SettingsPanel.populate(this.settings);
      window.StorageManager.saveSettings(this.settings);
      window.showToast('Appearance reset to defaults', 'info');
    },

    setAccentColor: function (color) {
      if (!color || color === '#') return;
      this._stopSyncingTheme();
      this.applyAccentColor(color);
      var hexInput = document.getElementById('hexInput');
      if (hexInput) hexInput.value = color.replace('#', '');
      var presetItems = document.querySelectorAll('.color-preset-item');
      for (var i = 0; i < presetItems.length; i++) {
        presetItems[i].classList.toggle('active', presetItems[i].dataset.color.toLowerCase() === color.toLowerCase());
      }
    },

    /** picking a colour here contradicts "follow the app", so it wins.
     *
     * Otherwise the choice survives until the next reload or window focus, when
     * the watcher pulls the app's theme back over it and the user's selection
     * disappears with no explanation.
     */
    _stopSyncingTheme: function () {
      if (!this.settings.syncThemeWithApp) return;

      this.settings.syncThemeWithApp = false;
      if (this._themeSyncTimer) {
        clearInterval(this._themeSyncTimer);
        this._themeSyncTimer = null;
      }
      var box = document.getElementById('settingsSyncTheme');
      if (box) box.checked = false;
      window.StorageManager.saveSettings(this.settings);
      if (window.HistoryPanel) window.HistoryPanel.syncFromDesktopApp();
      if (window.showToast) {
        window.showToast('Sync with AMVerge App turned off', 'info');
      }
    },

    setThemePreset: function (accent, gradient) {
      this._stopSyncingTheme();
      this.applyAccentColor(accent, gradient);
      var hexInput = document.getElementById('hexInput');
      if (hexInput) hexInput.value = accent.replace('#', '');
      var presetItems = document.querySelectorAll('.color-preset-item');
      for (var i = 0; i < presetItems.length; i++) {
        presetItems[i].classList.toggle('active', presetItems[i].dataset.color.toLowerCase() === accent.toLowerCase());
      }
    },

    _themeSyncTimer: null,
    _lastSyncedThemeHash: '',

    startThemeSyncWatcher: function () {
      this.stopThemeSyncWatcher();
      if (!this.settings.syncThemeWithApp) return;

      var s = this;
      this._themeSyncTimer = setInterval(function () {
        s.syncThemeFromApp(false);
      }, 1500);
    },

    stopThemeSyncWatcher: function () {
      if (this._themeSyncTimer) {
        clearInterval(this._themeSyncTimer);
        this._themeSyncTimer = null;
      }
    },

    syncThemeFromApp: function (showToastNotice) {
      if (!window.FileSystem || !window.FileSystem.readAppTheme) return;
      try {
        var theme = window.FileSystem.readAppTheme();

        if (theme) {
          var themeHash = JSON.stringify(theme);
          if (!showToastNotice && themeHash === this._lastSyncedThemeHash) {
            return;
          }
          this._lastSyncedThemeHash = themeHash;

          if (theme.accentColor) {
            this.settings.accentColor = theme.accentColor;
            this.settings.backgroundGradient = theme.backgroundGradientColor || theme.backgroundGradient || '#001a00';
            this.applyAccentColor(this.settings.accentColor, this.settings.backgroundGradient);
          }

          if (theme.backgroundImagePath) {
            var rawPath = theme.backgroundImagePath.split('?')[0];
            this.settings.backgroundImagePath = rawPath;
          } else {
            this.settings.backgroundImagePath = null;
          }

          if (theme.backgroundOpacity !== undefined) {
            this.settings.backgroundOpacity = theme.backgroundOpacity;
          }
          if (theme.backgroundBlur !== undefined) {
            this.settings.backgroundBlur = theme.backgroundBlur;
          }
          if (theme.gridPreviewSpeed !== undefined) {
            this.settings.gridPreviewSpeed = theme.gridPreviewSpeed;
          }
          if (theme.showClipTimestamps !== undefined) {
            this.settings.showClipTimestamps = theme.showClipTimestamps;
          }

          this.applyBackgroundMedia();
          this.applyTimestampVisibility(this.settings.showClipTimestamps !== false);

          if (window.SettingsPanel) {
            window.SettingsPanel.populate(this.settings);
          }
          window.StorageManager.saveSettings(this.settings);

          if (showToastNotice) window.showToast('Theme synced from AMVerge App', 'success');
        } else if (showToastNotice) {
          // applyAccentColor, not setThemePreset: the latter treats a colour
          // change as a manual choice and turns this very sync off
          this.applyAccentColor('#22c55e', '#001a00');
          window.showToast('Default AMVerge theme applied', 'info');
        }
      } catch (e) {
        if (showToastNotice) window.showToast('Could not sync theme: ' + e.message, 'error');
      }
    },

    toggleColorPicker: function () {
      var popover = document.getElementById('colorPickerPopover');
      var open = popover.style.display === 'none';
      popover.style.display = open ? '' : 'none';
      this._setPickerOpen(popover, open);
    },

    _setPickerOpen: function (popover, open) {
      var group = popover.parentNode;
      while (group && group.classList && !group.classList.contains('settings-group')) {
        group = group.parentNode;
      }
      if (group && group.classList) group.classList.toggle('picker-open', open);

      // the settings page scrolls, so on a short panel the popover opens past
      // the bottom edge and is clipped
      if (!open) return;
      try {
        popover.scrollIntoView({ block: 'nearest' });
      } catch (e) {
        popover.scrollIntoView(false);
      }
    },

    _hexToRgb: function (hex) {
      var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 34, g: 197, b: 94 };
    },

    _computeLogoFilter: function (r, g, b) {
      var rNorm = r / 255;
      var gNorm = g / 255;
      var bNorm = b / 255;
      var max = Math.max(rNorm, gNorm, bNorm);
      var min = Math.min(rNorm, gNorm, bNorm);
      var delta = max - min;

      var h = 0;
      var s = 0;
      var l = (max + min) / 2;

      if (delta !== 0) {
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === rNorm) {
          h = ((gNorm - bNorm) / delta) + (gNorm < bNorm ? 6 : 0);
        } else if (max === gNorm) {
          h = ((bNorm - rNorm) / delta) + 2;
        } else {
          h = ((rNorm - gNorm) / delta) + 4;
        }
        h = h * 60;
      }

      // Base green in logo is approximately Hue: 142deg, Saturation: 70%, Lightness: 50%
      var baseHue = 142;
      var hueShift = Math.round(h - baseHue);

      if (s < 0.08) {
        // Monochrome / White / Grey
        return 'grayscale(100%) brightness(' + Math.round(l * 200 + 40) + '%)';
      }

      var satPct = Math.round(Math.max(0.2, s / 0.7) * 100);
      var brightPct = Math.round(Math.max(0.6, l / 0.5) * 100);

      return 'hue-rotate(' + hueShift + 'deg) saturate(' + satPct + '%) brightness(' + brightPct + '%)';
    },

    // --- File dialogs ---
    browsePython: function () {
      var isWin = process.platform === 'win32';
      var path = window.FileSystem.chooseFile(
        isWin ? 'Select python.exe' : 'Select the Python interpreter',
        '',
        isWin ? 'python.exe|python.exe|All files|*.*' : 'All files|*.*');
      if (path) {
        document.getElementById('settingsPythonPath').value = path;
        this.saveSettings();
      }
    },

    browseOutputDir: function () {
      var dir = window.FileSystem.chooseFolder('Select output directory');
      if (dir) {
        document.getElementById('settingsOutputDir').value = dir;
        this.saveSettings();
      }
    },

    // --- Diagnostics ---
    /* report on the interpreter detection actually uses.*/
    runDoctor: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) return;

      var python = this._resolvePython();
      var run = function (args, timeout) {
        var res = window.FileSystem.childProcess.spawnSync(python, args, {
          encoding: 'utf8', timeout: timeout || 10000, windowsHide: true
        });
        if (!res || res.error || res.status !== 0) return null;
        return ((res.stdout || '') + (res.stderr || '')).trim();
      };

      var status = {};

      var version = run(['--version'], 5000);
      status.python = version ? '✓ ' + version : '✗ Not found';

      // asked of the package itself: `pip show` needs pip, which the app's
      // uv-made environment does not have
      var cliVersion = run(['-c', 'import amverge; print(amverge.__version__)']);
      status.amverge = cliVersion ? '✓ v' + cliVersion : '✗ Not installed';

      var torch = run([
        '-c',
        'import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else' +
        ' ("Apple GPU (MPS)" if torch.backends.mps.is_available() else "CPU only"))'
      ], 30000);
      status.gpu = torch || 'PyTorch not installed';

      if (process.platform === 'darwin') {
        this._gpuDecodeOn = false;
        status.gpuDecodeOn = false;
        status.gpuDecode = 'Not available on macOS';
      } else {
        // whether NVDEC decode is available here, which is the thing the GPU row
        // above does not answer on its own
        var nelux = run([
          '-c',
          'from amverge.core.detection.nelux_runtime import nelux_available; print("ready" if nelux_available() else "off")'
        ], 30000);
        // remembered so the settings button can offer the opposite action
        this._gpuDecodeOn = nelux === 'ready';
        status.gpuDecodeOn = this._gpuDecodeOn;
        status.gpuDecode = nelux === 'ready'
          ? '✓ NVDEC enabled'
          : 'Off';
      }

      status.interpreter = python;

      window.SettingsPanel.updateSystemStatus(status);
    },

    /** install NVDEC decode into the shared runtime.
     *
     * Works whether or not the desktop app is installed: both provision the
     * same environment, so whichever runs first supplies it and the other
     * simply finds it.
     */
    installGpuDecode: function () {
      var s = this;
      if (!window.AmvergeRuntime) return;

      if (process.platform === 'darwin') {
        window.showToast('GPU decode needs an NVIDIA GPU, so it is Windows only', 'error');
        return;
      }

      // turning it off only removes Nelux, so it is quick and downloads nothing
      if (this._gpuDecodeOn) {
        window.AiInstallModal.openRuntimeJob({
          title: 'GPU decode',
          lede: 'Turn GPU decode off?',
          note: 'Removes Nelux. Nothing is downloaded and no other AI feature ' +
                'is affected; scene detection falls back to FFmpeg decoding.',
          job: { extras: ['ml'], gpu: true, gpuDecode: false },
          onFinished: function () { s.runDoctor(); }
        });
        return;
      }

      window.AiInstallModal.openRuntimeJob({
        title: 'GPU decode',
        note: 'Decodes video on the GPU for AI scene detection. Needs an NVIDIA ' +
              'GPU from the RTX 20 series or newer, and downloads PyTorch (~3 GB).',
        job: { extras: ['ml'], gpu: true, gpuDecode: true },
        onFinished: function () { s.runDoctor(); }
      });
    },

    // --- Setup wizard bridge ---
    _setupNext: function () {
      window.ToolsSetup.runCheck();
    },

    _setupSkip: function () {
      window.ToolsSetup.skip();
      document.getElementById('app').style.display = '';
      this.switchTab('home');
      this.startLayerPoll();
    },

    _setupInstall: function () {
      var s = this;
      window.ToolsSetup.installAmverge(function (success) {
        if (success) s.runDoctor();
      });
    },

    _setupFinish: function () {
      window.ToolsSetup.finish();
      document.getElementById('app').style.display = '';
      this.switchTab('home');
      this.runDoctor();
      this.startLayerPoll();
    },

    confirmFactoryReset: function () {
      var modal = document.getElementById('resetConfirmModal');
      if (modal) modal.style.display = '';
    },

    closeResetConfirmModal: function () {
      var modal = document.getElementById('resetConfirmModal');
      if (modal) modal.style.display = 'none';
    },

    executeFactoryReset: function () {
      this.closeResetConfirmModal();

      // Clear all extension local storage
      window.StorageManager.removeItem('setup_complete');
      window.StorageManager.removeItem('setup_skipped');
      window.StorageManager.removeItem('workflow_mode');
      window.StorageManager.removeItem('settings');
      window.StorageManager.removeItem('history');

      // Reset App state
      this.settings = {
        pythonPath: '',
        outputDir: '',
        detectionMethod: 'keyframe_detection',
        layerPrefix: 'AMVerge_',
        autoScale: true,
        accentColor: '#22c55e',
        backgroundGradient: '#001a00',
        backgroundImagePath: null,
        backgroundOpacity: 1.0,
        backgroundBlur: 0,
        gridPreviewSpeed: 1.0,
        showClipTimestamps: true,
        syncThemeWithApp: false,
        theme: 'dark'
      };

      this.applyAccentColor(this.settings.accentColor, this.settings.backgroundGradient);
      this.applyBackgroundMedia();
      this.applyTimestampVisibility(true);

      document.getElementById('app').style.display = 'none';
      if (window.ToolsSetup) {
        window.ToolsSetup.show();
      }
      window.showToast('Extension reset to setup wizard', 'info');
    }
  };

  window.showToast = function (msg, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3000);
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.App = App;
    App.init();
  });
})();
