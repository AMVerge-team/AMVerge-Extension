(function () {
  var fs = null;
  var path = null;
  var os = null;
  var childProcess = null;

  function nodeRequire(mod) {
    try { return window.cep_node.require(mod); } catch (e) {}
    try { return window.__adobe_cep__.node.require(mod); } catch (e) {}
    try { return require(mod); } catch (e) {}
    return null;
  }

  fs = nodeRequire('fs');
  path = nodeRequire('path');
  os = nodeRequire('os');
  childProcess = nodeRequire('child_process');

  var DIALOG_TIMEOUT = 300000;

  function augmentPath() {
    if (!fs || !path || !os || process.platform === 'win32') return;
    var home = os.homedir();
    var extra = [
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/local/bin'
    ];
    var current = (process.env.PATH || '').split(':');
    var added = [];
    for (var i = 0; i < extra.length; i++) {
      if (current.indexOf(extra[i]) !== -1) continue;
      try {
        if (fs.existsSync(extra[i])) added.push(extra[i]);
      } catch (e) {}
    }
    if (added.length) process.env.PATH = added.concat(current).join(':');
  }

  augmentPath();

  var FileSystem = {
    fs: fs,
    path: path,
    os: os,
    childProcess: childProcess,

    isAvailable: function () {
      return fs !== null;
    },

    createFolder: function (folder) {
      if (!fs) return false;
      try {
        fs.mkdirSync(folder, { recursive: true });
        return true;
      } catch (e) {
        dbg('error', 'FileSystem', 'createFolder: ' + e);
        return false;
      }
    },

    fileExists: function (filePath) {
      if (!fs) return false;
      try {
        return fs.existsSync(filePath);
      } catch (e) {
        return false;
      }
    },

    listFiles: function (dir, extension) {
      if (!fs) return [];
      try {
        var files = fs.readdirSync(dir);
        if (extension) {
          return files.filter(function (f) { return f.endsWith(extension); }).map(function (f) { return path.join(dir, f); });
        }
        return files.map(function (f) { return path.join(dir, f); });
      } catch (e) {
        return [];
      }
    },

    deleteFile: function (filePath) {
      if (!fs) return;
      try { fs.unlinkSync(filePath); } catch (e) {}
    },

    deleteFolderRecursive: function (folderPath) {
      if (!fs) return;
      // `self`, not `this`: inside the forEach callback `this` is undefined, so
      // the recursive call threw on the first subfolder it met and the outer
      // catch swallowed it, leaving the folder half deleted and no trace of why
      var self = this;
      try {
        if (fs.existsSync(folderPath)) {
          fs.readdirSync(folderPath).forEach(function (file) {
            var cur = path.join(folderPath, file);
            if (fs.lstatSync(cur).isDirectory()) {
              self.deleteFolderRecursive(cur);
            } else {
              fs.unlinkSync(cur);
            }
          });
          fs.rmdirSync(folderPath);
        }
      } catch (e) {
        dbg('warn', 'FileSystem', 'Could not fully delete ' + folderPath + ': ' + e.message);
      }
    },

    getExtension: function (filePath) {
      if (!path) return '';
      var ext = path.extname(filePath);
      return ext ? ext.slice(1) : '';
    },

    getFileName: function (filePath) {
      if (!path) return '';
      return path.basename(filePath);
    },

    getFileNameWithoutExtension: function (filePath) {
      if (!path) return '';
      return path.basename(filePath, path.extname(filePath));
    },

    getTempDir: function () {
      if (!os) return '';
      return os.tmpdir();
    },

    getHomeDir: function () {
      if (!os) return '';
      return os.homedir();
    },

    _osascript: function (lines) {
      if (!childProcess) return '';
      try {
        var result = childProcess.execFileSync('osascript', ['-e', lines.join('\n')], {
          encoding: 'utf8',
          timeout: DIALOG_TIMEOUT
        });
        return (result || '').trim();
      } catch (e) {
        return '';
      }
    },

    _asString: function (value) {
      return '"' + String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    },

    _filterExtensions: function (filter) {
      var exts = [];
      var groups = String(filter || '').split('|');
      for (var i = 1; i < groups.length; i += 2) {
        var patterns = groups[i].split(';');
        for (var j = 0; j < patterns.length; j++) {
          var p = patterns[j].trim().replace(/^\*\./, '');
          if (!p || p.indexOf('*') !== -1) continue;
          if (exts.indexOf(p) === -1) exts.push(p.toLowerCase());
        }
      }
      return exts;
    },

    _chooseFileMac: function (title, startFolder, filter) {
      var exts = this._filterExtensions(filter);
      var typeList = '';
      if (exts.length) {
        var quoted = [];
        for (var i = 0; i < exts.length; i++) quoted.push(this._asString(exts[i]));
        typeList = ' of type {' + quoted.join(', ') + '}';
      }
      var location = startFolder && this.fileExists(startFolder)
        ? ' default location POSIX file ' + this._asString(startFolder)
        : '';
      var invisibles = typeList ? '' : ' with invisibles';
      return this._osascript([
        'activate',
        'set chosen to choose file with prompt ' + this._asString(title || 'Select video') +
          typeList + location + invisibles,
        'POSIX path of chosen'
      ]);
    },

    _chooseFolderMac: function (title, startFolder) {
      var location = startFolder && this.fileExists(startFolder)
        ? ' default location POSIX file ' + this._asString(startFolder)
        : '';
      return this._osascript([
        'activate',
        'set chosen to choose folder with prompt ' + this._asString(title || 'Select folder') + location,
        'POSIX path of chosen'
      ]);
    },

    chooseFile: function (title, startFolder, filter) {
      if (!childProcess) return '';
      filter = filter || 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.mpg;*.mpeg;*.m2ts;*.mts;*.ts;*.wmv;*.flv;*.mxf|All files|*.*';
      startFolder = startFolder || '';
      if (process.platform !== 'win32') {
        return this._chooseFileMac(title, startFolder, filter);
      }
      try {
        var psScript = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$f = New-Object System.Windows.Forms.OpenFileDialog',
          '$f.Title = "' + (title || 'Select video').replace(/'/g, "''") + '"',
          '$f.Filter = "' + filter.replace(/'/g, "''") + '"',
          startFolder ? '$f.InitialDirectory = "' + startFolder.replace(/'/g, "''") + '"' : '',
          '$f.Multiselect = $false',
          'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName } else { "" }'
        ].join('; ');
        var result = childProcess.execFileSync('powershell.exe', ['-STA', '-NoProfile', '-Command', psScript], {
          encoding: 'utf8',
          timeout: DIALOG_TIMEOUT,
          windowsHide: true
        });
        return (result || '').trim();
      } catch (e) {
        return '';
      }
    },

    chooseFolder: function (title, startFolder) {
      if (!childProcess) return '';
      if (process.platform !== 'win32') {
        return this._chooseFolderMac(title, startFolder);
      }
      try {
        var psScript = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
          '$f.Description = "' + (title || 'Select folder').replace(/'/g, "''") + '"',
          startFolder ? '$f.SelectedPath = "' + startFolder.replace(/'/g, "''") + '"' : '',
          'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { "" }'
        ].join('; ');
        var result = childProcess.execFileSync('powershell.exe', ['-STA', '-NoProfile', '-Command', psScript], {
          encoding: 'utf8',
          timeout: DIALOG_TIMEOUT,
          windowsHide: true
        });
        return (result || '').trim();
      } catch (e) {
        return '';
      }
    },

    writeFile: function (filePath, content) {
      if (!fs) return false;
      try {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
      } catch (e) {
        return false;
      }
    },

    readFile: function (filePath) {
      if (!fs) return '';
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        return '';
      }
    },

    /** this extension's own folder, for reaching bundled binaries */
    getExtensionRoot: function () {
      try {
        if (window.__adobe_cep_ && window.__adobe_cep_.getSystemPath) {
          var viaCep = window.__adobe_cep_.getSystemPath('extension');
          if (viaCep) return viaCep;
        }
      } catch (e) {}

      // outside a CEP host (tests, a plain browser) fall back to the page URL,
      // which is <extension>/index.html
      try {
        var href = decodeURI(window.location.href).replace(/^file:\/{2,3}/, '');
        return this.path.dirname(href.split('?')[0].split('#')[0]);
      } catch (e) {
        return '';
      }
    },

    getAppDataDir: function () {
      var path = this.path;
      var home = this.getHomeDir();
      if (process.platform === 'win32') {
        return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      }
      if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support');
      }
      return process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    },

    /** where the persistent extension log lives, independent of any single
     * CEP session. CEP overwrites its own CEPHtmlEngine*.log on every
     * relaunch, so a hang right before a force-quit leaves nothing behind -
     * this file exists to survive exactly that.
     */
    getLogPath: function () {
      return this.path.join(this.getAppDataDir(), 'AMVerge', 'logs', 'extension.log');
    },

    _logRotated: false,

    /** appends pre-formatted lines (already joined with '\n') to the
     * persistent log, rotating the previous session's file to `.old` on the
     * first write of this session and capping growth so a long-running AE
     * session doesn't grow it unbounded.
     *
     * Deliberately has no dbg() calls anywhere in this method: dbg() is what
     * calls appendLog, so logging a failure here would recurse.
     */
    appendLog: function (lines) {
      if (!fs) return;
      try {
        var logPath = this.getLogPath();
        try { fs.mkdirSync(this.path.dirname(logPath), { recursive: true }); } catch (e) {}

        if (!this._logRotated) {
          this._logRotated = true;
          try {
            if (fs.existsSync(logPath)) fs.copyFileSync(logPath, logPath + '.old');
          } catch (e) {}
          try { fs.writeFileSync(logPath, ''); } catch (e) {}
        }

        fs.appendFileSync(logPath, lines + '\n');

        // cheap size cap: once past 5MB, keep only the trailing ~1MB
        var stat = fs.statSync(logPath);
        if (stat.size > 5 * 1024 * 1024) {
          var tail = fs.readFileSync(logPath, 'utf8').slice(-1024 * 1024);
          fs.writeFileSync(logPath, tail);
        }
      } catch (e) {}
    },

    ensureExecutable: function (target) {
      if (!fs || process.platform === 'win32') return;
      try {
        var mode = fs.statSync(target).mode;
        if ((mode & 73) !== 73) fs.chmodSync(target, parseInt('755', 8));
      } catch (e) {
        dbg('warn', 'FileSystem', 'Could not mark executable: ' + target);
      }
    },

    /** roots that can hold the shared AMVerge Python runtime, best first.
     *
     * The shared location belongs to neither product, so whichever installed
     * first provides it. The `app.amverge` entries are where the desktop app
     * used to keep its own: a venv hardcodes its absolute path, so an existing
     * one is used where it stands rather than moved.
     */
    getRuntimeRoots: function () {
      var path = this.path;
      var home = this.getHomeDir();
      var roots = [];

      var override = process.env.AMVERGE_RUNTIME_DIR;
      if (override) roots.push(override);

      var local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      var roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      var appSupport = path.join(home, 'Library', 'Application Support');

      // shared, product-named
      roots.push(path.join(local, 'AMVerge', 'runtime'));
      roots.push(path.join(appSupport, 'AMVerge', 'runtime'));
      roots.push(path.join(home, '.local', 'share', 'AMVerge', 'runtime'));

      // legacy, app-owned
      roots.push(path.join(roaming, 'app.amverge'));
      roots.push(path.join(appSupport, 'app.amverge'));
      roots.push(path.join(home, '.local', 'share', 'app.amverge'));

      return roots;
    },

    /** Python interpreter from the shared AMVerge runtime, or null.
     *
     * Using the same interpreter as the app means a pack installed in either
     * product is immediately usable in the other, instead of torch being
     * downloaded twice into two Pythons that know nothing about each other.
     *
     * Null when no runtime has been provisioned yet, in which case the caller
     * falls back to the configured or PATH python.
     */
    getAppAiPython: function () {
      try {
        var path = this.path;
        var roots = this.getRuntimeRoots();

        for (var i = 0; i < roots.length; i++) {
          var candidates = [
            path.join(roots[i], 'pyenv', 'Scripts', 'python.exe'),
            path.join(roots[i], 'pyenv', 'bin', 'python')
          ];
          for (var j = 0; j < candidates.length; j++) {
            if (this.fileExists(candidates[j])) return candidates[j];
          }
        }
      } catch (e) {
        dbg('warn', 'FileSystem', 'getAppAiPython failed: ' + e);
      }
      return null;
    },

    /** the `amverge` console script from the app's AI venv, or null.
     *
     * Preferred over `python -m amverge`, because a wheel install does not
     * necessarily ship `amverge/__main__.py` and `-m` then fails with "package
     * cannot be directly executed". The console script is generated from the
     * project's entry point, so it exists in every install, and it is what the
     * desktop app itself spawns.
     */
    getAppAiCli: function () {
      var python = this.getAppAiPython();
      return python ? this.siblingCliFor(python) : null;
    },

    /** the `amverge` script that sits beside a given interpreter, or null */
    siblingCliFor: function (pythonPath) {
      try {
        var path = this.path;
        var binDir = path.dirname(pythonPath);
        var names = process.platform === 'win32' ? ['amverge.exe', 'amverge.cmd'] : ['amverge'];
        for (var i = 0; i < names.length; i++) {
          var candidate = path.join(binDir, names[i]);
          if (this.fileExists(candidate)) return candidate;
        }
      } catch (e) {
        dbg('warn', 'FileSystem', 'siblingCliFor failed: ' + e);
      }
      return null;
    },

    readAppTheme: function () {
      if (!fs || !path || !os) return null;
      try {
        var localAppData = process.env.LOCALAPPDATA || path.join(this.getHomeDir(), 'AppData', 'Local');
        var roamingAppData = this.getAppDataDir();

        // Check if there is an explicit theme.json
        var jsonPaths = [
          path.join(roamingAppData, 'app.amverge', 'theme.json'),
          path.join(roamingAppData, 'com.amverge.cli', 'theme.json'),
          path.join(roamingAppData, 'AMVerge', 'theme.json')
        ];
        for (var j = 0; j < jsonPaths.length; j++) {
          if (fs.existsSync(jsonPaths[j])) {
            try {
              var parsed = JSON.parse(fs.readFileSync(jsonPaths[j], 'utf8'));
              if (parsed && parsed.accentColor) return parsed;
            } catch (e) {}
          }
        }

        // Search Tauri / WebView2 LevelDB storage for amverge.theme.v2
        var levelDbDirs = [
          path.join(localAppData, 'app.amverge', 'EBWebView', 'Default', 'Local Storage', 'leveldb'),
          path.join(localAppData, 'com.amiri.amverge', 'EBWebView', 'Default', 'Local Storage', 'leveldb')
        ];

        for (var i = 0; i < levelDbDirs.length; i++) {
          var ldir = levelDbDirs[i];
          if (!fs.existsSync(ldir)) continue;
          var files = fs.readdirSync(ldir);
          files.sort();
          files.reverse();

          for (var k = 0; k < files.length; k++) {
            var f = files[k];
            if (!f.endsWith('.log') && !f.endsWith('.ldb')) continue;
            var fullPath = path.join(ldir, f);
            try {
              var buffer = fs.readFileSync(fullPath);
              var str = buffer.toString('utf8');
              var idx = 0;
              var latestJson = null;

              while (true) {
                var pos = str.indexOf('"accentColor"', idx);
                if (pos === -1) break;
                var openBrace = str.lastIndexOf('{', pos);
                var closeBrace = str.indexOf('}', pos);
                if (openBrace !== -1 && closeBrace !== -1 && closeBrace > openBrace) {
                  var candidate = str.substring(openBrace, closeBrace + 1);
                  try {
                    var obj = JSON.parse(candidate);
                    if (obj && obj.accentColor) {
                      latestJson = obj;
                    }
                  } catch (err) {}
                }
                idx = pos + 13;
              }

              if (latestJson) {
                return latestJson;
              }
            } catch (readErr) {}
          }
        }

        // Fallback: Check if background.jpg exists in backgrounds dir
        var defaultBg = path.join(roamingAppData, 'app.amverge', 'backgrounds', 'background.jpg');
        if (fs.existsSync(defaultBg)) {
          return {
            accentColor: '#22c55e',
            backgroundGradientColor: '#001a00',
            backgroundImagePath: defaultBg,
            backgroundOpacity: 1.0,
            backgroundBlur: 0
          };
        }
      } catch (e) {
        dbg('warn', 'FileSystem', 'readAppTheme failed: ' + e);
      }
      return null;
    }
  };

  window.FileSystem = FileSystem;
})();
