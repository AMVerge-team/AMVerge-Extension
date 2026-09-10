(function () {
  var ImportPanel = {
    app: null,
    _startTime: null,
    _timer: null,

    init: function (app) {
      this.app = app;
    },

    showIdle: function () {
      this._stopTimer();
      document.getElementById('importIdle').style.display = '';
      document.getElementById('importProgress').style.display = 'none';
    },

    showProgress: function () {
      document.getElementById('importIdle').style.display = 'none';
      document.getElementById('importProgress').style.display = '';
      this._startTime = Date.now();
      this._startTimer();
      this.setProgress(0, 'Initializing...');
    },

    setProgress: function (pct, msg) {
      document.getElementById('importProgressFill').style.width = pct + '%';
      document.getElementById('importPct').textContent = Math.round(pct) + '%';
      if (msg) document.getElementById('importStatusText').textContent = msg;
      this._updateEta(pct);
    },

    _startTimer: function () {
      this._stopTimer();
      var s = this;
      var elapsedEl = document.getElementById('importElapsedVal');
      if (elapsedEl) elapsedEl.textContent = '00:00';

      this._timer = setInterval(function () {
        if (!s._startTime) return;
        var diffSec = Math.floor((Date.now() - s._startTime) / 1000);
        var m = Math.floor(diffSec / 60);
        var sec = diffSec % 60;
        if (elapsedEl) {
          elapsedEl.textContent = ('0' + m).slice(-2) + ':' + ('0' + sec).slice(-2);
        }
      }, 1000);
    },

    _stopTimer: function () {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      this._startTime = null;
    },

    _updateEta: function (pct) {
      var etaEl = document.getElementById('importEtaVal');
      if (!etaEl) return;
      if (pct <= 2 || !this._startTime) {
        etaEl.textContent = '--:--';
        return;
      }
      if (pct >= 100) {
        etaEl.textContent = '00:00';
        return;
      }
      var elapsedSec = (Date.now() - this._startTime) / 1000;
      var totalEstimateSec = elapsedSec / (pct / 100);
      var remainingSec = Math.max(0, Math.round(totalEstimateSec - elapsedSec));

      var m = Math.floor(remainingSec / 60);
      var s = remainingSec % 60;
      etaEl.textContent = ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
    },

    hide: function () {
      this._stopTimer();
      document.getElementById('importIdle').style.display = 'none';
      document.getElementById('importProgress').style.display = 'none';
    },

    /** back to the pick-a-video state.
     *
     * `hide()` blanks both the idle and progress views, which is correct when
     * the caller is about to hide the whole import area (the success path
     * switches to the scene grid). A failure leaves the area on screen, so it
     * has to come back here or the panel renders as an empty background with no
     * controls, and stays that way until the extension is reloaded.
     */
    showIdle: function () {
      this._stopTimer();
      document.getElementById('importProgress').style.display = 'none';
      document.getElementById('importIdle').style.display = '';
    }
  };

  window.ImportPanel = ImportPanel;
})();
