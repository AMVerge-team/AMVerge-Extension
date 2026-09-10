(function () {
  var PreviewPanel = {
    _currentScene: null,

    init: function (app) {
      this.app = app;
      this.video = document.getElementById('previewVideo');
      if (window.VideoPlayer) window.VideoPlayer.init();
      this.empty = document.getElementById('previewEmpty');
      this.window = document.getElementById('previewWindow');
      this.info = document.getElementById('sceneInfo');
      this.infoIndex = document.getElementById('sceneInfoIndex');
      this.infoDuration = document.getElementById('sceneInfoDuration');
      this.infoTime = document.getElementById('sceneInfoTime');
      this.importBtn = document.getElementById('importToAeBtn');
      this.selectedInfo = document.getElementById('selectedInfo');
      this.prevBtn = document.getElementById('previewPrevBtn');
      this.nextBtn = document.getElementById('previewNextBtn');
      this.navLabel = document.getElementById('previewNavLabel');
    },

    showScene: function (scene) {
      this._currentScene = scene;
      this.empty.style.display = 'none';

      // the cut clip the pipeline produced. `collect_scenes` names these
      // optimistically, so a scene can carry a path for a file ffmpeg never
      // actually wrote; when that happens fall back to the source video seeked
      // to the scene's range rather than showing a blank player
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

      if (clipPath) {
        var self = this;

        var play = function (finalPath) {
          // a later click can land while the proxy is still building, so the
          // result is dropped unless this is still the scene on screen
          if (self._currentScene !== scene) return;
          var fileUrl = 'file:///' + encodeURI(finalPath.replace(/\\/g, '/'));
          dbg('info', 'Preview', 'Loading ' + fileUrl +
              (range ? ' @ ' + range.start + '-' + range.end : ''));
          window.VideoPlayer.setBusy(false);
          window.VideoPlayer.load(fileUrl, range);
        };

        this.empty.style.display = 'none';

        // usually already built, in which case this plays without a spinner.
        // the spinner is only for the clip that outruns the background queue
        var ready = window.PreviewProxy ? window.PreviewProxy.cached(clipPath) : clipPath;
        if (ready) {
          play(ready);
        } else {
          window.VideoPlayer.setBusy(true);
          window.PreviewProxy.request(clipPath, play, true);
        }
      } else {
        dbg('warn', 'Preview', 'No playable source for this scene');
        window.VideoPlayer.clear();
        this.empty.style.display = '';
      }

      this.info.style.display = '';
      this.infoIndex.textContent = '#' + ((scene.scene_index !== undefined ? scene.scene_index : 0) + 1);
      var dur = scene.duration_sec || scene.duration || (scene.end_sec - scene.start_sec) || 0;
      this.infoDuration.textContent = this._fmt(dur);
      this.infoTime.textContent = this._fmt(scene.start_sec || scene.start || 0) + ' - ' + this._fmt(scene.end_sec || scene.end || 0);

      this._updateNavButtons();
    },

    clearPreview: function () {
      this._currentScene = null;
      this.empty.style.display = '';
      window.VideoPlayer.clear();
      this.info.style.display = 'none';
      this._updateNavButtons();
    },

    navigatePrev: function () {
      if (!this._currentScene || !this.app._currentScenes) return;
      var scenes = this.app._currentScenes;
      if (scenes.length === 0) return;
      var curIdx = this._currentScene.scene_index !== undefined ? this._currentScene.scene_index : 0;
      var newIdx = Math.max(0, curIdx - 1);
      var scene = null;
      for (var i = 0; i < scenes.length; i++) {
        var sidx = scenes[i].scene_index !== undefined ? scenes[i].scene_index : i;
        if (sidx === newIdx) { scene = scenes[i]; break; }
      }
      if (scene) {
        this.showScene(scene);
        if (window.ClipsPanel) {
          window.ClipsPanel.selectScene(newIdx);
        }
      }
    },

    navigateNext: function () {
      if (!this._currentScene || !this.app._currentScenes) return;
      var scenes = this.app._currentScenes;
      if (scenes.length === 0) return;
      var curIdx = this._currentScene.scene_index !== undefined ? this._currentScene.scene_index : 0;
      var newIdx = Math.min(scenes.length - 1, curIdx + 1);
      var scene = null;
      for (var i = 0; i < scenes.length; i++) {
        var sidx = scenes[i].scene_index !== undefined ? scenes[i].scene_index : i;
        if (sidx === newIdx) { scene = scenes[i]; break; }
      }
      if (scene) {
        this.showScene(scene);
        if (window.ClipsPanel) {
          window.ClipsPanel.selectScene(newIdx);
        }
      }
    },

    _updateNavButtons: function () {
      if (!this._currentScene || !this.app._currentScenes || this.app._currentScenes.length === 0) {
        if (this.prevBtn) this.prevBtn.disabled = true;
        if (this.nextBtn) this.nextBtn.disabled = true;
        if (this.navLabel) this.navLabel.textContent = '-';
        return;
      }
      var scenes = this.app._currentScenes;
      var curIdx = this._currentScene.scene_index !== undefined ? this._currentScene.scene_index : 0;
      if (this.prevBtn) this.prevBtn.disabled = curIdx <= 0;
      if (this.nextBtn) this.nextBtn.disabled = curIdx >= scenes.length - 1;
      if (this.navLabel) this.navLabel.textContent = (curIdx + 1) + ' / ' + scenes.length;
    },

    updateImportBtn: function (count) {
      this.importBtn.disabled = count === 0;
      if (count > 0) {
        this.importBtn.innerHTML = '<svg class="icon"><use href="#icon-import"/></svg> Import ' + count + ' Scene' + (count !== 1 ? 's' : '') + ' to AE';
        this.selectedInfo.textContent = count + ' scene' + (count !== 1 ? 's' : '') + ' selected';
        this.selectedInfo.classList.add('has-selection');
      } else {
        this.importBtn.innerHTML = '<svg class="icon"><use href="#icon-import"/></svg> Import Selected to AE';
        this.selectedInfo.textContent = '0 scenes selected';
        this.selectedInfo.classList.remove('has-selection');
      }
    },

    _fmt: function (sec) {
      if (sec === undefined || sec === null) return '0:00';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
  };

  window.PreviewPanel = PreviewPanel;
})();
