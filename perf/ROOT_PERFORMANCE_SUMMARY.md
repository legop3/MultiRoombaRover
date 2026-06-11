# `/` Performance Investigation Summary

This is the high-level handoff for the default route at:

```sh
https://rover.otter.land/
```

The detailed issue writeups live in `perf/issues/`.

## Main Finding

The `/` page is doing too much main-thread work for low-end devices. On the current powerful
machine it can appear smooth, but CPU throttling shows real risk for mobile and weaker
computers.

The biggest measured problem is repeated global input listener churn. The broader underlying
theme is that high-frequency live data and broad React context invalidation cause many parts
of the page to rerender or recommit DOM attributes.

## Key Measurements

### Clean `/` Profile, 8x Mobile CPU Throttle

Artifact:

```sh
perf/results/2026-06-11T03-15-51-398Z/report.json
```

Results:

```txt
average frame interval: ~140ms
p95 frame interval:     ~166.8ms
p99 frame interval:     ~383.4ms
long tasks:             67
event listener delta:   +13,481
JS heap delta:          +22.76MB
ScriptDuration delta:   ~35.85s
TaskDuration delta:     ~52.88s
```

Top notable CPU self-time included:

```txt
removeEventListener ~1.30s
addEventListener    ~0.94s
```

### Listener Audit

Artifact:

```sh
perf/results/2026-06-11T03-03-31-625Z-listeners/listener-report.json
```

Worst churn:

```txt
keydown               adds=8040 removes=8039
keyup                 adds=8040 removes=8039
blur                  adds=8040 removes=8039
gamepadconnected      adds=8040 removes=8039
gamepaddisconnected   adds=8040 removes=8039
```

### `/` Runtime Audit, 6x Mobile CPU Throttle, 30s

Artifact:

```sh
perf/results/2026-06-11T03-21-51-263Z-root-runtime/root-runtime-report.json
```

Results:

```txt
average frame interval: ~88ms
p95 frame interval:     150ms
p99 frame interval:     183ms
long tasks:             18
WebSocket messages:     at least 1000 sampled
WebSocket bytes:        ~798KB sampled
DOM mutation records:   41,062
DOM attribute records:  40,761
```

Top sampled WebSocket events:

```txt
log:entry       526
sensorFrame     306
commandAck      145
session:sync      5
```

### `/` Runtime Audit With Mutation Targets, 6x Mobile CPU Throttle, 18s

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

Results:

```txt
average frame interval: ~116.6ms
p95 frame interval:     ~166.7ms
p99 frame interval:     ~316.6ms
long tasks:             16
DOM mutation records:   18,758
DOM attribute records:  18,490
```

Top WebSocket events:

```txt
log:entry       850
sensorFrame     277
commandAck      200
session:sync     23
```

Top mutation targets:

```txt
input.accent-emerald-400 name       5300
input.accent-emerald-400 type       2650
field-input name                    ~1300 each
div.h-full style                    1238
path d                              621
path fill                           619
```

## Ordered Work Plan

1. Fix `KeyboardInputManager` and `GamepadInputManager` listener churn.
2. Split/stabilize `ControlContext` so action consumers do not rerender on every state change.
3. Batch or gate `log:entry` socket updates.
4. Throttle visual telemetry rendering.
5. Memoize or lazy-mount `ReplaySourcesPanel`.
6. Split and memoize chat composer/nickname form.
7. Clean up or share timers.

## Reproduction Commands

Install Playwright dependency if missing:

```sh
npm install --prefix perf playwright@1.60.0
npx playwright install chromium
```

Clean CPU profile:

```sh
CPU_THROTTLE=8 VIEWPORT=390x844 MOBILE=1 node perf/live-cpu-profile.mjs https://rover.otter.land/ perf/results
```

Listener audit:

```sh
node perf/live-listener-audit.mjs https://rover.otter.land/ perf/results
```

Runtime audit:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Runtime audit with shorter mutation target sample:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=18000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

## Notes

The `perf/results/2026-06-11T03-11-39-596Z-route-sweep/` route sweep includes `/spectate`,
`/mini`, `/display`, and `/scanner`. Those are not the current priority. Use them only for
context.

