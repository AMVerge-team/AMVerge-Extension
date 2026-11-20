// AMVerge ExtendScript host
// Functions exposed to CEP JS via evalScript

function jsonEscape(value) {
  if (typeof value === "string") {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  }
  return String(value);
}

function amvergeJson(ok, message, filePath, name) {
  return '{"ok":' + (ok ? "true" : "false") + ',"message":"' + jsonEscape(message || "") + '","filePath":"' + jsonEscape(filePath || "") + '","name":"' + jsonEscape(name || "") + '"}';
}

function isPremiere() {
  try {
    return typeof app !== "undefined" && app.appName && String(app.appName).indexOf("Premiere") !== -1;
  } catch (e) {
    return false;
  }
}

function pproFindOrCreateBin(parentItem, binName) {
  if (!parentItem || !parentItem.children) return null;
  for (var i = 0; i < parentItem.children.numItems; i++) {
    var child = parentItem.children[i];
    if (child && child.type === ProjectItemType.BIN && child.name === binName) {
      return child;
    }
  }
  return parentItem.createBin(binName);
}

function pproFindItemByPath(parentItem, targetFsName) {
  if (!parentItem || !parentItem.children) return null;
  var lowerTarget = String(targetFsName).toLowerCase();
  for (var i = 0; i < parentItem.children.numItems; i++) {
    var child = parentItem.children[i];
    if (!child) continue;
    if (child.type === ProjectItemType.BIN) {
      var nested = pproFindItemByPath(child, targetFsName);
      if (nested) return nested;
    } else if (child.getMediaPath) {
      try {
        var mediaPath = child.getMediaPath();
        if (mediaPath && String(mediaPath).toLowerCase() === lowerTarget) {
          return child;
        }
      } catch (e) {}
    }
  }
  return null;
}

function importClipToPremiere(filePath, layerName, sourceIn, sourceDuration, timelineStart) {
  try {
    if (!app.project || !app.project.rootItem) {
      return amvergeJson(false, "No project open");
    }

    var targetFile = new File(filePath);
    if (!targetFile.exists) {
      return amvergeJson(false, "File not found: " + filePath);
    }

    var targetBin = pproFindOrCreateBin(app.project.rootItem, "AMVerge Clips") || app.project.rootItem;
    var projectItem = pproFindItemByPath(targetBin, targetFile.fsName) || pproFindItemByPath(app.project.rootItem, targetFile.fsName);

    if (!projectItem) {
      var imported = app.project.importFiles([targetFile.fsName], true, targetBin, false);
      if (!imported) {
        return amvergeJson(false, "Failed to import footage into Premiere Pro");
      }
      projectItem = pproFindItemByPath(targetBin, targetFile.fsName);
      if (!projectItem && targetBin.children && targetBin.children.numItems > 0) {
        projectItem = targetBin.children[targetBin.children.numItems - 1];
      }
    }

    if (!projectItem) {
      return amvergeJson(false, "Imported clip could not be located in project");
    }

    if (layerName && projectItem.name !== layerName) {
      try {
        projectItem.name = layerName;
      } catch (e) {}
    }

    if (typeof sourceIn === "number" && sourceIn >= 0 && typeof sourceDuration === "number" && sourceDuration > 0) {
      try {
        // Premiere Pro ticks: 254016000000 ticks per second
        var inTicks = String(Math.round(sourceIn * 254016000000));
        var outTicks = String(Math.round((sourceIn + sourceDuration) * 254016000000));
        projectItem.setInPoint(inTicks, 4);
        projectItem.setOutPoint(outTicks, 4);
      } catch (e) {}
    }

    var seq = app.project.activeSequence;
    if (seq && seq.videoTracks && seq.videoTracks.numTracks > 0) {
      var targetTime = typeof timelineStart === "number" && timelineStart >= 0
        ? timelineStart
        : seq.getPlayerPosition();
      // overwriteClip places at the playhead without shifting later timeline cuts
      seq.videoTracks[0].overwriteClip(projectItem, targetTime);
      return amvergeJson(true, "Imported clip to active sequence", filePath, layerName || projectItem.name);
    }

    return amvergeJson(true, "Imported clip into AMVerge Clips bin", filePath, layerName || projectItem.name);
  } catch (err) {
    return amvergeJson(false, "Premiere ExtendScript error: " + String(err));
  }
}

