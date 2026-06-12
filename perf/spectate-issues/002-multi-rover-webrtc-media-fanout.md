# Issue 002: Multi-Rover WebRTC Media Fan-Out

## Summary

`/spectate` mounts several `RoverMediaPlayer` instances at once. In the fresh runtime
audit, Chromium reported 6 active `RTCPeerConnections`. That is a large baseline for
low-end clients, especially while the page is also handling telemetry, snapshots, logs,
chat, and SVG HUD maps.

## Severity

High.

This may not show up as React mutations, but it consumes CPU in browser media pipelines,
WebRTC negotiation, decoding, audio handling, and event dispatch. It also scales with the
number of rovers.

## Upstream Likelihood

Low to medium.

General `RoverMediaPlayer` improvements can help both `/` and `/spectate`, but the core
problem is spectate-specific: `/spectate` intentionally displays multiple rover media
players at once. The fix needs a spectator policy for active feeds.

## Affected Files

- `webui/src/components/SpectateVideo/index.jsx`
- `webui/src/components/RoverMediaPlayer/index.jsx`
- `webui/src/hooks/useVideoRequests.js`
- `webui/src/lib/whepPlayer.js`
- `webui/src/spectate/SpectatorApp/components/RoverRow.jsx`
- server-side WHEP/video request handling, if feed quality/rate selection is added

## Evidence

Artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

30s sample:

```txt
RTCPeerConnections: 6
JSEventListeners:   379
```

The listener list is dominated by normal media listeners:

```txt
audio canplay/ended/error/pause/play/stalled/waiting: 9 each
video media events: 3 each
```

That pattern fits several rover media players, likely with video and dedicated audio
connections.

The same audit also saw:

```txt
TaskDuration:     28.48s
ScriptDuration:   12.11s
Long tasks:       81
```

The earlier 8x throttled `/spectate` profile saw:

```txt
Task delta:       49.13s
Script delta:     19.58s
```

## Current Code Path

Each rover card mounts:

```txt
webui/src/components/SpectateVideo/index.jsx:17
<RoverMediaPlayer roverId={roverId} />
```

`RoverMediaPlayer` automatically creates video and audio request entries:

```txt
webui/src/components/RoverMediaPlayer/index.jsx
autoEntries = [
  video rover entry,
  optional dedicated audio entry,
]
```

It then requests sources through `useVideoRequests`, starts WHEP players, maintains
restart timers, maintains unmute/audio retry timers, and optionally falls back to
snapshots when no WHEP URL exists.

## Why This Matters

Six peer connections on a powerful desktop may feel fine. On weak laptops and mobile
devices, simultaneous WebRTC decode plus React UI churn can easily saturate the main
thread or media threads. The visible symptom is not necessarily one obvious function in
the CPU profile; it is degraded frame cadence, long tasks, and high browser-level media
work.

## Fix Strategies

### Option A: Cap Active Live Feeds On Mobile

For mobile/low-end layouts:

- one primary live WHEP feed
- secondary rover cards use snapshots or lower-rate previews
- promote a secondary rover to live only when selected/visible/focused

This is the highest-impact spectator-specific design change.

### Option B: Pause Offscreen Feeds

Use `IntersectionObserver` around each `SpectateVideo` or `RoverSpectatorCard`:

- start WHEP when the card is visible
- stop WHEP when the card is far offscreen
- keep a small grace period to avoid flapping while scrolling

This matters especially because portrait `/spectate` can scroll.

### Option C: Disable Dedicated Audio For Non-Focused Rovers

Dedicated audio is useful, but not necessarily for every rover at the same time.

Possible policy:

- audio enabled only for the selected/primary rover
- audio disabled for muted secondary rovers
- audio WHEP starts only after user interaction

This should reduce peer connections and audio retry timers.

### Option D: Request Lower Quality For Spectator Secondary Feeds

If the server/media stack supports it, add spectator quality tiers:

```txt
primary:   normal FPS/resolution
secondary: low FPS/resolution or snapshot-only
mobile:    lower default bitrate/resolution
```

### Option E: Stop Retry Loops When Hidden

When document visibility is hidden or a card is offscreen:

- stop restart timers
- stop audio retry intervals
- avoid requesting fresh WHEP URLs

## Recommended Path

After the HUD/telemetry issue, add a spectator feed activity policy:

1. Define "primary" versus "secondary" rover cards.
2. Keep only primary feeds fully live on mobile.
3. Use `IntersectionObserver` to avoid live playback for offscreen cards.
4. Disable secondary audio by default.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- `RTCPeerConnections` should drop below 6 on mobile.
- Media listener counts should drop.
- `TaskDuration` should drop.
- Frame p95/p99 should improve.
- User-visible video should still start reliably for the primary rover.

## Risks

- Spectators may expect all feeds live all the time on desktop.
- Switching feeds can introduce startup delay if WHEP is torn down too aggressively.
- Audio policy needs to avoid surprising users. Make the focused rover's audio behavior
  clear and consistent.

