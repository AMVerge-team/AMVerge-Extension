/**
 * customSelect.js - replaces a native <select> popup with a styled one.
 *
 * Windows draws the native popup itself, so its blue highlight and tight rows
 * are not reachable from CSS. The real <select> stays in the DOM and remains
 * the source of truth, so existing `.value` reads and `onchange` handlers keep
 * working untouched; this only paints what the user sees.
 */
(function () {
  'use strict';

  var CustomSelect = {
    /** wrap every .settings-select on the page. safe to call more than once */
    enhanceAll: function () {
      var selects = document.querySelectorAll('select.settings-select');
      for (var i = 0; i < selects.length; i++) this.enhance(selects[i]);
    },

    enhance: function (select) {
      if (!select || select._csWrap) return;

      var wrap = document.createElement('div');
      wrap.className = 'cs';

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'cs-trigger';
      trigger.innerHTML = '<span class="cs-label"></span><span class="cs-caret">▼</span>';

      var menu = document.createElement('div');
      menu.className = 'cs-menu';
      menu.style.display = 'none';

      select.parentNode.insertBefore(wrap, select);
      wrap.appendChild(select);
      wrap.appendChild(trigger);
      wrap.appendChild(menu);

      select._csWrap = wrap;
      select._csLabel = trigger.querySelector('.cs-label');
      select._csMenu = menu;

      var s = this;
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        if (wrap.classList.contains('open')) s.close(select);
        else s.open(select);
      });

      // the select can be assigned to directly (SettingsPanel.populate does),
      // which fires no event, so the visible label is refreshed on open too
      select.addEventListener('change', function () { s.syncLabel(select); });

      this.syncLabel(select);
    },

    syncLabel: function (select) {
      var option = select.options[select.selectedIndex];
      if (select._csLabel) select._csLabel.textContent = option ? option.textContent : '';
    },

    open: function (select) {
      var s = this;
      this.closeAll();

      var menu = select._csMenu;
      menu.innerHTML = '';

      for (var i = 0; i < select.options.length; i++) {
        (function (option, idx) {
          var row = document.createElement('div');
          row.className = 'cs-option' + (idx === select.selectedIndex ? ' selected' : '');
          row.innerHTML = '<span class="cs-check">' +
            (idx === select.selectedIndex ? '✓' : '') + '</span>';
          row.appendChild(document.createTextNode(option.textContent));
          row.addEventListener('click', function (e) {
            e.stopPropagation();
            s.choose(select, idx);
          });
          menu.appendChild(row);
        })(select.options[i], i);
      }

      menu.style.display = '';
      select._csWrap.classList.add('open');
      this._openSelect = select;
    },

    close: function (select) {
      if (!select || !select._csWrap) return;
      select._csWrap.classList.remove('open');
      select._csMenu.style.display = 'none';
      if (this._openSelect === select) this._openSelect = null;
    },

    closeAll: function () {
      if (this._openSelect) this.close(this._openSelect);
    },

    choose: function (select, idx) {
      this.close(select);
      if (select.selectedIndex === idx) return;

      select.selectedIndex = idx;
      this.syncLabel(select);
      // dispatched so the element's own onchange attribute runs, which is what
      // saves the setting. assigning selectedIndex alone fires nothing
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  document.addEventListener('click', function () { CustomSelect.closeAll(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') CustomSelect.closeAll();
  });

  window.CustomSelect = CustomSelect;
})();
