# Server-side transcoding audit

The production server has **no hardware video acceleration**, so every encode and decode is
software on the CPU. This is an audit of what the server actually does per rover, measured
rather than reasoned about.

Measured against a live 640x480@30 h264 stream, CPU averaged over a 10s window after reaching
steady state. Figures are fractions of one core, **per rover**.

## The latency work adds no transcoding

Verified end to end on all three ingest transports:

| ingest | MediaMTX ingested | browser decoded |
|---|---|---|
| mpegts / SRT | H264 | 640x480, 181 frames |
| RTSP / UDP | H264 | 640x480, 180 frames |
| WHIP | H264 | 640x480, 180 frames |

H264 in, H264 out, every time. MediaMTX **repacketizes** between containers and RTP; it never
transcodes. Audio is Opus end to end for the same reason — Opus is WebRTC's native codec, so
nothing needs converting.

That also means the RTSP and WHIP work is CPU-neutral on the server. Dropping MPEG-TS removes
mux and demux work, so if anything it is slightly cheaper.

## What does cost CPU, always on, per rover

| worker | cost | notes |
|---|---|---|
| replay recorder | **0.098 cores** | `-c:v libx264` — a real transcode |
| snapshot writer | **0.042 cores** | decodes 30fps to emit 1fps JPEG |
| | **~0.14 cores/rover** | plus an opus→AAC audio recorder per rover with capture |

Both are spawned automatically for **every rover in the roster**, not on demand:

- `replayEngineV2/workerManager.js` spawns a segment recorder per source from
  `listDesiredSources()`, which walks the whole roster plus room cameras plus PTZ.
- `server/mediamtx/rover-snapshot-writer.sh` runs under `runOnReady` with
  `runOnReadyRestart: yes`.

So ~0.14 cores per rover before anyone is watching anything. Four rovers is roughly 0.6 of a
core; on a 2-vCPU VPS with real camera content, which is harder to encode than the synthetic
source measured here, that starts to matter.

### The replay recorder is the one real transcode

```
as shipped, -preset veryfast    0.098 cores
-preset ultrafast               0.076 cores   (-22%)
-c:v copy, no transcode         0.013 cores   (-87%)
```

`-c:v copy` is 7.5x cheaper because the rover already publishes h264 — the recorder decodes and
re-encodes something that was already in the right codec.

**It is not a drop-in change, which is why it has not been made here.** The re-encode buys
things the replay feature depends on:

- `-vf fps=N` normalises frame rate across heterogeneous sources so they can be concatenated
- `-g`/`-keyint_min` force keyframes at segment boundaries, so segments are independently
  playable and splice cleanly

With `-c:v copy`, segments can only split on keyframes the rover happens to emit. At
`--intra 120` that is one every 4s, so segment boundaries would drift and short trims could
break. Making it work needs the rover GOP and `SEGMENT_SECONDS` aligned, and the replay
builder verified against the result. That is a replay-correctness change with its own testing,
not a latency change, so it belongs in its own piece of work.

`-preset ultrafast` is the safe partial win: these are temporary segments that get re-encoded
by the replay builder anyway, so their quality barely matters. Not applied here either, for the
same reason — it is a change to a feature outside this work's remit, and it should be measured
against actual replay output rather than assumed harmless.

### A rejected snapshot optimisation

`-skip_frame nokey` looked obviously right: decode only keyframes instead of all 30fps, since
the output is 1fps anyway.

```
as shipped                      0.042 cores
with -skip_frame nokey          0.052 cores   ← worse
```

**Measurably worse**, so it was not applied. The JPEG encode and demux dominate, and skipping
frames adds its own bookkeeping without removing enough decode work to pay for it. This is
exactly the kind of change that would have been committed on reasoning alone.

## On-demand encodes, not a steady-state concern

These only run when someone asks, and are expected to be expensive:

- `replayEngineV2/replayBuilder.js`, `sidebarRenderer.js`, `roomCameraReplayBuilder.js` — build
  the final replay video
- `audioForwardService` upload playback — decodes an arbitrary uploaded file to s16le, then
  encodes Opus at 24kbps. Audio only, short, cheap.

## One continuous transcode outside the rover path

`ptzCameraService/index.js:616` publishes the PTZ camera with `-c:v libx264`. If PTZ is enabled
that is another always-on software encode, independent of rover count. Not measured here because
it needs a PTZ camera, but it is the same class of cost as the replay recorder and worth
checking on the VPS if PTZ is in use.

## How to re-run this audit

`webrtc/local/cpu-audit.sh` and `webrtc/local/transcode-check.sh` are kept out of the
repository — they are one-off measurement scripts, not project tooling. They read CPU from
`/proc/<pid>/stat` jiffies over a fixed window rather than sampling `top`, so the figure is a
real average rather than one instant.
