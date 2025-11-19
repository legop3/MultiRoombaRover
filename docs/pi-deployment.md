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

### Dummy rover build (for local testing)

If you need extra “virtual” rovers on your laptop/CI box, build the dummy binary:

```bash
cd pi/roverd
mkdir -p ../../dist
make dummy
```

Run the resulting `dist/roverd-dummy` on any machine; it will connect to the server, stream fake Group 100 sensor data, and log drive commands so you can test multi-rover features without additional hardware.

## Automated installation (recommended)

Install the Raspberry Pi camera helpers (Bookworm ships them):

```bash
sudo apt update
sudo apt install libcamera-apps
```

Once the binary (and repo) are on the Pi, run the helper script from the repo root:

```bash
cd ~/MultiRoombaRover
sudo ./pi/install_roverd.sh
```

What the script does:

- creates the `roverd` service account (dialout/gpio/video groups) if missing and installs `/usr/local/bin/roverd`
- copies `pi/roverd/roverd.sample.yaml` to `/etc/roverd.yaml` if the file is absent (existing configs are left untouched)
- installs/enables the `roverd.service` systemd unit, restarting it automatically when a config already exists
- installs `/usr/local/bin/video-publisher`, drops `video-publisher.service`, and enables it so video is published automatically on boot

Flags:

| Flag | Purpose |
|------|---------|
| `-b PATH` | use a different roverd binary (defaults to `dist/roverd`) |
| `-c PATH` | seed `/etc/roverd.yaml` from another template |

If the script installs the sample config, it will remind you to edit `/etc/roverd.yaml` before manually restarting the service: set `name`, `serverUrl`, serial device, BRC pin, battery thresholds, and optionally override `media.publishUrl`. When left blank, roverd automatically publishes to `srt://<server-host>:9000?streamid=#!::r=<name>,m=publish…` (the host comes from `serverUrl`). If your reverse proxy adds prefixes (like `/video/<name>`), use its rewrite options so the rover keeps publishing to plain `<name>`.

Re-run `pi/install_roverd.sh` any time you pull updates—the script overwrites the roverd + video-publisher binaries and drops the latest systemd units so the only configuration you ever touch manually is `/etc/roverd.yaml`. `roverd` rewrites `/var/lib/roverd/video.env` on startup, so no other files need editing.
## Manual installation

1. Copy the binary and config:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin roverd || true
   sudo install -o roverd -g roverd -m 0755 dist/roverd /usr/local/bin/roverd
   sudo install -o roverd -g roverd -m 0640 pi/roverd/roverd.sample.yaml /etc/roverd.yaml
   ```
   Adjust `/etc/roverd.yaml` for each rover: `name`, `serverUrl` (e.g. `ws://control-server:8080/rover`), serial port path, battery thresholds, GPIO pin for BRC, and (if needed) the media `publishUrl` override. Otherwise, roverd derives `srt://<server-host>:9000?streamid=#!::r=<name>,m=publish&latency=20&mode=caller&transtype=live&pkt_size=1316` based on the `serverUrl`; keep proxy-only path prefixes out of this URL so every rover keeps the same simple stream name.

2. Install the systemd unit:
   ```bash
   sudo install -m 0644 pi/systemd/roverd.service /etc/systemd/system/roverd.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now roverd.service
   ```

`roverd` requires access to `/dev/ttyAMA0` and `/dev/gpiochip*`; keeping it under its own user ensures the rest of the system stays isolated—just make sure the account belongs to the `dialout` and `gpio` groups so it can reach the UART and libgpiod.  
The video publisher needs read access to the camera devices (`/dev/media*`, `/dev/video*`), so the install script adds the `roverd` service account to the `video` group; if you created the user manually, make sure it belongs to `video`.  
**BRC note:** configure `brc.gpioPin` (and `brc.gpioChip` if you’re not using `gpiochip0`) and ensure the `roverd` user has permission to toggle that line—no root privileges are required anymore.  
If you set `media.manage: true` in `/etc/roverd.yaml`, make sure the `roverd` service account can invoke `systemctl <action> <media.service>` (the installer wires `video-publisher.service` to run as `roverd`, so no sudo tweaks are required unless you rename it).

## Video publisher details

The `video-publisher.service` unit runs `/usr/local/bin/video-publisher`, piping `rpicam-vid`/`libcamera-vid` straight into the stock FFmpeg package:

```bash
rpicam-vid (or libcamera-vid) --inline --timeout 0 --width=WIDTH --height=HEIGHT \
  --framerate=FPS --bitrate=BITRATE --codec h264 --profile baseline --output - \
  | ffmpeg -hide_banner -loglevel warning -fflags nobuffer \
      -f h264 -i pipe:0 -c:v copy -an -flush_packets 1 -f mpegts $PUBLISH_URL
```

`/var/lib/roverd/video.env` carries all tunables (`PUBLISH_URL`, resolution, FPS, bitrate). `roverd` rewrites the file whenever you restart it or hit the “Restart Camera” button so the publisher always inherits the correct rover ID + bitrate knobs. Because we now use the distro FFmpeg build with SRT enabled, the installer is much faster—no custom compile steps.  
Use `sudo systemctl status video-publisher` to watch logs; the unit auto-restarts whenever the connection drops or FFmpeg exits with an error.

## Server + UI

From the repo root:

```bash
cd server
npm install
npm run start
```

This launches the HTTP server (serving the barebones UI) and the rover WebSocket endpoint at `ws://<server>:8080/rover`. The UI expects `roverd` instances to send `hello` frames so it can populate the rover list. Use the mode buttons to emit Start/Safe/Full/Passive/Dock commands (they send the raw OI opcode bytes), tap the sensor toggle to request Group 100 streaming, and use WASD for drive testing; the UI emits Drive Direct commands ~8 times per second, so the rover sees them immediately.
