(function () {
  window.consoleLog = [];
  window.consoleMaxEntries = 500;
  window.consoleFilter = { level: 'all', search: '' };

  function debounce(fn, ms) {
    var timer;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function dbg(level, source, message) {
    var entry = {
      time: new Date(),
      level: level,
      source: source,
      message: String(message || '')
    };
    window.consoleLog.push(entry);
    if (window.consoleLog.length > window.consoleMaxEntries) {
      window.consoleLog.shift();
    }
    try {
      var cl = level === 'success' ? 'info' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
      console[cl]('[' + source + ']', message);
    } catch (e) {}
    if (window.ConsolePanel && window.ConsolePanel._active) {
      window.ConsolePanel.renderLogContent();
    }
  }

  function getFilteredLogs() {
    var f = window.consoleFilter;
    return window.consoleLog.filter(function (e) {
      if (f.level !== 'all' && e.level !== f.level) return false;
      if (f.search && e.message.indexOf(f.search) === -1 && e.source.indexOf(f.search) === -1) return false;
      return true;
    });
  }

  function setLogFilter(type, value) {
    window.consoleFilter[type] = value;
    if (window.ConsolePanel && window.ConsolePanel._active) {
      window.ConsolePanel.renderLogContent();
    }
  }

  function clearLog() {
    window.consoleLog = [];
    dbg('info', 'Console', 'Log cleared');
  }

  function escHtmlLog(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.dbg = dbg;
  window.getFilteredLogs = getFilteredLogs;
  window.setLogFilter = setLogFilter;
  window.clearLog = clearLog;
  window.escHtmlLog = escHtmlLog;
  window._debounce = debounce;

  window.ConsolePanel = {
    _active: false,

    init: function () {
      this.bindEvents();
    },

    bindEvents: function () {
      var s = this;
      var entries = document.getElementById('consoleEntries');
      if (!entries) return;

      var clearBtn = document.getElementById('consoleClearBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          clearLog();
          s.renderLogContent();
        });
      }

      var copyBtn = document.getElementById('consoleCopyBtn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var filtered = getFilteredLogs();
          var text = '';
          for (var i = 0; i < filtered.length; i++) {
            var e = filtered[i];
            var time = ('0' + e.time.getHours()).slice(-2) + ':' + ('0' + e.time.getMinutes()).slice(-2) + ':' + ('0' + e.time.getSeconds()).slice(-2);
            text += '[' + time + '] [' + e.level.toUpperCase() + '] [' + e.source + '] ' + e.message + '\n';
          }
          var textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          if (window.showToast) window.showToast('Copied ' + filtered.length + ' entries', 'info');
        });
      }

      var search = document.getElementById('consoleSearch');
      if (search) {
        var debouncedSearch = debounce(function () {
          setLogFilter('search', search.value);
        }, 150);
        search.addEventListener('input', debouncedSearch);
      }
    },

    setFilterLevel: function (level) {
      setLogFilter('level', level);
      var btns = document.querySelectorAll('.console-filter-btn');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('data-level') === level) {
          btns[i].classList.add('active');
        } else {
          btns[i].classList.remove('active');
        }
      }
    },

    activate: function () {
      this._active = true;
      this.renderLogContent();
    },

    deactivate: function () {
      this._active = false;
    },

    renderLogContent: function () {
      var container = document.getElementById('consoleEntries');
      if (!container) return;
      var logs = getFilteredLogs();

      if (logs.length === 0) {
        container.innerHTML = '<div class="console-empty"><svg class="icon"><use href="#icon-console"/></svg><span>No log entries match criteria</span></div>';
        return;
      }
      var wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
      var html = '';
      var start = Math.max(0, logs.length - 200);
      for (var i = start; i < logs.length; i++) {
        var e = logs[i];
        var time = ('0' + e.time.getHours()).slice(-2) + ':' + ('0' + e.time.getMinutes()).slice(-2) + ':' + ('0' + e.time.getSeconds()).slice(-2);
        html += '<div class="console-entry console-' + e.level + '">' +
          '<span class="console-entry-time">' + time + '</span>' +
          '<span class="console-entry-source">' + escHtmlLog(e.source) + '</span>' +
          '<span class="console-entry-msg">' + escHtmlLog(e.message) + '</span>' +
        '</div>';
      }
      container.innerHTML = html;
      if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }
  };
})();
