/**
 * DaVinci Resolve Studio bridge for AMVerge's shared UI.
 * Loaded before CSInterface.js in the Resolve build to shim CEP APIs
 * onto DaVinci Resolve's WorkflowIntegration.node native module.
 */
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var electron = null;
  try {
    electron = require('electron');
  } catch (e) {}

  var PLUGIN_ID = 'com.amverge.resolve';
  var PLUGIN_ROOT = path.resolve(__dirname, '..');
  var resolveObj = null;

  function loadWorkflowIntegration() {
    var candidates = [
      path.join(PLUGIN_ROOT, 'WorkflowIntegration.node'),
      path.join(__dirname, 'WorkflowIntegration.node'),
    ];

    if (process.platform === 'win32') {
      var programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      candidates.push(
        path.join(
          programData,
          'Blackmagic Design',
          'DaVinci Resolve',
          'Support',
          'Developer',
          'Workflow Integrations',
          'Examples',
          'SamplePlugin',
          'WorkflowIntegration.node'
        )
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node'
      );
    } else {
      candidates.push(
        '/opt/resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node'
      );
    }

    for (var i = 0; i < candidates.length; i++) {
      try {
        if (fs.existsSync(candidates[i])) {
          return require(candidates[i]);
        }
      } catch (e) {}
    }
    return null;
  }

  function getResolve() {
    if (resolveObj) return resolveObj;
    var wi = loadWorkflowIntegration();
    if (!wi) return null;
    try {
      if (!wi.Initialize(PLUGIN_ID)) return null;
      resolveObj = wi.GetResolve();
      return resolveObj;
    } catch (e) {
      return null;
    }
  }

  function findOrCreateBin(mediaPool, rootFolder, binName) {
    var subs = rootFolder.GetSubFolderList ? rootFolder.GetSubFolderList() : [];
    if (Array.isArray(subs)) {
      for (var i = 0; i < subs.length; i++) {
        if (subs[i] && subs[i].GetName && subs[i].GetName() === binName) {
          return subs[i];
        }
      }
    }
    return mediaPool.AddSubFolder ? mediaPool.AddSubFolder(rootFolder, binName) : rootFolder;
  }

  function findClipByPath(folder, targetPath) {
    if (!folder) return null;
    var lower = String(targetPath).toLowerCase();
    var clips = folder.GetClipList ? folder.GetClipList() : [];
    if (Array.isArray(clips)) {
      for (var i = 0; i < clips.length; i++) {
        try {
          var p = clips[i].GetClipProperty('File Path');
          if (p && String(p).toLowerCase() === lower) {
            return clips[i];
          }
        } catch (e) {}
      }
    }
    var subs = folder.GetSubFolderList ? folder.GetSubFolderList() : [];
    if (Array.isArray(subs)) {
      for (var j = 0; j < subs.length; j++) {
        var found = findClipByPath(subs[j], targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  function importClipToResolve(args) {
    var filePath = args[0] || '';
    var layerName = args[1] || '';
    var sourceIn = typeof args[5] === 'number' ? args[5] : null;
    var sourceDuration = typeof args[6] === 'number' ? args[6] : null;

    if (!filePath || !fs.existsSync(filePath)) {
      return JSON.stringify({ ok: false, message: 'File not found: ' + filePath, filePath: filePath, name: layerName });
    }

    var resolve = getResolve();
    if (!resolve) {
      return JSON.stringify({ ok: false, message: 'DaVinci Resolve Studio integration is not connected.' });
    }

    var pm = resolve.GetProjectManager();
    var project = pm && pm.GetCurrentProject();
    if (!project) {
      return JSON.stringify({ ok: false, message: 'No project open in DaVinci Resolve.' });
    }

    var mediaPool = project.GetMediaPool();
    var rootFolder = mediaPool && mediaPool.GetRootFolder();
    if (!mediaPool || !rootFolder) {
      return JSON.stringify({ ok: false, message: 'Could not access Media Pool.' });
    }

    var targetBin = findOrCreateBin(mediaPool, rootFolder, 'AMVerge Clips') || rootFolder;
    mediaPool.SetCurrentFolder(targetBin);

    var mediaPoolItem = findClipByPath(targetBin, filePath) || findClipByPath(rootFolder, filePath);
    if (!mediaPoolItem) {
      var imported = mediaPool.ImportMedia([filePath]);
      if (!imported || !imported.length) {
        return JSON.stringify({ ok: false, message: 'Failed to import media into DaVinci Resolve.' });
      }
      mediaPoolItem = imported[0];
    }

    var timeline = project.GetCurrentTimeline();
    if (timeline) {
      var clipInfo = { mediaPoolItem: mediaPoolItem };
      if (sourceIn !== null && sourceIn >= 0 && sourceDuration !== null && sourceDuration > 0) {
        var fps = parseFloat(mediaPoolItem.GetClipProperty('FPS')) || 24;
        clipInfo.startFrame = Math.round(sourceIn * fps);
        clipInfo.endFrame = Math.round((sourceIn + sourceDuration) * fps);
      }
      mediaPool.AppendToTimeline([clipInfo]);
      return JSON.stringify({
        ok: true,
        message: 'Appended clip to active timeline',
        filePath: filePath,
        name: layerName || mediaPoolItem.GetClipProperty('Clip Name') || path.basename(filePath),
      });
    }

    return JSON.stringify({
      ok: true,
      message: 'Imported clip into AMVerge Clips bin',
      filePath: filePath,
      name: layerName || mediaPoolItem.GetClipProperty('Clip Name') || path.basename(filePath),
    });
  }

  function getSelectedLayerInfoResolve() {
    var resolve = getResolve();
    if (!resolve) {
      return JSON.stringify({ ok: false, message: 'DaVinci Resolve Studio is not connected' });
    }
    var pm = resolve.GetProjectManager();
    var project = pm && pm.GetCurrentProject();
    if (!project) {
      return JSON.stringify({ ok: false, message: 'No project open' });
    }
    var timeline = project.GetCurrentTimeline();
    var item = timeline && timeline.GetCurrentVideoItem ? timeline.GetCurrentVideoItem() : null;
    if (!item) {
      return JSON.stringify({ ok: false, message: 'No clip under playhead' });
    }
    var mpi = item.GetMediaPoolItem ? item.GetMediaPoolItem() : null;
    var filePath = mpi ? (mpi.GetClipProperty('File Path') || '') : '';
    var name = item.GetName ? item.GetName() : 'Unknown';
    var fps = mpi ? (parseFloat(mpi.GetClipProperty('FPS')) || 0) : 0;
    var frames = item.GetDuration ? Number(item.GetDuration()) : 0;
    var duration = fps > 0 ? frames / fps : 0;

    return JSON.stringify({
      ok: true,
      name: name,
      filePath: filePath,
      width: 0,
      height: 0,
      frameRate: Number(fps.toFixed(3)),
      duration: Number(duration.toFixed(2)),
      compName: timeline.GetName ? timeline.GetName() : '',
      layerName: name,
      layerDuration: Number(duration.toFixed(2)),
    });
  }

  function collectFolderItems(folder, out) {
    if (!folder) return;
    var clips = folder.GetClipList ? folder.GetClipList() : [];
    if (Array.isArray(clips)) {
      for (var i = 0; i < clips.length; i++) {
        try {
          var fp = clips[i].GetClipProperty('File Path');
          if (fp) {
            out.push({ name: clips[i].GetClipProperty('Clip Name') || path.basename(fp), path: fp });
          }
        } catch (e) {}
      }
    }
    var subs = folder.GetSubFolderList ? folder.GetSubFolderList() : [];
    if (Array.isArray(subs)) {
      for (var j = 0; j < subs.length; j++) {
        collectFolderItems(subs[j], out);
      }
    }
  }

  function getProjectFootageResolve() {
    var resolve = getResolve();
    if (!resolve) return JSON.stringify({ ok: false, message: 'DaVinci Resolve Studio is not connected' });
    var pm = resolve.GetProjectManager();
    var project = pm && pm.GetCurrentProject();
    var mediaPool = project && project.GetMediaPool();
    var root = mediaPool && mediaPool.GetRootFolder();
    if (!root) return JSON.stringify({ ok: false, message: 'No project open' });
    var items = [];
    collectFolderItems(root, items);
    return JSON.stringify({ ok: true, items: items });
  }

  function parseCallArgs(argString) {
    try {
      return JSON.parse('[' + argString + ']');
    } catch (e) {
      return [];
    }
  }

  function evalScriptShim(script, callback) {
    var result = JSON.stringify({ ok: false, message: 'Unsupported host call' });
    try {
      var trimmed = String(script || '').trim();
      if (trimmed.indexOf('getSelectedLayerInfo') === 0) {
        result = getSelectedLayerInfoResolve();
      } else if (trimmed.indexOf('getProjectFootage') === 0) {
        result = getProjectFootageResolve();
      } else if (trimmed.indexOf('importClipToAE(') === 0) {
        var inner = trimmed.slice('importClipToAE('.length, -1);
        result = importClipToResolve(parseCallArgs(inner));
      }
    } catch (err) {
      result = JSON.stringify({ ok: false, message: 'Resolve bridge error: ' + String(err) });
    }
    if (typeof callback === 'function') {
      setTimeout(function () { callback(result); }, 0);
    }
  }

  // Expose CEP-compatible shims for the shared AMVerge UI
  window.cep_node = { require: require };
  window.cep = window.cep || {};
  window.cep.util = window.cep.util || {
    openURLInDefaultBrowser: function (url) {
      if (electron && electron.shell && electron.shell.openExternal) {
        electron.shell.openExternal(url);
        return 0;
      }
      return 1;
    },
  };

  window.__adobe_cep__ = {
    evalScript: evalScriptShim,
    getSystemPath: function () { return PLUGIN_ROOT; },
    getExtensionId: function () { return PLUGIN_ID; },
    getHostEnvironment: function () {
      return JSON.stringify({ appId: 'RESOLVE', appName: 'DaVinci Resolve' });
    },
    getWindowWidth: function () { return window.innerWidth; },
    getWindowHeight: function () { return window.innerHeight; },
    resizeContent: function () {},
    openURLInDefaultBrowser: function (url) {
      if (electron && electron.shell && electron.shell.openExternal) {
        electron.shell.openExternal(url);
      }
    },
  };
  window.__adobe_cep_ = window.__adobe_cep__;
})();
