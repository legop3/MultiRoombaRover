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

Make sure the Pi has GStreamer 1.22+ plus the libcamera + bad plugin sets (Bookworm ships them):

```bash
sudo apt update
sudo apt install libcamera-apps \
  gstreamer1.0-tools gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libcamera
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
- installs `/usr/local/bin/whip-publisher`, drops `whip-publisher.service`, and enables it so video is published automatically on boot

Flags:

| Flag | Purpose |
|------|---------|
| `-b PATH` | use a different roverd binary (defaults to `dist/roverd`) |
| `-c PATH` | seed `/etc/roverd.yaml` from another template |

If the script installs the sample config, it will remind you to edit `/etc/roverd.yaml` before manually restarting the service: set `name`, `serverUrl`, serial device, BRC pin, battery thresholds, and optionally override `media.publishUrl`. When left blank, roverd automatically publishes to `http://<server-host>:8889/whip/<name>` (host + scheme are derived from `serverUrl`).

## Manual installation

1. Copy the binary and config:
   ```bash
   sudo useradd -r -s /usr/sbin/nologin roverd || true
   sudo install -o roverd -g roverd -m 0755 dist/roverd /usr/local/bin/roverd
   sudo install -o roverd -g roverd -m 0640 pi/roverd/roverd.sample.yaml /etc/roverd.yaml
   ```
   Adjust `/etc/roverd.yaml` for each rover: `name`, `serverUrl` (e.g. `ws://control-server:8080/rover`), serial port path, battery thresholds, GPIO pin for BRC, and (if needed) the media `whepUrl` override. Otherwise, roverd fills in `http://<pi-ip>:8889/rovercam/whep` based on the DHCP-assigned address.

2. Install the systemd unit:
   ```bash
   sudo install -m 0644 pi/systemd/roverd.service /etc/systemd/system/roverd.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now roverd.service
   ```

`roverd` requires access to `/dev/ttyAMA0` and `/dev/gpiochip*`; keeping it under its own user ensures the rest of the system stays isolated—just make sure the account belongs to the `dialout` and `gpio` groups so it can reach the UART and libgpiod.  
The WHIP publisher needs read access to the camera devices (`/dev/media*`, `/dev/video*`), so the install script adds the `roverd` service account to the `video` group; if you created the user manually, make sure it belongs to `video`.  
**BRC note:** configure `brc.gpioPin` (and `brc.gpioChip` if you’re not using `gpiochip0`) and ensure the `roverd` user has permission to toggle that line—no root privileges are required anymore.  
If you set `media.manage: true` in `/etc/roverd.yaml`, make sure the `roverd` service account can invoke `systemctl <action> <media.service>` (the installer wires `whip-publisher.service` to run as `roverd`, so no sudo tweaks are required unless you rename it).

## WHIP publisher details

The `whip-publisher.service` unit runs `/usr/local/bin/whip-publisher`, a small shell wrapper that launches:

```bash
gst-launch-1.0 libcamerasrc ! video/x-raw,width=WIDTH,height=HEIGHT,framerate=FPS/1 \
  ! videoconvert ! x264enc tune=zerolatency bitrate=BITRATE_KB key-int-max=FPS \
  ! h264parse config-interval=1 ! whipclientsink signaller::whip-endpoint=$WHIP_URL
```

roverd writes `/var/lib/roverd/whip.env` on startup (and whenever you restart the service) so the publisher inherits the correct `WHIP_URL`, resolution, FPS, and bitrate. Tweak those knobs under `media.videoWidth`, `media.videoHeight`, `media.videoFps`, and `media.videoBitrate` in `/etc/roverd.yaml` if you need different camera settings.  
Use `sudo systemctl status whip-publisher` to watch the pipeline logs; the unit auto-restarts whenever the network drops or GStreamer exits.

## Server + UI

From the repo root:

```bash
cd server
npm install
npm run start
```

This launches the HTTP server (serving the barebones UI) and the rover WebSocket endpoint at `ws://<server>:8080/rover`. The UI expects `roverd` instances to send `hello` frames so it can populate the rover list. Use the mode buttons to emit Start/Safe/Full/Passive/Dock commands (they send the raw OI opcode bytes), tap the sensor toggle to request Group 100 streaming, and use WASD for drive testing; the UI emits Drive Direct commands ~8 times per second, so the rover sees them immediately.
