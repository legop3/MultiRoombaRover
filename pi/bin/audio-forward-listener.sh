#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${VIDEO_ENV_FILE:-/var/lib/roverd/video.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file ${ENV_FILE} missing; cannot start audio forward listener" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${AUDIO_FORWARD_URL:?AUDIO_FORWARD_URL not set in ${ENV_FILE}}"
PLAYBACK_DEVICE="${AUDIO_PLAYBACK_DEVICE:-forward}"

if [[ -n "${FFMPEG_BIN:-}" ]]; then
  FFMPEG_BIN_PATH="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_BIN_PATH="$(command -v ffmpeg)"
else
  echo "ffmpeg not found; install it via apt install ffmpeg." >&2
  exit 1
fi

if command -v aplay >/dev/null 2>&1; then
  APLAY_BIN_PATH="$(command -v aplay)"
else
  echo "aplay not found; install it via apt install alsa-utils." >&2
  exit 1
fi

LAST_FFMPEG_STATUS="unknown"
LAST_APLAY_STATUS="unknown"

run_pipeline() {
  set +e
  "${FFMPEG_BIN_PATH}" \
    -hide_banner \
    -loglevel warning \
    -fflags nobuffer \
    -flags low_delay \
    -max_delay 0 \
    -reorder_queue_size 0 \
    -analyzeduration 0 \
    -probesize 32 \
    -i "${AUDIO_FORWARD_URL}" \
    -vn \
    -ac 1 \
    -ar 16000 \
    -f s16le \
    pipe:1 \
    | "${APLAY_BIN_PATH}" \
      -q \
      -D "${PLAYBACK_DEVICE}" \
      -t raw \
      -f S16_LE \
      -r 16000 \
      -c 1 \
      -B 40000 \
      -F 10000
  local rc=$?
  local -a statuses=("${PIPESTATUS[@]}")
  LAST_FFMPEG_STATUS="${statuses[0]:-unknown}"
  LAST_APLAY_STATUS="${statuses[1]:-unknown}"
  set -e
  return "${rc}"
}

trap 'kill 0 2>/dev/null' EXIT INT TERM

while true; do
  if run_pipeline; then
    exit 0
  fi
  echo "Audio forward listener exited ffmpeg=${LAST_FFMPEG_STATUS:-unknown} aplay=${LAST_APLAY_STATUS:-unknown}, restarting in 2s..." >&2
  sleep 2
done
