# `/` CPU Performance Issue Index

This folder breaks the live-site `/` CPU investigation into separate, work-ready issues.
Each issue can be handled in its own chat or branch without needing to re-run the whole
investigation first.

The testing target was the deployed page:

```sh
https://rover.otter.land/
```

The important local perf tools are:

```sh
node perf/live-cpu-profile.mjs https://rover.otter.land/ perf/results
node perf/live-listener-audit.mjs https://rover.otter.land/ perf/results
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

The strongest `/` artifacts from this investigation are:

- `perf/results/2026-06-11T03-15-51-398Z/report.json`
  Clean `/` profile, mobile viewport, 8x CPU throttle.
- `perf/results/2026-06-11T03-03-31-625Z-listeners/listener-report.json`
  Listener add/remove stack audit.
- `perf/results/2026-06-11T03-21-51-263Z-root-runtime/root-runtime-report.json`
  `/` runtime audit, mobile viewport, 6x CPU throttle, 30s sample.
- `perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json`
  `/` runtime audit, mobile viewport, 6x CPU throttle, 18s sample with mutation targets.

## Ranked Issues

1. [Global input listener churn](./001-global-input-listener-churn.md)
2. [ControlContext broad invalidation](./002-control-context-broad-invalidation.md)
3. [High-volume socket log stream](./003-high-volume-log-stream.md)
4. [Sensor telemetry render frequency](./004-sensor-telemetry-render-frequency.md)
5. [ReplaySourcesPanel repeated DOM commits](./005-replay-sources-panel-churn.md)
6. [Chat and nickname composer churn](./006-chat-and-nickname-churn.md)
7. [Timers and polling cleanup](./007-timers-and-polling.md)

## Quick Read

The highest-confidence first fix is issue 001. It is directly measured, large, and
structurally fixable: install keyboard/gamepad global listeners once and have them read
latest state/actions from refs.

Issue 002 is the likely multiplier behind issue 001 and several UI churn symptoms. The
current `ControlContext` value changes broadly, and many callbacks depend on `state` or
`pipeline`; that causes consumers/effects to refresh even when the visible behavior did
not materially change.

Issues 003 and 004 are independent live-data pressure: the `/` page receives a lot of
socket traffic, especially `log:entry` and `sensorFrame`, and those streams feed UI work.

Issue 005 and issue 006 are component-level symptoms visible in DOM mutation probes. They
should probably be tackled after the context/listener work, because broad invalidation may
be causing some of their repeated commits.

## Important Scope Note

There are also `/spectate` results in `perf/results` because the investigation briefly
compared routes. The user later clarified that `/spectate` is not the current priority.
These issue writeups intentionally focus on `/` only.

