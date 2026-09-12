(function () {
  var ClipsPanel = {
    _scenes: [],
    _selected: {},
    _focusedIdx: null,
    // where a shift-range starts from: the last plain click or tick
    _anchorIdx: null,
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
      this._focusedIdx = null;
      this._anchorIdx = null;
      // every route into an episode lands here, closing one included, so this
      // is where the proxy cache follows what the grid is actually showing
      if (window.PreviewProxy) window.PreviewProxy.reset(scenes, this.app);
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

      for (var i = 0; i < this._scenes.length; i++) {
        grid.appendChild(this._buildTile(this._scenes[i], i));
      }
    },

    /** one grid tile, built alone so a clip arriving mid-cut can replace it without a full re-render */
    _buildTile: function (s, i) {
      {
        var idx = s.scene_index !== undefined ? s.scene_index : i;

        var wrapper = document.createElement('div');
        wrapper.className = 'clip-wrapper clip-appear';
        wrapper.style.setProperty('--appear-delay', Math.min(i * 30, 600) + 'ms');
        wrapper.dataset.index = idx;

        if (idx === this._focusedIdx) {
          wrapper.classList.add('focused');
        }
        if (this._selected[idx]) {
          wrapper.classList.add('selected');
        }

        // only a real image: an <img> pointed at a .mp4 just hides itself
        var thumb = s.thumbnail || '';
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

        // Lazy hover video player. Silent on purpose: a grid of tiles that
        // each start talking when the pointer crosses them is unusable.
        var clipPath = s.clip_path || s.path || '';
        var hoverVideo = null;
        if (clipPath) {
          hoverVideo = document.createElement('video');
          hoverVideo.className = 'clip-hover-video';
          hoverVideo.muted = true;
          hoverVideo.loop = true;
          hoverVideo.playsInline = true;

          if (thumb) {
            // a still exists, so the clip is only decoded on hover
            hoverVideo.preload = 'none';
          } else {
            // no still, so the video's first frame stands in for the poster
            hoverVideo.preload = 'metadata';
            hoverVideo.style.display = 'block';
            (function (v, p) {
              window.PreviewProxy.request(p, function (playable) {
                v.src = 'file:///' + encodeURI(playable.replace(/\\/g, '/'));
              });
            })(hoverVideo, clipPath);
          }
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

        (function (w, idx, clipP, vidEl, thumb, sel) {
          var hoverTimer = null;
          var hovering = false;

          var startPlaying = function (playable) {
            // the pointer can leave while a proxy is still building, and a tile
            // that starts playing after that looks like it picked itself
            if (!hovering) return;
            if (!vidEl.src) {
              vidEl.src = 'file:///' + encodeURI(playable.replace(/\\/g, '/'));
            }
            vidEl.style.display = 'block';
            var playPromise = vidEl.play();
            if (playPromise && playPromise.catch) {
              playPromise.catch(function () {});
            }
          };

          w.addEventListener('mouseenter', function () {
            if (!vidEl || !clipP) return;
            hovering = true;
            hoverTimer = setTimeout(function () {
              // keep the still up until a proxy exists, rather than paint black
              var ready = window.PreviewProxy.cached(clipP);
              if (ready || vidEl.src) startPlaying(ready || clipP);
              else window.PreviewProxy.request(clipP, startPlaying);
            }, 120);
          });

          w.addEventListener('mouseleave', function () {
            hovering = false;
            if (hoverTimer) {
              clearTimeout(hoverTimer);
              hoverTimer = null;
            }
            if (vidEl) {
              vidEl.pause();
              // back to the first frame, which is what the tile shows at rest
              try { vidEl.currentTime = 0; } catch (e) {}
              // only hide it when a still is underneath to fall back to
              if (thumb) vidEl.style.display = 'none';
            }
          });

          // same controls as the app: click focuses, dblclick/ctrl ticks, shift ranges
          w.addEventListener('click', function (e) {
            // the corner checkbox is a direct toggle wherever it is clicked
            if (e.target === sel || sel.contains(e.target)) {
              e.stopPropagation();
              ClipsPanel.toggleSelect(idx);
              return;
            }

            if (e.shiftKey) {
              ClipsPanel._shiftSelect(idx);
              return;
            }

            if (e.ctrlKey || e.metaKey) {
              ClipsPanel.toggleSelect(idx);
              return;
            }

            dbg('info', 'Clips', 'click focus idx=' + idx);
            ClipsPanel.focusScene(idx);
          });

          // double click ticks it for export without disturbing focus
          w.addEventListener('dblclick', function (e) {
            e.preventDefault();
            ClipsPanel.toggleSelect(idx);
          });
        })(wrapper, idx, clipPath, hoverVideo, thumb, sel);

        return wrapper;
      }
    },

    /** replace one tile in place, keeping the rest of the grid untouched */
    _refreshTile: function (idx) {
      var grid = document.getElementById('clipsGrid');
      if (!grid) return;

      for (var i = 0; i < this._scenes.length; i++) {
        var s = this._scenes[i];
        var sIdx = s.scene_index !== undefined ? s.scene_index : i;
        if (sIdx !== idx) continue;

        var old = grid.querySelector('.clip-wrapper[data-index="' + idx + '"]');
        if (!old) return;
        var fresh = this._buildTile(s, i);
        // the appear animation is for a grid arriving all at once. replaying it
        // on every clip that finishes cutting would make the grid twitch
        fresh.classList.remove('clip-appear');
        grid.replaceChild(fresh, old);
        return;
      }
    },

    /** a clip finished cutting: point its tile at the file that now exists */
    applyClip: function (idx, clipPath, clipMode) {
      for (var i = 0; i < this._scenes.length; i++) {
        var s = this._scenes[i];
        var sIdx = s.scene_index !== undefined ? s.scene_index : i;
        if (sIdx !== idx) continue;

        if (!clipPath) {
          dbg('warn', 'Clips', 'Scene ' + idx + ' produced no clip (' + clipMode + ')');
          return;
        }
        s.clip_path = clipPath;
        s.path = clipPath;
        this._refreshTile(idx);
        return;
      }
    },

    /** a thumbnail landed for a clip whose tile is already on screen */
    markThumbnail: function (idx) {
      var grid = document.getElementById('clipsGrid');
      if (!grid) return;
      var wrapper = grid.querySelector('.clip-wrapper[data-index="' + idx + '"]');
      if (!wrapper) return;

      var img = wrapper.querySelector('.clip-thumb');
      if (!img || !img.getAttribute('src')) return;
      // the <img> already tried this path and failed while the file did not
      // exist, so it needs a URL the cache has not seen to try again
      img.style.display = '';
      img.src = img.getAttribute('src').split('?')[0] + '?t=' + Date.now();
    },

    /** fold the final scene list in, keeping selection and focus the user may already have set */
    mergeScenes: function (scenes) {
      var byIdx = {};
      for (var i = 0; i < scenes.length; i++) {
        var sc = scenes[i];
        byIdx[sc.scene_index !== undefined ? sc.scene_index : i] = sc;
      }

      for (var j = 0; j < this._scenes.length; j++) {
        var mine = this._scenes[j];
        var idx = mine.scene_index !== undefined ? mine.scene_index : j;
        var theirs = byIdx[idx];
        if (!theirs) continue;

        var clip = theirs.clip_path || theirs.path || '';
        var changed = false;
        if (clip && clip !== mine.clip_path) {
          mine.clip_path = clip;
          mine.path = clip;
          changed = true;
        }
        if (theirs.thumbnail && theirs.thumbnail !== mine.thumbnail) {
          mine.thumbnail = theirs.thumbnail;
          changed = true;
        }
        if (changed) this._refreshTile(idx);
      }

      if (window.PreviewProxy) window.PreviewProxy.reset(this._scenes, this.app);
    },

    /** focus a clip: what you are looking at, as opposed to what gets exported */
    focusScene: function (idx) {
      this._focusedIdx = parseInt(idx, 10);
      // a plain click is where the next shift-range starts from
      this._anchorIdx = this._focusedIdx;
      this._updateFocusUI();
      if (!this.app) {
        dbg('error', 'Clips', 'no app reference, cannot open preview');
        return;
      }
      this.app.selectScene(this._focusedIdx);
    },

    /** kept for callers that predate the focus split */
    selectScene: function (idx) {
      this.focusScene(idx);
    },

    toggleSelect: function (idx) {
      idx = parseInt(idx, 10);
      if (this._selected[idx]) {
        delete this._selected[idx];
      } else {
        this._selected[idx] = true;
      }
      // ticking a clip moves the anchor too, as ctrl-clicking does elsewhere
      this._anchorIdx = idx;
      this._updateSelectionUI();
      this._notify();
    },

    /** shift-click: range from the anchor to here.
     *
     * The anchor outlives the range, so shift-clicking again re-ranges from the
     * same start. That is what makes a range extendable and shrinkable: before,
     * the range cleared the anchor, so the second shift-click anchored on itself
     * and selected that one clip.
     */
    _shiftSelect: function (idx) {
      var anchor = this._anchorIdx;
      if (anchor === null || anchor === undefined) {
        anchor = this._focusedIdx !== null ? this._focusedIdx : idx;
      }
      this._rangeSelect(anchor, idx);
    },

    _rangeSelect: function (fromIdx, toIdx) {
      var scenes = this._scenes;
      var indices = [];
      for (var i = 0; i < scenes.length; i++) {
        var idx = scenes[i].scene_index !== undefined ? scenes[i].scene_index : i;
        indices.push(idx);
      }
      var fromPos = indices.indexOf(fromIdx);
      var toPos = indices.indexOf(toIdx);
      if (fromPos === -1 || toPos === -1) return;

      // the range replaces the selection, but the anchor stays put so the next
      // shift-click can redraw it from the same end
      this._selected = {};
      this._anchorIdx = fromIdx;
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
      this._focusedIdx = null;
      this._anchorIdx = null;
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

    _updateFocusUI: function () {
      var items = document.querySelectorAll('.clip-wrapper');
      for (var i = 0; i < items.length; i++) {
        var idx = parseInt(items[i].dataset.index, 10);
        if (idx === this._focusedIdx) {
          items[i].classList.add('focused');
        } else {
          items[i].classList.remove('focused');
        }
      }
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
