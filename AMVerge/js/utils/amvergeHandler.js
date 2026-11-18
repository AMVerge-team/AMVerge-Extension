(function () {
  var MAX_STAGE_BYTES = 4 * 1024 * 1024 * 1024;

  var AmvergeHandler = {
    _proc: null,
    _cancelling: false,
    _stagingInFlight: false,
    _stagingDir: '',
    _stagingFile: '',
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
      if (this.isRunning()) {
        if (callbacks && callbacks.onError) callbacks.onError('Already running');
        return;
      }

      this._outputDir = outputDir;
      this._scenes = [];
      this._cancelling = false;
      this._stagingDir = '';
      this._stagingFile = '';
      this._onProgress = callbacks.onProgress || null;
      this._onComplete = callbacks.onComplete || null;
      this._onError = callbacks.onError || null;
      this._onInitialClips = callbacks.onInitialClips || null;
      this._onClipReady = callbacks.onClipReady || null;
      this._onThumbnail = callbacks.onThumbnail || null;
      this._onPhase1 = callbacks.onPhase1Complete || null;
      this._onReencode = callbacks.onReencodeProgress || null;

      var method = opts.method || 'keyframe';
      var cli = opts.cli || { command: opts.pythonPath || 'python', prefix: ['-m', 'amverge'] };

      if (!window.FileSystem || !window.FileSystem.childProcess) {
        if (this._onError) this._onError('FileSystem not available');
        return;
      }

      window.FileSystem.createFolder(outputDir);

      this._prepareInput(videoPath, function (inputPath) {
        if (s._cancelling) {
          s._cleanup();
          return;
        }
        s._runDetect(inputPath, method, cli, opts);
      });
    },

    /** copy cross-drive sources (e.g. D: HDD -> C: NVMe temp) sequentially before
     *  spawning ffmpeg -f segment; keeps the exact basename so clip/thumbnail
     *  filenames stay identical. */
    _prepareInput: function (videoPath, done) {
      var fsMod = window.FileSystem;
      var nodeFs = fsMod && fsMod.fs;
      var pathMod = fsMod && fsMod.path;
      if (process.platform !== 'win32' || !nodeFs || !pathMod || !nodeFs.copyFile) {
        done(videoPath);
        return;
      }

      var tempRoot = fsMod.getTempDir ? fsMod.getTempDir() : '';
      var srcMatch = /^([A-Za-z]):/.exec(videoPath);
      var tmpMatch = /^([A-Za-z]):/.exec(tempRoot);
      if (!srcMatch || !tmpMatch || srcMatch[1].toLowerCase() === tmpMatch[1].toLowerCase()) {
        done(videoPath);
        return;
      }

      try {
        var st = nodeFs.statSync(videoPath);
        if (!st || !st.isFile() || st.size <= 0 || st.size > MAX_STAGE_BYTES) {
          done(videoPath);
          return;
        }
      } catch (e) {
        done(videoPath);
        return;
      }

      var stageDir = pathMod.join(tempRoot, 'AMVerge', '_stage_' + Date.now() + '_' + process.pid);
      var stageFile = pathMod.join(stageDir, pathMod.basename(videoPath));
      try {
        fsMod.createFolder(stageDir);
      } catch (e) {
        done(videoPath);
        return;
      }

      this._stagingDir = stageDir;
      this._stagingFile = stageFile;
      this._stagingInFlight = true;
      if (this._onProgress) this._onProgress(2, 'Staging video on fast drive...', 'detect');
      dbg('info', 'Amverge', 'Staging cross-drive input to ' + stageFile);

      var s = this;
      nodeFs.copyFile(videoPath, stageFile, function (err) {
        s._stagingInFlight = false;
        if (err || s._cancelling) {
          if (err) dbg('warn', 'Amverge', 'Staging failed, reading directly: ' + err.message);
          s._cleanupStaging();
          done(videoPath);
          return;
        }
        done(stageFile);
      });
    },

    _cleanupStaging: function () {
      var nodeFs = window.FileSystem && window.FileSystem.fs;
      if (!nodeFs) {
        this._stagingDir = '';
        this._stagingFile = '';
        return;
      }
      try {
        if (this._stagingFile) nodeFs.unlinkSync(this._stagingFile);
      } catch (e) {}
      try {
        if (this._stagingDir) nodeFs.rmdirSync(this._stagingDir);
      } catch (e) {}
      this._stagingDir = '';
      this._stagingFile = '';
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
      if (cliMethod === 'transnetv2' && decodeMethod === 'nelux') {
        args = args.concat(['--decode-method', 'nelux']);
      }

      args = args.concat(['--ipc', '--output', this._outputDir, videoPath]);

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
          if (!line) continue;
          if (line.indexOf('PROGRESS|') === 0) {
            var parts = line.split('|');
            var pct = parseFloat(parts[1]);
            if (isNaN(pct)) pct = 0;
            var msg = parts.length > 2 ? parts.slice(2).join('|') : '';
            if (s._onProgress) s._onProgress(pct, msg, 'detect');
          } else if (!s._handleEvent(line)) {
            // a scene cut is live progress worth seeing in the console, the rest is cli chatter
            dbg(/^Scene \d+ detected/.test(line) ? 'info' : 'debug', 'CLI', line);
          }
        }
      });

      var stdoutBuf = '';
      this._proc.stdout.on('data', function (data) {
        stdoutBuf += data.toString();
      });

      var spawnErrored = false;

      this._proc.on('error', function (err) {
        spawnErrored = true;
        s._cleanup();
        var errMsg;
        if (err && (err.code === 'ENOENT' || String(err.message).indexOf('ENOENT') !== -1)) {
          errMsg = 'AMVerge CLI not found. Open AMVerge Desktop to install the AI runtime, or set the Python/CLI path in Extension Settings.';
        } else {
          errMsg = 'Process error: ' + err.message;
          if (stderrLog.trim()) errMsg += ' - ' + stderrLog.trim();
        }
        if (s._onError) s._onError(errMsg);
      });

      this._proc.on('close', function (code) {
        s._cleanup();
        if (s._cancelling || spawnErrored) return;

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
      if (!this._proc && !this._stagingInFlight) return;
      this._cancelling = true;
      if (this._proc) {
        try {
          if (process.platform === 'win32') {
            window.FileSystem.childProcess.execSync('taskkill /F /T /PID ' + this._proc.pid, { windowsHide: true });
          } else {
            this._proc.kill('SIGTERM');
          }
        } catch (e) {}
      }
      if (!this._stagingInFlight) this._cleanup();
    },

    isRunning: function () {
      return this._proc !== null || this._stagingInFlight;
    },

    _cleanup: function () {
      this._proc = null;
      if (!this._stagingInFlight) this._cleanupStaging();
    }
  };

  window.AmvergeHandler = AmvergeHandler;
})();
