/**
 * aiInstallModal.js
 *
 * Offers to install the TransNetV2 dependency when AI Scene Detection is
 * selected but the pack is missing.
 *
 * Mirrors the desktop app's AI install dialog (`components/AiInstallModal.tsx`)
 * in both wording and structure, and reuses its `pxm-*` / `aid-*` class names so
 * the two look like one product. The difference is what runs underneath: the app
 * provisions a managed venv with uv, while the extension pips into whichever
 * interpreter it is pointed at, bootstrapping pip first when that interpreter is
 * the app's uv-made environment, which ships without it.
 *
 * ExtendScript is not involved here. This is all panel-side Node.
 */
(function () {
  'use strict';

  var TARGET_MODULE = 'transnetv2_pytorch';

  var AiInstallModal = {
    _app: null,
    _proc: null,

    init: function (app) {
      this._app = app;
    },

    /** true when a CLI failure was the missing AI pack rather than a real error */
    looksLikeMissingMlPack: function (message) {
      if (!message) return false;
      var text = String(message).toLowerCase();
      return text.indexOf('transnetv2_pytorch not installed') !== -1 ||
             text.indexOf('amverge[ml]') !== -1;
    },

    open: function () {
      var overlay = document.getElementById('aiInstallModal');
      if (!overlay) return;
      overlay.style.display = '';
      this._setStage('confirm');
      this._describeTarget();
    },

    close: function () {
      var overlay = document.getElementById('aiInstallModal');
      if (overlay) overlay.style.display = 'none';
    },

    _setStage: function (stage) {
      var confirm = document.getElementById('aiInstallConfirm');
      var progress = document.getElementById('aiInstallProgress');
      if (confirm) confirm.style.display = stage === 'confirm' ? '' : 'none';
      if (progress) progress.style.display = stage === 'confirm' ? 'none' : '';
    },

    /** says which interpreter the install will land in, since that is the thing
     *  most likely to surprise someone who already installed it elsewhere */
    _describeTarget: function () {
      var target = document.getElementById('aiInstallTarget');
      if (!target) return;

      var python = this._app ? this._app._resolvePython() : 'python';
      var shared = window.FileSystem && window.FileSystem.getAppAiPython
        ? window.FileSystem.getAppAiPython()
        : null;

      if (shared && python === shared) {
        target.textContent = "the AMVerge desktop app's AI environment (shared)";
      } else if (this._app && this._app.settings && this._app.settings.pythonPath) {
        target.textContent = python;
      } else {
        target.textContent = python + ' (from PATH)';
      }
    },

    install: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) {
        this._fail('Node child_process is unavailable, so the install cannot run.');
        return;
      }

      var python = this._app ? this._app._resolvePython() : 'python';
      this._setStage('installing');
      this._setMessage('Starting install...');
      this._setIndeterminate(true);

      this._ensurePip(python, function (ok, detail) {
        if (!ok) {
          s._fail('Could not set up pip in ' + python + '. ' + detail);
          return;
        }
        s._installPack(python);
      });
    },

    /** make sure `python` can run pip, bootstrapping it when it cannot.
     *
     * The desktop app provisions its AI environment with uv, and a uv venv
     * ships no pip at all, so pointing pip at the shared environment fails with
     * "No module named pip" before anything is downloaded. ensurepip is in the
     * standard library and installs pip into that same venv, which leaves uv's
     * own view of the environment untouched.
     */
    _ensurePip: function (python, callback) {
      var s = this;
      this._run(python, ['-m', 'pip', '--version'], null, function (code) {
        if (code === 0) {
          callback(true);
          return;
        }
        s._setMessage('Setting up pip...');
        s._run(python, ['-m', 'ensurepip', '--upgrade'], null, function (code2, lastLine) {
          callback(code2 === 0, lastLine);
        });
      });
    },

    _installPack: function (python) {
      var s = this;
      this._setMessage('Downloading TransNetV2 and PyTorch...');

      // named directly rather than as `amverge[ml]`, because that resolves the
      // published wheel from PyPI and would install over a local editable
      // checkout.
      //
      // deliberately not --upgrade: the app may already have laid down a CUDA
      // build of torch from its own index, and upgrading would pull the CPU
      // wheel from PyPI over the top of it and break the app's GPU detection
      var args = ['-m', 'pip', 'install', '--disable-pip-version-check',
                  TARGET_MODULE, 'torch'];

      this._run(python, args, function (line) { s._setMessage(line); }, function (code, lastLine) {
        s._setIndeterminate(false);
        if (code === 0) {
          s._setMessage('Installed. AI Scene Detection is ready.');
          s._setDone();
          if (window.showToast) window.showToast('TransNetV2 installed', 'success');
        } else {
          s._fail('pip exited with code ' + code + '. ' + lastLine);
        }
      });
    },

    /** run `python args`, reporting the last line it printed.
     *
     * `onLine` is optional and gets every non-empty line: pip has no
     * machine-readable progress, so its latest line is the most honest thing to
     * show rather than a fabricated percentage.
     */
    _run: function (python, args, onLine, onClose) {
      var s = this;
      var lastLine = '';
      var proc;

      try {
        proc = window.FileSystem.childProcess.spawn(python, args, { windowsHide: true });
      } catch (e) {
        onClose(-1, 'Could not start ' + python + ': ' + e.message);
        return;
      }
      this._proc = proc;

      var onData = function (buf) {
        var lines = String(buf).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          lastLine = line;
          if (onLine) onLine(line);
        }
      };

      if (proc.stdout) proc.stdout.on('data', onData);
      if (proc.stderr) proc.stderr.on('data', onData);

      var settled = false;
      proc.on('close', function (code) {
        if (settled) return;
        settled = true;
        s._proc = null;
        onClose(code, lastLine);
      });

      // an 'error' event with no listener throws, and the modal would then sit
      // on its progress bar with nothing to explain why
      proc.on('error', function (err) {
        if (settled) return;
        settled = true;
        s._proc = null;
        onClose(-1, python + ' failed to run: ' + err.message);
      });
    },

    cancel: function () {
      if (this._proc) {
        try { this._proc.kill(); } catch (e) { /* already gone */ }
        this._proc = null;
      }
      this.close();
    },

    _setMessage: function (text) {
      var el = document.getElementById('aiInstallMessage');
      if (el) el.textContent = text;
    },

    _setIndeterminate: function (on) {
      var fill = document.getElementById('aiInstallFill');
      if (!fill) return;
      fill.classList.toggle('aid-fill-indeterminate', !!on);
      fill.style.width = on ? '100%' : '100%';
    },

    _setDone: function () {
      var errors = document.getElementById('aiInstallErrors');
      if (errors) errors.style.display = 'none';
      var btn = document.getElementById('aiInstallCloseBtn');
      if (btn) btn.textContent = 'Done';
    },

    _fail: function (message) {
      this._setStage('installing');
      this._setIndeterminate(false);
      this._setMessage('');
      var errors = document.getElementById('aiInstallErrors');
      if (errors) {
        errors.style.display = '';
        errors.textContent = message;
      }
      var btn = document.getElementById('aiInstallCloseBtn');
      if (btn) btn.textContent = 'Close';
    }
  };

  window.AiInstallModal = AiInstallModal;
})();
