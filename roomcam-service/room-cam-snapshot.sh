#!/usr/bin/env bash
set -euo pipefail

# Configurable via environment
DEVICE="${DEVICE:-/dev/video0}"
RESOLUTION="${RESOLUTION:-640x480}"
QUALITY="${QUALITY:-10}" # ffmpeg MJPEG quality (lower is better)
PORT="${PORT:-8088}"
WORKDIR="${WORKDIR:-/run/roomcam}"
# Optional: set INPUT_FORMAT=bayer_grbg8 to transcode raw Bayer cams (e.g., OV534) to JPEG.
INPUT_FORMAT="${INPUT_FORMAT:-mjpeg}"

mkdir -p "${WORKDIR}"
SNAPSHOT_PATH="${WORKDIR}/snapshot.jpg"
rm -f "${SNAPSHOT_PATH}"

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

/usr/bin/python3 -u -m http.server "${PORT}" --directory "${WORKDIR}" --bind 0.0.0.0 &
HTTP_PID=$!

wait -n "${FFMPEG_PID}" "${HTTP_PID}"
