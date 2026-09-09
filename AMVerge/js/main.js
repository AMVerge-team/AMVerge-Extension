(function () {
  var App = {
    settings: {
      pythonPath: '',
      outputDir: '',
      detectionMethod: 'transnetv2_gpu',
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
      window.ToolsSetup.init(this);
      window.HistoryPanel.init(this);

      var s = this;
      window.ClipsPanel.onSelectionChange(function (count) {
        window.PreviewPanel.updateImportBtn(count);
      });
    },

    bindEvents: function () {
      var s = this;
      var divider = document.getElementById('mainDivider');
      if (divider) {
        divider.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var startX = e.clientX;
          var startWidth = document.querySelector('.right-pane').offsetWidth;
          function onMove(e2) {
            var delta = startX - e2.clientX;
            var newWidth = Math.max(180, Math.min(400, startWidth + delta));
            document.querySelector('.right-pane').style.flex = '0 0 ' + newWidth + 'px';
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      document.addEventListener('mousedown', function (e) {
        var popover = document.getElementById('colorPickerPopover');
        var container = document.getElementById('colorPickerContainer');
        if (popover && container && popover.style.display !== 'none') {
          if (!container.contains(e.target)) {
            popover.style.display = 'none';
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
      var pages = ['home', 'console', 'settings', 'history'];
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
      if (tab === 'history') {
        if (window.HistoryPanel) window.HistoryPanel.render();
      }
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

    _previewPaneVisible: true,

    updateLayerInfoDisplay: function () {
      var wrap = document.getElementById('aeLayerActionWrap');
      var btnName = document.getElementById('aeLayerBtnName');
      var text = document.getElementById('aeLayerInfoText');
      var layer = this._selectedLayerInfo;

      if (!layer || !layer.ok || !layer.filePath) {
        if (wrap) wrap.style.display = 'none';
        return;
      }

      var parts = [];
      if (layer.width > 0 && layer.height > 0) parts.push(layer.width + 'x' + layer.height);
      if (layer.frameRate > 0) parts.push(layer.frameRate.toFixed(2) + ' fps');
      var name = layer.layerName || layer.name || 'Footage';
      if (btnName) btnName.textContent = name;
      if (text) text.textContent = (parts.length ? parts.join(' \u00b7 ') : name);
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

    togglePreviewPane: function () {
      var pane = document.getElementById('rightPane');
      var divider = document.getElementById('mainDivider');
      var btn = document.getElementById('togglePreviewDrawerBtn');
      if (!pane) return;

      this._previewPaneVisible = !this._previewPaneVisible;
      if (this._previewPaneVisible) {
        pane.style.display = 'flex';
        if (divider) divider.style.display = '';
        if (btn) {
          btn.classList.add('active');
          btn.title = 'Hide Preview Panel';
        }
      } else {
        pane.style.display = 'none';
        if (divider) divider.style.display = 'none';
        if (btn) {
          btn.classList.remove('active');
          btn.title = 'Show Preview Panel';
        }
      }
    },

    // --- Import video ---
    startImport: function () {
      var homeDir = window.FileSystem ? window.FileSystem.getHomeDir() : '';
      var videoPath = window.FileSystem ? window.FileSystem.chooseFile('Select video to detect scenes', homeDir) : '';
      if (!videoPath) return;
      this.runDetection(videoPath);
    },

    startImportFromProject: function () {
      if (!(window.__adobe_cep__ && window.__adobe_cep__.evalScript)) {
        window.showToast('AE bridge not available', 'error');
        return;
      }
      var s = this;
      window.__adobe_cep__.evalScript('getSelectedFootagePath()', function (raw) {
        var res = {};
        try { res = JSON.parse(raw || '{}'); } catch (e) {}
        if (res.ok && res.path) {
          s.runDetection(res.path);
        } else {
          window.showToast(res.message || 'Select a footage item in the Project panel', 'error');
        }
      });
    },

    selectProjectFootage: function (path) {
      this.runDetection(path);
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

      window.ImportPanel.showProgress();
      document.getElementById('scenePanel').style.display = 'none';

      window.AmvergeHandler.detect(videoPath, outputDir, {
        method: this.settings.detectionMethod,
        threshold: this.settings.threshold || 0.5,
        decodeMethod: this.settings.decodeMethod || 'ffmpeg',
        pythonPath: this.settings.pythonPath || 'python'
      }, {
        onProgress: function (pct, msg, stage) {
          window.ImportPanel.setProgress(pct, msg);
        },
        onComplete: function (result) {
          var scenes = result.scenes || [];
          if (scenes.length > 0) {
            s._currentScenes = scenes;
            window.ClipsPanel.loadScenes(scenes);
          }
          document.getElementById('importArea').style.display = 'none';
          document.getElementById('scenePanel').style.display = '';
          window.ImportPanel.hide();
          window.HistoryPanel.addRun(videoPath, outputDir, scenes.length, s.settings.detectionMethod);
          window.showToast('Detected ' + scenes.length + ' scenes', 'success');
        },
        onError: function (err) {
          window.ImportPanel.hide();
          document.getElementById('importArea').style.display = '';
          document.getElementById('scenePanel').style.display = 'none';
          window.showToast('Detection failed: ' + err, 'error');
          dbg('error', 'App', err);
        }
      });
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
      }
      window.ClipsPanel._selected = {};
      window.ClipsPanel._selected[idx] = true;
      window.ClipsPanel._updateSelectionUI();
      window.ClipsPanel._notify();
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
        this.syncThemeFromApp(false);
        this.startThemeSyncWatcher();
      } else {
        this.stopThemeSyncWatcher();
      }

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
        window.showToast('Background media applied', 'success');
      }
    },

    clearBackgroundMedia: function () {
      this.settings.backgroundImagePath = null;
      this.applyBackgroundMedia();
      window.StorageManager.saveSettings(this.settings);
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
      this.applyAccentColor(color);
      var hexInput = document.getElementById('hexInput');
      if (hexInput) hexInput.value = color.replace('#', '');
      var presetItems = document.querySelectorAll('.color-preset-item');
      for (var i = 0; i < presetItems.length; i++) {
        presetItems[i].classList.toggle('active', presetItems[i].dataset.color.toLowerCase() === color.toLowerCase());
      }
    },

    setThemePreset: function (accent, gradient) {
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
          this.setThemePreset('#22c55e', '#001a00');
          window.showToast('Default AMVerge theme applied', 'info');
        }
      } catch (e) {
        if (showToastNotice) window.showToast('Could not sync theme: ' + e.message, 'error');
      }
    },

    toggleColorPicker: function () {
      var popover = document.getElementById('colorPickerPopover');
      popover.style.display = popover.style.display === 'none' ? '' : 'none';
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
      var path = window.FileSystem.chooseFile('Select python.exe', '', 'python.exe|python.exe|All files|*.*');
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
    runDoctor: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) return;

      var status = {};

      try {
        var pyRes = window.FileSystem.childProcess.spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        var py = ((pyRes.stdout || '') + (pyRes.stderr || '')).trim();
        status.python = '✓ ' + (py || '').trim();
      } catch (e) {
        status.python = '✗ Not found';
      }

      try {
        var amv = window.FileSystem.childProcess.execFileSync('python', ['-m', 'pip', 'show', 'amverge'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        var lines = (amv || '').split('\n');
        var ver = '';
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('Version:') === 0) { ver = lines[i].split(':')[1].trim(); break; }
        }
        status.amverge = '✓ v' + (ver || '?');
      } catch (e) {
        status.amverge = '✗ Not installed';
      }

      try {
        var gpu = window.FileSystem.childProcess.execFileSync('python', ['-c', 'import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        status.gpu = (gpu || '').trim();
      } catch (e) {
        status.gpu = 'PyTorch not installed';
      }

      window.SettingsPanel.updateSystemStatus(status);
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
        detectionMethod: 'transnetv2_gpu',
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

  window.addEventListener('DOMContentLoaded', function () {
    window.App = App;
    App.init();
  });
})();
