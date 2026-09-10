/**
 * aiInstallModal.js
 *
 * Offers to install the TransNetV2 dependency when AI Scene Detection is
 * selected but the pack is missing.
 *
 * Mirrors the desktop app's AI install dialog (`components/AiInstallModal.tsx`)
 * in both wording and structure, and reuses its `pxm-*` / `aid-*` class names so
 * the two look like one product. The difference is what runs underneath: the app
 * provisions a managed venv with uv, while the extension can only pip into
 * whichever interpreter it is pointed at.
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

      // pip is pointed at the CLI's own ml extra rather than `amverge[ml]`,
      // because the latter resolves the published wheel from PyPI and would
      // install over a local editable checkout
      var args = ['-m', 'pip', 'install', '--upgrade', TARGET_MODULE, 'torch'];

      try {
        this._proc = window.FileSystem.childProcess.spawn(python, args, { windowsHide: true });
      } catch (e) {
        this._fail('Could not start pip: ' + e.message);
        return;
      }

      var lastLine = '';
      var onData = function (buf) {
        var text = String(buf);
        var lines = text.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line) lastLine = line;
        }
        // pip has no machine-readable progress, so the latest line is the most
        // honest thing to show rather than a fabricated percentage
        if (lastLine) s._setMessage(lastLine);
      };

      if (this._proc.stdout) this._proc.stdout.on('data', onData);
      if (this._proc.stderr) this._proc.stderr.on('data', onData);

      this._proc.on('close', function (code) {
        s._proc = null;
        s._setIndeterminate(false);
        if (code === 0) {
          s._setMessage('Installed. AI Scene Detection is ready.');
          s._setDone();
          if (window.showToast) window.showToast('TransNetV2 installed', 'success');
        } else {
          s._fail('pip exited with code ' + code + '. ' + lastLine);
        }
      });

      this._proc.on('error', function (err) {
        s._proc = null;
        s._fail('pip failed to run: ' + err.message);
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
