# Pi Deployment Guide

## Tooling

Fedora 43:

```bash
sudo dnf install golang libgpiod
```

Cross-compiling roverd for Pi Zero 2 W (ARMv7):

```bash
cd pi/roverd
mkdir -p ../../dist
make pi-build
```

The binary is placed in `dist/roverd` (relative to the repo root).

## Automated installation (recommended)

Once the binary (and repo) are on the Pi, run the helper script from the repo root:

```bash
cd ~/MultiRoombaRover
sudo ./pi/install_roverd.sh --mediamtx
```

What the script does:

- creates the `roverd` (and optionally `mediamtx`) service users if missing and installs `/usr/local/bin/roverd`
- copies `pi/roverd/roverd.sample.yaml` to `/etc/roverd.yaml` if the file is absent (existing configs are left untouched)
- installs/enables the `roverd.service` systemd unit, restarting it automatically when a config already exists
- when `--mediamtx` is passed, installs the sample mediaMTX config + unit, enables the service, and restarts it

Flags:

| Flag | Purpose |
|------|---------|
| `-b PATH` | use a different roverd binary (defaults to `dist/roverd`) |
| `-c PATH` | seed `/etc/roverd.yaml` from another template |
| `--mediamtx` | install the provided mediaMTX config + unit alongside roverd |

If the script installs the sample config, it will remind you to edit `/etc/roverd.yaml` before manually restarting the service: set `name`, `serverUrl`, serial device, BRC pin, battery thresholds, and the WHEP URL that the central server should expose.

## Manual installation

1. Copy the binary and config:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin roverd || true
   sudo install -o roverd -g roverd -m 0755 dist/roverd /usr/local/bin/roverd
   sudo install -o roverd -g roverd -m 0640 pi/roverd/roverd.sample.yaml /etc/roverd.yaml
   ```
   Adjust `/etc/roverd.yaml` for each rover: `name`, `serverUrl` (e.g. `ws://control-server:8080/rover`), serial port path, battery thresholds, GPIO pin for BRC, and the media WHEP URL that points at the central distribution server.

2. Install the systemd unit:
   ```bash
   sudo install -m 0644 pi/systemd/roverd.service /etc/systemd/system/roverd.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now roverd.service
   ```

`roverd` requires access to `/dev/ttyAMA0` and `/sys/class/gpio`; keeping it under its own user ensures the rest of the system stays isolated.  
If you set `media.manage: true` in `/etc/roverd.yaml`, make sure the `roverd` service account can invoke `systemctl <action> <media.service>` (either run the unit as root or grant sudo privileges for that command).

## Configuring mediaMTX

1. Download the latest mediaMTX release for ARMv7 and place the binary at `/usr/local/bin/mediamtx`.
2. Copy the provided config:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin mediamtx || true
   sudo install -d -o mediamtx -g mediamtx /etc/mediamtx
   sudo install -o mediamtx -g mediamtx -m 0644 pi/mediamtx/mediamtx.yml /etc/mediamtx/mediamtx.yml
   sudo install -m 0644 pi/systemd/mediamtx.service /etc/systemd/system/mediamtx.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now mediamtx.service
   ```

The sample config uses the Raspberry Pi camera module as the source and exposes a WHEP endpoint at `http://<pi-host>:8889/whep/rovercam`. Point `media.whepUrl` in `roverd.yaml` at this URL so the central server can list it.  
Expose the mediaMTX HTTP API locally (default `http://127.0.0.1:9997`) and set `media.healthUrl` so `roverd` can monitor the pipeline; `media.service` should match the systemd unit name (default `mediamtx.service`).

## Server + UI

From the repo root:

```bash
cd server
npm install
npm run start
```

This launches the HTTP server (serving the barebones UI) and the rover WebSocket endpoint at `ws://<server>:8080/rover`. The UI expects `roverd` instances to send `hello` frames so it can populate the rover list. Use the mode buttons to emit Start/Safe/Full/Passive/Dock commands (they send the raw OI opcode bytes), tap the sensor toggle to request Group 100 streaming, and use WASD for drive testing; the UI emits Drive Direct commands ~8 times per second, so the rover sees them immediately.
