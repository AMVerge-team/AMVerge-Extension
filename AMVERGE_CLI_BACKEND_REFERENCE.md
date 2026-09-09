# AMVerge CLI Backend Reference — CEP Extension Integration

> Source: `C:\Users\Moongetsu\Documents\GitHub\AMVerge-CLI-Org`
>
> PyPI package: `pip install amverge`
> CLI binary: `amverge`
> Python API: `from amverge import detect_scenes`

---

## Architecture

```
CEP Extension (JS) ──child_process.spawn──> amverge CLI / Python library
                                                  ↓
                                            PyAV + FFmpeg + PyTorch
```

The CEP extension spawns `amverge` as a subprocess (like AniSmooth spawns `python main.py`). Two integration options:

1. **CLI sidecar** — spawn `amverge backend <video> <output_dir>`, read IPC events from stderr + final JSON from stdout
2. **Python library** — spawn bundled Python + `from amverge import detect_scenes` directly

---

## Integration Option 1: CLI Sidecar (Recommended)

### Command Interface

```bash
# Detection + cutting (V2 TransNetV2 pipeline)
amverge backend <video_path> <output_dir>

# Discord RPC server (long-lived subprocess)
amverge rpc-server

# GPU/dependency check
amverge gpu --json
amverge doctor
amverge version --json
```

### IPC Protocol (stderr events, stdout JSON)

The `backend` command emits structured events to **stderr** (consumed line-by-line by JS):

| Event | Format | When |
|---|---|---|
| Progress | `PROGRESS\|<0-100>\|<message>` | Detection/cutting progress |
| Initial clips | `INITIAL_CLIPS_READY\|<json>` | Scene boundaries detected (before cutting) |
| Clip ready | `CLIP_READY\|<idx>\|<path>\|<mode>` | Single scene cut complete |
| Phase 1 done | `PHASE1_COMPLETE` | All lossless copy scenes done |
| Re-encode progress | `REENCODE_PROGRESS\|<done>\|<total>` | Re-encode phase (reported per scene) |

Final result written to **stdout** as JSON:

```json
{
  "schema_version": "1.0",
  "run_id": "<uuid>",
  "video": {
    "video_file_path": "<path>",
    "duration_sec": 1234.5,
    "width": 1920,
    "height": 1080,
    "fps": 23.976
  },
  "cache": {
    "cache_hit": false,
    "secs_path": "...",
    "frames_path": "..."
  },
  "scenes": [
    {
      "scene_index": 0,
      "start_sec": 0.0,
      "end_sec": 12.3,
      "path": "<source>",
      "thumbnail": "<source>",
      "original_file": "episode.mp4",
      "original_path": "<source>",
      "clip_path": "<output_clip.mp4>",
      "clip_mode": "copy"
    }
  ],
  "scenes_secs": [[0.0, 12.3], ...],
  "scenes_frames": [[0, 295], ...],
  "detector": { "method": "run_model_one_pass", "device": "cuda" },
  "warnings": [],
  "error": null
}
```

### JS Integration Pattern (CEP)

```js
// Spawn like AniSmooth spawns Python
var proc = cep_node.child_process.spawn('amverge', [
  'backend',
  videoPath,
  outputDir
]);

// Read IPC events from stderr
proc.stderr.on('data', function (data) {
  var lines = data.toString().split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith('PROGRESS|')) {
      var parts = line.split('|');
      var pct = parseInt(parts[1], 10);
      var msg = parts.slice(2).join('|');
      updateProgressBar(pct);
    } else if (line.startsWith('INITIAL_CLIPS_READY|')) {
      var json = line.slice('INITIAL_CLIPS_READY|'.length);
      var clips = JSON.parse(json);
      renderClips(clips);
    } else if (line.startsWith('CLIP_READY|')) {
      var parts = line.split('|');
      var idx = parseInt(parts[1], 10);
      var clipPath = parts[2];
      var mode = parts[3];
      markClipReady(idx, clipPath, mode);
    } else if (line === 'PHASE1_COMPLETE') {
      showPhase1Done();
    } else if (line.startsWith('REENCODE_PROGRESS|')) {
      var parts = line.split('|');
      var done = parseInt(parts[1], 10);
      var total = parseInt(parts[2], 10);
      showReencodeProgress(done, total);
    }
  }
});

// Read final JSON from stdout
var buffer = '';
proc.stdout.on('data', function (data) {
  buffer += data.toString();
});
proc.on('close', function (code) {
  if (code === 0) {
    var result = JSON.parse(buffer);
    // result.scenes contains final cut clips
  }
});
```

---

## Integration Option 2: Python Library

### API

```python
from amverge import detect_scenes

result = detect_scenes(
    "episode.mp4",
    output_dir="./scenes",
    method="keyframe",       # "keyframe" | "edge" | "transnetv2"
    decode_method="ffmpeg",  # "ffmpeg" | "nelux" (transnetv2 only)
    thumbnails=True,
    similarity=True,
    progress=my_callback,    # optional (stage, pct, msg)
)

for scene in result.scenes:
    print(scene.index, scene.start, scene.end, scene.path, scene.thumbnail)
```

