# Issue 002: ControlContext Broad Invalidation

## Summary

`ControlContext` exposes one large changing context value containing all control state,
pipeline objects, limiter state, and action callbacks. This likely causes many consumers
to re-render and effects to re-run when unrelated control state changes.

This is probably the multiplier behind the global input listener churn and some repeated
DOM commits on `/`.

## Severity

High, but fix after issue 001 unless doing both together.

Issue 001 is the symptom with the clearest measurement. Issue 002 is the architectural
cause that may also affect other parts of the page.

## Affected Files

- `webui/src/controls/ControlContext.jsx`
- `webui/src/controls/inputs/KeyboardInputManager.jsx`
- `webui/src/controls/inputs/GamepadInputManager.jsx`
- Many consumers of `useControlSystem()`

## Evidence

The `contextValue` in `ControlContext.jsx` is:

```jsx
const contextValue = useMemo(
  () => ({
    state,
    dispatch,
    pipeline,
    overcurrentLimiter,
    actions: {
      setMode,
      setDriveVector,
      setAuxMotors,
      ...
    },
  }),
  [
    state,
    pipeline,
    overcurrentLimiter,
    setMode,
    setDriveVector,
    ...
  ],
);
```

Any state change changes the whole context value. Any consumer using:

```jsx
const { state, actions } = useControlSystem();
```

is subscribed to the broad value, even if it only needs one action or one small state field.

This connects to measured symptoms:

- Input listener effects rerun because their action/callback dependencies change.
- `/` runtime audit saw repeated attribute commits in UI that should not need to change every
  telemetry/log tick.
- CPU profiles show large minified React frames (`C9`, `ad`, `Fl`, etc.) alongside listener
  churn.

## Why This Matters

React context invalidation is coarse. When provider value identity changes, every consumer
below it can be scheduled to render. Even memoized children are not enough if they consume
the changing context directly.

This project has several high-frequency update sources:

- telemetry frames
- logs
- session syncs
- control state changes
- settings state
- timers

If `ControlContext` changes broadly, it makes it harder to isolate these updates.

## Likely Cause Pattern

Several action callbacks depend on `state` or `pipeline`, which changes their identity:

```jsx
const setDriveVector = useCallback(..., [pipeline, recordControlIntent, state.manualDockAssist?.active]);
const setServoAngle = useCallback(..., [pipeline, recordControlIntent, state.manualDockAssist?.active]);
const runMacro = useCallback(..., [driveMacroBackoffEnabled, pipeline, ..., state.macros, ...]);
const startHorn = useCallback(..., [dispatch, normalizedHornSettings, pipeline, ..., state.horn?.active, ...]);
```

Those callbacks are then included in `contextValue`.

Consumers that include those callbacks in effects rerun when the callback identity changes.

## Fix Strategy

### Option A: Split State and Actions Contexts

Create separate contexts:

```jsx
const ControlStateContext = createContext(null);
const ControlActionsContext = createContext(null);
```

Then:

```jsx
<ControlStateContext.Provider value={stateValue}>
  <ControlActionsContext.Provider value={actionsValue}>
    {children}
  </ControlActionsContext.Provider>
</ControlStateContext.Provider>
```

Action-only consumers should not rerender when state changes.

### Option B: Add Selectors

Create a small external-store style control store, similar to `SessionContext` or
`TelemetryContext`, so consumers can select only the state slice they need:

```jsx
useControlSelector((state) => state.camera.angle)
useControlActions()
```

This is more work but scales better.

### Option C: Stabilize Actions With Refs

Keep action function identities stable and read latest state/pipeline from refs:

```jsx
const latestRef = useRef(null);
latestRef.current = { state, pipeline, overcurrentLimiter, ... };

const setDriveVector = useCallback((vector, meta = {}) => {
  const { state, pipeline } = latestRef.current;
  ...
}, []);
```

This pairs well with issue 001 because stable actions make stable input effects easier.

## Recommended Path

For incremental work:

1. Fix issue 001 directly using refs in input managers.
2. Split `ControlActionsContext` from `ControlStateContext`.
3. Convert heavy/control-critical consumers first:
   - `KeyboardInputManager`
   - `GamepadInputManager`
   - mobile controls
   - right pane controls
4. Later add selector hooks for state-heavy consumers.

## Validation

After issue 001 + partial issue 002:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Look for:

- listener add/remove counts near 1
- fewer repeated input attribute mutations
- fewer long tasks
- lower `ScriptDuration` and `TaskDuration`

For development builds, React DevTools Profiler would be ideal to verify fewer renders. The
deployed production page does not currently publish source maps, so local profiling may be
more useful after implementing.

## Risks

- Ref-based stable actions can hide stale state bugs if refs are not updated reliably.
- Splitting context touches many files. Prefer a small staged migration.
- Control commands are safety-sensitive; verify stop/horn/mic/docking behavior carefully.

