# FIXED!
# Issue 007: Timers and Polling Cleanup

## Summary

The `/` page creates multiple intervals and timeouts. They are not the dominant problem,
but they contribute to steady background work and can wake components even when hidden.

## Severity

Low to medium.

Address after the larger structural issues unless a specific timer is found to be hot.

## Affected Files

Known or likely timer users:

- `webui/src/components/AlertFeed/index.jsx`
- `webui/src/components/ReplaySourcesPanel/index.jsx`
- `webui/src/components/HudOverlays/TurnsOverlay/index.jsx`
- `webui/src/components/RoverQueuesPanel/index.jsx`
- `webui/src/components/ModeGateOverlay/index.jsx`
- `webui/src/components/SocketConnectionPill/index.jsx`
- `webui/src/controls/ControlContext.jsx` horn heat interval
- `webui/src/controls/overcurrentLimiter.js`

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

In an 18s `/` audit at mobile viewport with 6x CPU throttle:

```txt
intervals created:     22
timeouts created:      11
interval fires:        148
timeout fires:         6
```

Most common timer registrations:

```txt
interval:200      7
timeout:12000     4
interval:60000    4
interval:250      4
interval:3000     4
interval:1000     2
```

In a 30s audit:

```txt
interval fires: 593
```

## Why This Matters

Timers wake the main thread. On a fast desktop they disappear into the noise; on a throttled
mobile CPU, timers can combine with socket traffic and React work to create visible stalls.

The timer issue is not that any one interval is terrible. It is that many UI elements keep
time independently.

## Likely Sources

### ReplaySourcesPanel

Cooldown display:

```jsx
const interval = setInterval(update, 250);
```

Only needed while cooldown is active and panel is visible.

### AlertFeed

Likely uses a frequent interval for alert lifetimes. This should only run while alerts exist.

### TurnsOverlay / RoverQueuesPanel

Countdown displays often use `setInterval(() => setNow(Date.now()), 250 or 1000)`.

### ControlContext Horn Heat

Horn heat interval at 100ms only runs when horn is active/cooling:

```jsx
const tickMs = 100;
const interval = setInterval(...)
```

This is probably okay, but verify it only runs when needed.

## Fix Strategies

### Option A: Visibility-Gate Timers

Only run panel-specific timers when the panel is visible/open.

Example:

```jsx
if (!isVisible || !needsCountdown) return;
```

### Option B: Coarse Intervals

Use 1000ms for human-readable countdowns unless sub-second precision matters.

Replay cooldowns and queue countdowns probably do not need 250ms.

### Option C: Shared Clock Store

Instead of each component creating its own interval, create one shared clock:

```jsx
useClock(1000)
useClock(250)
```

Then multiple components can share a single interval.

### Option D: CSS Animations for Pure Visual Expiry

For alert progress bars, use CSS animation if the UI does not need React state each tick.

## Recommended Path

After major fixes, rerun the runtime audit. If intervals still show high:

1. Increase replay cooldown interval from 250ms to 1000ms.
2. Gate timers by tab visibility.
3. Create a shared clock hook for countdown UI.
4. Convert alert lifetime visuals to CSS where possible.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Expected:

- lower `intervals`
- lower `intervalFires`
- no visible regression in countdowns/alerts

## Risks

- Timers used for control safety should not be slowed without careful review.
- Alert expiration should still happen reliably.
- Queue/turn countdowns can update less often, but should not become misleading.

