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

Then point each rover's `/etc/roverd.yaml` at `ws://<server>:8080/rover`, enable the sensor stream from the UI, and drive with WASD.
Use the “Restart Camera” button if you enable media management so roverd can bounce the mediamtx service remotely.
Heads-up: the BRC pulser now uses libgpiod; make sure the `roverd` service account is in the `gpio` group (or otherwise allowed to access `/dev/gpiochip*`) and set `brc.gpioChip` if your hardware exposes a different chip name.
