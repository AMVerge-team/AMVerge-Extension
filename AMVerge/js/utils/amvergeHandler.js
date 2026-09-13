(function () {
  var AmvergeHandler = {
    _proc: null,
    _cancelling: false,
    _outputDir: '',
    _scenes: [],
    _onProgress: null,
    _onComplete: null,
    _onError: null,
    _onInitialClips: null,
    _onClipReady: null,
    _onThumbnail: null,
    _onPhase1: null,
    _onReencode: null,

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
      // streaming events, emitted by the transnetv2 path only. a keyframe run
      // never fires them and simply finishes through onComplete as before
      this._onInitialClips = callbacks.onInitialClips || null;
      this._onClipReady = callbacks.onClipReady || null;
      this._onThumbnail = callbacks.onThumbnail || null;
      this._onPhase1 = callbacks.onPhase1Complete || null;
      this._onReencode = callbacks.onReencodeProgress || null;

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

    /** handle one streaming IPC line, returning true when it was one. unknown lines fall through to the log. */
    _handleEvent: function (line) {
      var s = this;

      if (line.indexOf('INITIAL_CLIPS_READY|') === 0) {
        var raw = line.slice('INITIAL_CLIPS_READY|'.length);
        var clips;
        try {
          clips = JSON.parse(raw);
        } catch (e) {
          dbg('warn', 'Amverge', 'Unreadable INITIAL_CLIPS_READY payload');
          return true;
        }
        this._scenes = clips;
        if (this._onInitialClips) this._onInitialClips(clips);
        return true;
      }

      if (line.indexOf('CLIP_READY|') === 0) {
        var cp = line.split('|');
        var idx = parseInt(cp[1], 10);
        if (!isNaN(idx) && this._onClipReady) {
          // a path can legitimately contain a pipe, so everything between the
          // index and the trailing mode belongs to it
          this._onClipReady(idx, cp.slice(2, cp.length - 1).join('|'), cp[cp.length - 1] || '');
        }
        return true;
      }

      if (line.indexOf('THUMBNAIL_READY|') === 0) {
        var tIdx = parseInt(line.split('|')[1], 10);
        if (!isNaN(tIdx) && this._onThumbnail) this._onThumbnail(tIdx);
        return true;
      }

      if (line === 'PHASE1_COMPLETE') {
        if (this._onPhase1) this._onPhase1();
        return true;
      }

      if (line.indexOf('REENCODE_PROGRESS|') === 0) {
        var rp = line.split('|');
        var doneCount = parseInt(rp[1], 10);
        var total = parseInt(rp[2], 10);
        if (!isNaN(doneCount) && !isNaN(total) && this._onReencode) {
          this._onReencode(doneCount, total);
        }
        return true;
      }

      return false;
    },

    _runDetect: function (videoPath, method, cli, extraOpts) {
      var s = this;
      var cliMethod = (method === 'transnetv2_gpu' || method === 'transnetv2') ? 'transnetv2' : 'keyframe';
      var args = cli.prefix.concat(['detect', '--method', cliMethod]);

      // ask for NVDEC and let the CLI settle it: it falls back to FFmpeg on its
      // own, so enabling GPU decode in the app is all that turns this on
      var decodeMethod = (extraOpts && extraOpts.decodeMethod) || 'nelux';
      if (cliMethod === 'transnetv2' && decodeMethod === 'nelux' && process.platform !== 'darwin') {
        args = args.concat(['--decode-method', 'nelux']);
      }

      args = args.concat(['--ipc', '--output', this._outputDir, videoPath]);

      dbg('info', 'Amverge', 'Spawning CLI: ' + cli.command + ' ' + args.join(' '));

      try {
        // `detached` makes this the leader of its own process group (POSIX
        // only; Windows ignores it). The CLI shells out to ffmpeg itself, and
        // that child inherits our group by default, so killing the group in
        // `cancel()` reaches ffmpeg too instead of orphaning it.
        this._proc = window.FileSystem.childProcess.spawn(cli.command, args, { windowsHide: true, detached: process.platform !== 'win32' });
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
          if (!line) continue;
          if (line.indexOf('PROGRESS|') === 0) {
            var parts = line.split('|');
            var pct = parseFloat(parts[1]);
            if (isNaN(pct)) pct = 0;
            var msg = parts.length > 2 ? parts.slice(2).join('|') : '';
            if (s._onProgress) s._onProgress(pct, msg, 'detect');
          } else if (!s._handleEvent(line)) {
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
          // negative pid signals the whole process group (see spawn above),
          // so any ffmpeg the CLI shelled out to dies with it
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
    }
  };

  window.AmvergeHandler = AmvergeHandler;
})();
