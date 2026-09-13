(function () {
  var ToolsSetup = {
    _timers: [],
    _checkState: {},
    _python: null,

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
        { label: 'GPU acceleration', status: 'pending', key: 'gpu' }
      ];

      var html = '';
      for (var i = 0; i < checks.length; i++) {
        html += '<div class="setup-check-item pending" id="check-' + checks[i].key + '" data-label="' + checks[i].label + '"><svg class="icon"><use href="#icon-circle"/></svg> ' + checks[i].label + '</div>';
      }
      results.innerHTML = html;

      this._addTimer(function () { s._checkPython(); }, 200);
    },

    _pythonCandidates: function () {
      var list = [];
      if (window.App && window.App._resolvePython) list.push(window.App._resolvePython());
      var names = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
      for (var i = 0; i < names.length; i++) {
        if (list.indexOf(names[i]) === -1) list.push(names[i]);
      }
      return list;
    },

    _ask: function (python, args, timeout) {
      try {
        var res = window.FileSystem.childProcess.spawnSync(python, args, {
          encoding: 'utf8', timeout: timeout || 10000, windowsHide: true
        });
        if (!res || res.error || res.status !== 0) return null;
        return ((res.stdout || '') + (res.stderr || '')).trim();
      } catch (e) {
        return null;
      }
    },

    _checkPython: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) {
        this._markCheck('python', 'fail', 'No Node.js access');
        return;
      }

      var candidates = this._pythonCandidates();
      for (var i = 0; i < candidates.length; i++) {
        var ver = this._ask(candidates[i], ['--version'], 5000);
        if (ver && ver.indexOf('Python 3.') === 0) {
          this._python = candidates[i];
          s._markCheck('python', 'pass', ver);
          this._addTimer(function () { s._checkAmverge(); }, 100);
          return;
        }
      }

      this._python = null;
      s._markCheck('python', 'fail', 'Python 3.11+ not found');
      this._addTimer(function () { s._checkFfmpeg(); }, 100);
    },

    _checkAmverge: function () {
      var s = this;
      var ver = this._python
        ? this._ask(this._python, ['-c', 'import amverge; print(amverge.__version__)'])
        : null;
      if (ver) {
        s._markCheck('amverge', 'pass', 'Version: ' + ver);
      } else {
        s._markCheck('amverge', 'fail', 'Not installed');
      }
      this._addTimer(function () { s._checkFfmpeg(); }, 100);
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
      var probe = 'import torch;' +
        'print("CUDA available" if torch.cuda.is_available() else' +
        ' ("Apple GPU (MPS)" if torch.backends.mps.is_available() else "CPU only"))';
      var result = this._python ? this._ask(this._python, ['-c', probe]) : null;
      s._markCheck('gpu', 'pass', result || 'No PyTorch');
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
      var amvergeOk = this._checkState.amverge;
      var installBtn = document.getElementById('setupInstallBtn');
      var continueBtn = document.getElementById('setupContinueBtn');
      if (installBtn) installBtn.disabled = amvergeOk;
      if (continueBtn) continueBtn.disabled = !amvergeOk;
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
      status.textContent = 'Preparing the AMVerge runtime...';

      if (!window.AmvergeRuntime) {
        status.textContent = 'Error: runtime installer unavailable';
        return;
      }

      window.AmvergeRuntime.installBase({
        onStage: function (text) {
          fill.style.width = '40%';
          status.textContent = text;
        },
        onLine: function (text) {
          status.textContent = text;
          dbg('debug', 'Setup', text);
        },
        onDone: function (ok, detail) {
          if (!ok) {
            status.textContent = 'Install failed: ' + detail;
            dbg('error', 'Setup', detail);
            return;
          }
          fill.style.width = '100%';
          status.textContent = 'amverge installed successfully';
          s._addTimer(function () {
            s._showStep('complete');
            if (cb) cb(true);
          }, 300);
        }
      });
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
        }
        if (window.HistoryPanel) window.HistoryPanel.syncFromDesktopApp();
      }

      this._clearTimers();
      this.hide();
    }
  };

  window.ToolsSetup = ToolsSetup;
})();
