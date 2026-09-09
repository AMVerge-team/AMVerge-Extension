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
      try {
        if (fs.existsSync(folderPath)) {
          fs.readdirSync(folderPath).forEach(function (file) {
            var cur = path.join(folderPath, file);
            if (fs.lstatSync(cur).isDirectory()) {
              this.deleteFolderRecursive(cur);
            } else {
              fs.unlinkSync(cur);
            }
          });
          fs.rmdirSync(folderPath);
        }
      } catch (e) {}
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

    chooseFile: function (title, startFolder, filter) {
      if (!childProcess) return '';
      try {
        filter = filter || 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm|All files|*.*';
        startFolder = startFolder || '';
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
          timeout: 30000,
          windowsHide: true
        });
        return (result || '').trim();
      } catch (e) {
        return '';
      }
    },

    chooseFolder: function (title, startFolder) {
      if (!childProcess) return '';
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
          timeout: 30000,
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

    readAppTheme: function () {
      if (!fs || !path || !os) return null;
      try {
        var localAppData = process.env.LOCALAPPDATA || path.join(this.getHomeDir(), 'AppData', 'Local');
        var roamingAppData = process.env.APPDATA || path.join(this.getHomeDir(), 'AppData', 'Roaming');

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
