(function () {
  // one spawn per chunk, not per clip. windows caps a command line at about
  // 32k characters, and a long episode's paths blow past that
  var MAX_CLIPS_PER_SPAWN = 40;
  var MAX_ARG_CHARS = 24000;

  // how many clips may jump the background queue at once. without a cap, a
  // grid whose scenes carry no thumbnails asks for every tile at once and
  // spawns hundreds of processes
  var MAX_URGENT = 2;

  var PROBE_TIMEOUT = 60000;
  var URGENT_TIMEOUT = 120000;
  var BATCH_TIMEOUT = 15 * 60 * 1000;

  /** browser-playable paths for an episode's clips.
   *
   * Cutting stream-copies the video, so every clip inherits the source codec.
   * HEVC and 10-bit H.264 both demux and play their audio here while the
   * picture stays black, because CEP's Chromium decodes neither.
   *
   * Two things make this fast enough to sit behind a click. Clips all share one
   * codec, so a single probe decides for the whole episode and a playable one
   * costs nothing at all afterwards. When proxies are needed they are built for
   * the whole episode in the background, in parallel, from one process, so by
   * the time anything is clicked the answer is usually already cached.
   */
  var PreviewProxy = {
    // null until probed, then true when originals cannot be shown as-is
    _needsProxy: null,
    _cache: {},
    // clip paths belonging to the loaded episode, the only ones worth proxying
    _known: {},
    _waiters: {},
    _urgent: {},
    _wantUrgent: {},
    _procs: [],
    _clips: [],
    _clis: null,
    // the CLI that answered last, tried first from then on
    _cli: null,
    // CLIs found to lack `preview-proxy`, keyed by command. version skew is
    // normal: the app's managed venv holds a released wheel, often older than a
    // developer's checkout, so the CLI preferred for detection is frequently
    // not one that can build a proxy
    _unsupported: {},
    // bumped on every reset, so results from the previous episode are ignored
    // instead of populating a cache that no longer matches the grid
    _episode: 0,

    /** point at a new episode, discarding whatever the last one built */
    reset: function (scenes, app) {
      this.cancel();
      this._episode++;
      this._needsProxy = null;
      this._cache = {};
      this._known = {};
      this._waiters = {};
      this._urgent = {};
      this._wantUrgent = {};
      this._clips = [];

      if (!scenes || !scenes.length) return;

      // `collect_scenes` names clips optimistically, so a scene can carry a
      // path for a file ffmpeg never wrote. those are dropped here rather than
      // spending a transcode slot on them
      var fs = window.FileSystem;
      this._known = {};
      for (var i = 0; i < scenes.length; i++) {
        var p = scenes[i].clip_path || scenes[i].path || '';
        if (!p) continue;
        if (fs && fs.fileExists && !fs.fileExists(p)) continue;
        this._clips.push(p);
        this._known[p] = true;
      }
      if (!this._clips.length) return;

      this._clis = app && app._resolveCliCandidates ? app._resolveCliCandidates() : null;
      if (!this._clis || !this._clis.length ||
          !window.FileSystem || !window.FileSystem.childProcess) {
        // nothing to build with, so originals are all there is
        this._needsProxy = false;
        return;
      }

      this._probe();
    },

    /** the playable path for a clip if it is already known, else null */
    cached: function (clipPath) {
      if (this._needsProxy === false) return clipPath;
      // anything that is not one of this episode's clips is the source video,
      // which the preview falls back to when a clip never got written. proxying
      // a whole episode to look at one scene of it is not a trade worth making
      if (!this._known[clipPath]) return clipPath;
      return this._cache[clipPath] || null;
    },

    /** call back with a playable path for `clipPath`, immediately when known.
     *
     * The callback always runs exactly once. It falls back to the original clip
     * rather than never firing: a black picture beats a preview that hangs.
     *
     * `urgent` is for the clip someone is waiting on, which is the one they
     * clicked. Everything else rides the background pass, so a mouse crossing
     * the grid cannot push the opened clip out of the way.
     */
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
      if (urgent) this._wantUrgent[clipPath] = true;

      // while the probe is still out there is nothing useful to spawn. the
      // waiter is served the moment it answers
      if (urgent && this._needsProxy === true) this._buildNow(clipPath);
    },

    /** stop every running build and release anything waiting on one */
    cancel: function () {
      for (var i = 0; i < this._procs.length; i++) this._kill(this._procs[i]);
      this._procs = [];
      this._urgent = {};
      this._wantUrgent = {};
      this._flushWaiters();
    },

    _probe: function () {
      var s = this;
      var ep = this._episode;
      var target = this._firstExistingClip();
      if (!target) {
        this._needsProxy = false;
        this._flushWaiters();
        return;
      }

      var answered = false;
      this._spawn(['preview-proxy', target, '--probe', '--json'], PROBE_TIMEOUT,
        function (row) {
          if (ep !== s._episode || row.playable === undefined) return;
          answered = true;
          s._needsProxy = row.playable === false;

          if (!s._needsProxy) {
            dbg('info', 'Proxy', 'Clips play as-is, no proxies needed');
            s._flushWaiters();
            return;
          }

          dbg('info', 'Proxy', 'Clips are ' + row.codec + ' (' + row.pixFmt +
              '), building preview proxies for ' + s._clips.length + ' clips');
          s._prewarm();
          // anything clicked during the probe has been waiting on this answer
          for (var clip in s._wantUrgent) {
            if (s._wantUrgent.hasOwnProperty(clip)) s._buildNow(clip);
          }
        },
        function () {
          if (ep !== s._episode || answered) return;
          // no CLI could answer, so assume the originals are fine rather than
          // leaving every preview waiting on a proxy that will never arrive
          s._needsProxy = false;
          s._flushWaiters();
        });
    },

    /** build every clip's proxy in the background, in grid order */
    _prewarm: function () {
      var s = this;
      var ep = this._episode;
      var chunks = this._chunk(this._clips);

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

    /** jump one clip ahead of the background queue.
     *
     * Over the cap the request simply waits: the prewarm pass is already
     * working through the same clips, so it will be served either way.
     */
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
      var original = row.original;
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

    /** run `preview-proxy` on the first CLI that has the command.
     *
     * `onRow` fires per JSON line as results stream in. `onDone` fires once,
     * after every candidate has been tried or one has finished.
     */
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

        // `missing` separates "this CLI cannot do the job" from "this run went
        // wrong". Only the first is worth remembering: blacklisting a working
        // CLI over one bad clip would cost every later preview in the session.
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

        // an 'error' event with no listener throws, which would take down
        // whatever click started this. ENOENT just means this candidate is not
        // installed, so move along to the next one
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

    _chunk: function (clips) {
      var chunks = [];
      var current = [];
      var chars = 0;
      for (var i = 0; i < clips.length; i++) {
        if (current.length >= MAX_CLIPS_PER_SPAWN ||
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

    _firstExistingClip: function () {
      var fs = window.FileSystem;
      for (var i = 0; i < this._clips.length; i++) {
        if (!fs || !fs.fileExists || fs.fileExists(this._clips[i])) return this._clips[i];
      }
      return null;
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
