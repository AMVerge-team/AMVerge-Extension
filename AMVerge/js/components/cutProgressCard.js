/**
 * cutProgressCard.js - floating progress for work that outlives the grid opening.
 *
 * Cutting runs in two phases; the grid opens at PHASE1_COMPLETE and this card
 * carries the slow re-encode. Mirrors the app's minimized ImportTerminal.
 */
(function () {
  'use strict';

  var SPINNER = ['|', '/', '-', '\\'];
  var MAX_LINES = 300;

  var CutProgressCard = {
    _timer: null,
    _frame: 0,
    _lines: 0,
    _onDismiss: null,
    // closing the card means "stop showing me this", so later progress must not
    // bring it back. cleared by reset() when a new run starts
    _dismissed: false,
    _minimized: false,

    init: function () {
      var head = document.getElementById('cutCardHead');
      if (head) head.addEventListener('mousedown', this._startDrag.bind(this));

      var remembered = false;
      try {
        remembered = localStorage.getItem('amverge_cutCardMinimized') === '1';
      } catch (e) {}
      this.setMinimized(remembered);
    },

    /** allow the card to appear again, for a new run */
    reset: function () {
      this._dismissed = false;
    },

    /** collapse to the header and bar, or expand back to the log.
     *
     * Remembered across runs, so someone who does not want the per-clip log
     * does not have to close it every time cutting starts.
     */
    toggleMinimized: function () {
      this.setMinimized(!this._minimized);
    },

    setMinimized: function (minimized) {
      this._minimized = !!minimized;

      var card = document.getElementById('cutProgressCard');
      if (card) card.classList.toggle('minimized', this._minimized);

      var btn = document.getElementById('cutCardMin');
      if (btn) {
        // en dash collapses, square expands, matching the app's terminal card
        btn.innerHTML = this._minimized ? '&#9634;' : '&#8211;';
        btn.title = this._minimized ? 'Expand' : 'Minimize';
        btn.setAttribute('aria-label', btn.title);
      }

      try {
        localStorage.setItem('amverge_cutCardMinimized', this._minimized ? '1' : '0');
      } catch (e) {
        // a remembered preference is not worth failing a cut over
      }
    },

    /** show the card and start its spinner */
    show: function (title, onDismiss) {
      if (this._dismissed) return;
      var card = document.getElementById('cutProgressCard');
      if (!card) return;

      this._onDismiss = onDismiss || null;
      this._lines = 0;
      var body = document.getElementById('cutCardBody');
      if (body) body.innerHTML = '';

      this.setTitle(title || 'Working');
      this.setProgress(0, 0);
      card.style.display = '';
      this._startSpinner();
    },

    setTitle: function (text) {
      var el = document.getElementById('cutCardTitle');
      if (el) el.textContent = text;
    },

    setProgress: function (done, total) {
      var pct = total > 0 ? Math.round((done / total) * 100) : 0;
      var fill = document.getElementById('cutCardFill');
      var label = document.getElementById('cutCardPct');
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = total > 0 ? done + '/' + total : pct + '%';
    },

    /** append a line to the card's log, keeping the newest in view */
    log: function (text) {
      var body = document.getElementById('cutCardBody');
      if (!body) return;

      var line = document.createElement('div');
      line.className = 'cut-card-line';
      line.textContent = text;
      body.appendChild(line);

      this._lines++;
      if (this._lines > MAX_LINES && body.firstChild) {
        body.removeChild(body.firstChild);
        this._lines--;
      }
      body.scrollTop = body.scrollHeight;
    },

    /** work finished: stop the spinner and let the card fade itself out */
    finish: function (text) {
      this._stopSpinner();
      var spinner = document.getElementById('cutCardSpinner');
      if (spinner) spinner.textContent = '✓';
      this.setTitle(text || 'Done');

      var s = this;
      setTimeout(function () { s.hide(); }, 2500);
    },

    /** the close button: hide for good. cutting carries on regardless, and
     *  clips keep landing in the grid as they finish */
    dismiss: function () {
      var cb = this._onDismiss;
      this._dismissed = true;
      this.hide();
      if (cb) cb();
    },

    hide: function () {
      this._stopSpinner();
      var card = document.getElementById('cutProgressCard');
      if (card) card.style.display = 'none';
      this._onDismiss = null;
    },

    isVisible: function () {
      var card = document.getElementById('cutProgressCard');
      return !!card && card.style.display !== 'none';
    },

    _startSpinner: function () {
      this._stopSpinner();
      var s = this;
      var el = document.getElementById('cutCardSpinner');
      if (el) el.textContent = SPINNER[0];
      this._timer = setInterval(function () {
        s._frame = (s._frame + 1) % SPINNER.length;
        var spinner = document.getElementById('cutCardSpinner');
        if (spinner) spinner.textContent = SPINNER[s._frame];
      }, 120);
    },

    _stopSpinner: function () {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    _startDrag: function (e) {
      if (e.button !== 0) return;
      // the close button lives in the drag handle, so a press on it must not
      // start a drag instead of closing
      if (e.target && e.target.closest && e.target.closest('button')) return;

      var card = document.getElementById('cutProgressCard');
      if (!card) return;

      var rect = card.getBoundingClientRect();
      var offsetX = e.clientX - rect.left;
      var offsetY = e.clientY - rect.top;
      card.classList.add('dragging');
      e.preventDefault();

      var onMove = function (moveEvent) {
        // clamped to the window, so the card cannot be dropped out of reach
        var x = Math.min(window.innerWidth - rect.width - 8,
                         Math.max(8, moveEvent.clientX - offsetX));
        var y = Math.min(window.innerHeight - rect.height - 8,
                         Math.max(8, moveEvent.clientY - offsetY));
        card.style.left = x + 'px';
        card.style.top = y + 'px';
        card.style.right = 'auto';
        card.style.bottom = 'auto';
      };
      var onUp = function () {
        card.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  };

  window.CutProgressCard = CutProgressCard;
})();
