/**
 * aiInstallModal.js - offers to install TransNetV2 when the pack is missing.
 *
 * Mirrors the app's AiInstallModal.tsx and reuses its classes, but pips into
 * whichever interpreter it is pointed at. All panel-side Node, no ExtendScript.
 */
(function () {
  'use strict';

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
      this._job = null;
      overlay.style.display = '';
      this._setStage('confirm');
      this._describeTarget();
    },

    /** same dialog, driven by an explicit runtime job rather than the ml pack */
    openRuntimeJob: function (config) {
      var overlay = document.getElementById('aiInstallModal');
      if (!overlay) return;

      this._job = config;
      overlay.style.display = '';
      this._setStage('confirm');

      var title = document.getElementById('aiInstallTitle');
      if (title) title.textContent = config.title;
      var lede = document.getElementById('aiInstallLede');
      if (lede) lede.textContent = config.lede || ('Install ' + config.title + '?');
      var note = document.querySelector('#aiInstallConfirm .aid-note');
      if (note) note.textContent = config.note;
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

    /** which environment this lands in, since that is the thing most likely to
     *  surprise someone who already installed it elsewhere */
    _describeTarget: function () {
      var target = document.getElementById('aiInstallTarget');
      if (!target || !window.AmvergeRuntime) return;

      var dir = window.AmvergeRuntime.runtimeDir();
      var existing = window.FileSystem && window.FileSystem.getAppAiPython
        ? window.FileSystem.getAppAiPython()
        : null;
      target.textContent = existing
        ? 'the shared AMVerge runtime (' + dir + ')'
        : 'a new shared AMVerge runtime (' + dir + ')';
    },

    install: function () {
      var s = this;
      if (!window.FileSystem || !window.FileSystem.childProcess) {
        this._fail('Node child_process is unavailable, so the install cannot run.');
        return;
      }

      this._setStage('installing');
      this._setMessage('Starting install...');
      this._setIndeterminate(true);

      // everything goes through the shared runtime, so an install here is the
      // same environment the desktop app would build, and either product can
      // be the one that creates it
      var job = this._job ? this._job.job : { extras: ['ml'], gpu: true, gpuDecode: false };
      var onFinished = this._job && this._job.onFinished;

      window.AmvergeRuntime.install(job, {
        onStage: function (text) { s._setMessage(text); },
        onLine: function (text) { s._setMessage(text); },
        onDone: function (ok, detail) {
          s._setIndeterminate(false);
          if (!ok) {
            s._fail(detail || 'The install did not complete.');
            return;
          }
          s._setMessage('Installed.');
          s._setDone();
          if (window.showToast) window.showToast('AI environment ready', 'success');
          if (onFinished) onFinished();
        }
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
