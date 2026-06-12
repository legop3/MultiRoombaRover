# Issue 006: Spectator Role Handshake Retries

## Summary

The spectator route sometimes attempts `subscribeAll` before the server has accepted the
socket as a spectator. In the 8x throttled profile, the console repeatedly showed:

```txt
Failed to enter spectator mode Error: Spectator role required
```

This did not reproduce in the later 6x runtime audit, so it is intermittent. It is still
worth fixing because it can create startup retries, extra session/auth events, console
noise, and delayed media setup on slow devices.

## Severity

Medium-low.

This is not the main steady-state CPU eater. Treat it as a correctness/startup reliability
issue that can make performance worse under throttling.

## Upstream Likelihood

Low.

This is specific to `/spectate` startup and server role/subscription ordering. The `/`
performance backlog probably will not fix it.

## Affected Files

- `webui/src/hooks/useSpectatorMode.js`
- `webui/src/context/SocketContext.jsx`
- `webui/src/context/SessionContext.jsx`
- `server/src/services/authService/index.js`
- `server/src/services/roverManager/socketHandlers.js`

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-14-34-168Z/report.json
```

That 8x CPU-throttled profile captured repeated console errors:

```txt
Failed to enter spectator mode Error: Spectator role required
```

Fresh 6x runtime audit:

```txt
consoleErrors: []
auth:role events: 4
```

So the race is not constant, but it exists under some timing conditions.

## Current Code Path

`useSpectatorMode` does this:

```txt
webui/src/hooks/useSpectatorMode.js:18
if (session?.role !== 'spectator') {
  await setRole('spectator');
}

webui/src/hooks/useSpectatorMode.js:21
await subscribeAll();
```

The effect reruns when these change:

```txt
webui/src/hooks/useSpectatorMode.js:36
[connected, session?.mode, session?.role, setRole, subscribeAll]
```

The server rejects `subscribeAll` unless the socket role is already spectator:

```txt
server/src/services/roverManager/socketHandlers.js:161
if (socket.data?.role !== 'spectator') {
  cb({ error: 'Spectator role required' });
}
```

The auth service can initialize a socket as spectator only if the socket handshake query
requests it:

```txt
server/src/services/authService/index.js:40
const requestedRole = socket.handshake?.query?.role;

server/src/services/authService/index.js:41
const initialRole = requestedRole === 'spectator' ? 'spectator' : 'user';
```

If the spectate page connects as a normal user and then switches role after connect, slow
timing can expose ordering issues.

## Why This Matters

The retry itself is not a huge CPU cost. The damage is indirect:

- extra auth/session events
- repeated `subscribeAll` attempts
- delayed rover room joins
- delayed video/snapshot setup
- noisy console errors during profiling
- worse startup behavior on weak devices

## Fix Strategies

### Option A: Connect `/spectate` With `role=spectator`

Make the spectator route establish its socket with a spectator role query from the start:

```txt
io(..., { query: { role: 'spectator' } })
```

This uses the existing server path in `authService`.

### Option B: Wait For Confirmed Role Before `subscribeAll`

After calling `setRole('spectator')`, wait until `auth:role` or session state confirms
`role === 'spectator'`, then call `subscribeAll`.

Avoid calling `subscribeAll` in the same effect tick if the role update has not propagated.

### Option C: Add A Server-Side Atomic Spectator Enter Event

Create one event:

```txt
session:enterSpectator
```

Server behavior:

1. set socket role to spectator
2. join all visible rover rooms
3. return one ack

This removes client-side ordering risk.

### Option D: Debounce Or Guard Retries

If `subscribeAll` fails with `Spectator role required`, do not retry in a tight loop. Wait
for an explicit role event or connection change.

## Recommended Path

The cleanest fix is Option A plus Option B:

1. Make the `/spectate` socket connect as `role=spectator` when possible.
2. Keep `useSpectatorMode` as a fallback, but call `subscribeAll` only after confirmed
   spectator role.

If socket creation is shared in a way that makes route-specific query parameters awkward,
use the atomic server event instead.

## Validation

Run the throttled profile several times:

```sh
CPU_THROTTLE=8 VIEWPORT=390x844 MOBILE=1 \
  node perf/live-cpu-profile.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- No `Failed to enter spectator mode` console errors.
- Fewer `auth:role` events during startup.
- More consistent startup timing.

## Risks

- Be careful not to accidentally make ordinary `/` users spectators.
- If using route-specific socket query parameters, verify reconnects preserve the correct
  role.
- In lockdown mode, spectator setup must still fail cleanly.

