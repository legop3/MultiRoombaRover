#!/usr/bin/env bash
set -euo pipefail

# Configurable via environment
export DEVICE="${DEVICE:-/dev/video0}"
export RESOLUTION="${RESOLUTION:-640x480}"
export QUALITY="${QUALITY:-10}" # ffmpeg MJPEG quality (lower is better)
export PORT="${PORT:-8088}"
export WORKDIR="${WORKDIR:-/run/roomcam}"
# Optional: set INPUT_FORMAT=bayer_grbg8 to transcode raw Bayer cams (e.g., OV534) to JPEG.
export INPUT_FORMAT="${INPUT_FORMAT:-mjpeg}"
export MJPEG_FPS="${MJPEG_FPS:-15}"
export MJPEG_QUALITY="${MJPEG_QUALITY:-8}"

mkdir -p "${WORKDIR}"
SNAPSHOT_PATH="${WORKDIR}/snapshot.jpg"
rm -f "${SNAPSHOT_PATH}"
# push
cleanup() {
  [[ -n "${HTTP_PID:-}" ]] && kill "${HTTP_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' SIGTERM INT

cat > "${WORKDIR}/mjpeg_server.py" <<'PY'
import os
import threading
import time
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEVICE = os.environ.get("DEVICE", "/dev/video0")
RESOLUTION = os.environ.get("RESOLUTION", "640x480")
INPUT_FORMAT = os.environ.get("INPUT_FORMAT", "mjpeg")
MJPEG_FPS = os.environ.get("MJPEG_FPS", "15")
MJPEG_QUALITY = os.environ.get("MJPEG_QUALITY", "8")
WORKDIR = os.environ.get("WORKDIR", "/run/roomcam")
SNAPSHOT_PATH = os.path.join(WORKDIR, "snapshot.jpg")

FFMPEG_INPUT_ARGS = [
    "-f", "v4l2",
    "-input_format", INPUT_FORMAT,
    "-video_size", RESOLUTION,
    "-i", DEVICE,
]
FFMPEG_FILTERS = []
if INPUT_FORMAT.startswith("bayer_"):
    FFMPEG_FILTERS = ["-pix_fmt", "yuv420p"]

FRAME_LOCK = threading.Lock()
FRAME_EVENT = threading.Event()
LATEST_FRAME = b""

def spawn_mjpeg():
    cmd = [
        "/usr/bin/ffmpeg",
        "-loglevel", "warning", "-nostats",
        *FFMPEG_INPUT_ARGS,
        *FFMPEG_FILTERS,
        "-r", str(MJPEG_FPS),
        "-q:v", str(MJPEG_QUALITY),
        "-f", "mjpeg",
        "-",
    ]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

def update_frame(frame_bytes):
    global LATEST_FRAME
    with FRAME_LOCK:
        LATEST_FRAME = frame_bytes
    FRAME_EVENT.set()
    try:
        with open(SNAPSHOT_PATH, "wb") as fh:
            fh.write(frame_bytes)
    except OSError:
        pass

def frame_reader():
    while True:
        proc = spawn_mjpeg()
        buffer = b""
        try:
            while True:
                chunk = proc.stdout.read(8192)
                if not chunk:
                    break
                buffer += chunk
                while True:
                    start = buffer.find(b"\xff\xd8")
                    end = buffer.find(b"\xff\xd9", start + 2)
                    if start == -1 or end == -1:
                        break
                    frame = buffer[start : end + 2]
                    buffer = buffer[end + 2 :]
                    update_frame(frame)
        finally:
            try:
                proc.kill()
            except Exception:
                pass
        time.sleep(1)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/snapshot.jpg":
            with FRAME_LOCK:
                frame = LATEST_FRAME
            if not frame:
                self.send_error(404, "snapshot missing")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.end_headers()
            self.wfile.write(frame)
            return

        if self.path == "/stream.mjpg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                while True:
                    FRAME_EVENT.wait(timeout=2)
                    FRAME_EVENT.clear()
                    with FRAME_LOCK:
                        frame = LATEST_FRAME
                    if not frame:
                        continue
                    header = (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
                    )
                    self.wfile.write(header)
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
            except BrokenPipeError:
                pass
            return

        self.send_error(404, "not found")

    def log_message(self, format, *args):
        return

def main():
    threading.Thread(target=frame_reader, daemon=True).start()
    addr = ("0.0.0.0", int(os.environ.get("PORT", "8088")))
    ThreadingHTTPServer(addr, Handler).serve_forever()

if __name__ == "__main__":
    main()
PY

/usr/bin/python3 -u "${WORKDIR}/mjpeg_server.py" &
HTTP_PID=$!

wait -n "${HTTP_PID}"
