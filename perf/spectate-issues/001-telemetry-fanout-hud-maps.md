# Issue 001: Telemetry Fan-Out And Always-On HUD Maps

## Summary

`/spectate` renders multiple rover cards at once, and every rover card includes a live HUD
with an always-on top-down SVG map. During the 30s throttled audit, the page received
1,354 `sensorFrame` events and produced more than 5,300 SVG `path` attribute mutations.

This is the strongest measured `/spectate` CPU problem.

## Severity

High.

This is high-frequency, always-on work. It scales with the number of visible rovers and
hits exactly the devices we care about: mobile browsers and weaker computers.

## Upstream Likelihood

Medium.

The `/` telemetry issue will likely help if it introduces a central throttled visual
telemetry path. However, `/spectate` has a unique multiplier: it renders several rover
HUDs and several `TopDownMap` instances at the same time. Even after upstream telemetry
throttling, `/spectate` probably still needs a policy for how many maps update and how
often.

Related upstream issue:

```txt
perf/issues/004-sensor-telemetry-render-frequency.md
```

## Affected Files

- `webui/src/components/SpectateVideo/index.jsx`
- `webui/src/components/HudOverlays/HudOverlay/index.jsx`
- `webui/src/components/HudOverlays/HudOverlay/HudMapOverlay.jsx`
- `webui/src/components/TopDownMap/TopDownMapContent.jsx`
- `webui/src/components/TopDownMap/visuals.jsx`
- `webui/src/context/TelemetryContext.jsx`
- `webui/src/components/RoverMediaPlayer/index.jsx`
- `webui/src/components/HudOverlays/OvercurrentOverlay/index.jsx`
- `webui/src/components/HudOverlays/LowBatteryOverlay/index.jsx`
- `webui/src/components/HudOverlays/VerticalBatteryOverlay/index.jsx`

## Evidence

Artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

30s sample, mobile viewport, 6x CPU throttle:

```txt
sensorFrame events:        1,354
sensorFrame bytes:         2,531,090
path d mutations:          2,688
path fill mutations:       2,682
Long tasks:                   81
Worst long task:             375ms
Average frame gap:         113.9ms
p95 frame gap:             233.3ms
```

The path mutation pattern is the important clue. Normal text/status updates do not mutate
thousands of SVG path `d` and `fill` attributes. `TopDownMap` does.

## Current Code Path

`SpectateVideo` mounts a full media and overlay stack for each rover:

```txt
webui/src/components/SpectateVideo/index.jsx:17
RoverMediaPlayer

webui/src/components/SpectateVideo/index.jsx:26
HudOverlay variant="spectator"

webui/src/components/SpectateVideo/index.jsx:33
OvercurrentOverlay

webui/src/components/SpectateVideo/index.jsx:35
VerticalBatteryOverlay
```

`HudOverlay` subscribes to telemetry:

```txt
webui/src/components/HudOverlays/HudOverlay/index.jsx:27
const frame = useTelemetryFrame(effectiveRoverId);
```

For spectator mode, it forces the top-down map on:

```txt
webui/src/components/HudOverlays/HudOverlay/index.jsx:50
variant === 'spectator' ? true : ...
```

Then `HudMapOverlay` renders:

```txt
webui/src/components/HudOverlays/HudOverlay/HudMapOverlay.jsx:35
<TopDownMap sensors={sensors} size={240} overlay />
```

There is also duplicated telemetry subscription pressure. `RoverMediaPlayer` subscribes to
telemetry for audio ducking and media state, while `HudOverlay`, battery overlays, and
warning overlays can subscribe for the same rover.

## Why This Matters

The raw socket message rate is not automatically a problem. The expensive part is waking
multiple React subscribers, recomputing visual sensor geometry, and mutating SVG
attributes for every visual update.

On `/`, there is generally one primary driver view. On `/spectate`, the same sensor stream
can be multiplied across several rover cards.

## Fix Strategies

### Option A: Add A Throttled Visual Telemetry Channel

This is the most reusable upstream-friendly fix.

Keep `TelemetryContext` storing the latest frame immediately, but notify visual consumers
at a lower cadence:

```txt
useTelemetryFrameRaw(roverId)     high-frequency, only where truly needed
useTelemetryFrameVisual(roverId)  throttled display data
```

Use visual telemetry for:

- `TopDownMap`
- `HudOverlay`
- `SpectatorTelemetryOverlay`
- battery overlays
- warning overlays where 100-200ms delay is acceptable

Suggested rates:

```txt
desktop visual telemetry: 10-15Hz
mobile visual telemetry:   5-10Hz
```

### Option B: Pass One Telemetry Frame Through `SpectateVideo`

Right now, each overlay can subscribe independently. Instead, let `SpectateVideo` subscribe
once per rover and pass `sensors` down:

```jsx
const frame = useTelemetryFrameVisual(roverId);
const sensors = frame?.sensors ?? null;

<RoverMediaPlayer roverId={roverId} sensors={sensors} />
<HudOverlay roverId={roverId} sensors={sensors} />
<OvercurrentOverlay roverId={roverId} sensors={sensors} />
<LowBatteryOverlay roverId={roverId} sensors={sensors} />
<VerticalBatteryOverlay roverId={roverId} sensors={sensors} />
```

This may require small prop additions to the warning/battery overlays.

### Option C: Make Spectator HUD Maps Adaptive

Spectator maps are currently always on. For low-end/mobile:

- hide maps by default on portrait mobile
- update maps at a lower cadence than text warnings
- only animate the focused/first rover's map
- show static/minimal maps for secondary rovers
- make map visibility a spectator setting

### Option D: Memoize TopDownMap Geometry

This is useful after throttling. Avoid recalculating path data when the sensor fields that
drive a particular path did not change.

## Recommended Path

Do this after the `/` telemetry issue if that work touches `TelemetryContext`.

Best first implementation:

1. Add `useTelemetryFrameVisual(roverId)` with a 100-150ms visual notification cadence.
2. Switch `HudOverlay` and `TopDownMap` consumers to visual telemetry.
3. In `SpectateVideo`, subscribe once and pass sensors down where practical.
4. Add a spectator/mobile map policy so only the most important maps update live.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- `path d` and `path fill` mutations should drop sharply.
- `ScriptDuration` should drop.
- Long task count should drop.
- Frame p95/p99 should improve.
- `sensorFrame` socket count may stay the same if only rendering is throttled.

## Risks

- Do not throttle control/safety logic that needs immediate data.
- Keep battery/overcurrent warnings responsive enough to be trusted.
- If map updates become too slow, operators may perceive the HUD as stale. A 5-10Hz map is
  usually enough for spectators, but verify by watching the live page.

