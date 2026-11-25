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
      this._resolvedPython = null;
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

      if (window.App && window.App.settings && window.App.settings.pythonPath) {
        candidates.push({ cmd: window.App.settings.pythonPath, args: [], isFile: true });
      }

      if (fs.getAppAiPython) {
        var shared = fs.getAppAiPython();
        if (shared) candidates.push({ cmd: shared, args: [], isFile: true });
      }

      if (process.platform === 'win32') {
        candidates.push({ cmd: 'py', args: ['-3.13'], isFile: false });
        candidates.push({ cmd: 'py', args: ['-3.12'], isFile: false });
        candidates.push({ cmd: 'py', args: ['-3.11'], isFile: false });
        candidates.push({ cmd: 'py', args: [], isFile: false });
      }

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
        var checkArgs = baseArgs.concat(['-c', 'import importlib.metadata as m; print(m.version("amverge"))']);
        var result = window.FileSystem.childProcess.execFileSync(cmd, checkArgs, { encoding: 'utf8', timeout: 10000, windowsHide: true });
        var ver = (result || '').trim();
        s._markCheck('amverge', 'pass', ver ? 'Version: ' + ver : 'Installed');
        this._addTimer(function () { s._checkFfmpeg(); }, 100);
      } catch (e) {
        s._markCheck('amverge', 'fail', 'Not installed');
      }
    },

    _checkFfmpeg: function () {
      var s = this;
      var fs = window.FileSystem;
      
      // Check portable FFmpeg first (installed by AMVerge)
      var portableFfmpeg = fs.getPortableFfmpeg ? fs.getPortableFfmpeg() : null;
      if (portableFfmpeg) {
        s._markCheck('ffmpeg', 'pass', 'Portable: ' + fs.path.basename(fs.path.dirname(portableFfmpeg)));
        this._addTimer(function () { s._checkGpu(); }, 100);
        return;
      }
      
      // Check PATH
      try {
        var result = fs.childProcess.execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        s._markCheck('ffmpeg', 'pass', 'Found in PATH');
        this._addTimer(function () { s._checkGpu(); }, 100);
      } catch (e) {
        // FFmpeg not found anywhere - this is a blocking issue
        s._markCheck('ffmpeg', 'fail', 'Not found (required for video processing)');
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
      var ffmpegOk = this._checkState.ffmpeg;
      var installBtn = document.getElementById('setupInstallBtn');
      var continueBtn = document.getElementById('setupContinueBtn');
      
      // Install button: enabled if amverge OR ffmpeg is missing
      if (installBtn) installBtn.disabled = !!(amvergeOk && ffmpegOk);
      
      // Continue button: requires python, amverge, AND ffmpeg
      if (continueBtn) continueBtn.disabled = !(pythonOk && amvergeOk && ffmpegOk);
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

      var needsFfmpeg = !this._checkState.ffmpeg;
      var needsAmverge = !this._checkState.amverge;

      var installSteps = [];
      if (needsAmverge) installSteps.push('amverge');
      if (needsFfmpeg) installSteps.push('ffmpeg');

      var currentStep = 0;
      var totalSteps = installSteps.length;

      var runNextStep = function () {
        if (currentStep >= totalSteps) {
          // All done
          s._resolvedPython = null;
          fill.style.width = '100%';
          status.textContent = 'Installation complete';
          s._addTimer(function () {
            s._showStep('complete');
            if (cb) cb(true);
          }, 300);
          return;
        }

        var step = installSteps[currentStep];
        var baseProgress = (currentStep / totalSteps) * 100;
        var stepProgress = 100 / totalSteps;

        if (step === 'amverge') {
          fill.style.width = baseProgress + '%';
          status.textContent = 'Installing amverge package...';

          window.AmvergeRuntime.install({ extras: ['edge'], gpu: false }, {
            onStage: function (message) {
              status.textContent = message;
            },
            onLine: function (message) {
              dbg('debug', 'Setup', message);
            },
            onDone: function (ok, detail) {
              if (!ok) {
                status.textContent = 'Install failed: ' + detail;
                dbg('error', 'Setup', detail);
                return;
              }
              currentStep++;
              fill.style.width = (baseProgress + stepProgress) + '%';
              runNextStep();
            }
          });
        } else if (step === 'ffmpeg') {
          fill.style.width = baseProgress + '%';
          status.textContent = 'Installing FFmpeg...';

          window.AmvergeRuntime.installFfmpeg({
            onStage: function (message) {
              status.textContent = message;
            },
            onLine: function (message) {
              dbg('debug', 'Setup', message);
            },
            onDone: function (ok, detail) {
              if (!ok) {
                status.textContent = 'FFmpeg install failed: ' + detail;
                dbg('error', 'Setup', detail);
                return;
              }
              currentStep++;
              fill.style.width = (baseProgress + stepProgress) + '%';
              runNextStep();
            }
          });
        } else {
          currentStep++;
          runNextStep();
        }
      };

      fill.style.width = '5%';
      runNextStep();
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
