# `/spectate` CPU Performance Issue Index

This folder breaks the live-site `/spectate` CPU investigation into separate,
work-ready issues. These are intentionally separate from `perf/issues`, which is the
current `/` backlog.

The testing target was:

```sh
https://rover.otter.land/spectate
```

Primary artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

Secondary artifacts:

```sh
perf/results/2026-06-11T03-14-34-168Z/report.json
perf/results/2026-06-11T03-11-39-596Z-route-sweep/route-sweep-report.json
```

## Ranked Issues

1. [Telemetry fan-out and always-on HUD maps](./001-telemetry-fanout-hud-maps.md)
2. [Multi-rover WebRTC media fan-out](./002-multi-rover-webrtc-media-fanout.md)
3. [Room camera and snapshot object URL churn](./003-room-camera-snapshot-object-url-churn.md)
4. [Broad spectator session rerenders](./004-broad-spectator-session-rerenders.md)
5. [Shared log/session stream pressure](./005-shared-log-session-stream-pressure.md)
6. [Spectator role handshake retries](./006-spectator-role-handshake-retries.md)

## Quick Read

The biggest `/spectate` CPU issue is the number of live visual things being updated at
once. The page receives about 45 `sensorFrame` events/sec in the sampled run, and every
rover card has an always-on HUD map. That produced thousands of SVG `path` mutations in
30 seconds.

The second issue is live media fan-out. The audit saw 6 `RTCPeerConnections`, which is a
lot for low-end laptops and mobile browsers, especially alongside React/HUD updates.

The third issue is snapshot/camera image churn. Room camera frames created 117 `img.src`
mutations and the socket audit saw 11MB of binary payloads in 30 seconds.

Issues 004 and 005 are where the `/` backlog overlaps most. If the `/` work adds better
session selectors, log batching, chat batching, and telemetry visual throttling, revisit
these spectate writeups before implementing them from scratch.

Issue 006 is lower priority because it was intermittent, but it is worth fixing because
failed spectator setup can create extra retries, console noise, and unpredictable startup
work.

## Upstream Labels

Each issue includes an "Upstream Likelihood" section:

- `High`: likely mostly fixed by the earlier `/` work.
- `Medium`: `/` work should help, but `/spectate` still needs targeted changes.
- `Low`: mostly spectate-specific.

