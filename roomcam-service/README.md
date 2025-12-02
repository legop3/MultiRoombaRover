# Room camera snapshot service

Lightweight systemd service that serves a JPEG snapshot from any MJPEG-capable webcam (most USB webcams) at 4 fps. The server pulls `http://<host>:8080/snapshot.jpg` for room cams.

## Files
- `room-cam-snapshot.sh` – ffmpeg + simple HTTP server wrapper
- `room-cam.service` – systemd unit template

## Usage
1) Copy the service into place (adjust path/env as needed):
   ```bash
   sudo cp roomcam-service/room-cam.service /etc/systemd/system/room-cam.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now room-cam.service
   ```
2) Override defaults via `Environment=` in the unit or drop-ins:
   - `DEVICE=/dev/video0`
   - `RESOLUTION=640x480`
   - `QUALITY=5` (ffmpeg MJPEG quality; lower is higher quality)
   - `PORT=8080`
   - `WORKDIR=/run/roomcam`
   - `INPUT_FORMAT=mjpeg` (use `bayer_grbg8` for OV534/raw Bayer cams; aliases `GRBG`/`grbg` are accepted)
3) Point the server `roomCameras[].url` to `http://<host>:8080/snapshot.jpg`.

Notes:
- The camera runs at its native MJPEG frame rate; the server polls snapshots at ~4 fps, so no extra filtering is applied here.

To run outside systemd, just execute `./room-cam-snapshot.sh` with any overrides.
