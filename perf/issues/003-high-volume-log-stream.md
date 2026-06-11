# Issue 003: High-Volume Socket Log Stream

## Summary

The `/` page receives a very high volume of `log:entry` socket messages. These update the
global session store even when logs are not the primary visible task.

This is not the single biggest CPU stack item, but it is a major source of live update
pressure on low-end devices.

## Severity

Medium-high.

Fix after listener/context work, unless logs are known to be unusually noisy in production.

## Affected Files

- `webui/src/context/SessionContext.jsx`
- `webui/src/components/LogPanel/index.jsx`
- Server log emission paths, depending on where `log:entry` is emitted

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

In an 18s `/` audit at mobile viewport with 6x CPU throttle:

```txt
log:entry count: 850
log:entry bytes: 185,008
```

Artifact:

```sh
perf/results/2026-06-11T03-21-51-263Z-root-runtime/root-runtime-report.json
```

In a 30s audit, among the most recent sampled 1000 WebSocket messages:

```txt
log:entry count: 526
log:entry bytes: 111,535
```

In `SessionContext.jsx`, each log entry does:

```jsx
function handleLogEntry(entry) {
  setState((prev) => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
}
```

This creates a new session state object and a new logs array for every log message.

## Why This Matters

Even if `LogPanel` is not visible or not currently selected, `SessionContext` still processes
the update. Every session subscriber selector is evaluated on each `setState`.

At 850 log messages in 18s, this is roughly 47 log entries per second.

On a powerful desktop this is fine. On a weaker phone or low-end laptop, it becomes steady
background pressure.

## Likely Cause

The server appears to broadcast operational logs very frequently. The client stores the last
200 logs globally.

The `/` page includes `LogPanel` under settings and may also have other components depending
on session state.

## Fix Strategies

### Option A: Do Not Subscribe to Logs Unless Log UI Is Visible

Best conceptual fix:

- Add an explicit client event like `log:subscribe` / `log:unsubscribe`.
- Only subscribe when `LogPanel` is open or user is admin.
- For ordinary mobile control users, skip logs entirely.

### Option B: Batch Log Entries Client-Side

Keep receiving logs, but batch state updates:

```jsx
const pendingLogsRef = useRef([]);
const flushTimerRef = useRef(null);

function handleLogEntry(entry) {
  pendingLogsRef.current.push(entry);
  if (flushTimerRef.current) return;
  flushTimerRef.current = setTimeout(() => {
    const batch = pendingLogsRef.current.splice(0);
    flushTimerRef.current = null;
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs, ...batch].slice(-200),
    }));
  }, 250);
}
```

This changes 47 state updates/sec into about 4 updates/sec.

### Option C: Store Logs in a Separate External Store

Move logs out of main `SessionContext` so unrelated session consumers are not touched by
log spam.

For example:

```jsx
LogStoreProvider
useLogEntries()
```

This isolates log updates from user/roster/session state.

### Option D: Server-Side Sampling or Severity Filtering

Only send:

- warnings/errors by default
- full logs to admin/log panel subscribers
- sampled info/debug entries

## Recommended Path

Start with client batching. It is low-risk and easy to validate.

Then consider subscription gating if logs are not essential for normal users.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

The socket `log:entry` count may remain high if only batching client-side, but UI state
updates should reduce. To measure batching directly, add temporary counters in
`SessionContext` or extend the audit to count React commits after local changes.

Expected user-visible perf improvements:

- lower `ScriptDuration`
- lower `TaskDuration`
- fewer repeated DOM commits if log updates were causing broad subscribers to render

## Risks

- Logs may be used for operator visibility during incidents.
- Batching can delay log display by 100-500ms. That should be acceptable for UI logs.
- Subscription gating requires server/client protocol changes.

