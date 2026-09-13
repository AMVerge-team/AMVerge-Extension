(function () {
  var COLOR_PRESETS = [
    { accent: '#22c55e', gradient: '#001a00' },
    { accent: '#3b82f6', gradient: '#000f1f' },
    { accent: '#ef4444', gradient: '#1a0000' },
    { accent: '#eab308', gradient: '#1a1400' },
    { accent: '#8b5cf6', gradient: '#0f0020' },
    { accent: '#f43f5e', gradient: '#1a0008' },
    { accent: '#06b6d4', gradient: '#001a1f' },
    { accent: '#f97316', gradient: '#1a0d00' },
    { accent: '#ffffff', gradient: '#141414' },
    { accent: '#bebebe', gradient: '#0f0f0f' },
    { accent: '#6366f1', gradient: '#06061f' },
    { accent: '#a855f7', gradient: '#14002b' }
  ];

  var SettingsPanel = {
    init: function (app) {
      this.app = app;
      this._buildColorPresets();
    },

    populate: function (settings) {
      var pythonPathInput = document.getElementById('settingsPythonPath');
      if (pythonPathInput) pythonPathInput.value = settings.pythonPath || '';
      var outputDirInput = document.getElementById('settingsOutputDir');
      if (outputDirInput) outputDirInput.value = settings.outputDir || '';
      var detection = document.getElementById('settingsDetectionMethod');
      if (detection) {
        detection.value = settings.detectionMethod || 'transnetv2_gpu';
        // assigning .value fires nothing, so the styled label has to be told
        if (window.CustomSelect) window.CustomSelect.syncLabel(detection);
      }
      var layerPrefixInput = document.getElementById('settingsLayerPrefix');
      if (layerPrefixInput) layerPrefixInput.value = settings.layerPrefix || 'AMVerge_';
      var autoScaleBox = document.getElementById('settingsAutoScale');
      if (autoScaleBox) autoScaleBox.checked = settings.autoScale !== false;

      var syncCheckbox = document.getElementById('settingsSyncTheme');
      if (syncCheckbox) syncCheckbox.checked = settings.syncThemeWithApp === true;

      var opacityInput = document.getElementById('settingsBgOpacity');
      if (opacityInput) opacityInput.value = settings.backgroundOpacity !== undefined ? settings.backgroundOpacity : 1;
      var opacityLabel = document.getElementById('bgOpacityValue');
      if (opacityLabel) opacityLabel.textContent = Math.round((settings.backgroundOpacity !== undefined ? settings.backgroundOpacity : 1) * 100) + '%';

      var blurInput = document.getElementById('settingsBgBlur');
      if (blurInput) blurInput.value = settings.backgroundBlur || 0;
      var blurLabel = document.getElementById('bgBlurValue');
      if (blurLabel) blurLabel.textContent = (settings.backgroundBlur || 0) + 'px';

      var speedInput = document.getElementById('settingsPreviewSpeed');
      if (speedInput) speedInput.value = settings.gridPreviewSpeed || 1.0;
      var speedLabel = document.getElementById('previewSpeedValue');
      if (speedLabel) speedLabel.textContent = (settings.gridPreviewSpeed || 1.0).toFixed(1) + 'x';

      var timestampsBox = document.getElementById('settingsShowTimestamps');
      if (timestampsBox) timestampsBox.checked = settings.showClipTimestamps !== false;

      var clearBtn = document.getElementById('clearBgMediaBtn');
      var btnLabel = document.getElementById('bgMediaBtnLabel');
      if (clearBtn) clearBtn.style.display = settings.backgroundImagePath ? 'inline-flex' : 'none';
      if (btnLabel) btnLabel.textContent = settings.backgroundImagePath ? 'Change' : 'Upload';

      // opacity and blur only act on a background image, so they are hidden
      // until there is one rather than sitting there doing nothing
      var hasBackground = !!settings.backgroundImagePath;
      var opacityRow = document.getElementById('bgOpacityRow');
      var blurRow = document.getElementById('bgBlurRow');
      if (opacityRow) opacityRow.style.display = hasBackground ? '' : 'none';
      if (blurRow) blurRow.style.display = hasBackground ? '' : 'none';

      var hexInput = document.getElementById('hexInput');
      var color = settings.accentColor || '#22c55e';
      if (hexInput) hexInput.value = color.replace('#', '');
      var presetItems = document.querySelectorAll('.color-preset-item');
      for (var i = 0; i < presetItems.length; i++) {
        presetItems[i].classList.toggle('active', presetItems[i].dataset.color.toLowerCase() === color.toLowerCase());
      }
    },

    _buildColorPresets: function () {
      var grid = document.getElementById('colorPresetsGrid');
      if (!grid) return;
      grid.innerHTML = '';
      for (var i = 0; i < COLOR_PRESETS.length; i++) {
        var swatch = document.createElement('div');
        swatch.className = 'color-preset-item';
        swatch.style.background = COLOR_PRESETS[i].accent;
        swatch.dataset.color = COLOR_PRESETS[i].accent;
        (function (preset) {
          swatch.addEventListener('click', function () {
            if (window.App) window.App.setThemePreset(preset.accent, preset.gradient);
          });
        })(COLOR_PRESETS[i]);
        grid.appendChild(swatch);
      }
    },

    updateSystemStatus: function (status) {
      var pyEl = document.getElementById('sysPythonStatus');
      var amvEl = document.getElementById('sysAmvergeStatus');
      var gpuEl = document.getElementById('sysGpuStatus');

      var decodeEl = document.getElementById('sysGpuDecodeStatus');
      var envEl = document.getElementById('sysInterpreter');

      if (status) {
        if (pyEl) pyEl.textContent = status.python || 'Unknown';
        if (pyEl) pyEl.style.color = status.python && status.python.indexOf('✓') !== -1 ? 'var(--accent)' : '';
        if (amvEl) amvEl.textContent = status.amverge || 'Unknown';
        if (amvEl) amvEl.style.color = status.amverge && status.amverge.indexOf('✓') !== -1 ? 'var(--accent)' : '';
        if (gpuEl) gpuEl.textContent = status.gpu || 'Unknown';
        if (decodeEl) {
          decodeEl.textContent = status.gpuDecode || 'Unknown';
          decodeEl.style.color = status.gpuDecode && status.gpuDecode.indexOf('✓') !== -1 ? 'var(--accent)' : '';
        }
        var decodeBtn = document.getElementById('gpuDecodeBtn');
        if (decodeBtn) decodeBtn.textContent = status.gpuDecodeOn ? 'Disable' : 'Enable';
        // which Python all of the above describes, since it is not obvious and
        // is the first thing worth knowing when a row looks wrong
        if (envEl) envEl.textContent = status.interpreter || '';
      } else {
        if (pyEl) { pyEl.textContent = 'Not checked'; pyEl.style.color = ''; }
        if (amvEl) { amvEl.textContent = 'Not checked'; amvEl.style.color = ''; }
        if (gpuEl) { gpuEl.textContent = 'Not checked'; gpuEl.style.color = ''; }
        if (decodeEl) { decodeEl.textContent = 'Not checked'; decodeEl.style.color = ''; }
        if (envEl) envEl.textContent = '';
      }
    }
  };

  window.SettingsPanel = SettingsPanel;
})();
