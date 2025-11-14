# Multi Roomba Rover

a remake of my RoombaRover project with a decentralized and embedded approach
supports multiple roombas

on each roomba:
- a raspberry pi zero 2 w
  - a raspberry pi camera
- roomba's serial port hooked up to the built in serial port on the raspberry pi

pi provisioning:
- enable serial port
- disable wifi powersave
- disable bluetooth

## Repo layout

- `pi/roverd`: tiny Go daemon that bridges the Create 2 serial port, BRC pin, and the control server via WebSockets.
- `server`: Node.js process that terminates rover sockets, relays commands to/from the Socket.IO UI, and serves `public/`.
- `pi/systemd` / `pi/mediamtx`: ready-to-drop systemd units and a minimal mediaMTX config for WebRTC publishing (roverd can optionally supervise the mediamtx service).
- `docs/pi-deployment.md`: per-rover build + install instructions (cross-compiling on Fedora 43, deploying roverd + mediaMTX).

## Quick start

```bash
# build the Pi agent (armv7)
cd pi/roverd
mkdir -p ../../dist
make pi-build

# start the server + UI
cd ../../server
npm install
npm run start
```

Need a fake rover or multi-rover testing without hardware? Use the dummy build:

```bash
cd pi/roverd
mkdir -p ../../dist
make dummy
./../../dist/roverd-dummy -config ./roverd.sample.yaml
```

The dummy binary connects to the Node server, emits simulated sensor frames, and logs every command it receives, so you can spin up as many virtual rovers as you’d like on your dev machine.

## Admin config & authentication

Before running the Node server, copy `server/config.example.yaml` to `server/config.yaml` and customize the admin records (password hashes, Discord IDs, lockdown permission). Those credentials are used by the driver UI’s login panel—only admins can toggle locks/modes, and lockdown admins retain access when the system enters lockdown mode. The spectator page (future) can set `role:set` to `spectator`, and the server enforces all permissions server-side so client tweaks can’t grant extra control.

Deploy a rover by copying the repo + `dist/roverd` to the Pi and running the helper (it will also fetch mediaMTX when `--mediamtx` is set):

```bash
cd ~/MultiRoombaRover
sudo ./pi/install_roverd.sh --mediamtx
```

Then point each rover's `/etc/roverd.yaml` at `ws://<server>:8080/rover`, set `name` to the rover’s ID, and make sure the Pi’s mediaMTX is reachable at `http://<pi-ip>:8889/whep/rovercam` (the default). Each rover advertises that WHEP URL in its `hello` frame, and the server’s media bridge automatically creates a matching pull path so mediaMTX on 192.168.0.86 fans the stream out to drivers/spectators—browsers never talk to the Pi directly.
Use the “Restart Camera” button if you enable media management so roverd can bounce the mediamtx service remotely.
Heads-up: the BRC pulser now uses libgpiod; make sure the `roverd` service account is in the `gpio` group (or otherwise allowed to access `/dev/gpiochip*`) and set `brc.gpioChip` if your hardware exposes a different chip name.

## Fedora server deployment

Run the installer from inside the `server/` directory after cloning the repo onto your Fedora 43 Server box:

```bash
cd ~/MultiRoombaRover/server
sudo ./install_server.sh
```

The script must be executed via `sudo` from the user that owns the repo. It will:

- install Node.js/npm plus curl/tar
- run `npm install --production`
- copy `config.example.yaml` to `config.yaml` if needed (edit the file afterwards for admins/media URLs + `media.mediamtxApiUrl`)
- download mediaMTX v1.15.3 and drop it into `/usr/local/bin`
- write `/etc/mediamtx/mediamtx.yml` that points to the Node server’s `/mediamtx/auth` webhook
- create + enable `mediamtx.service` and `multirover.service`, both running as your repo user and pointing at the clone directly

Publishing rovers lives on a trusted network, so the generated config skips HTTP auth for the `publish` action (only playback hits the Node webhook). If you already ran an older installer, edit `/etc/mediamtx/mediamtx.yml` and add:

```yaml
authHTTPExclude:
  - action: publish
```

Then restart `mediamtx.service` so WHIP pushes from the Pis stop getting rejected.

Once finished, update `server/config.yaml` with your admin passwords, `media.whepBaseUrl` (`http://192.168.0.86:8889/whep`), and `media.mediamtxApiUrl` (usually `http://127.0.0.1:9997`). The Node server hits that API for health checks and token hooks while mediaMTX fans WHIP publishers back out as WHEP viewers. Restart `multirover.service` whenever you edit the config. To pull updates later, just `git pull`, re-run `npm install --production` inside `server/`, and restart the service—no need to rerun the installer.

### Video handshake + diagnostics

- Every `video:request` returns `{ url, token }`. The browser posts the SDP offer to `url` and includes `Authorization: Basic base64(token:token)`. mediaMTX forwards the `token` to `/mediamtx/auth`, which checks the socket’s permissions and either returns 200 or 401—no query parameters are involved anymore.
- To see what mediaMTX is ingesting from the Pis, run `npm run check:media` (or `node scripts/checkMedia.js`). It hits `/v3/paths/list` and prints each rover’s `ready` state and byte counters so you can instantly spot publish issues.
