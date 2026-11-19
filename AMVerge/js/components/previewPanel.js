(function () {
  var PreviewPanel = {
    _currentScene: null,
    _busyTimer: null,

    init: function (app) {
      this.app = app;
      this.video = document.getElementById('previewVideo');
      if (window.VideoPlayer) window.VideoPlayer.init();
      this.empty = document.getElementById('previewEmpty');
      this.window = document.getElementById('previewWindow');
      this.importBtn = document.getElementById('importToAeBtn');
    },

    showScene: function (scene) {
      this._currentScene = scene;
      this.empty.style.display = 'none';

      // clips are named optimistically, so fall back to the seeked source
      var clipPath = scene.clip_path || scene.path || '';
      var range = null;

      var missing = clipPath && window.FileSystem && window.FileSystem.fileExists &&
                    !window.FileSystem.fileExists(clipPath);
      if (missing) dbg('warn', 'Preview', 'Clip not on disk: ' + clipPath);

      if ((!clipPath || missing) && this.app && this.app._currentVideo) {
        clipPath = this.app._currentVideo;
        range = {
          start: scene.start_sec || scene.start || 0,
          end: scene.end_sec || scene.end || 0
        };
      } else if (missing) {
        clipPath = '';
      }

      if (this._busyTimer !== null) {
        clearTimeout(this._busyTimer);
        this._busyTimer = null;
      }

      if (clipPath) {
        var self = this;

        var play = function (finalPath) {
          // a later click can land while the proxy is still building, so the
          // result is dropped unless this is still the scene on screen
          if (self._currentScene !== scene) return;
          if (self._busyTimer !== null) {
            clearTimeout(self._busyTimer);
            self._busyTimer = null;
          }
          var fileUrl = window.FileSystem.fileUrl(finalPath);
          dbg('info', 'Preview', 'Loading ' + fileUrl +
              (range ? ' @ ' + range.start + '-' + range.end : ''));
          window.VideoPlayer.setBusy(false);
          window.VideoPlayer.load(fileUrl, range);
        };

        this.empty.style.display = 'none';

        // usually already built, in which case this plays without a spinner.
        // debounce the busy overlay by 180ms so fast probes don't flash it
        var ready = window.PreviewProxy ? window.PreviewProxy.cached(clipPath) : clipPath;
        if (ready) {
          play(ready);
        } else {
          this._busyTimer = setTimeout(function () {
            self._busyTimer = null;
            if (self._currentScene === scene) {
              window.VideoPlayer.setBusy(true);
            }
          }, 180);
          window.PreviewProxy.request(clipPath, play, true);
        }
      } else {
        dbg('warn', 'Preview', 'No playable source for this scene');
        window.VideoPlayer.clear();
        this.empty.style.display = '';
      }
    },

    clearPreview: function () {
      this._currentScene = null;
      this.empty.style.display = '';
      window.VideoPlayer.clear();
    },

    updateImportBtn: function (count) {
      this.importBtn.disabled = count === 0;
      if (count > 0) {
        this.importBtn.innerHTML = '<svg class="icon"><use href="#icon-import"/></svg> Import ' + count + ' Scene' + (count !== 1 ? 's' : '') + ' to AE';
      } else {
        this.importBtn.innerHTML = '<svg class="icon"><use href="#icon-import"/></svg> Import Selected to AE';
      }
    }
  };

  window.PreviewPanel = PreviewPanel;
})();
