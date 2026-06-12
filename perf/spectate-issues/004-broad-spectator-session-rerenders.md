# Issue 004: Broad Spectator Session Rerenders

## Summary

`SpectatorContent` reads the whole session object with `useSession()`. That means broad
session changes can rerender the top-level spectator layout, including the sidebar, rover
row, secondary row, chat, logs, room cameras, and overlays.

The audit saw 54 `session:sync` events in 30s, carrying about 914KB, while the DOM also
showed repeated added/removed-node bursts.

## Severity

Medium-high.

This is likely a multiplier. It may not be the single hottest path, but it can cause
otherwise independent components to rerender together.

## Upstream Likelihood

Medium to high.

If the `/` backlog changes `SessionContext` to provide better selectors, better structural
sharing, batched log/session updates, or more stable action references, this issue may be
partly fixed upstream. However, `SpectatorContent` itself still needs to stop reading the
whole session object.

Related upstream issues:

```txt
perf/issues/003-high-volume-log-stream.md
perf/issues/006-chat-and-nickname-churn.md
perf/issues/007-timers-and-polling.md
```

## Affected Files

- `webui/src/spectate/SpectatorApp/SpectatorContent.jsx`
- `webui/src/hooks/useSpectatorMode.js`
- `webui/src/context/SessionContext.jsx`
- `webui/src/spectate/SpectatorApp/components/RoverRow.jsx`
- `webui/src/spectate/SpectatorApp/components/SecondaryRow.jsx`
- sidebar components mounted by `SpectatorContent`

## Evidence

Artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

30s sample:

```txt
session:sync events:     54
session:sync bytes:      914,000
DOM mutation records:    5,868
DOM nodes added:         440
DOM nodes removed:       440
```

Largest mutation bursts:

```txt
119 records, 57 added, 58 removed
117 records, 52 added, 53 removed
113 records, 52 added, 52 removed
102 records, 49 added, 49 removed
100 records, 48 added, 48 removed
```

Those bursts suggest periodic component/list updates, not just single text changes.

## Current Code Path

`SpectatorContent` subscribes to the whole session:

```txt
webui/src/spectate/SpectatorApp/SpectatorContent.jsx:22
const { session } = useSession();
```

It then derives:

```txt
inLockdown = session?.mode === 'lockdown'
roster = session?.roster ?? []
```

But because it reads the whole session object, changes to logs, users, active drivers,
room cameras, replay state, chat-related session fields, or any other session branch can
potentially re-render the whole spectator layout.

`useSpectatorMode` also reads the whole session:

```txt
webui/src/hooks/useSpectatorMode.js:7
const { session, setRole, subscribeAll, connected } = useSession();
```

It only needs `mode`, `role`, `connected`, and actions.

## Why This Matters

`/spectate` is already rendering expensive children. A broad rerender at the top makes
other optimizations less effective because unrelated live data can still wake the route.

For example:

- a log entry should not rerender the rover media grid
- a chat composer state change should not rerender room camera feeds
- a session sync should not recreate layout props unless the selected fields changed

## Fix Strategies

### Option A: Replace Whole Session Reads With Selectors

In `SpectatorContent`, use precise selectors:

```jsx
const mode = useSessionSelector((state) => state.session?.mode ?? null);
const roster = useSessionSelector((state) => state.session?.roster ?? EMPTY_ROSTER);
```

Then:

```jsx
const inLockdown = mode === 'lockdown';
```

Make sure selector outputs are stable. If `roster` is rebuilt on every `session:sync`,
this still rerenders. The store may need structural sharing upstream.

### Option B: Split Spectator Layout Into Memoized Regions

Split the page into:

- spectator sidebar
- rover grid
- secondary/camera row
- global overlays

Then each region subscribes only to what it needs.

### Option C: Narrow `useSpectatorMode`

Replace:

```jsx
const { session, setRole, subscribeAll, connected } = useSession();
```

with selectors/actions:

```jsx
const mode = useSessionSelector((state) => state.session?.mode ?? null);
const role = useSessionSelector((state) => state.session?.role ?? null);
const connected = useSessionSelector((state) => state.connected);
const { setRole, subscribeAll } = useSessionActions();
```

### Option D: Batch Or Diff `session:sync`

This may belong to the `/` backlog. If incoming sync payloads replace large object
branches each time, selector users will still rerender. Preserve references for unchanged
branches.

## Recommended Path

Do this after the `/` session/log work if that work changes `SessionContext`.

Local `/spectate` changes:

1. Remove whole-session `useSession()` from `SpectatorContent`.
2. Remove whole-session `useSession()` from `useSpectatorMode`.
3. Split the layout so rover media rows do not depend on sidebar data.
4. Re-test mutation bursts and React commit behavior.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- Fewer added/removed DOM mutation bursts.
- Lower `ScriptDuration`.
- Possibly lower `RecalcStyleCount` and `LayoutCount`.
- `session:sync` socket counts may stay the same unless server/store work changes them.

## Risks

- Selector equality matters. Returning new arrays/objects from selectors can erase the win.
- Be careful with lockdown mode; the full-page lockdown branch must still update promptly.
- If `roster` reference stability is poor upstream, this issue may need `SessionContext`
  structural sharing before it fully improves.

