/**
 * amvergeRuntime.js - provisions the shared AMVerge Python runtime.
 *
 * The desktop app does this in Rust (deps/install.rs) with a bundled `uv`.
 * The extension ships its own copy so it can do the same, which is what lets
 * either product be installed alone and still end up with one environment both
 * can use.
 *
 * The constants below MUST match deps/packs.rs. Two products writing one venv
 * with different ideas of the Python version or CUDA index would fight over it.
 */
(function () {
  'use strict';

  var PYTHON_VERSION = '3.12';
  var PYTHON_VERSION_GPU_DECODE = '3.13';
  var TORCH_CUDA_INDEX = 'https://download.pytorch.org/whl/cu128';
  var TORCH_CUDA_INDEX_GPU_DECODE = 'https://download.pytorch.org/whl/cu130';
  var TORCH_PIN_GPU_DECODE = 'torch==2.13.*';
  var TORCH_FAMILY = ['torch', 'torchvision'];

  var AmvergeRuntime = {
    /** the bundled uv, falling back to the app's staged copy and then PATH */
    uvPath: function () {
      var fs = window.FileSystem;
      if (!fs || !fs.path) return null;

      var triple = process.platform === 'win32'
        ? 'x86_64-pc-windows-msvc'
        : (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin');
      var exe = process.platform === 'win32' ? 'uv.exe' : 'uv';

      // inside the .zxp, staged by `npm run fetch:uv`
      var bundled = fs.path.join(fs.getExtensionRoot(), 'bin', 'uv', triple, exe);
      if (fs.fileExists(bundled)) {
        fs.ensureExecutable(bundled);
        return bundled;
      }

      // a dev checkout of the app beside this one, so `tauri dev` and the
      // extension share one download
      if (process.env.AMVERGE_UV) {
        if (fs.fileExists(process.env.AMVERGE_UV)) return process.env.AMVERGE_UV;
      }

      return exe; // PATH, if the user happens to have uv
    },

    /** where a new runtime goes: the shared, product-neutral location */
    sharedRuntimeDir: function () {
      var fs = window.FileSystem;
      var path = fs.path;
      var home = fs.getHomeDir();

      if (process.env.AMVERGE_RUNTIME_DIR) return process.env.AMVERGE_RUNTIME_DIR;
      if (process.platform === 'win32') {
        var local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return path.join(local, 'AMVerge', 'runtime');
      }
      if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'AMVerge', 'runtime');
      }
      return path.join(home, '.local', 'share', 'AMVerge', 'runtime');
    },

    /** the runtime in use: an existing one wherever it is, else the shared one.
     *
     * A venv records its absolute path in pyvenv.cfg and in every console
     * script, so one that already exists is used where it stands.
     */
    runtimeDir: function () {
      var fs = window.FileSystem;
      var roots = fs.getRuntimeRoots();
      for (var i = 0; i < roots.length; i++) {
        var win = fs.path.join(roots[i], 'pyenv', 'Scripts', 'python.exe');
        var nix = fs.path.join(roots[i], 'pyenv', 'bin', 'python');
        if (fs.fileExists(win) || fs.fileExists(nix)) return roots[i];
      }
      return this.sharedRuntimeDir();
    },

    pythonIn: function (runtimeDir) {
      var path = window.FileSystem.path;
      return process.platform === 'win32'
        ? path.join(runtimeDir, 'pyenv', 'Scripts', 'python.exe')
        : path.join(runtimeDir, 'pyenv', 'bin', 'python');
    },

    /** `major.minor` of an existing runtime's interpreter, or null */
    pythonVersionOf: function (python) {
      return this._ask(python, "import sys; print('%d.%d' % sys.version_info[:2])");
    },

    /** whether the runtime currently has Nelux, so an ordinary pack install can
     *  leave the GPU decode profile exactly as it found it */
    hasNelux: function (python) {
      return this._ask(python, 'import importlib.util as u; print(u.find_spec("nelux") is not None)') === 'True';
    },

    /** true when amverge is an editable install pointing outside site-packages */
    isEditableCheckout: function (python) {
      var where = this._ask(python,
        'import amverge, pathlib; print(pathlib.Path(amverge.__file__).parent)');
      return !!where && where.toLowerCase().indexOf('site-packages') === -1;
    },

    /** the distributions an amverge extra would have pulled in.
     *
     * Only what the runtime needs installing; torch is handled separately by
     * TORCH_FAMILY. Mirrors the extras in the CLI's pyproject.
     */
    _distsForExtras: function (extras) {
      var map = {
        ml: ['transnetv2-pytorch', 'tqdm'],
        nelux: ['nelux>=0.18'],
        depth: ['depth-anything-v2', 'opencv-python-headless'],
        interpolation: ['scipy', 'opencv-python-headless'],
        scout: ['transformers', 'pillow'],
        upscale: ['spandrel', 'onnxruntime']
      };
      var out = [];
      for (var i = 0; i < extras.length; i++) {
        var dists = map[extras[i]] || [];
        for (var j = 0; j < dists.length; j++) {
          if (out.indexOf(dists[j]) === -1) out.push(dists[j]);
        }
      }
      return out;
    },

    _ask: function (python, code) {
      var fs = window.FileSystem;
      if (!fs.fileExists(python)) return null;
      try {
        var res = fs.childProcess.spawnSync(python, ['-c', code], {
          encoding: 'utf8', timeout: 20000, windowsHide: true
        });
        if (!res || res.status !== 0) return null;
        return (res.stdout || '').trim() || null;
      } catch (e) {
        return null;
      }
    },

    /** environment every uv call runs with, matching the app's exactly */
    _uvEnv: function (runtimeDir) {
      var path = window.FileSystem.path;
      var env = {};
      for (var k in process.env) {
        if (process.env.hasOwnProperty(k)) env[k] = process.env[k];
      }
      env.UV_PYTHON_INSTALL_DIR = path.join(runtimeDir, 'python');
      env.UV_CACHE_DIR = path.join(runtimeDir, 'uv-cache');
      env.UV_PYTHON_PREFERENCE = 'only-managed';
      env.UV_CONCURRENT_DOWNLOADS = '8';
      return env;
    },

    /**
     * install packs into the shared runtime, provisioning it if needed.
     *
     * opts: { extras: ['ml'], gpu: bool, gpuDecode: bool }
     * callbacks: { onLine, onStage, onDone(ok, detail) }
     */
    install: function (opts, callbacks) {
      var s = this;
      var fs = window.FileSystem;
      var cb = callbacks || {};
      var line = cb.onLine || function () {};
      var stage = cb.onStage || function () {};
      var done = cb.onDone || function () {};

      if (!fs || !fs.childProcess) {
        done(false, 'Node child_process is unavailable.');
        return;
      }

      var uv = this.uvPath();
      var runtimeDir = this.runtimeDir();
      var python = this.pythonIn(runtimeDir);
      var env = this._uvEnv(runtimeDir);

      fs.createFolder(runtimeDir);

      var existing = this.pythonVersionOf(python);
      var hasNelux = existing ? this.hasNelux(python) : false;
      // undefined leaves the profile as it is, for an ordinary pack install
      var wantNelux = opts.gpuDecode === undefined ? hasNelux : !!opts.gpuDecode;

      // only when the request cannot be met by the env that exists. going back
      // to the default profile never needs one: 3.13 runs everything 3.12 does,
      // so turning GPU decode off is just removing Nelux, with no download
      var needsRebuild = !existing ||
        (wantNelux && existing !== PYTHON_VERSION_GPU_DECODE);

      var finish = function (code, last) {
        if (code !== 0) {
          done(false, last || 'uv exited with code ' + code);
          return;
        }
        done(true, runtimeDir);
      };

      // turning it off is only ever removing Nelux. nothing else in the
      // environment changes, so there is no resolution to run and nothing to
      // download - and no chance of sending a working torch back an index
      if (opts.gpuDecode === false && existing) {
        if (!hasNelux) {
          done(true, runtimeDir);
          return;
        }
        stage('Removing GPU decode...');
        this._run(uv, ['pip', 'uninstall', '--python', python, 'nelux'], env, line, finish);
        return;
      }

      var installPacks = function () {
        var extras = (opts.extras || []).slice();
        if (wantNelux && extras.indexOf('nelux') === -1) extras.push('nelux');
        if (!extras.length) extras.push('ml');

        var args = ['pip', 'install', '--python', python];

        if (s.isEditableCheckout(python)) {
          // a developer's editable amverge would be replaced by the published
          // wheel, silently reverting the CLI to whatever is on PyPI. name the
          // extras' own distributions instead and leave the checkout alone
          line('Keeping the editable amverge checkout; installing extras directly.');
          args = args.concat(s._distsForExtras(extras));
        } else {
          args.push('amverge[' + extras.join(',') + ']');
        }

        args = args.concat(TORCH_FAMILY);
        if (wantNelux) args.push(TORCH_PIN_GPU_DECODE);
        if (opts.gpu && process.platform !== 'darwin') {
          args.push('--extra-index-url');
          args.push(wantNelux ? TORCH_CUDA_INDEX_GPU_DECODE : TORCH_CUDA_INDEX);
        }

        stage(wantNelux
          ? 'Installing GPU decode and PyTorch...'
          : 'Installing AI packages and PyTorch...');
        s._run(uv, args, env, line, finish);
      };

      if (!needsRebuild) {
        installPacks();
        return;
      }

      stage('Preparing the Python environment...');
      var venvArgs = ['venv', fs.path.join(runtimeDir, 'pyenv'), '--python',
                      wantNelux ? PYTHON_VERSION_GPU_DECODE : PYTHON_VERSION];
      // --clear so an interpreter of the wrong version, and everything built
      // against it, goes rather than being half-reused
      if (existing) venvArgs.push('--clear');

      this._run(uv, venvArgs, env, line, function (code, last) {
        if (code !== 0) {
          done(false, last || 'Environment setup failed (' + code + ')');
          return;
        }
        installPacks();
      });
    },

    installBase: function (callbacks) {
      var s = this;
      var fs = window.FileSystem;
      var cb = callbacks || {};
      var line = cb.onLine || function () {};
      var stage = cb.onStage || function () {};
      var done = cb.onDone || function () {};

      if (!fs || !fs.childProcess) {
        done(false, 'Node child_process is unavailable.');
        return;
      }

      var uv = this.uvPath();
      var runtimeDir = this.runtimeDir();
      var python = this.pythonIn(runtimeDir);
      var env = this._uvEnv(runtimeDir);

      fs.createFolder(runtimeDir);

      var installCli = function () {
        stage('Installing the AMVerge CLI...');
        s._run(uv, ['pip', 'install', '--python', python, 'amverge[edge]'], env, line,
          function (code, last) {
            if (code !== 0) {
              done(false, last || 'uv exited with code ' + code);
              return;
            }
            done(true, runtimeDir);
          });
      };

      if (this.pythonVersionOf(python)) {
        installCli();
        return;
      }

      stage('Preparing the Python environment...');
      this._run(uv, ['venv', fs.path.join(runtimeDir, 'pyenv'), '--python', PYTHON_VERSION], env, line,
        function (code, last) {
          if (code !== 0) {
            done(false, last || 'Environment setup failed (' + code + ')');
            return;
          }
          installCli();
        });
    },

    _run: function (command, args, env, onLine, onClose) {
      var proc;
      var lastLine = '';
      try {
        proc = window.FileSystem.childProcess.spawn(command, args, {
          env: env, windowsHide: true
        });
      } catch (e) {
        onClose(-1, 'Could not start ' + command + ': ' + e.message);
        return;
      }

      var onData = function (buf) {
        var lines = String(buf).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var text = lines[i].trim();
          if (!text) continue;
          lastLine = text;
          onLine(text);
        }
      };
      if (proc.stdout) proc.stdout.on('data', onData);
      if (proc.stderr) proc.stderr.on('data', onData);

      var settled = false;
      proc.on('close', function (code) {
        if (settled) return;
        settled = true;
        onClose(code, lastLine);
      });
      // an 'error' event with no listener throws, and the caller would sit on a
      // progress bar with nothing to explain why
      proc.on('error', function (err) {
        if (settled) return;
        settled = true;
        onClose(-1, command + ' failed to run: ' + err.message);
      });
    }
  };

  window.AmvergeRuntime = AmvergeRuntime;
})();
