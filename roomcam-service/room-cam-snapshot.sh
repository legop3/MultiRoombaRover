#!/usr/bin/env bash
set -euo pipefail

# Configurable via environment
DEVICE="${DEVICE:-/dev/video0}"
RESOLUTION="${RESOLUTION:-640x480}"
QUALITY="${QUALITY:-5}" # ffmpeg MJPEG quality (lower is better)
PORT="${PORT:-8088}"
WORKDIR="${WORKDIR:-/run/roomcam}"

mkdir -p "${WORKDIR}"
SNAPSHOT_PATH="${WORKDIR}/snapshot.jpg"

cleanup() {
  [[ -n "${FFMPEG_PID:-}" ]] && kill "${FFMPEG_PID}" 2>/dev/null || true
  [[ -n "${HTTP_PID:-}" ]] && kill "${HTTP_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' SIGTERM INT

/usr/bin/ffmpeg \
  -loglevel warning -nostats \
  -f v4l2 -input_format mjpeg -video_size "${RESOLUTION}" -i "${DEVICE}" \
  -q:v "${QUALITY}" \
  -f image2 -update 1 "${SNAPSHOT_PATH}" &
FFMPEG_PID=$!

/usr/bin/python3 -u -m http.server "${PORT}" --directory "${WORKDIR}" --bind 0.0.0.0 &
HTTP_PID=$!

wait -n "${FFMPEG_PID}" "${HTTP_PID}"
