(function () {
  var ExportHandler = {
    _proc: null,
    _cancelling: false,
    _inputsPath: null,
    _onProgress: null,
    _onComplete: null,
    _onError: null,

    /** exports `clips` (each `{ input: <clip file path> }`) via `amverge export
     *  --codec copy`, matching the desktop app's own export pipeline. Only
     *  stream copy is exposed here; the CLI's own fallback ladder re-encodes
     *  to H.264 on its own if a given clip's codec cannot be copied into MP4.
     *
     * clips: array of { input }
     * outputDir/fileStem: passed straight to the CLI's --output/--name
     * cli: { command, prefix } from App._resolveCli()
     * callbacks: { onProgress(pct, msg), onComplete(outputPaths), onError(message) }
     */
    export: function (clips, outputDir, fileStem, cli, callbacks) {
      var s = this;
      if (this._proc) {
        if (callbacks && callbacks.onError) callbacks.onError('An export is already running');
        return;
      }

      var fs = window.FileSystem;
      if (!fs || !fs.childProcess) {
        if (callbacks && callbacks.onError) callbacks.onError('FileSystem not available');
        return;
      }
      if (!clips || !clips.length) {
        if (callbacks && callbacks.onError) callbacks.onError('No clips to export');
        return;
      }

      this._cancelling = false;
      this._onProgress = callbacks.onProgress || null;
      this._onComplete = callbacks.onComplete || null;
      this._onError = callbacks.onError || null;

      fs.createFolder(outputDir);

      var inputsPath = fs.path.join(fs.getTempDir(), 'amverge_export_' + Date.now() + '.json');
      if (!fs.writeFile(inputsPath, JSON.stringify(clips))) {
        if (this._onError) this._onError('Failed to write export input list');
        return;
      }
      this._inputsPath = inputsPath;

      var args = cli.prefix.concat([
        'export',
        '--inputs-json', inputsPath,
        '--output', outputDir,
        '--name', fileStem,
        '--container', 'mp4',
        '--codec', 'copy',
        '--audio', 'copy',
        '--ipc'
      ]);

      dbg('info', 'Export', 'Spawning CLI: ' + cli.command + ' ' + args.join(' '));

      try {
        this._proc = fs.childProcess.spawn(cli.command, args, {
          windowsHide: true, detached: process.platform !== 'win32'
        });
      } catch (e) {
        this._cleanup();
        if (this._onError) this._onError('Failed to spawn amverge: ' + e.message);
        return;
      }

      if (this._onProgress) this._onProgress(0, 'Starting export...');

      var stderrBuf = '';
      var stderrLog = '';
      this._proc.stderr.on('data', function (data) {
        var str = data.toString();
        stderrBuf += str;
        stderrLog += str;
        var lines = stderrBuf.split('\n');
        stderrBuf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          if (line.indexOf('PROGRESS|') === 0) {
            var parts = line.split('|');
            var pct = parseFloat(parts[1]);
            if (isNaN(pct)) pct = 0;
            var msg = parts.length > 2 ? parts.slice(2).join('|') : '';
            if (s._onProgress) s._onProgress(pct, msg);
          } else {
            dbg('debug', 'CLI', line);
          }
        }
      });

      var stdoutBuf = '';
      this._proc.stdout.on('data', function (data) {
        stdoutBuf += data.toString();
      });

      this._proc.on('error', function (err) {
        s._cleanup();
        var errMsg = 'Process error: ' + err.message;
        if (stderrLog.trim()) errMsg += ' - ' + stderrLog.trim();
        if (s._onError) s._onError(errMsg);
      });

      this._proc.on('close', function (code) {
        s._cleanup();
        if (s._cancelling) return;

        var parsed = null;
        try { parsed = JSON.parse(stdoutBuf.trim()); } catch (e) {}

        if (parsed && parsed.error) {
          if (s._onError) s._onError(parsed.error.message || 'Export failed');
          return;
        }
        if (parsed && parsed.outputs) {
          if (s._onComplete) s._onComplete(parsed.outputs);
          return;
        }

        var errMsg = 'amverge export failed with exit code ' + code;
        if (stderrLog.trim()) {
          var lines = stderrLog.trim().split('\n');
          errMsg += ': ' + lines[lines.length - 1];
        }
        if (s._onError) s._onError(errMsg);
      });
    },

    cancel: function () {
      if (!this._proc) return;
      this._cancelling = true;
      try {
        if (process.platform === 'win32') {
          window.FileSystem.childProcess.execSync('taskkill /F /T /PID ' + this._proc.pid, { windowsHide: true });
        } else {
          process.kill(-this._proc.pid, 'SIGTERM');
        }
      } catch (e) {}
      this._cleanup();
    },

    isRunning: function () {
      return this._proc !== null;
    },

    _cleanup: function () {
      this._proc = null;
      if (this._inputsPath && window.FileSystem) {
        window.FileSystem.deleteFile(this._inputsPath);
      }
      this._inputsPath = null;
    }
  };

  window.ExportHandler = ExportHandler;
})();