function pproGetSelectedLayerInfo() {
  try {
    if (!app.project) {
      return '{"ok":false,"message":"No project open"}';
    }

    var projectItem = null;
    var trackItem = null;
    var seq = app.project.activeSequence;

    if (seq && seq.getSelection) {
      var selection = seq.getSelection();
      if (selection && selection.length > 0) {
        for (var i = 0; i < selection.length; i++) {
          if (selection[i] && selection[i].projectItem) {
            trackItem = selection[i];
            projectItem = selection[i].projectItem;
            break;
          }
        }
      }
    }

    if (!projectItem && app.getCurrentProjectViewSelection) {
      var binSel = app.getCurrentProjectViewSelection();
      if (binSel && binSel.length > 0) {
        for (var j = 0; j < binSel.length; j++) {
          if (binSel[j] && binSel[j].type !== ProjectItemType.BIN && binSel[j].getMediaPath) {
            projectItem = binSel[j];
            break;
          }
        }
      }
    }

    if (!projectItem) {
      return '{"ok":false,"message":"No clip selected"}';
    }

    var filePath = "";
    try {
      filePath = projectItem.getMediaPath() || "";
    } catch (e) {}

    var name = projectItem.name || "Unknown";
    var dur = 0;
    if (trackItem && trackItem.duration && typeof trackItem.duration.seconds === "number") {
      dur = trackItem.duration.seconds;
    }

    var json = '{"ok":true';
    json += ',"name":"' + jsonEscape(name) + '"';
    json += ',"filePath":"' + jsonEscape(filePath) + '"';
    json += ',"width":0,"height":0,"frameRate":0,"duration":' + dur.toFixed(2);
    if (seq) {
      json += ',"compName":"' + jsonEscape(String(seq.name || "")) + '"';
      if (trackItem) {
        json += ',"layerName":"' + jsonEscape(String(trackItem.name || name)) + '"';
        json += ',"layerDuration":' + dur.toFixed(2);
      }
    }
    json += '}';
    return json;
  } catch (err) {
    return '{"ok":false,"message":"' + jsonEscape(String(err)) + '"}';
  }
}

function pproCollectFootage(parentItem, parts) {
  if (!parentItem || !parentItem.children) return;
  for (var i = 0; i < parentItem.children.numItems; i++) {
    var child = parentItem.children[i];
    if (!child) continue;
    if (child.type === ProjectItemType.BIN) {
      pproCollectFootage(child, parts);
    } else if (child.getMediaPath) {
      try {
        var mediaPath = child.getMediaPath();
        if (mediaPath) {
          parts.push('{"name":"' + jsonEscape(child.name || "") + '","path":"' + jsonEscape(mediaPath) + '"}');
        }
      } catch (e) {}
    }
  }
}

function pproGetProjectFootage() {
  try {
    if (!app.project || !app.project.rootItem) {
      return '{"ok":false,"message":"No project open"}';
    }
    var parts = [];
    pproCollectFootage(app.project.rootItem, parts);
    return '{"ok":true,"items":[' + parts.join(',') + ']}';
  } catch (e) {
    return '{"ok":false,"message":"' + jsonEscape(e.toString()) + '"}';
  }
}

// Import a scene clip into AE or Premiere Pro - individual params
function importClipToAE(filePath, layerName, autoScale, offset, prevDuration, sourceIn, sourceDuration, timelineStart) {
  if (isPremiere()) {
    return importClipToPremiere(filePath, layerName, sourceIn, sourceDuration, timelineStart);
  }
  try {
    if (!app.project) {
      return amvergeJson(false, "No project open");
    }

    var targetFile = new File(filePath);
    if (!targetFile.exists) {
      return amvergeJson(false, "File not found: " + filePath);
    }

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      var foundComp = null;
      for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i) instanceof CompItem) {
          foundComp = app.project.item(i);
          break;
        }
      }
      if (foundComp) {
        comp = foundComp;
      } else {
        comp = app.project.items.addComp("AMVerge Comp", 1920, 1080, 1.0, 60.0, 24.0);
      }
    }

    // Find or create 'AMVerge Clips' folder in Project bin
    var folderName = "AMVerge Clips";
    var targetFolder = null;
    for (var f = 1; f <= app.project.numItems; f++) {
      var itm = app.project.item(f);
      if (itm instanceof FolderItem && itm.name === folderName) {
        targetFolder = itm;
        break;
      }
    }
    if (!targetFolder) {
      targetFolder = app.project.items.addFolder(folderName);
    }

    // Check if footage already imported in project
    var footage = null;
    for (var j = 1; j <= app.project.numItems; j++) {
      var item = app.project.item(j);
      if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
        if (item.mainSource.file.fsName === targetFile.fsName) {
          footage = item;
          break;
        }
      }
    }

    if (!footage) {
      var importOptions = new ImportOptions(targetFile);
      footage = app.project.importFile(importOptions);
    }

    if (!footage) {
      return amvergeJson(false, "Failed to import footage");
    }

    if (targetFolder && footage.parentFolder !== targetFolder) {
      footage.parentFolder = targetFolder;
    }

    var layer = comp.layers.add(footage);
    if (!layer) {
      return amvergeJson(false, "Failed to add layer to composition");
    }

    if (layerName) {
      layer.name = layerName;
    }

    if (typeof timelineStart !== "number") timelineStart = offset ? prevDuration : 0;
    if (typeof sourceIn !== "number" || sourceIn < 0) sourceIn = 0;
    layer.startTime = timelineStart - sourceIn;
    if (typeof sourceDuration === "number" && sourceDuration > 0) {
      layer.inPoint = timelineStart;
      layer.outPoint = timelineStart + sourceDuration;
    }

    // Auto-scale to comp dimensions while preserving aspect ratio
    if (autoScale !== false && footage.width > 0 && footage.height > 0) {
      var scaleX = (comp.width / footage.width) * 100;
      var scaleY = (comp.height / footage.height) * 100;
      var uniformScale = Math.min(scaleX, scaleY);
      layer.property("Scale").setValue([uniformScale, uniformScale]);
    }

    return amvergeJson(true, "Successfully imported clip", filePath, layerName || footage.name);
  } catch (err) {
    return amvergeJson(false, "ExtendScript error: " + String(err));
  }
}

