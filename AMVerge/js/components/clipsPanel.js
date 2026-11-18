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
      this._bindScrollPerf();
    },

    _isScrolling: false,

    _bindScrollPerf: function () {
      var grid = document.getElementById('clipsGrid');
      var scroller = grid ? grid.parentElement : null;
      if (!scroller || scroller._amvScrollBound) return;
      scroller._amvScrollBound = true;
      var s = this;
      var timer = null;
      scroller.addEventListener('scroll', function () {
        s._isScrolling = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          s._isScrolling = false;
        }, 120);
      }, { passive: true });
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
      this._renderCount();
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

    _releaseVideos: function (root) {
      this._stopSharedHover();
      if (!root) return;
      var videos = root.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) {
        try {
          videos[i].pause();
          videos[i].removeAttribute('src');
          videos[i].load();
        } catch (e) {}
      }
    },

    _hoverVid: null,
    _hoverRvfc: null,
    _hoverOwner: null,

    _getHoverVideo: function () {
      if (this._hoverVid) return this._hoverVid;
      var v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
      document.body.appendChild(v);
      this._hoverVid = v;
      return v;
    },

    _stopSharedHover: function (owner) {
      if (owner && this._hoverOwner && this._hoverOwner !== owner) return;
      var v = this._hoverVid;
      if (v) {
        if (this._hoverRvfc !== null && typeof v.cancelVideoFrameCallback === 'function') {
          try { v.cancelVideoFrameCallback(this._hoverRvfc); } catch (e) {}
        }
        this._hoverRvfc = null;
        try { v.pause(); } catch (e) {}
      }
      if (this._hoverOwner && this._hoverOwner.canvas) {
        var c = this._hoverOwner.canvas;
        if (c.parentNode) c.parentNode.removeChild(c);
        this._hoverOwner.canvas = null;
      }
      this._hoverOwner = null;
    },

    render: function () {
      var grid = document.getElementById('clipsGrid');
      if (!grid) return;
      this._bindScrollPerf();
      this._releaseVideos(grid);
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
        wrapper.className = 'clip-wrapper';
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

        var clipPath = s.clip_path || s.path || '';
        var isPendingReencode = !clipPath && !s.source_range;
        if (isPendingReencode) {
          wrapper.classList.add('is-pending-reencode');
          wrapper.title = 'Waiting to re-encode';
        }

        var overlay = document.createElement('div');
        overlay.className = 'clip-overlay';
        overlay.innerHTML =
          '<span class="clip-time">' + this._formatTime(s.start_sec || s.start || 0) + ' - ' + this._formatTime(s.end_sec || s.end || 0) + '</span>';

        var sel = document.createElement('div');
        sel.className = 'clip-selection';

        wrapper.appendChild(img);
        if (isPendingReencode) {
          var badge = document.createElement('div');
          badge.className = 'clip-pending-badge';
          badge.innerHTML = '<span class="clip-pending-spinner"></span><span>Re-encode</span>';
          wrapper.appendChild(badge);
        }
        wrapper.appendChild(overlay);
        wrapper.appendChild(sel);

        (function (w, idx, initialClipP, sel, overlayEl) {
          var clipP = initialClipP;
          var hoverTimer = null;
          var hovering = false;
          var ownerState = { canvas: null };

          w._updateClipInPlace = function (newPath) {
            clipP = newPath || clipP;
            w.classList.remove('is-pending-reencode');
            w.removeAttribute('title');
            var b = w.querySelector('.clip-pending-badge');
            if (b && b.parentNode) b.parentNode.removeChild(b);
          };

          var cancelHover = function () {
            hovering = false;
            if (hoverTimer) {
              clearTimeout(hoverTimer);
              hoverTimer = null;
            }
            ClipsPanel._stopSharedHover(ownerState);
          };

          var startPlaying = function (playable) {
            if (!hovering || ClipsPanel._isScrolling || idx === ClipsPanel._focusedIdx) return;
            ClipsPanel._stopSharedHover();
            var canvas = document.createElement('canvas');
            canvas.className = 'clip-hover-video';
            canvas.style.display = 'block';
            w.insertBefore(canvas, overlayEl);
            ownerState.canvas = canvas;
            ClipsPanel._hoverOwner = ownerState;

            var ctx = canvas.getContext('2d');
            var v = ClipsPanel._getHoverVideo();
            var rate = (ClipsPanel.app && ClipsPanel.app.settings && ClipsPanel.app.settings.gridPreviewSpeed) || 1;
            v.playbackRate = rate;

            var draw = function () {
              if (ClipsPanel._hoverOwner !== ownerState || !ownerState.canvas) return;
              if (v.readyState >= 2 && v.videoWidth && v.videoHeight) {
                var cw = canvas.clientWidth || 160;
                var ch = canvas.clientHeight || 90;
                if (canvas.width !== cw || canvas.height !== ch) {
                  canvas.width = cw;
                  canvas.height = ch;
                }
                try { ctx.drawImage(v, 0, 0, cw, ch); } catch (e) {}
              }
              if (!v.paused && !v.ended && typeof v.requestVideoFrameCallback === 'function') {
                ClipsPanel._hoverRvfc = v.requestVideoFrameCallback(draw);
              }
            };

            var nextSrc = 'file:///' + encodeURI(playable.replace(/\\/g, '/'));
            if (v.getAttribute('src') !== nextSrc) {
              v.src = nextSrc;
            } else {
              try { v.currentTime = 0; } catch (e) {}
            }
            if (typeof v.requestVideoFrameCallback === 'function') {
              ClipsPanel._hoverRvfc = v.requestVideoFrameCallback(draw);
            }
            var playPromise = v.play();
            if (playPromise && playPromise.catch) {
              playPromise.catch(function () {});
            }
          };

          w.addEventListener('mouseenter', function () {
            if (!clipP || ClipsPanel._isScrolling || idx === ClipsPanel._focusedIdx) return;
            hovering = true;
            hoverTimer = setTimeout(function () {
              if (!hovering || ClipsPanel._isScrolling || idx === ClipsPanel._focusedIdx) return;
              var ready = window.PreviewProxy.cached(clipP);
              if (ready) startPlaying(ready);
              else window.PreviewProxy.request(clipP, startPlaying);
            }, 220);
          });

          w.addEventListener('mouseleave', function () {
            cancelHover();
          });

          // same controls as the app: click focuses, dblclick/ctrl ticks, shift ranges
          w.addEventListener('click', function (e) {
            cancelHover();
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
            cancelHover();
            ClipsPanel.toggleSelect(idx);
          });
        })(wrapper, idx, clipPath, sel, overlay);

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
        this._releaseVideos(old);
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
        if (clipMode) s.clip_mode = clipMode;
        if (window.PreviewProxy && window.PreviewProxy.refresh) {
          window.PreviewProxy.refresh([s], this.app);
        }
        var grid = document.getElementById('clipsGrid');
        var existing = grid ? grid.querySelector('.clip-wrapper[data-index="' + idx + '"]') : null;
        if (existing && existing._updateClipInPlace) {
          existing._updateClipInPlace(clipPath);
        } else {
          this._refreshTile(idx);
        }
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
      // If the image already decoded cleanly, do not force a reload flash
      if (img.complete && img.naturalWidth > 0 && img.style.display !== 'none') return;
      var nextUrl = img.getAttribute('src').split('?')[0] + '?t=' + Date.now();
      var pre = new Image();
      pre.onload = function () {
        img.src = nextUrl;
        img.style.display = '';
      };
      pre.src = nextUrl;
    },

    /** fold the final scene list in, keeping selection and focus the user may already have set */
    mergeScenes: function (scenes) {
      var byIdx = {};
      for (var i = 0; i < scenes.length; i++) {
        var sc = scenes[i];
        byIdx[sc.scene_index !== undefined ? sc.scene_index : i] = sc;
      }

      var grid = document.getElementById('clipsGrid');
      for (var j = 0; j < this._scenes.length; j++) {
        var mine = this._scenes[j];
        var idx = mine.scene_index !== undefined ? mine.scene_index : j;
        var theirs = byIdx[idx];
        if (!theirs) continue;

        var clip = theirs.clip_path || theirs.path || '';
        if (clip && clip !== mine.clip_path) {
          mine.clip_path = clip;
          mine.path = clip;
          var existing = grid ? grid.querySelector('.clip-wrapper[data-index="' + idx + '"]') : null;
          if (existing && existing._updateClipInPlace) {
            existing._updateClipInPlace(clip);
          } else {
            this._refreshTile(idx);
          }
        }
        if (theirs.thumbnail && theirs.thumbnail !== mine.thumbnail) {
          mine.thumbnail = theirs.thumbnail;
          this.markThumbnail(idx);
        }
      }

      if (window.PreviewProxy) {
        if (window.PreviewProxy.refresh) window.PreviewProxy.refresh(this._scenes, this.app);
        else window.PreviewProxy.reset(this._scenes, this.app);
      }
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
      var prev = document.querySelectorAll('.clip-wrapper.focused');
      for (var i = 0; i < prev.length; i++) {
        if (parseInt(prev[i].dataset.index, 10) !== this._focusedIdx) {
          prev[i].classList.remove('focused');
        }
      }
      if (this._focusedIdx !== null && this._focusedIdx !== undefined) {
        var next = document.querySelector('.clip-wrapper[data-index="' + this._focusedIdx + '"]');
        if (next && !next.classList.contains('focused')) {
          next.classList.add('focused');
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
      this._renderCount();
    },

    /** "n / total selected" in the middle of the scenes header */
    _renderCount: function () {
      var el = document.getElementById('sceneCount');
      if (el) el.textContent = Object.keys(this._selected).length + ' / ' + this._scenes.length + ' selected';
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
