(function () {
  var TABS = ["home", "console", "settings", "history", "setup"];
  var html = {};
  for (var i = 0; i < TABS.length; i++) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "./tabs/" + TABS[i] + ".html", false);
      xhr.send(null);
      if (xhr.status === 0 || xhr.status === 200) {
        html[TABS[i]] = xhr.responseText;
      } else {
        html[TABS[i]] = "";
      }
    } catch (e) {
      html[TABS[i]] = "";
    }
  }
  window.__AMVERGE_TAB_HTML__ = html;
  document.addEventListener("DOMContentLoaded", function () {
    var placeholders = document.querySelectorAll("[data-tab]");
    for (var j = 0; j < placeholders.length; j++) {
      var name = placeholders[j].getAttribute("data-tab");
      placeholders[j].outerHTML = window.__AMVERGE_TAB_HTML__[name] || "";
    }
  }, true);
})();
