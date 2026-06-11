# Issue 005: ReplaySourcesPanel Repeated DOM Commits

## Summary

`ReplaySourcesPanel` appears to re-commit many input/checkbox attributes repeatedly on `/`,
especially in mobile portrait where the panel is always mounted near the top of the page.

This may be a component-local issue, or it may be caused by broader context/session updates.
Tackle it after issues 001 and 002 unless profiling still shows it as large.

## Severity

Medium.

It is visible in mutation probes, but likely partly downstream of broader invalidation.

## Affected Files

- `webui/src/components/ReplaySourcesPanel/index.jsx`
- `webui/src/App.jsx`
- `webui/src/context/SessionContext.jsx`
- `webui/src/settings/SettingsProvider.jsx`

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

In an 18s `/` audit at mobile viewport with 6x CPU throttle, top mutation targets included:

```txt
input.accent-emerald-400 name: 5300
input.accent-emerald-400 type: 2650
input#replay-sources-mobile-portrait-title name: 666
input#replay-sources-mobile-portrait-title type: 333
```

The `accent-emerald-400` class maps to `ReplaySourcesPanel` checkboxes:

```jsx
<input
  type="checkbox"
  checked={includeSidebar}
  ...
  className="accent-emerald-400"
/>
```

and source item checkboxes:

```jsx
<input
  type="checkbox"
  checked={selected.includes(item.key)}
  onChange={() => onToggle(item.key)}
  className="accent-emerald-400"
/>
```

The mobile portrait route mounts it here:

```jsx
<ReplaySourcesPanel panelId="replay-sources-mobile-portrait" />
```

in `App.jsx`.

## Why This Matters

Repeated DOM attribute commits are a symptom of repeated React commits. Even if the attribute
values do not change semantically, React still touches DOM attributes when the subtree
rerenders/commits.

The panel is not central to driving, so it should not be doing meaningful work during normal
control-page idle.

## Likely Causes

The component subscribes to several session slices:

```jsx
const replaySources = useSessionSelector((state) => state.session?.replaySources ?? []);
const mode = useSessionSelector((state) => state.session?.mode || null);
const assignmentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
const roster = useSessionSelector((state) => state.session?.roster ?? []);
const replayState = useSessionSelector((state) => state.session?.replay || null);
const latestReplay = useSessionSelector((state) => state.latestReplay);
```

Potential problems:

- `session:sync` may provide new array/object identities even when contents are unchanged.
- `normalizeSources(replaySources || [])` runs every render and produces new objects.
- `GroupList` is not memoized.
- `selected.includes(item.key)` is recomputed for each item on each render.
- `remainingMs` interval updates every 250ms when cooldown is active.
- Parent/mobile layout re-renders can also re-render this panel.

## Fix Strategies

### Option A: Memoize Normalized Sources

```jsx
const sources = useMemo(
  () => normalizeSources(replaySources || []),
  [replaySources],
);
```

This is already not memoized in the current code.

### Option B: Use Shallow Equality Selectors

For arrays like `replaySources` and `roster`, use a selector/equality function that avoids
rerendering when content did not change.

Example:

```jsx
const replaySources = useSessionSelector(
  (state) => state.session?.replaySources ?? [],
  shallowReplaySourcesEqual,
);
```

### Option C: Memoize GroupList

```jsx
const GroupList = React.memo(function GroupList(...) { ... });
```

Also memoize:

```jsx
const selectedSet = useMemo(() => new Set(selected), [selected]);
```

Then use `selectedSet.has(item.key)`.

### Option D: Do Not Mount Replay Panel By Default on Mobile

If replay is not a core mobile driving workflow, consider putting it behind a tab/accordion
or lazy mounting it only when expanded.

This is a product decision.

### Option E: Stop Passing Unstable Callbacks

Memoize callbacks:

```jsx
const toggleKey = useCallback((key) => { ... }, []);
const handleReplay = useCallback(async () => { ... }, [...]);
```

This helps if child components are memoized.

## Recommended Path

1. Fix issues 001 and 002 first.
2. Rerun root runtime audit.
3. If `ReplaySourcesPanel` still dominates mutation targets:
   - memoize `sources`
   - memoize `GroupList`
   - add shallow equality selectors
   - consider lazy mounting on mobile

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=18000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Expected improvement:

```txt
input.accent-emerald-400 name/type mutations should drop sharply
replay title input name/type mutations should drop
```

## Risks

- Replay source selections and saved panel settings must still update correctly.
- If lazy mounting, preserve persisted title/sidebar settings.
- Do not break replay cooldown display.

