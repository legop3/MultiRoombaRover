# Issue 003: Room Camera And Snapshot Object URL Churn

## Summary

Room camera and rover snapshot frames are delivered as binary payloads. The client creates
a new `Blob`, creates a new object URL, revokes the previous URL, and updates React state
for every frame. In the 30s `/spectate` audit, this caused 117 `img.src` mutations and
11MB of binary socket payloads.

## Severity

Medium-high.

This is not the biggest measured CPU source, but it is steady work and very visible on
low-end devices because JPEG decoding, Blob allocation, object URL churn, image source
updates, and React state updates all happen together.

## Upstream Likelihood

Low.

This is mostly `/spectate` and camera-panel specific. It will not be fixed by the `/`
input, control context, or log work. It may benefit indirectly if broad rerenders are
reduced, but the frame handling itself needs targeted changes.

## Affected Files

- `webui/src/hooks/useRoomCameraSnapshots.js`
- `webui/src/hooks/useRoverSnapshots.js`
- `webui/src/components/RoomCameraPanel/index.jsx`
- `webui/src/components/RoomCameraFeed/index.jsx`
- `server/src/services/roomCameraService/socketGateway.js`
- `server/src/services/roverSnapshotService/socketGateway.js`

## Evidence

Artifact:

```sh
perf/results/2026-06-12T04-55-16-888Z-root-runtime/root-runtime-report.json
```

30s sample:

```txt
unlabeled binary socket events: 126
unlabeled binary bytes:         11,048,477
roomCamera:frame events:           117
roverSnapshot:frame events:          7
img src mutations:                 117
blink class mutations:             117
```

The 8x throttled profile also had these CPU entries:

```txt
Blob
decodeString
setAttribute
```

Those line up with binary socket parsing, Blob/object URL creation, and `img.src` updates.

## Current Code Path

`useRoomCameraSnapshots` handles each frame:

```txt
webui/src/hooks/useRoomCameraSnapshots.js:78
const blob = new Blob([buffer], { type: 'image/jpeg' });

webui/src/hooks/useRoomCameraSnapshots.js:79
const url = URL.createObjectURL(blob);

webui/src/hooks/useRoomCameraSnapshots.js:82
URL.revokeObjectURL(prevUrl);

webui/src/hooks/useRoomCameraSnapshots.js:85
setFeeds(...)
```

`useRoverSnapshots` has the same pattern.

`RoomCameraFeed` writes that object URL into an image:

```txt
webui/src/components/RoomCameraFeed/index.jsx:24
<img src={feed.objectUrl} ... />
```

It also toggles blink state for each frame:

```txt
webui/src/components/RoomCameraFeed/index.jsx:12
setBlink((prev) => !prev);
```

Server-side frame rates:

```txt
server/src/services/roomCameraService/socketGateway.js:11
STREAM_INTERVAL_MS = 1000

server/src/services/roverSnapshotService/socketGateway.js:11
STREAM_INTERVAL_MS = 333
```

## Why This Matters

The page is doing memory allocation and DOM/image decode work on every camera frame. At
one room camera per second this can be acceptable, but `/spectate` is already busy. When
combined with live WebRTC and telemetry maps, this becomes another steady CPU drain.

The blink dot is also doing one React state update and class mutation per frame. It is
small, but it is pure extra work.

## Fix Strategies

### Option A: Drop Frames When The Client Is Behind

Keep only the latest pending frame per camera. If the previous object URL has not been
painted or decoded yet, replace the pending buffer instead of forcing every frame through
React.

### Option B: Throttle Display Updates On Mobile

Render room camera frames at a lower client-side display rate:

```txt
desktop: 1fps as today, or configured
mobile:  0.2-0.5fps for secondary room cameras
```

The server can still emit at its existing rate for other clients, but this client can
choose not to render every frame.

### Option C: Lazy Mount Or Collapse Room Cameras On Mobile

On portrait mobile, `SecondaryRow` can defer `RoomCameraPanel` until:

- the user scrolls near it
- the user opens the panel
- the page is idle after initial rover feeds have settled

### Option D: Remove Per-Frame React Blink State

Replace the blink toggle with CSS animation or a timestamp updated less often.

For example:

- keep status text
- use a CSS pulse class while status is `playing`
- avoid toggling React state on every frame

### Option E: Stabilize Room Camera Source Lists

`RoomCameraPanel` currently passes a newly created array of objects into the snapshot hook:

```txt
webui/src/components/RoomCameraPanel/index.jsx:37
useRoomCameraSnapshots(cameras.map((camera) => ({ id: camera.id })))
```

The hook ultimately keys by IDs, so this is not the main issue, but it still creates extra
memo/effect churn on rerender. Prefer a memoized array of IDs:

```jsx
const cameraIds = useMemo(() => cameras.map((camera) => camera.id), [cameras]);
const feedMap = useRoomCameraSnapshots(cameraIds);
```

## Recommended Path

Start with the cheap fixes:

1. Remove the per-frame blink state.
2. Memoize camera IDs in `RoomCameraPanel`.
3. Add client-side render throttling/drop-latest behavior in `useRoomCameraSnapshots`.
4. Consider lazy mounting/collapsing room cameras in mobile spectator layout.

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=30000 \
  node perf/live-root-runtime-audit.mjs https://rover.otter.land/spectate perf/results
```

Expected improvements:

- `img.h-full.w-full:attributes:src` mutations should drop if display is throttled.
- `span.h-2.w-2:attributes:class` mutations should disappear if blink state is removed.
- `ScriptDuration` and long tasks should improve modestly.
- Binary socket bytes may stay the same unless server subscription/rate is changed.

## Risks

- Reducing room camera update rate can make the room view feel stale.
- Object URL lifecycle must stay correct. Do not leak old URLs.
- If lazy mounting unsubscribes too aggressively, first frame display may feel delayed.

