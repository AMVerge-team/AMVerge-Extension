(function () {
  var ClipsPanel = {
    _scenes: [],
    _selected: {},
    _lastClickedIdx: null,
    _listeners: [],

    init: function (app) {
      this.app = app;
    },

    onSelectionChange: function (cb) {
      this._listeners.push(cb);
    },

    _notify: function () {
      var count = Object.keys(this._selected).length;
      for (var i = 0; i < this._listeners.length; i++) {
        this._listeners[i](count, this._selected);
      }
    },

    loadScenes: function (scenes) {
      this._scenes = scenes;
      this._selected = {};
      this._lastClickedIdx = null;
      this.render();
      document.getElementById('sceneCount').textContent = scenes.length;
    },

    _density: 'normal',

    setDensity: function (density) {
      this._density = density;
      var grid = document.getElementById('clipsGrid');
      if (!grid) return;
      grid.classList.remove('density-compact', 'density-normal', 'density-large');
      grid.classList.add('density-' + density);
      var btns = document.querySelectorAll('.density-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].dataset.density === density);
      }
    },

    render: function () {
      var grid = document.getElementById('clipsGrid');
      if (!grid) return;
      grid.innerHTML = '';
      grid.className = 'clips-grid density-' + this._density;

      var scenes = this._scenes;
      for (var i = 0; i < scenes.length; i++) {
        var s = scenes[i];
        var idx = s.scene_index !== undefined ? s.scene_index : i;

        var wrapper = document.createElement('div');
        wrapper.className = 'clip-wrapper clip-appear';
        wrapper.style.setProperty('--appear-delay', Math.min(i * 30, 600) + 'ms');
        wrapper.dataset.index = idx;

        if (s.clip_path) wrapper.classList.add('cut-ready');
        if (this._selected[idx]) {
          wrapper.classList.add('selected');
        }

        var thumb = s.thumbnail || s.path || '';
        var img = document.createElement('img');
        img.className = 'clip-thumb';
        img.draggable = false;
        if (thumb) {
          img.src = 'file:///' + encodeURI(thumb.replace(/\\/g, '/'));
          img.onerror = function () {
            this.style.display = 'none';
          };
        } else {
          img.style.display = 'none';
        }

        // Lazy hover video player
        var clipPath = s.clip_path || s.path || '';
        var hoverVideo = null;
        if (clipPath) {
          hoverVideo = document.createElement('video');
          hoverVideo.className = 'clip-hover-video';
          hoverVideo.muted = true;
          hoverVideo.loop = true;
          hoverVideo.playsInline = true;
          hoverVideo.preload = 'none';
        }

        var overlay = document.createElement('div');
        overlay.className = 'clip-overlay';
        overlay.innerHTML =
          '<span class="clip-index">#' + (i + 1) + '</span>' +
          '<span class="clip-time">' + this._formatTime(s.start_sec || s.start || 0) + ' - ' + this._formatTime(s.end_sec || s.end || 0) + '</span>';

        var sel = document.createElement('div');
        sel.className = 'clip-selection';

        wrapper.appendChild(img);
        if (hoverVideo) wrapper.appendChild(hoverVideo);
        wrapper.appendChild(overlay);
        wrapper.appendChild(sel);

        (function (w, idx, clipP, vidEl) {
          var hoverTimer = null;
          w.addEventListener('mouseenter', function () {
            if (!vidEl || !clipP) return;
            hoverTimer = setTimeout(function () {
              if (!vidEl.src) {
                vidEl.src = 'file:///' + encodeURI(clipP.replace(/\\/g, '/'));
              }
              vidEl.style.display = 'block';
              var playPromise = vidEl.play();
              if (playPromise && playPromise.catch) {
                playPromise.catch(function () {});
              }
            }, 120);
          });

          w.addEventListener('mouseleave', function () {
            if (hoverTimer) {
              clearTimeout(hoverTimer);
              hoverTimer = null;
            }
            if (vidEl) {
              vidEl.pause();
              vidEl.currentTime = 0;
              vidEl.style.display = 'none';
            }
          });

          w.addEventListener('click', function (e) {
            if (e.shiftKey && ClipsPanel._lastClickedIdx !== null) {
              ClipsPanel._rangeSelect(ClipsPanel._lastClickedIdx, idx);
              return;
            }
            ClipsPanel._lastClickedIdx = idx;

            if (e.target === sel || sel.contains(e.target)) {
              ClipsPanel.toggleSelect(idx);
            } else {
              if (!e.shiftKey && !e.ctrlKey) {
                ClipsPanel.selectScene(idx);
              }
            }
          });
        })(wrapper, idx, clipPath, hoverVideo);

        grid.appendChild(wrapper);
      }
    },

    selectScene: function (idx) {
      if (this.app) this.app.selectScene(parseInt(idx, 10));
    },

    toggleSelect: function (idx) {
      idx = parseInt(idx, 10);
      if (this._selected[idx]) {
        delete this._selected[idx];
      } else {
        this._selected[idx] = true;
      }
      this._updateSelectionUI();
      this._notify();
    },

    _rangeSelect: function (fromIdx, toIdx) {
      var s = this;
      var scenes = this._scenes;
      var indices = [];
      for (var i = 0; i < scenes.length; i++) {
        var idx = scenes[i].scene_index !== undefined ? scenes[i].scene_index : i;
        indices.push(idx);
      }
      var fromPos = indices.indexOf(fromIdx);
      var toPos = indices.indexOf(toIdx);
      if (fromPos === -1 || toPos === -1) return;

      var start = Math.min(fromPos, toPos);
      var end = Math.max(fromPos, toPos);
      for (var j = start; j <= end; j++) {
        this._selected[indices[j]] = true;
      }
      this._updateSelectionUI();
      this._notify();
    },

    selectAll: function () {
      for (var i = 0; i < this._scenes.length; i++) {
        var idx = this._scenes[i].scene_index !== undefined ? this._scenes[i].scene_index : i;
        this._selected[idx] = true;
      }
      this._updateSelectionUI();
      this._notify();
    },

    deselectAll: function () {
      this._selected = {};
      this._updateSelectionUI();
      this._notify();
    },

    getSelectedScenes: function () {
      var s = this;
      return this._scenes.filter(function (sc) {
        var idx = sc.scene_index !== undefined ? sc.scene_index : s._scenes.indexOf(sc);
        return s._selected[idx];
      });
    },

    getSelectedCount: function () {
      return Object.keys(this._selected).length;
    },

    _updateSelectionUI: function () {
      var s = this;
      var items = document.querySelectorAll('.clip-wrapper');
      for (var i = 0; i < items.length; i++) {
        var idx = items[i].dataset.index;
        if (s._selected[idx]) {
          items[i].classList.add('selected');
        } else {
          items[i].classList.remove('selected');
        }
      }
    },

    _formatTime: function (sec) {
      if (sec === undefined || sec === null) return '0:00';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
  };

  window.ClipsPanel = ClipsPanel;
})();
