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

    _resolvedPython: null,

    _resolvePythonCandidate: function () {
      if (this._resolvedPython) return this._resolvedPython;

      var fs = window.FileSystem;
      if (!fs || !fs.childProcess) return null;

      var candidates = [];

      // 1. App-managed AI Python environment if provisioned
      if (fs.getAppAiPython) {
        var shared = fs.getAppAiPython();
        if (shared) candidates.push({ cmd: shared, args: [], isFile: true });
      }

      // 2. Windows py launcher with version flags
      if (process.platform === 'win32') {
        candidates.push({ cmd: 'py', args: ['-3.13'], isFile: false });
        candidates.push({ cmd: 'py', args: ['-3.12'], isFile: false });
        candidates.push({ cmd: 'py', args: ['-3.11'], isFile: false });
        candidates.push({ cmd: 'py', args: [], isFile: false });
      }

      // 3. Standard binaries
      candidates.push({ cmd: 'python3.13', args: [], isFile: false });
      candidates.push({ cmd: 'python3.12', args: [], isFile: false });
      candidates.push({ cmd: 'python3.11', args: [], isFile: false });
      candidates.push({ cmd: 'python3', args: [], isFile: false });
      candidates.push({ cmd: 'python', args: [], isFile: false });

      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.isFile && !fs.fileExists(c.cmd)) continue;

        try {
          var checkArgs = c.args.concat(['--version']);
          var res = fs.childProcess.spawnSync(c.cmd, checkArgs, {
            encoding: 'utf8', timeout: 5000, windowsHide: true
          });
          var out = ((res.stdout || '') + (res.stderr || '')).trim();
          var match = out.match(/Python\s+([0-9]+)\.([0-9]+)/i);
          if (match) {
            var major = parseInt(match[1], 10);
            var minor = parseInt(match[2], 10);
            if (major === 3 && minor >= 11) {
              this._resolvedPython = {
                cmd: c.cmd,
                args: c.args,
                versionStr: out
              };
              return this._resolvedPython;
            }
          }
        } catch (e) {}
      }

      return null;
    },

    _checkPython: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) {
        this._markCheck('python', 'fail', 'No Node.js access');
        return;
      }

      var py = this._resolvePythonCandidate();
      if (py) {
        s._markCheck('python', 'pass', py.versionStr);
        this._addTimer(function () { s._checkAmverge(); }, 100);
      } else {
        // Probe default python to give helpful error message if an older version exists
        var foundVer = '';
        try {
          var r = window.FileSystem.childProcess.spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
          foundVer = ((r.stdout || '') + (r.stderr || '')).trim();
        } catch (e) {}

        if (foundVer) {
          s._markCheck('python', 'fail', foundVer + ' (requires Python 3.11+)');
        } else {
          s._markCheck('python', 'fail', 'Not found (requires Python 3.11+)');
        }
      }
    },

    _checkAmverge: function () {
      var s = this;
      var py = this._resolvePythonCandidate();
      var cmd = py ? py.cmd : 'python';
      var baseArgs = py ? py.args.slice() : [];

      try {
        var checkArgs = baseArgs.concat(['-m', 'pip', 'show', 'amverge']);
        var result = window.FileSystem.childProcess.execFileSync(cmd, checkArgs, { encoding: 'utf8', timeout: 10000, windowsHide: true });
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
      var py = this._resolvePythonCandidate();
      var cmd = py ? py.cmd : 'python';
      var baseArgs = py ? py.args.slice() : [];

      try {
        var checkArgs = baseArgs.concat(['-c', 'import torch; print(torch.cuda.is_available())']);
        var result = window.FileSystem.childProcess.execFileSync(cmd, checkArgs, { encoding: 'utf8', timeout: 10000, windowsHide: true });
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

      var py = this._resolvePythonCandidate();
      var cmd = py ? py.cmd : 'python';
      var baseArgs = py ? py.args.slice() : [];
      var installArgs = baseArgs.concat(['-m', 'pip', 'install', 'amverge[edge]']);

      try {
        var proc = window.FileSystem.childProcess.spawn(cmd, installArgs);
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
