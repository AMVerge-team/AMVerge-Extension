/**
 * Custom-skinned preview player.
 *
 * A port of the desktop app's `VideoPlayer.tsx`. It renders into the markup the
 * app's CSS already targets (.video-wrapper > .video-frame > video + .controls),
 * so the two look identical and both follow the accent colour.
 *
 * Native `controls` are deliberately not used: they paint Chromium's own white
 * pill, which ignores the theme entirely.
 */
(function () {
  var VOLUME_HIDE_DELAY_MS = 700;
  var FALLBACK_VOLUME = 0.5;

  function fmt(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function setIcon(button, iconId) {
    var use = button.querySelector('use');
    if (use) use.setAttribute('href', '#' + iconId);
  }

  var VideoPlayer = {
    _hideTimer: null,
    _dragging: false,
    _lastVolume: FALLBACK_VOLUME,
    /** false until the user unmutes; clips start silent otherwise */
    _userUnmuted: false,

    init: function () {
      this.wrapper = document.getElementById('previewPlayer');
      this.video = document.getElementById('previewVideo');
      if (!this.wrapper || !this.video) return;

      this.playBtn = document.getElementById('pvPlayBtn');
      this.timeLabel = document.getElementById('pvTime');
      this.progress = document.getElementById('pvProgress');
      this.progressBar = document.getElementById('pvProgressBar');
      this.volumeControl = document.getElementById('pvVolumeControl');
      this.muteBtn = document.getElementById('pvMuteBtn');
      this.volumeSlider = document.getElementById('pvVolume');
      this.fullscreenBtn = document.getElementById('pvFullscreenBtn');
      this.frame = this.wrapper.querySelector('.video-frame');

      this._bind();
      this._applyVolumeFill(1);
    },

    _bind: function () {
      var s = this;

      this.playBtn.addEventListener('click', function () { s.togglePlay(); });
      this.video.addEventListener('click', function () { s.togglePlay(); });

      this.video.addEventListener('play', function () { setIcon(s.playBtn, 'icon-pause'); });
      this.video.addEventListener('pause', function () { setIcon(s.playBtn, 'icon-play'); });

      this.video.addEventListener('loadedmetadata', function () {
        s._syncProgressRange();
        s._renderTime();
      });
      this.video.addEventListener('timeupdate', function () {
        // a scene is a slice of a longer video, so playback loops back to its
        // start at the end rather than running on into the next scene
        if (s._range && s._range.end && s.video.currentTime >= s._range.end) {
          try { s.video.currentTime = s._range.start || 0; } catch (e) {}
        }
        s.progressBar.value = s.video.currentTime;
        s._renderTime();
      });

      // click anywhere on the bar to seek, rather than only on the filled part
      this.progress.addEventListener('click', function (e) {
        var duration = s.video.duration;
        if (!isFinite(duration) || duration <= 0) return;
        var rect = e.currentTarget.getBoundingClientRect();
        var fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        var from = s._range ? (s._range.start || 0) : 0;
        var to = s._range ? (s._range.end || duration) : duration;
        s.video.currentTime = from + fraction * (to - from);
      });

      this.muteBtn.addEventListener('click', function () { s.toggleMute(); });

      this.volumeSlider.addEventListener('input', function (e) {
        s.setVolume(parseFloat(e.target.value));
      });
      this.volumeSlider.addEventListener('pointerdown', function () {
        s._dragging = true;
        s._cancelHide();
      });
      document.addEventListener('pointerup', function () {
        if (!s._dragging) return;
        s._dragging = false;
        s._scheduleHide();
      });

      this.volumeControl.addEventListener('mouseenter', function () { s._showVolume(); });
      this.volumeControl.addEventListener('mouseleave', function () { s._scheduleHide(); });

      this.fullscreenBtn.addEventListener('click', function () { s.toggleFullscreen(); });

      this.video.addEventListener('volumechange', function () {
        s._syncMuteIcon();
      });

      // without this a codec the CEP Chromium cannot decode just shows nothing
      this.video.addEventListener('error', function () {
        var err = s.video.error;
        var code = err ? err.code : '?';
        dbg('error', 'VideoPlayer', 'Cannot play source (code ' + code + '): ' + s.video.currentSrc);
      });
    },

    /** point the player at a file and start it.
     *
     * `range` is an optional `{ start, end }` in seconds. Scene detection finds
     * boundaries without cutting any files, so a scene is a time range inside
     * the source video rather than a clip of its own. Given a range, the player
     * seeks to `start` and loops back there at `end`, which is how the desktop
     * app previews an uncut scene too.
     */
    load: function (fileUrl, range) {
      if (!this.wrapper || !this.video) {
        dbg('error', 'VideoPlayer', 'Player not initialised, markup missing');
        return;
      }
      this._range = range || null;

      this.wrapper.style.display = '';
      // reloading the same source would otherwise restart it needlessly when
      // stepping between two scenes of one episode
      if (this.video.getAttribute('src') !== fileUrl) {
        this.video.src = fileUrl;
        this.video.load();
      }

      // muted by default: clips are skimmed rapidly and a scene bursting into
      // sound on every click is worse than having to ask for it. unmuting
      // sticks for the session, so it is a one-time choice rather than per clip
      this.video.muted = this._userUnmuted !== true;
      this.video.volume = this._lastVolume;
      this._applyVolumeFill(this._lastVolume);
      this._syncMuteIcon();
      this._syncProgressRange();
      this._seekToRangeStart();

      var playing = this.video.play();
      if (playing && playing['catch']) playing['catch'](function () {});

      // measured after a frame so layout has settled. a zero height here means
      // the file loaded fine and is simply being drawn at no size, which looks
      // identical to "nothing happened" without this
      var s2 = this;
      window.requestAnimationFrame(function () {
        var w = s2.wrapper.getBoundingClientRect();
        var v = s2.video.getBoundingClientRect();
        dbg('info', 'VideoPlayer',
            'wrapper ' + Math.round(w.width) + 'x' + Math.round(w.height) +
            ', video ' + Math.round(v.width) + 'x' + Math.round(v.height) +
            ', display=' + window.getComputedStyle(s2.wrapper).display +
            ', readyState=' + s2.video.readyState);
      });
    },

    /** jump to the range start, waiting for metadata if it is not ready yet */
    _seekToRangeStart: function () {
      if (!this._range) return;
      var s = this;
      var start = this._range.start || 0;

      if (this.video.readyState >= 1) {
        try { this.video.currentTime = start; } catch (e) {}
        return;
      }

      var once = function () {
        s.video.removeEventListener('loadedmetadata', once);
        try { s.video.currentTime = start; } catch (e) {}
      };
      this.video.addEventListener('loadedmetadata', once);
    },

    /** stop and release the file.
     *
     * Clearing `src` and calling `load()` frees the decoder immediately.
     * Chromium otherwise keeps it alive until GC, and stepping through scenes
     * piles up players until playback stops working entirely.
     */
    clear: function () {
      this.wrapper.style.display = 'none';
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch (e) {}
      setIcon(this.playBtn, 'icon-play');
    },

    /** show or hide the "preparing" state while a proxy is being built.
     *
     * A transcode is fast but not instant, and without this the panel looks
     * frozen between the click and playback starting.
     */
    setBusy: function (busy) {
      if (!this.wrapper) return;
      this.wrapper.style.display = '';
      this.wrapper.classList.toggle('is-busy', !!busy);
      if (busy) {
        // the old clip must not keep playing under the overlay
        try { this.video.pause(); } catch (e) {}
      }
    },

    togglePlay: function () {
      if (this.video.paused) {
        var playing = this.video.play();
        if (playing && playing['catch']) playing['catch'](function () {});
      } else {
        this.video.pause();
      }
    },

    setVolume: function (value) {
      var clamped = Math.min(1, Math.max(0, value));
      this.video.volume = clamped;
      // dragging to the bottom mutes, and dragging back up undoes it
      this.video.muted = clamped === 0;
      if (clamped > 0) this._lastVolume = clamped;
      this._applyVolumeFill(clamped);
      this._syncMuteIcon();
    },

    toggleMute: function () {
      if (this.video.muted || this.video.volume === 0) {
        // remembered, so the next clip does not go silent again
        this._userUnmuted = true;
        this.video.muted = false;
        this.setVolume(this._lastVolume || FALLBACK_VOLUME);
        this.volumeSlider.value = this._lastVolume || FALLBACK_VOLUME;
      } else {
        this._userUnmuted = false;
        this.video.muted = true;
        this._syncMuteIcon();
      }
    },

    toggleFullscreen: function () {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else if (this.frame && this.frame.requestFullscreen) {
        this.frame.requestFullscreen();
      }
    },

    /** times are relative to the scene, not the whole episode.
     *
     * Playing scene 40 of an episode should read 0:03 / 0:07, not 18:22 / 24:10.
     */
    _renderTime: function () {
      var current = this.video.currentTime;
      var duration = isFinite(this.video.duration) ? this.video.duration : 0;

      if (this._range) {
        var start = this._range.start || 0;
        var end = this._range.end || duration;
        current = Math.max(0, current - start);
        duration = Math.max(0, end - start);
      }

      this.timeLabel.textContent = fmt(current) + ' / ' + fmt(duration);
    },

    /** the scrubber spans the scene, so its span matches the range when set */
    _syncProgressRange: function () {
      var duration = isFinite(this.video.duration) && this.video.duration > 0 ? this.video.duration : 1;
      if (this._range) {
        this.progressBar.min = this._range.start || 0;
        this.progressBar.max = this._range.end || duration;
      } else {
        this.progressBar.min = 0;
        this.progressBar.max = duration;
      }
    },

    /** the slider paints its own fill, so the filled share is a CSS variable */
    _applyVolumeFill: function (value) {
      this.volumeSlider.style.setProperty('--volume-fill', (value * 100) + '%');
    },

    _syncMuteIcon: function () {
      var silent = this.video.muted || this.video.volume === 0;
      setIcon(this.muteBtn, silent ? 'icon-volume-mute' : 'icon-volume');
      this.muteBtn.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
    },

    _showVolume: function () {
      this._cancelHide();
      this.volumeControl.classList.add('open');
    },

    _cancelHide: function () {
      if (this._hideTimer !== null) {
        window.clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }
    },

    _scheduleHide: function () {
      var s = this;
      this._cancelHide();
      this._hideTimer = window.setTimeout(function () {
        s._hideTimer = null;
        // a drag that wandered off the slider still owns the pointer, so
        // closing under it would drop the grab mid-gesture
        if (s._dragging) return;
        s.volumeControl.classList.remove('open');
      }, VOLUME_HIDE_DELAY_MS);
    }
  };

  window.VideoPlayer = VideoPlayer;
})();
