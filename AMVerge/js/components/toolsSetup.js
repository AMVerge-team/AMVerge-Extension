(function () {
  var ToolsSetup = {
    _timers: [],
    _checkState: {},

    _selectedMode: 'sync',

    init: function (app) {
      this.app = app;
    },

    selectMode: function (mode) {
      this._selectedMode = mode;
      var cardSync = document.getElementById('modeCardSync');
      var cardStandalone = document.getElementById('modeCardStandalone');
      if (cardSync) cardSync.classList.toggle('active', mode === 'sync');
      if (cardStandalone) cardStandalone.classList.toggle('active', mode === 'standalone');
    },

    _addTimer: function (fn, ms) {
      var s = this;
      var id = setTimeout(function () { fn(); }, ms);
      s._timers.push(id);
      return id;
    },

    _clearTimers: function () {
      for (var i = 0; i < this._timers.length; i++) {
        clearTimeout(this._timers[i]);
      }
      this._timers = [];
    },

    show: function () {
      document.getElementById('setup-gate').style.display = '';
      this._showStep('welcome');
      this.selectMode('sync');
    },

    hide: function () {
      this._clearTimers();
      document.getElementById('setup-gate').style.display = 'none';
    },

    isComplete: function () {
      return window.StorageManager.getItem('setup_complete', '0') === '1' ||
             window.StorageManager.getItem('setup_skipped', '0') === '1';
    },

    _showStep: function (name) {
      var steps = ['welcome', 'check', 'install', 'complete'];
      for (var i = 0; i < steps.length; i++) {
        document.getElementById('setup' + steps[i].charAt(0).toUpperCase() + steps[i].slice(1)).style.display = steps[i] === name ? '' : 'none';
      }
    },

    runCheck: function () {
      var s = this;
      this._showStep('check');
      var results = document.getElementById('setupCheckResults');
      results.innerHTML = '';

      this._checkState = { python: false, amverge: false, ffmpeg: false, gpu: false };
      var installBtn = document.getElementById('setupInstallBtn');
      if (installBtn) installBtn.disabled = true;
      var continueBtn = document.getElementById('setupContinueBtn');
      if (continueBtn) continueBtn.disabled = true;

      var checks = [
        { label: 'Python 3.11+', status: 'pending', key: 'python' },
        { label: 'amverge package', status: 'pending', key: 'amverge' },
        { label: 'FFmpeg', status: 'pending', key: 'ffmpeg' },
        { label: 'GPU (CUDA)', status: 'pending', key: 'gpu' }
      ];

      var html = '';
      for (var i = 0; i < checks.length; i++) {
        html += '<div class="setup-check-item pending" id="check-' + checks[i].key + '" data-label="' + checks[i].label + '"><svg class="icon"><use href="#icon-circle"/></svg> ' + checks[i].label + '</div>';
      }
      results.innerHTML = html;

      this._addTimer(function () { s._checkPython(); }, 200);
    },

    _checkPython: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) {
        this._markCheck('python', 'fail', 'No Node.js access');
        return;
      }
      try {
        var result = window.FileSystem.childProcess.spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        var ver = ((result.stdout || '') + (result.stderr || '')).trim();
        if (ver.indexOf('Python 3.') === 0) {
          s._markCheck('python', 'pass', ver);
          this._addTimer(function () { s._checkAmverge(); }, 100);
        } else {
          s._markCheck('python', 'fail', ver + ': need Python 3.11+');
        }
      } catch (e) {
        s._markCheck('python', 'fail', 'Not found');
      }
    },

    _checkAmverge: function () {
      var s = this;
      try {
        var result = window.FileSystem.childProcess.execFileSync('python', ['-m', 'pip', 'show', 'amverge'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        var lines = (result || '').split('\n');
        var ver = '';
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('Version:') === 0) { ver = lines[i].trim(); break; }
        }
        s._markCheck('amverge', 'pass', ver || 'Installed');
        this._addTimer(function () { s._checkFfmpeg(); }, 100);
      } catch (e) {
        s._markCheck('amverge', 'fail', 'Not installed');
      }
    },

    _checkFfmpeg: function () {
      var s = this;
      try {
        var result = window.FileSystem.childProcess.execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        s._markCheck('ffmpeg', 'pass', 'Found');
        this._addTimer(function () { s._checkGpu(); }, 100);
      } catch (e) {
        s._markCheck('ffmpeg', 'warn', 'Not in PATH (may still work)');
        this._addTimer(function () { s._checkGpu(); }, 100);
      }
    },

    _checkGpu: function () {
      var s = this;
      try {
        var result = window.FileSystem.childProcess.execFileSync('python', ['-c', 'import torch; print(torch.cuda.is_available())'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        var avail = (result || '').trim();
        if (avail === 'True') {
          s._markCheck('gpu', 'pass', 'CUDA available');
        } else {
          s._markCheck('gpu', 'pass', 'CPU only');
        }
      } catch (e) {
        s._markCheck('gpu', 'pass', 'No PyTorch');
      }
    },

    _markCheck: function (key, status, msg) {
      var el = document.getElementById('check-' + key);
      if (!el) return;
      el.className = 'setup-check-item ' + status;
      var icon = status === 'pass' ? 'icon-circle-check' : status === 'fail' ? 'icon-circle-x' : 'icon-circle-exclaim';
      var iconColor = status === 'pass' ? 'var(--accent)' : status === 'fail' ? '#ef4444' : '#facc15';
      var label = el.dataset.label || el.textContent.trim();
      el.innerHTML = '<svg class="icon" style="color:' + iconColor + '"><use href="#' + icon + '"/></svg> ' + escHtmlLog(label) + (msg ? ': ' + escHtmlLog(msg) : '');
      this._checkState[key] = (status === 'pass');
      this._refreshCheckActions();
    },

    _refreshCheckActions: function () {
      var pythonOk = this._checkState.python;
      var amvergeOk = this._checkState.amverge;
      var installBtn = document.getElementById('setupInstallBtn');
      var continueBtn = document.getElementById('setupContinueBtn');
      if (installBtn) installBtn.disabled = !(pythonOk && !amvergeOk);
      if (continueBtn) continueBtn.disabled = !(pythonOk && amvergeOk);
    },

    installAmverge: function (cb) {
      var s = this;
      this._showStep('install');
      var fill = document.getElementById('setupProgressFill');
      var status = document.getElementById('setupStatusText');

      if (!window.FileSystem || !window.FileSystem.childProcess) {
        status.textContent = 'Error: No Node.js access';
        return;
      }

      fill.style.width = '10%';
      status.textContent = 'Installing amverge package...';

      try {
        var proc = window.FileSystem.childProcess.spawn('python', ['-m', 'pip', 'install', 'amverge[edge]']);
        var buf = '';
        proc.stdout.on('data', function (data) { buf += data.toString(); });
        proc.stderr.on('data', function (data) { buf += data.toString(); });
        proc.on('close', function (code) {
          if (code === 0) {
            fill.style.width = '100%';
            status.textContent = 'amverge installed successfully';
            s._addTimer(function () {
              s._showStep('complete');
              if (cb) cb(true);
            }, 300);
          } else {
            status.textContent = 'Install failed. Try: pip install amverge';
            dbg('error', 'Setup', buf);
          }
        });
        proc.on('error', function (err) {
          status.textContent = 'Error: ' + err.message;
        });
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      }
    },

    skip: function () {
      window.StorageManager.setItem('setup_skipped', '1');
      this._clearTimers();
      this.hide();
    },

    finish: function () {
      var isSync = (this._selectedMode === 'sync');
      window.StorageManager.setItem('setup_complete', '1');
      window.StorageManager.setItem('workflow_mode', this._selectedMode);

      if (window.App) {
        window.App.settings.syncThemeWithApp = isSync;
        window.StorageManager.saveSettings(window.App.settings);
        if (isSync) {
          window.App.syncThemeFromApp(false);
          if (window.HistoryPanel) window.HistoryPanel.syncFromDesktopApp();
        }
      }

      this._clearTimers();
      this.hide();
    }
  };

  window.ToolsSetup = ToolsSetup;
})();
