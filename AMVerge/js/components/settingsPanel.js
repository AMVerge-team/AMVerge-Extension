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
      document.getElementById('settingsPythonPath').value = settings.pythonPath || '';
      document.getElementById('settingsOutputDir').value = settings.outputDir || '';
      document.getElementById('settingsDetectionMethod').value = settings.detectionMethod || 'transnetv2_gpu';
      document.getElementById('settingsLayerPrefix').value = settings.layerPrefix || 'AMVerge_';
      document.getElementById('settingsAutoScale').checked = settings.autoScale !== false;

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

      if (status) {
        if (pyEl) pyEl.textContent = status.python || 'Unknown';
        if (pyEl) pyEl.style.color = status.python && status.python.indexOf('✓') !== -1 ? 'var(--accent)' : '';
        if (amvEl) amvEl.textContent = status.amverge || 'Unknown';
        if (amvEl) amvEl.style.color = status.amverge && status.amverge.indexOf('✓') !== -1 ? 'var(--accent)' : '';
        if (gpuEl) gpuEl.textContent = status.gpu || 'Unknown';
      } else {
        if (pyEl) { pyEl.textContent = 'Not checked'; pyEl.style.color = ''; }
        if (amvEl) { amvEl.textContent = 'Not checked'; amvEl.style.color = ''; }
        if (gpuEl) { gpuEl.textContent = 'Not checked'; gpuEl.style.color = ''; }
      }
    }
  };

  window.SettingsPanel = SettingsPanel;
})();