### Return Types

| Type | Fields |
|---|---|
| `DetectResult` | `scenes: list[Scene]`, `similar_pairs: list[tuple[int,int]]`, `output_dir: str`, `scenes_json: str` |
| `Scene` | `index: int`, `start: float`, `end: float`, `duration: float`, `path: str`, `thumbnail: str\|None`, `original_file: str` |

```python
result.to_dict()    # plain dict
result.to_json(p)   # write JSON file
result.filter(min_duration=1.0)        # drop short scenes
result.merge_similar(threshold=0.1)    # merge similar pairs
```

### Detection Methods

| Method | Speed | Accuracy | Requirements | Notes |
|---|---|---|---|---|
| `keyframe` | Fastest | Low | PyAV | Cuts at I-frame boundaries, lossless |
| `edge` | Medium | Medium | PyAV + OpenCV (`[edge]`) | Canny edge + cosine sim inside keyframe windows |
| `transnetv2` | Slow (GPU/CPU) | Highest | PyTorch (`[ml]`) | Deep CNN on 48x27 frames, GPU auto |

### Decode Backends (transnetv2 only)

| Decode | Platform | Speed | Notes |
|---|---|---|---|
| `ffmpeg` | Cross-platform | Medium | Decode + inference interleaved |
| `nelux` | Windows only | Fastest | GPU decode via NVDEC, falls back to ffmpeg |

### Progress Callback

```python
def my_callback(stage: str, pct: int, msg: str):
    # stages: "detect", "segment", "thumbnails", "similarity"
    update_ui(pct, msg)
```

---

## Cutting Pipeline

### V2 (transnetv2) — Two-Phase Cutting

```
1. TransNetV2 detects scene boundaries
2. Get keyframe timestamps via PyAV
3. Check if HEVC (CPU re-encode fallback)
4. Classify scenes by keyframe alignment:
   - Phase 1: scenes starting on keyframes → lossless stream copy (8 workers)
   - Phase 2: scenes NOT on keyframes → re-encode (2 workers)
   - HEVC CPU: snapped_copy (snap to nearest keyframe within 5s) to avoid slow encode
5. Cut modes: copy, snapped_copy, smartcut (encode tiny head + copy tail), reencode
```

### V1 (keyframe/edge) — FFmpeg Segment

```
FFmpeg -segment_times with stream copy → collect scenes → generate thumbnails → similarity check
```

---

## Discord RPC

Long-lived sidecar process. Reads JSON commands from stdin:

```json
{"type": "update", "details": "Detecting scenes...", "state": "12 scenes found"}
{"type": "clear"}
{"type": "shutdown"}
```

Throttles to 1 update per 15s. Uses same CLIENT_ID as AMVerge desktop.

---

## Diagnostics (Setup Wizard)

```bash
amverge doctor       # full health check
amverge gpu          # GPU info
amverge version --json  # all dep versions
```

`amverge doctor` checks: FFmpeg available, Python deps (PyAV, Pillow, NumPy), optional deps (torch, OpenCV, pypresence), write access.

---

## Install

```bash
pip install amverge                     # keyframe detection only
pip install amverge[edge]               # + OpenCV for edge detection
pip install amverge[ml]                 # + TransNetV2 (PyTorch)
pip install amverge[ml,edge,discord]    # all features
```

---

## Key Files for CEP Integration

| File | Purpose |
|---|---|
| `amverge/cli.py` | Typer app, registers all commands |
| `amverge/pipeline.py` | Public API: `detect_scenes()`, `DetectResult`, `Scene` |
| `amverge/commands/sidecar/backend.py` | Drop-in V2 backend (IPC events + JSON result) |
| `amverge/commands/sidecar/rpc_server.py` | Discord RPC sidecar |
| `amverge/commands/system/doctor.py` | Health check command |
| `amverge/commands/system/gpu.py` | GPU info command |
| `amverge/core/infra/ipc.py` | IPC protocol: `emit_progress`, `emit_event`, `log` |
| `amverge/core/infra/binaries.py` | FFmpeg/FFprobe path resolution |
| `amverge/core/codec/codec_utils.py` | Codec profiles, HEVC check, GPU resolve |

---

## CEP Extension Integration Summary

```
CEP Extension (vanilla JS)
  ├── spawn("amverge backend <video> <dir>") → stderr events + stdout JSON
  ├── spawn("amverge doctor") → setup wizard health check
  ├── spawn("amverge gpu") → GPU info display
  ├── spawn("amverge rpc-server") → long-lived Discord RPC
  └── OR: spawn bundled Python + `from amverge import detect_scenes`
```

Same spawning pattern as AniSmooth's Python backend (`child_process.spawn`). Same JSON-line stdout protocol. IPC events on stderr are new — parse the `|`-delimited prefix to route to UI callbacks.
