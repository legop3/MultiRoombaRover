# Issue 005: Shared Log And Session Stream Pressure

## Summary

`/spectate` receives a large volume of shared live socket traffic, especially `log:entry`,
`session:sync`, `sensorFrame`, and `commandAck`. Some of this will likely be fixed by the
`/` backlog, but it remains important for `/spectate` because the route keeps logs/chat
visible in the sidebar while also rendering multiple live media feeds.

## Severity

Medium.

This is not as spectate-specific as the HUD map or WebRTC fan-out issues, but it adds
steady parsing, state, and render pressure.

## Upstream Likelihood

High for logs and shared session pressure.

If the `/` work implements log batching, log virtualization, selector-based session
updates, and chat/nickname churn reduction, a lot of this issue should improve without
special `/spectate` changes.

Related upstream issues:

```txt
perf/issues/003-high-volume-log-stream.md
perf/issues/006-chat-and-nickname-churn.md
perf/issues/007-timers-and-polling.md
perf/issues/004-sensor-telemetry-render-frequency.md
```

## Affected Files

- `webui/src/context/SessionContext.jsx`
- `webui/src/spectate/SpectatorApp/SpectatorContent.jsx`
- `webui/src/spectate/SpectatorApp/components/LogsRow.jsx`
- `webui/src/components/ChatPanel/index.jsx`
- `webui/src/components/RawUserPilePanel/index.jsx`
- `webui/src/components/RoverQueuesPanel/index.jsx`
- server log/session emitters

## Evidence

Artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

30s sample:

```txt
log:entry events:      634
log:entry bytes:       150,179
session:sync events:    54
session:sync bytes:     914,000
commandAck events:      68
chat:init bytes:        77,415
log:init bytes:         44,530
```

Text and input mutations also appeared:

```txt
Text characterData mutations:                164
input.field-input.flex-1 name mutations:     102
input.chat-composer-input name mutations:    102
```

The input-name churn matches the same type of sidebar/chat behavior observed on `/`.

## Current Code Path

`SpectatorContent` keeps these mounted:

```txt
webui/src/spectate/SpectatorApp/SpectatorContent.jsx:88
<ChatPanel allowSpectatorInput ... />

webui/src/spectate/SpectatorApp/SpectatorContent.jsx:91
<LogsRow ... />

webui/src/spectate/SpectatorApp/SpectatorContent.jsx:79
<RoverQueuesPanel title="Rovers" />

webui/src/spectate/SpectatorApp/SpectatorContent.jsx:68
<RawUserPilePanel ... />
```

That is useful spectator UI, but it means `/spectate` pays for general page state while
also paying for media and telemetry.

## Why This Matters

Logs and session syncs are deceptively expensive:

- socket payloads must be parsed
- state must be updated
- arrays/lists may be copied
- list components may rerender
- text/input attributes may mutate

This becomes worse on `/spectate` because the route is not just a dashboard. It is also a
multi-feed media surface.

## Fix Strategies

### Option A: Reuse The `/` Log Fix

The `/` log issue should probably introduce:

- batching log updates
- capping retained logs
- virtualizing or windowing visible rows
- pausing log rendering when collapsed/offscreen
- separating log ingestion from log rendering

Apply the same path to `LogsRow`.

### Option B: Make Spectator Sidebar Panels Independently Subscribed

The rover media grid should not rerender because logs/chat/users changed. This overlaps
with issue 004.

### Option C: Lower Or Gate Command/Log Visibility For Mobile

On mobile spectator layout, logs are less important than video health. Options:

- collapse logs by default
- batch logs while collapsed
- show only warning/error logs by default
- update visible logs at 1-2Hz

### Option D: Reduce `session:sync` Payload Churn

If the server sends full session snapshots frequently, consider:

- event-specific deltas for high-frequency branches
- preserving client-side branch references for unchanged data
- moving logs/chat out of the broad session path if they are currently coupled

## Recommended Path

Do not start here if you are working the `/` list first. Fix the `/` log/session/chat
items, then rerun `/spectate` and reassess.

If still hot on `/spectate`:

1. Make `LogsRow` batch/virtualize/collapse.
2. Keep the media grid isolated from sidebar state.
3. Add a mobile spectator mode that reduces log rendering frequency.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- Lower `Text:characterData` mutations.
- Fewer added/removed DOM mutation bursts.
- Lower `ScriptDuration`.
- `log:entry` socket count may remain high if only rendering is batched.

## Risks

- Logs are operationally useful; do not hide critical warnings.
- If batching is too aggressive, the UI can feel stale.
- Be careful not to mix log ingestion throttling with log display throttling. Usually,
  display throttling is safer.

