# Issue 001: Global Input Listener Churn

## Summary

The `/` page repeatedly removes and re-adds global keyboard and gamepad event listeners.
This is the clearest and most actionable CPU problem found on the control page.

On weaker CPUs, this turns into measurable main-thread cost. It also makes the input layer
fragile because every broad render/effect invalidation touches global browser listeners.

## Severity

High.

This should be fixed first. It is directly measured and likely amplifies other `/` issues.

## Affected Files

- `webui/src/controls/inputs/KeyboardInputManager.jsx`
- `webui/src/controls/inputs/GamepadInputManager.jsx`
- `webui/src/controls/inputs/gamepadHub.js`
- Related multiplier: `webui/src/controls/ControlContext.jsx`

## Evidence

### Listener Audit

Artifact:

```sh
perf/results/2026-06-11T03-03-31-625Z-listeners/listener-report.json
```

At the second snapshot, the audit saw:

```txt
keydown               adds=8040 removes=8039
keyup                 adds=8040 removes=8039
blur                  adds=8040 removes=8039
gamepadconnected      adds=8040 removes=8039
gamepaddisconnected   adds=8040 removes=8039
```

The stack mapped those to the live bundle locations corresponding to:

- `KeyboardInputManager.jsx` global `keydown`, `keyup`, `blur` effect
- `gamepadHub.js` global `gamepadconnected`, `gamepaddisconnected` listener registration

### Root Runtime Audit

Artifact:

```sh
perf/results/2026-06-11T03-21-51-263Z-root-runtime/root-runtime-report.json
```

In a 30s `/` run at mobile viewport with 6x CPU throttle:

```txt
add:window:keydown             770
remove:window:keydown          769
add:window:keyup               770
remove:window:keyup            769
add:window:blur                770
remove:window:blur             769
add:window:gamepadconnected    770
remove:window:gamepadconnected 769
add:window:gamepaddisconnected 770
remove:window:gamepaddisconnected 769
```

### Clean CPU Profile

Artifact:

```sh
perf/results/2026-06-11T03-15-51-398Z/report.json
```

Clean `/` profile, mobile viewport, 8x CPU throttle:

```txt
average frame interval: ~140ms
p95 frame interval:     ~166.8ms
p99 frame interval:     ~383.4ms
long tasks:             67
event listener delta:   +13,481
removeEventListener:    ~1.30s self time
addEventListener:       ~0.94s self time
```

## Likely Cause

`KeyboardInputManager` installs global listeners inside a `useEffect` with a very large
dependency list:

```jsx
useEffect(() => {
  function handleKeyDown(event) { ... }
  function handleKeyUp(event) { ... }
  function handleBlur() { ... }

  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('keyup', handleKeyUp, { capture: true });
  window.addEventListener('blur', handleBlur);
  return () => {
    window.removeEventListener('keydown', handleKeyDown, { capture: true });
    window.removeEventListener('keyup', handleKeyUp, { capture: true });
    window.removeEventListener('blur', handleBlur);
  };
}, [
  actionTokens,
  blurChat,
  driveFromKeys,
  ensureServoLoop,
  ensureSongLoop,
  focusChat,
  isChatFocused,
  keymap.chatFocus,
  ...
  dockAssist,
]);
```

Many dependencies change when `ControlContext` or settings/session state changes. That
causes the effect to tear down and reinstall global listeners over and over.

`GamepadInputManager` has the same pattern in a subscription effect:

```jsx
useEffect(() => {
  return subscribeGamepadHub((hubState) => { ... });
}, [
  activeSignature,
  ensureProfile,
  gamepadSettings?.defaults?.profile,
  gamepadSettings?.profiles,
  handleButtonEdge,
  handleCameraAxis,
  registerInputState,
  runMacro,
  setAuxMotors,
  setDriveVector,
  setMode,
  toggleNightVision,
  dockAssist,
]);
```

When this effect resubscribes, `subscribeGamepadHub` may add/remove global device listeners
in `gamepadHub.js`.

## Fix Strategy

### KeyboardInputManager

Install global listeners once:

```jsx
const latestRef = useRef(null);

latestRef.current = {
  keymap,
  actionTokens,
  isChatFocused,
  focusChat,
  resetAll,
  driveFromKeys,
  ensureServoLoop,
  ensureSongLoop,
  ...
};

useEffect(() => {
  function handleKeyDown(event) {
    const latest = latestRef.current;
    if (!latest) return;
    // Existing logic, reading from latest instead of closure variables.
  }

  function handleKeyUp(event) {
    const latest = latestRef.current;
    if (!latest) return;
    // Existing logic.
  }

  function handleBlur() {
    latestRef.current?.resetAll();
  }

  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('keyup', handleKeyUp, { capture: true });
  window.addEventListener('blur', handleBlur);
  return () => {
    window.removeEventListener('keydown', handleKeyDown, { capture: true });
    window.removeEventListener('keyup', handleKeyUp, { capture: true });
    window.removeEventListener('blur', handleBlur);
  };
}, []);
```

Keep mutable input state in refs as it already mostly does:

- `activeTokensRef`
- `lastVectorRef`
- `lastAuxRef`
- `servoIntervalRef`
- `songIntervalRef`
- `hornActiveRef`

### GamepadInputManager

Use the same pattern:

- Keep latest settings/actions/state in a ref.
- Subscribe to `subscribeGamepadHub` once.
- The subscription callback reads latest values from the ref.

Do not resubscribe just because profile/settings/action references changed.

### gamepadHub.js

After `GamepadInputManager` is stable, confirm whether `gamepadHub.js` still needs changes.
It already tries to add global device listeners only when there are subscribers. The churn
is likely caused by subscriber churn, not necessarily a bug in the hub itself.

## Validation

Before fix:

```sh
node perf/live-listener-audit.mjs https://rover.otter.land/ perf/results
```

Expected current bad result:

```txt
hundreds or thousands of add/remove pairs for:
keydown
keyup
blur
gamepadconnected
gamepaddisconnected
```

After fix:

```txt
keydown add ~= 1
keyup add ~= 1
blur add ~= 1
gamepadconnected add ~= 1
gamepaddisconnected add ~= 1
removes only on page teardown
```

Also run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
CPU_THROTTLE=8 VIEWPORT=390x844 MOBILE=1 node perf/live-cpu-profile.mjs https://rover.otter.land/ perf/results
```

Expected improvements:

- `JSEventListeners` delta should stop climbing dramatically.
- `addEventListener` / `removeEventListener` should disappear from top CPU self-time.
- Average frame interval and long-task count should improve, though other issues will remain.

## Risks

- Keyboard control safety matters. Be careful to preserve `resetAll()` on blur and text-input
  ignoring behavior.
- If using refs, avoid stale data bugs by updating the ref every render before browser events
  can fire.
- Verify horn hold, mic push-to-talk, chat focus, drive macro, dock assist, camera tilt, song
  controls, and Home Assistant shortcuts.

