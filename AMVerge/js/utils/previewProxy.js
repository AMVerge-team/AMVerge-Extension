(function () {
  // one spawn per chunk, not per clip. windows caps a command line at about
  // 32k characters, and a long episode's paths blow past that
  var MAX_CLIPS_PER_SPAWN = 40;
  // probing is ffprobe only, so a chunk costs far less than a chunk of
  // transcodes. bigger chunks mean fewer interpreter startups, which is most of
  // a probe pass's time
  var MAX_CLIPS_PER_PROBE = 120;
  var MAX_ARG_CHARS = 24000;

  // capped: a grid with no thumbnails would otherwise spawn hundreds at once
  var MAX_URGENT = 2;

  var PROBE_TIMEOUT = 60000;
  var URGENT_TIMEOUT = 120000;
  var BATCH_TIMEOUT = 15 * 60 * 1000;

  /** browser-playable paths for an episode's clips.
   *
   * CEP's Chromium decodes neither HEVC nor 10-bit H.264, so those play audio
   * over a black picture.
   *
   * Playability is per clip, not per episode. Keyframe detection stream-copies
   * every scene, so its clips do share the source codec, but AI detection mixes
   * modes: keyframe-aligned scenes are copied and keep the source codec, while
   * re-encodes and smartcuts come out as 8-bit H.264. One verdict for the whole
   * episode is therefore wrong for half of an AI run, which is what left some
   * clips black. Every clip is probed, and only the ones that need it are built.
   */
  var PreviewProxy = {
    // clip -> whether it can be shown as-is. absent until probed
    _playable: {},
    // set when no CLI here can answer, in which case originals are all there is
    _serveOriginals: false,
    // clips the probe rejected, built in the background in grid order
    _needBuild: [],
    _probing: {},
    _cache: {},
    // clip paths belonging to the loaded episode, the only ones worth proxying
    _known: {},
    // normalised clip path -> the spelling the grid uses
    _byNormPath: {},
    _waiters: {},
    _urgent: {},
    _wantUrgent: {},
    _procs: [],
    _clips: [],
    _clis: null,
    // the CLI that answered last, tried first from then on
    _cli: null,
    // CLIs found to lack `preview-proxy`. version skew between the app's venv
    // and a dev checkout is normal, so the preferred CLI often cannot build one
    _unsupported: {},
    // bumped on every reset, so results from the previous episode are ignored
    // instead of populating a cache that no longer matches the grid
    _episode: 0,

    /** point at a new episode, discarding whatever the last one built */
    reset: function (scenes, app) {
      this.cancel();
      this._episode++;
      this._playable = {};
      this._serveOriginals = false;
      this._needBuild = [];
      this._probing = {};
      this._cache = {};
      this._known = {};
      this._waiters = {};
      this._urgent = {};
      this._wantUrgent = {};
      this._byNormPath = {};
      this._clips = [];

      if (!scenes || !scenes.length) return;

      // `collect_scenes` names clips optimistically, so some files never exist
      var fs = window.FileSystem;
      this._known = {};
      for (var i = 0; i < scenes.length; i++) {
        var p = scenes[i].clip_path || scenes[i].path || '';
        if (!p) continue;
        if (fs && fs.fileExists && !fs.fileExists(p)) continue;
        this._clips.push(p);
        this._known[p] = true;
        this._byNormPath[this._norm(p)] = p;
      }
      if (!this._clips.length) return;

      this._clis = app && app._resolveCliCandidates ? app._resolveCliCandidates() : null;
      if (!this._clis || !this._clis.length ||
          !window.FileSystem || !window.FileSystem.childProcess) {
        // nothing to build with, so originals are all there is
        this._serveOriginals = true;
        return;
      }

      this._probeAll();
    },

    /** the playable path for a clip if it is already known, else null */
    cached: function (clipPath) {
      if (this._serveOriginals) return clipPath;
      // not a clip means the source video: never worth proxying a whole episode
      if (!this._known[clipPath]) return clipPath;
      return this._cache[clipPath] || null;
    },

    /** playable path for `clipPath`; the callback always runs exactly once, falling back to the original. `urgent` jumps the background queue. */
    request: function (clipPath, callback, urgent) {
      if (!clipPath) {
        callback('');
        return;
      }
      var hit = this.cached(clipPath);
      if (hit) {
        callback(hit);
        return;
      }

      if (!this._waiters[clipPath]) this._waiters[clipPath] = [];
      this._waiters[clipPath].push(callback);
      if (!urgent) return;

      this._wantUrgent[clipPath] = true;
      if (this._playable[clipPath] === false) this._buildNow(clipPath);
      else if (this._playable[clipPath] === undefined) this._probeNow(clipPath);
    },

    /** stop every running build and release anything waiting on one */
    cancel: function () {
      for (var i = 0; i < this._procs.length; i++) this._kill(this._procs[i]);
      this._procs = [];
      this._urgent = {};
      this._wantUrgent = {};
      this._probing = {};
      this._flushWaiters();
    },

    /** probe every clip, in grid order, a chunk per spawn.
     *
     * `--probe` is one ffprobe per clip and no transcode, so asking about all of
     * them costs little. Rows stream out as each is read, so a clip becomes
     * usable without waiting for the rest of the batch.
     */
    _probeAll: function () {
      var s = this;
      var ep = this._episode;
      var chunks = this._chunk(this._clips, MAX_CLIPS_PER_PROBE);
      var answered = false;

      var runChunk = function (i) {
        if (ep !== s._episode) return;
        if (i >= chunks.length) {
          if (!answered) {
            // no CLI could answer, so assume the originals are fine rather than
            // leaving every preview waiting on a proxy that will never arrive
            s._serveOriginals = true;
            s._flushWaiters();
            return;
          }
          s._startPrewarm();
          return;
        }
        s._spawn(['preview-proxy'].concat(chunks[i], ['--probe', '--json']), PROBE_TIMEOUT,
          function (row) {
            if (ep !== s._episode) return;
            answered = true;
            s._recordProbe(row);
          },
          function () { runChunk(i + 1); });
      };

      runChunk(0);
    },

    /** a click can land before the batch reaches that clip, and one ffprobe is
     *  cheap enough that it should not wait for the queue */
    _probeNow: function (clipPath) {
      if (this._probing[clipPath] || !this._known[clipPath]) return;
      this._probing[clipPath] = true;

      var s = this;
      var ep = this._episode;
      this._spawn(['preview-proxy', clipPath, '--probe', '--json'], PROBE_TIMEOUT,
        function (row) { if (ep === s._episode) s._recordProbe(row); },
        function () {
          if (ep !== s._episode) return;
          delete s._probing[clipPath];
          // no answer, so the original is the only thing left to offer
          if (s._playable[clipPath] === undefined) s._resolve(clipPath, clipPath);
        });
    },

    _norm: function (path) {
      return String(path).replace(/\//g, '\\').toLowerCase();
    },

    /** the grid's own spelling of a path the CLI echoed back.
     *
     * Arguments make the round trip through pathlib, which is free to normalise
     * separators. A result filed under the CLI's spelling would be one nothing
     * ever looks up, leaving that clip waiting forever.
     */
    _ownKey: function (path) {
      if (!path || this._known[path]) return path;
      return this._byNormPath[this._norm(path)] || path;
    },

    _recordProbe: function (row) {
      var clip = this._ownKey(row.original);
      if (!clip) return;

      // an unreadable clip counts as playable, as it does in the CLI, so a
      // probe failure does not queue a transcode that cannot work either
      var playable = row.error ? true : row.playable !== false;
      this._playable[clip] = playable;

      if (playable) {
        this._resolve(clip, clip);
        return;
      }
      if (this._needBuild.indexOf(clip) === -1) this._needBuild.push(clip);
      // clicked while the probe was still out, so it has been waiting on this
      if (this._wantUrgent[clip]) this._buildNow(clip);
    },

    _startPrewarm: function () {
      if (!this._needBuild.length) {
        dbg('info', 'Proxy', 'Clips play as-is, no proxies needed');
        return;
      }
      dbg('info', 'Proxy', 'Building preview proxies for ' + this._needBuild.length +
          ' of ' + this._clips.length + ' clips');
      this._prewarm(this._needBuild);
    },

    /** build proxies for the clips that need one, in the background */
    _prewarm: function (clips) {
      var s = this;
      var ep = this._episode;
      var chunks = this._chunk(clips);

      var runChunk = function (i) {
        if (ep !== s._episode) return;
        if (i >= chunks.length) {
          dbg('info', 'Proxy', 'Preview proxies ready');
          return;
        }
        s._spawn(['preview-proxy'].concat(chunks[i], ['--json']), BATCH_TIMEOUT,
          function (row) { if (ep === s._episode) s._record(row); },
          function () { runChunk(i + 1); });
      };

      runChunk(0);
    },

    /** jump one clip ahead of the queue; over the cap it just waits for the prewarm pass */
    _buildNow: function (clipPath) {
      if (this._urgent[clipPath] || this._cache[clipPath]) return;
      if (this._urgentCount() >= MAX_URGENT) return;
      this._urgent[clipPath] = true;

      var s = this;
      var ep = this._episode;
      this._spawn(['preview-proxy', clipPath, '--json'], URGENT_TIMEOUT,
        function (row) { if (ep === s._episode) s._record(row); },
        function () {
          if (ep !== s._episode) return;
          delete s._urgent[clipPath];
          // nothing came back, so hand over the original instead of spinning
          if (!s._cache[clipPath]) s._resolve(clipPath, clipPath);
        });
    },

    _urgentCount: function () {
      var n = 0;
      for (var k in this._urgent) {
        if (this._urgent.hasOwnProperty(k)) n++;
      }
      return n;
    },

    _record: function (row) {
      var original = this._ownKey(row.original);
      if (!original) return;
      if (row.error) {
        dbg('warn', 'Proxy', 'preview-proxy: ' + row.error);
        this._resolve(original, original);
        return;
      }
      this._resolve(original, row.path || original);
    },

    _resolve: function (clipPath, playablePath) {
      this._cache[clipPath] = playablePath;
      delete this._wantUrgent[clipPath];
      var waiting = this._waiters[clipPath];
      if (!waiting) return;
      delete this._waiters[clipPath];
      for (var i = 0; i < waiting.length; i++) waiting[i](playablePath);
    },

    /** hand every pending waiter the original clip and forget them */
    _flushWaiters: function () {
      var pending = this._waiters;
      this._waiters = {};
      for (var clip in pending) {
        if (!pending.hasOwnProperty(clip)) continue;
        var list = pending[clip];
        for (var i = 0; i < list.length; i++) list[i](this._cache[clip] || clip);
      }
    },

    /** run `preview-proxy` on the first CLI that has it. `onRow` per JSON line, `onDone` once. */
    _spawn: function (args, timeoutMs, onRow, onDone) {
      var s = this;
      var candidates = this._candidates();
      if (!candidates.length) {
        onDone();
        return;
      }

      var attempt = function (i) {
        if (i >= candidates.length) {
          dbg('warn', 'Proxy', 'No AMVerge CLI here has preview-proxy, so HEVC ' +
              'and 10-bit clips cannot be previewed. Update the AMVerge CLI.');
          onDone();
          return;
        }

        var cli = candidates[i];
        var proc;
        var settled = false;
        var gotRow = false;
        var stdout = '';
        var stderr = '';
        var timer = null;

        // only `missing` blacklists the CLI: a bad clip must not cost the session
        var finish = function (ok, missing) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          s._forget(proc);
          if (ok) {
            onDone();
            return;
          }
          if (missing) s._unsupported[cli.command] = true;
          attempt(i + 1);
        };

        try {
          proc = window.FileSystem.childProcess.spawn(
            cli.command, cli.prefix.concat(args), { windowsHide: true });
        } catch (e) {
          dbg('warn', 'Proxy', 'spawn failed (' + cli.command + '): ' + e.message);
          s._unsupported[cli.command] = true;
          attempt(i + 1);
          return;
        }
        s._procs.push(proc);

        // an unlistened 'error' throws; ENOENT just means try the next candidate
        proc.on('error', function (e) {
          dbg('warn', 'Proxy', 'spawn error (' + cli.command + '): ' + e.message);
          finish(false, true);
        });

        proc.stdout.on('data', function (d) {
          stdout += d.toString();
          var lines = stdout.split(String.fromCharCode(10));
          stdout = lines.pop();
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j].trim();
            if (!line) continue;
            var parsed = null;
            try { parsed = JSON.parse(line); } catch (e) { continue; }
            gotRow = true;
            s._cli = cli;
            onRow(parsed);
          }
        });

        proc.stderr.on('data', function (d) { stderr += d.toString(); });

        timer = setTimeout(function () {
          dbg('warn', 'Proxy', 'preview-proxy timed out');
          s._kill(proc);
          finish(true);
        }, timeoutMs);

        proc.on('close', function () {
          var noCommand = stderr.indexOf('No such command') !== -1;
          if (!gotRow && noCommand) {
            dbg('warn', 'Proxy', 'No preview-proxy in ' + cli.command + ', trying the next CLI');
          } else if (!gotRow && stderr.trim()) {
            dbg('warn', 'Proxy', 'preview-proxy said nothing usable: ' + stderr.trim());
          }
          // a run that said nothing usable gets no credit, so the next
          // candidate is tried whatever the CLI printed to explain itself
          finish(gotRow, noCommand);
        });
      };

      attempt(0);
    },

    _candidates: function () {
      var out = [];
      var list = this._clis || [];
      // whatever answered last time goes first, so the steady state is one spawn
      if (this._cli) list = [this._cli].concat(list);

      var seen = {};
      for (var i = 0; i < list.length; i++) {
        var cli = list[i];
        if (!cli || !cli.command || this._unsupported[cli.command]) continue;
        var key = cli.command + ' ' + (cli.prefix || []).join(' ');
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ command: cli.command, prefix: cli.prefix || [] });
      }
      return out;
    },

    _chunk: function (clips, maxClips) {
      var cap = maxClips || MAX_CLIPS_PER_SPAWN;
      var chunks = [];
      var current = [];
      var chars = 0;
      for (var i = 0; i < clips.length; i++) {
        if (current.length >= cap ||
            (current.length && chars + clips[i].length > MAX_ARG_CHARS)) {
          chunks.push(current);
          current = [];
          chars = 0;
        }
        current.push(clips[i]);
        chars += clips[i].length + 3;
      }
      if (current.length) chunks.push(current);
      return chunks;
    },

    _forget: function (proc) {
      var idx = this._procs.indexOf(proc);
      if (idx !== -1) this._procs.splice(idx, 1);
    },

    /** kill the process and its ffmpeg children, which outlive a plain kill */
    _kill: function (proc) {
      if (!proc) return;
      try {
        if (process.platform === 'win32') {
          window.FileSystem.childProcess.execSync(
            'taskkill /F /T /PID ' + proc.pid, { windowsHide: true });
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e) {}
    }
  };

  window.PreviewProxy = PreviewProxy;
})();
