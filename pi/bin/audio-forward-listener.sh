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
AUDIO_NORMALIZE_ENABLE="${AUDIO_NORMALIZE_ENABLE:-1}"
AUDIO_NORMALIZE_FILTER="${AUDIO_NORMALIZE_FILTER:-dynaudnorm=f=75:g=15:m=10:p=0.9,alimiter=limit=0.85:level=disabled}"

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
  local -a ffmpeg_args=(
    -hide_banner
    -loglevel warning
    -fflags nobuffer
    -flags low_delay
    -analyzeduration 200k
    -probesize 32k
    -i "${AUDIO_FORWARD_URL}"
    -vn
  )

  if [[ "${AUDIO_NORMALIZE_ENABLE}" -ne 0 ]]; then
    ffmpeg_args+=(-af "${AUDIO_NORMALIZE_FILTER}")
  fi

  ffmpeg_args+=(
    -ac 1
    -ar 16000
    -f s16le
    pipe:1
  )

  "${FFMPEG_BIN_PATH}" "${ffmpeg_args[@]}" \
    | "${APLAY_BIN_PATH}" \
        -q \
        -D "${PLAYBACK_DEVICE}" \
        -t raw \
        -f S16_LE \
        -r 16000 \
        -c 1
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
