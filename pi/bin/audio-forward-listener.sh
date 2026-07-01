#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${ROVERD_MEDIA_ENV_FILE:-/var/lib/roverd/media.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file ${ENV_FILE} missing; cannot start audio forward listener" >&2
  exit 1
fi

# Load KEY=VALUE pairs from media.env without evaluating shell syntax. The
# forward URL is data produced by roverd, and treating it as shell code would
# break on normal SRT query-string characters such as '&'.
load_env_file() {
  local content=""

  if [[ -r "$ENV_FILE" ]]; then
    content="$(cat "$ENV_FILE")"
  elif command -v sudo >/dev/null 2>&1; then
    content="$(sudo -n cat "$ENV_FILE" 2>/dev/null || true)"
  fi

  if [[ -z "$content" ]]; then
    echo "Cannot read ${ENV_FILE} (permission denied). Run as a user that can read it, or allow sudo -n for cat." >&2
    exit 1
  fi

  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
    else
      continue
    fi

    val="${val#${val%%[![:space:]]*}}"
    val="${val%${val##*[![:space:]]}}"
    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    printf -v "$key" '%s' "$val"
    export "$key"
  done <<< "$content"
}

load_env_file

: "${ROVERD_AUDIO_PLAYBACK_ENABLE:?ROVERD_AUDIO_PLAYBACK_ENABLE not set in ${ENV_FILE}}"
if [[ "${ROVERD_AUDIO_PLAYBACK_ENABLE}" -ne 1 ]]; then
  echo "Audio playback disabled by roverd media config; skipping audio forward listener" >&2
  exit 0
fi
: "${ROVERD_AUDIO_PLAYBACK_FORWARD_URL:?ROVERD_AUDIO_PLAYBACK_FORWARD_URL not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_PLAYBACK_DEVICE:?ROVERD_AUDIO_PLAYBACK_DEVICE not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_PLAYBACK_NORMALIZE:?ROVERD_AUDIO_PLAYBACK_NORMALIZE not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER:?ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER not set in ${ENV_FILE}}"
PLAYBACK_DEVICE="${ROVERD_AUDIO_PLAYBACK_DEVICE}"

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
    -i "${ROVERD_AUDIO_PLAYBACK_FORWARD_URL}"
    -vn
  )

  if [[ "${ROVERD_AUDIO_PLAYBACK_NORMALIZE}" -ne 0 ]]; then
    ffmpeg_args+=(-af "${ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER}")
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
