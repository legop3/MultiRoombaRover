# Issue 004: Sensor Telemetry Render Frequency

## Summary

The `/` page receives frequent `sensorFrame` messages and renders multiple telemetry/HUD
consumers from those frames. On throttled mobile CPU, this shows up as repeated SVG path
attribute mutations and significant live DOM churn.

## Severity

Medium-high.

This is likely the biggest non-input-manager source of steady rendering work.

## Affected Files

- `webui/src/context/TelemetryContext.jsx`
- `webui/src/components/TopDownMap/TopDownMapContent.jsx`
- `webui/src/components/TopDownMap/visuals.jsx`
- `webui/src/components/DriverVideo/index.jsx`
- `webui/src/components/HudOverlays/*`
- `webui/src/components/TelemetryPanel/index.jsx`
- `webui/src/components/PiHostStatsCard/index.jsx`

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

In an 18s `/` audit at mobile viewport with 6x CPU throttle:

```txt
sensorFrame count: 277
sensorFrame bytes: 520,169
```

That is about 15.4 sensor frames/sec.

The same audit saw SVG attribute mutations:

```txt
path d mutations:    621
path fill mutations: 619
```

These map strongly to `TopDownMapContent.jsx` and `visuals.jsx`, where sensor values are
converted into SVG arcs, cones, wheels, brush visuals, and colors.

Artifact:

```sh
perf/results/2026-06-11T03-21-51-263Z-root-runtime/root-runtime-report.json
```

In a 30s audit:

```txt
sensorFrame count among latest sampled 1000 messages: 306
sensorFrame bytes: 574,616
```

## Current Code Path

`TelemetryContext.jsx` updates every incoming frame:

```jsx
function handleSensorFrame({ roverId, sensors = {}, frame = {} }) {
  if (!roverId) return;
  const previous = framesRef.current[roverId] ?? {};
  framesRef.current = {
    ...framesRef.current,
    [roverId]: {
      ...previous,
      roverId,
      sensors,
      raw: frame?.data || null,
      receivedAt: Date.now(),
    },
  };
  notifyRover(roverId);
}
```

Consumers subscribe by rover:

```jsx
useTelemetryFrame(roverId)
```

Every `notifyRover(roverId)` wakes all consumers for that rover.

## Why This Matters

Telemetry itself may need to remain high-frequency for control safety or debugging, but the
visual UI usually does not need to render at full sensor frequency.

The expensive part is not receiving the socket message. It is causing React/SVG/HUD updates
and DOM attribute changes at the same cadence.

## Fix Strategies

### Option A: Throttle Render Notifications

Keep the latest frame in `framesRef` immediately, but notify subscribers at a lower rate.

Example:

```jsx
const pendingRoversRef = useRef(new Set());
const notifyScheduledRef = useRef(false);

function scheduleNotify(roverId) {
  pendingRoversRef.current.add(roverId);
  if (notifyScheduledRef.current) return;
  notifyScheduledRef.current = true;
  setTimeout(() => {
    notifyScheduledRef.current = false;
    const rovers = [...pendingRoversRef.current];
    pendingRoversRef.current.clear();
    rovers.forEach((id) => notifyRover(id));
  }, 100); // 10Hz visual updates
}
```

Then `handleSensorFrame` writes latest data immediately but calls `scheduleNotify(roverId)`.

### Option B: Separate Raw Telemetry From Visual Telemetry

Expose:

```jsx
useTelemetryFrameRaw(roverId)      // high-frequency, only for critical logic
useTelemetryFrameVisual(roverId)   // throttled for UI rendering
```

Use throttled visual telemetry in:

- TopDownMap
- HUD overlays
- telemetry panels
- battery bars
- host stats display

Keep raw telemetry for safety mechanisms if needed.

### Option C: Memoize/Split Sensor Consumers by Field

Do not re-render the entire map or all overlays when only one sensor field changed.

Examples:

- Battery components subscribe only to battery fields.
- Light bump bars subscribe only to light bump fields.
- Overcurrent overlay subscribes only to overcurrent fields.

This is more architectural but can reduce unnecessary work.

### Option D: Render TopDownMap Less Often

At the component level:

```jsx
const visualSensors = useThrottledValue(sensors, 100);
```

This is easier than changing `TelemetryContext`, but less central.

## Recommended Path

Start with a throttled visual notification path in `TelemetryContext`. It gives the largest
blast-radius reduction without changing every consumer immediately.

A reasonable target:

- Desktop: 10-15Hz visual updates
- Mobile: 5-10Hz visual updates

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=18000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Expected improvements:

- `path d` and `path fill` mutation counts should drop.
- `LayoutCount` and `RecalcStyleCount` may drop.
- `ScriptDuration` should drop.
- Frame p95 should improve.

Socket `sensorFrame` count may remain the same if only rendering is throttled.

## Risks

- Do not throttle logic that protects the rover or sends control commands unless you are sure
  it is only display logic.
- Operators may expect smooth sensor visuals, but 10Hz is usually enough for dashboards.
- Make sure low battery/overcurrent warnings still feel responsive.

