# `/spectate` CPU Performance Summary

This is the `/spectate` companion to the `/` performance writeups. The testing target
was the deployed page:

```sh
https://rover.otter.land/spectate
```

The most useful artifact for this pass is:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

That run used:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

## High-Level Result

`/spectate` is CPU-heavy for a different reason than `/`.

The `/` page's biggest confirmed issue is global input listener churn. `/spectate` does
not show that same dominant pattern. The fresh `/spectate` audit had 379 event listeners,
mostly normal media/image listeners, and no giant add/remove loop.

The `/spectate` hot path is instead a live-display fan-out problem:

- several rover media players are mounted at once
- each rover card renders live HUD telemetry and a top-down SVG map
- camera/snapshot frames create new blobs and `img.src` values
- the route subscribes to broad session/log/chat state while also rendering the whole
  spectator layout
- the page maintains several WebRTC players at the same time

## Key Measurements

Fresh `/spectate` runtime audit, 30s, mobile viewport, 6x CPU throttle:

```txt
TaskDuration:        28.48s over a 30.9s sample
ScriptDuration:      12.11s
Long tasks:          81
Worst long task:     375ms
Average frame gap:   113.9ms
p95 frame gap:       233.3ms
p99 frame gap:       300.0ms
Nodes:               7,059
Layout objects:      6,150
RTCPeerConnections:  6
LayoutCount:         243
RecalcStyleCount:    248
```

The 8x CPU-throttled profile from the earlier route comparison was worse:

```txt
Task delta:          49.13s over a 52.85s sample
Script delta:        19.58s
Layout delta:        516
Recalc delta:        522
Node delta:          +3,815
```

That profile also put `Blob`, `decodeString`, and `setAttribute` in the CPU stack, which
matches the runtime evidence for camera blobs, socket payload parsing, and SVG/image
attribute churn.

## Socket And DOM Pressure

The fresh audit captured these live events during the 30s window:

```txt
sensorFrame:          1,354 events, 2,531,090 bytes
log:entry:              634 events,   150,179 bytes
unlabeled binary:       126 events, 11,048,477 bytes
roomCamera:frame:       117 events
session:sync:            54 events,   914,000 bytes
commandAck:              68 events
roverHostStats:          17 events
roverSnapshot:frame:      7 events
```

The most important DOM mutations were:

```txt
path d:                 2,688 mutations
path fill:              2,682 mutations
img.h-full.w-full src:    117 mutations
span.h-2.w-2 class:       117 mutations
```

The `path` mutations point strongly at the per-rover `TopDownMap` SVG overlays. The
`img.src` and blink class mutations point at room camera snapshot rendering.

## Ordered Issue List

1. [Telemetry fan-out and always-on HUD maps](./spectate-issues/001-telemetry-fanout-hud-maps.md)
2. [Multi-rover WebRTC media fan-out](./spectate-issues/002-multi-rover-webrtc-media-fanout.md)
3. [Room camera and snapshot object URL churn](./spectate-issues/003-room-camera-snapshot-object-url-churn.md)
4. [Broad spectator session rerenders](./spectate-issues/004-broad-spectator-session-rerenders.md)
5. [Shared log/session stream pressure](./spectate-issues/005-shared-log-session-stream-pressure.md)
6. [Spectator role handshake retries](./spectate-issues/006-spectator-role-handshake-retries.md)

## Upstream Dependency Map

Fixing the `/` backlog first is a good plan.

Likely improved by `/` fixes:

- telemetry visual throttling
- log batching/gating
- chat/nickname churn
- session selector/store improvements
- generic timer cleanup

Not likely to be fixed by `/` alone:

- several simultaneous WHEP video/audio players
- per-rover spectator HUD maps
- room camera snapshot blob/object URL churn
- spectator role/subscribe handshake behavior
- mobile policy for how many live feeds should be active at once

## Suggested Re-Test

After each `/spectate` fix, run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

The most useful numbers to compare:

- `TaskDuration`
- `ScriptDuration`
- long task count and worst duration
- frame average/p95/p99
- `RTCPeerConnections`
- `mutationTargets` for `path d`, `path fill`, and `img src`
- `webSocketEvents` for `sensorFrame`, `log:entry`, `session:sync`, and binary frame volume

