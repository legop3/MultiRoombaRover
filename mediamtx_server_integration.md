# mediaMTX Integration

Each rover runs mediaMTX locally to capture the Pi camera and publish it upstream, while the control server hosts a central mediaMTX instance that fans video out to drivers and spectators.

## Pi (publisher)

- mediaMTX samples the Pi camera (`paths.rovercam.source: rpiCamera`) and exposes the HTTP API on `http://127.0.0.1:9997`.
- `/etc/roverd.yaml` contains `media.publishUrl`, pointing at the control server’s WHIP endpoint for that rover (e.g. `https://control.example.com/whip/roomba-alpha`). No auth is required when the Pi network is trusted.
- The `media.manage` flag keeps the local service alive via `systemctl` and hits the API for health checks (`media.healthUrl`, defaults to `http://127.0.0.1:9997/v3/paths/list`).

## Control server (viewer)

- The central mediaMTX instance accepts WHIP ingest at `/whip/<roverId>` and serves WHEP playback at `/whep/<roverId>`.
- The Node server issues viewer sessions (one per socket) via `video:request`, and mediaMTX calls back into `GET /mediamtx/auth?session=<id>&roverId=<name>` before letting a client access `/whep/<roverId>?session=<id>`. Lockdown mode simply stops minting sessions for non-lockdown admins.

## Driver / spectator UIs

- When a user requests video the browser asks the Node server for a session token, and if the current mode/role allows it, the server returns the WHEP URL plus the session id.
- Spectator mode and lockdown are enforced purely on the Node server: no direct Pi URLs are ever exposed, and once a user has a session it remains valid until they disconnect or lockdown revokes it.
