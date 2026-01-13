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
  [[ -n "${FFMPEG_PID:-}" ]] && kill "${FFMPEG_PID}" 2>/dev/null || true
  [[ -n "${HTTP_PID:-}" ]] && kill "${HTTP_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' SIGTERM INT

FFMPEG_INPUT_ARGS=(-f v4l2 -input_format "${INPUT_FORMAT}" -video_size "${RESOLUTION}" -i "${DEVICE}")
FFMPEG_FILTERS=()
if [[ "${INPUT_FORMAT}" == bayer_* ]]; then
  # Convert raw Bayer to a JPEG-friendly pixel format.
  FFMPEG_FILTERS=(-pix_fmt yuv420p)
fi

/usr/bin/ffmpeg -y \
  -loglevel warning -nostats \
  "${FFMPEG_INPUT_ARGS[@]}" \
  "${FFMPEG_FILTERS[@]}" \
  -q:v "${QUALITY}" \
  -f image2 -update 1 "${SNAPSHOT_PATH}" &
FFMPEG_PID=$!

cat > "${WORKDIR}/mjpeg_server.py" <<'PY'
import os
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

def spawn_mjpeg():
    cmd = [
        "/usr/bin/ffmpeg",
        "-loglevel", "warning", "-nostats",
        *FFMPEG_INPUT_ARGS,
        *FFMPEG_FILTERS,
        "-r", str(MJPEG_FPS),
        "-q:v", str(MJPEG_QUALITY),
        "-f", "mpjpeg",
        "-",
    ]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/snapshot.jpg":
            try:
                with open(SNAPSHOT_PATH, "rb") as fh:
                    data = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404, "snapshot missing")
            return

        if self.path == "/stream.mjpg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=ffmpeg")
            self.end_headers()
            proc = spawn_mjpeg()
            try:
                while True:
                    chunk = proc.stdout.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except BrokenPipeError:
                pass
            finally:
                proc.kill()
            return

        self.send_error(404, "not found")

    def log_message(self, format, *args):
        return

def main():
    addr = ("0.0.0.0", int(os.environ.get("PORT", "8088")))
    ThreadingHTTPServer(addr, Handler).serve_forever()

if __name__ == "__main__":
    main()
PY

/usr/bin/python3 -u "${WORKDIR}/mjpeg_server.py" &
HTTP_PID=$!

wait -n "${FFMPEG_PID}" "${HTTP_PID}"
