(function () {
  var StorageManager = {
    getItem: function (key, defaultValue) {
      try {
        var val = localStorage.getItem('amverge_' + key);
        return val !== null ? val : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },

    setItem: function (key, value) {
      try {
        localStorage.setItem('amverge_' + key, value);
      } catch (e) {
        dbg('error', 'Storage', 'setItem failed: ' + e);
      }
    },

    removeItem: function (key) {
      try {
        localStorage.removeItem('amverge_' + key);
      } catch (e) {}
    },

    loadSettings: function () {
      try {
        var raw = this.getItem('settings', '{}');
        return JSON.parse(raw);
      } catch (e) {
        return {};
      }
    },

    saveSettings: function (settings) {
      this.setItem('settings', JSON.stringify(settings));
    },

    loadHistory: function () {
      try {
        var raw = this.getItem('history', '[]');
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    },

    saveHistory: function (history) {
      this.setItem('history', JSON.stringify(history));
    }
  };

  window.StorageManager = StorageManager;
})();
