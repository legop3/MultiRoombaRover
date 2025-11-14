# mediaMTX Integration

Each rover runs mediaMTX locally to capture the Pi camera, and the control server hosts a central mediaMTX instance that fans video out to drivers and spectators. When a rover connects, the Node server asks the central mediaMTX to _pull_ the rover’s local WHEP stream and expose it under the rover’s name.

## Pi (publisher)

- mediaMTX samples the Pi camera (`paths.rovercam.source: rpiCamera`) and exposes the HTTP API on `http://127.0.0.1:9997`.
- `/etc/roverd.yaml` contains `media.whepUrl`, pointing at the Pi’s own WHEP endpoint (e.g. `http://roomba-alpha.local:8889/whep/rovercam`). This is what the central server will pull.
- The `media.manage` flag keeps the local service alive via `systemctl` and hits the API for health checks (`media.healthUrl`, defaults to `http://127.0.0.1:9997/v3/paths/list`).

## Control server (viewer)

- The central mediaMTX instance serves WHEP playback at `/whep/<roverId>` and exposes its control API on `http://127.0.0.1:9997`.
- When a rover connects, the Node server calls `POST /v3/config/paths/replace/<roverId>` and sets `source: whep://<pi-ip>:8889/rovercam/whep`. When the rover disconnects, the path is removed.
- Viewers still use `video:request` to obtain a session token. mediaMTX calls back into `/mediamtx/auth` before letting a client access `/whep/<roverId>?session=...`, and the Node server enforces lockdown/role rules there.

## Driver / spectator UIs

- When a user requests video the browser asks the Node server for a session token, and if the current mode/role allows it, the server returns the WHEP URL plus the session id.
- Spectator mode and lockdown are enforced purely on the Node server: no direct Pi URLs are ever exposed, and once a user has a session it remains valid until they disconnect or lockdown revokes it.
