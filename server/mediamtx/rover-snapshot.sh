#!/usr/bin/env bash
set -euo pipefail

STREAM_ID="${MTX_PATH:-}"
if [[ -z "${STREAM_ID}" ]]; then
  echo "MTX_PATH is required." >&2
  exit 1
fi

if [[ "${STREAM_ID}" == *-audio ]]; then
  exit 0
fi

OUTPUT_DIR="${ROVER_SNAPSHOT_DIR:-/var/lib/rover-snapshots}"
FPS="${ROVER_SNAPSHOT_FPS:-3}"
WIDTH="${ROVER_SNAPSHOT_WIDTH:-640}"
QUALITY="${ROVER_SNAPSHOT_QUALITY:-8}"

mkdir -p "${OUTPUT_DIR}"
OUTPUT_PATH="${OUTPUT_DIR}/${STREAM_ID}.jpg"

INPUT_URL="${ROVER_SNAPSHOT_INPUT_URL:-srt://127.0.0.1:9000?streamid=read:${STREAM_ID}}"

exec /usr/bin/ffmpeg -hide_banner -loglevel warning \
  -fflags nobuffer \
  -i "${INPUT_URL}" \
  -vf "fps=${FPS},scale=${WIDTH}:-1" \
  -q:v "${QUALITY}" \
  -an \
  -f image2 \
  -update 1 \
  "${OUTPUT_PATH}"
