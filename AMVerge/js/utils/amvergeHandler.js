(function () {
  var AmvergeHandler = {
    _proc: null,
    _cancelling: false,
    _outputDir: '',
    _scenes: [],
    _onProgress: null,
    _onComplete: null,
    _onError: null,

    detect: function (videoPath, outputDir, opts, callbacks) {
      var s = this;
      if (this._proc) {
        if (callbacks && callbacks.onError) callbacks.onError('Already running');
        return;
      }

      this._outputDir = outputDir;
      this._scenes = [];
      this._cancelling = false;
      this._onProgress = callbacks.onProgress || null;
      this._onComplete = callbacks.onComplete || null;
      this._onError = callbacks.onError || null;

      var method = opts.method || 'keyframe';
      // `{ command, prefix }` from App._resolveCli. the fallback keeps this
      // callable on its own, and matches the pre-console-script behaviour
      var cli = opts.cli || { command: opts.pythonPath || 'python', prefix: ['-m', 'amverge'] };

      if (!window.FileSystem || !window.FileSystem.childProcess) {
        if (this._onError) this._onError('FileSystem not available');
        return;
      }

      window.FileSystem.createFolder(outputDir);

      this._runDetect(videoPath, method, cli, opts);
    },

    _runDetect: function (videoPath, method, cli, extraOpts) {
      var s = this;
      var cliMethod = (method === 'transnetv2_gpu' || method === 'transnetv2') ? 'transnetv2' : 'keyframe';
      var args = cli.prefix.concat([
        'detect', '--method', cliMethod, '--ipc', '--output', this._outputDir, videoPath
      ]);

      dbg('info', 'Amverge', 'Spawning CLI: ' + cli.command + ' ' + args.join(' '));

      try {
        this._proc = window.FileSystem.childProcess.spawn(cli.command, args, { windowsHide: true });
      } catch (e) {
        if (this._onError) this._onError('Failed to spawn amverge: ' + e.message);
        return;
      }

      if (this._onProgress) this._onProgress(0, 'Initializing detection...', 'detect');

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
          if (line.indexOf('PROGRESS|') === 0) {
            var parts = line.split('|');
            var pct = parseFloat(parts[1]);
            if (isNaN(pct)) pct = 0;
            var msg = parts.length > 2 ? parts.slice(2).join('|') : '';
            if (s._onProgress) s._onProgress(pct, msg, 'detect');
          } else if (line) {
            dbg('debug', 'AmvergeCLI', line);
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

        if (code !== 0) {
          var errMsg = 'amverge failed with exit code ' + code;
          if (stderrLog.trim()) {
            var lines = stderrLog.trim().split('\n');
            errMsg += ': ' + lines[lines.length - 1];
          }
          if (s._onError) s._onError(errMsg);
          return;
        }

        try {
          var trimmed = stdoutBuf.trim();
          var parsed = JSON.parse(trimmed);
          var scenes = Array.isArray(parsed) ? parsed : (parsed.scenes || []);
          if (s._onProgress) s._onProgress(100, 'Detected ' + scenes.length + ' scenes', 'done');
          if (s._onComplete) s._onComplete({ scenes: scenes, output_dir: s._outputDir });
        } catch (e) {
          if (s._onError) s._onError('Failed to parse CLI output: ' + e.message);
        }
      });
    },

    cancel: function () {
      if (!this._proc) return;
      this._cancelling = true;
      try {
        if (process.platform === 'win32') {
          window.FileSystem.childProcess.execSync('taskkill /F /T /PID ' + this._proc.pid, { windowsHide: true });
        } else {
          this._proc.kill('SIGTERM');
        }
      } catch (e) {}
      this._cleanup();
    },

    isRunning: function () {
      return this._proc !== null;
    },

    _cleanup: function () {
      this._proc = null;
    }
  };

  window.AmvergeHandler = AmvergeHandler;
})();