// Import a scene clip into AE
// Receives JSON string: { filePath, layerName, autoScale, startTime, offset, prevDuration }
function importSceneToAE(jsonStr) {
  var data = {};
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    return amvergeJson(false, "Invalid JSON input");
  }

  return importClipToAE(data.filePath, data.layerName, data.autoScale, data.offset, data.prevDuration, data.sourceIn, data.sourceDuration, data.timelineStart);
}

// Get selected layer info from AE or Premiere Pro
function getSelectedLayerInfo() {
  if (isPremiere()) {
    return pproGetSelectedLayerInfo();
  }
  try {
    if (!app.project) {
      return '{"ok":false,"message":"No project open"}';
    }

    var comp = app.project.activeItem;
    var layer = null;
    var footage = null;

    // Check selected layers in active comp
    if (comp && comp instanceof CompItem) {
      var sel = comp.selectedLayers;
      if (sel && sel.length > 0) {
        for (var i = 0; i < sel.length; i++) {
          var lyr = sel[i];
          if (!lyr) continue;
          var src = lyr.source;
          if (src && src instanceof FootageItem) {
            layer = lyr;
            footage = src;
            break;
          }
          if (src && src.width > 0 && src.height > 0) {
            layer = lyr;
            footage = src;
            break;
          }
        }
      }
    }

    // Fallback: selected footage in project panel
    if (!footage && app.project.selection && app.project.selection.length > 0) {
      for (var j = 0; j < app.project.selection.length; j++) {
        var itm = app.project.selection[j];
        if (itm instanceof FootageItem) {
          footage = itm;
          break;
        }
      }
    }

    // Fallback: active item is footage
    if (!footage && comp instanceof FootageItem) {
      footage = comp;
    }

    if (!footage) {
      return '{"ok":false,"message":"No footage selected"}';
    }

    var w = parseInt(footage.width) || 0;
    var h = parseInt(footage.height) || 0;
    var fps = parseFloat(footage.frameRate) || 0;
    var dur = parseFloat(footage.duration) || 0;
    var name = footage.name || "Unknown";
    var filePath = "";
    try {
      if (footage.mainSource && footage.mainSource.file) {
        filePath = footage.mainSource.file.fsName;
      }
    } catch (e) {}

    var json = '{"ok":true';
    json += ',"name":"' + jsonEscape(name) + '"';
    json += ',"filePath":"' + jsonEscape(filePath) + '"';
    json += ',"width":' + w;
    json += ',"height":' + h;
    json += ',"frameRate":' + fps.toFixed(3);
    json += ',"duration":' + dur.toFixed(2);

    if (comp && comp instanceof CompItem) {
      json += ',"compName":"' + jsonEscape(String(comp.name || "")) + '"';
      json += ',"compWidth":' + (parseInt(comp.width) || 0);
      json += ',"compHeight":' + (parseInt(comp.height) || 0);
      json += ',"compFrameRate":' + parseFloat(comp.frameRate || 0).toFixed(3);
      if (layer) {
        json += ',"layerName":"' + jsonEscape(String(layer.name || "")) + '"';
        json += ',"layerIndex":' + layer.index;
        var layerIn = parseFloat(layer.inPoint) || 0;
        var layerOut = parseFloat(layer.outPoint) || 0;
        json += ',"layerDuration":' + (layerOut - layerIn).toFixed(2);
      }
    }

    json += '}';
    return json;

  } catch (err) {
    return '{"ok":false,"message":"' + jsonEscape(String(err)) + '"}';
  }
}

// List footage items in the project panel that have a source file
function getProjectFootage() {
  if (isPremiere()) {
    return pproGetProjectFootage();
  }
  try {
    if (!app.project) {
      return '{"ok":false,"message":"No project open"}';
    }
    var parts = [];
    for (var i = 1; i <= app.project.numItems; i++) {
      var itm = app.project.item(i);
      if (itm instanceof FootageItem && itm.mainSource && itm.mainSource.file) {
        parts.push('{"name":"' + jsonEscape(itm.name) + '","path":"' + jsonEscape(itm.mainSource.file.fsName) + '"}');
      }
    }
    return '{"ok":true,"items":[' + parts.join(',') + ']}';
  } catch (e) {
    return '{"ok":false,"message":"' + jsonEscape(e.toString()) + '"}';
  }
}

$.writeln("AMVerge host.jsx loaded");
