#!/usr/bin/env bash
set -euo pipefail

# Keep history expansion off so values containing "!" are safe.
set +H

ENV_FILE="${VIDEO_ENV_FILE:-/var/lib/roverd/video.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file ${ENV_FILE} missing; cannot publish" >&2
  exit 1
fi

# Load KEY=VALUE pairs from ENV_FILE WITHOUT evaluating shell metacharacters.
# This makes URLs containing characters like '&' and '#!' safe without requiring quoting.
load_env_file() {
  local content=""

  if [[ -r "$ENV_FILE" ]]; then
    content="$(cat "$ENV_FILE")"
  elif command -v sudo >/dev/null 2>&1; then
    # Try to read via sudo without prompting (useful when the service runs as an unprivileged user)
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
: "${PUBLISH_URL:?PUBLISH_URL not set in ${ENV_FILE}}"

# OV5647: 1296x972 is the common 2x2 binned mode, and it's 4:3.
# Hard-coded output size & FPS (matching your "no env inputs for res/fps" approach).
VIDEO_WIDTH="1296"
VIDEO_HEIGHT="972"
VIDEO_FPS="30"

# Keep bitrate configurable via env (or default).
VIDEO_BITRATE="${VIDEO_BITRATE:-3000000}"

# Force the sensor mode to match the output (avoids libcamera picking a different/cropped mode).
VIDEO_SENSOR_MODE="1296:972"

# Flip the camera 180deg (supported by rpicam-vid/libcamera-vid)
FLIP_ARGS=(--rotation 180)

MODE_ARGS=(--mode "${VIDEO_SENSOR_MODE}")

if [[ -n "${LIBCAMERA_BIN:-}" ]]; then
  LIBCAMERA_BIN_PATH="$LIBCAMERA_BIN"
elif command -v rpicam-vid >/dev/null 2>&1; then
  LIBCAMERA_BIN_PATH="$(command -v rpicam-vid)"
elif command -v libcamera-vid >/dev/null 2>&1; then
  LIBCAMERA_BIN_PATH="$(command -v libcamera-vid)"
else
  echo "Neither rpicam-vid nor libcamera-vid found; install libcamera-apps." >&2
  exit 1
fi

if [[ -n "${FFMPEG_BIN:-}" ]]; then
  FFMPEG_BIN_PATH="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_BIN_PATH="$(command -v ffmpeg)"
else
  echo "ffmpeg not found; install it via apt install ffmpeg." >&2
  exit 1
fi

run_pipeline() {
  "${LIBCAMERA_BIN_PATH}" \
    --inline \
    --timeout 0 \
    "${MODE_ARGS[@]}" \
    --width "${VIDEO_WIDTH}" \
    --height "${VIDEO_HEIGHT}" \
    "${FLIP_ARGS[@]}" \
    --framerate "${VIDEO_FPS}" \
    --bitrate "${VIDEO_BITRATE}" \
    --codec h264 \
    --profile baseline \
    --denoise auto \
    --nopreview \
    --metering centre \
    --ev 0.1 \
    --awb auto \
    --saturation 0.6 \
    --brightness 0 \
    --output - \
  | "${FFMPEG_BIN_PATH}" \
      -hide_banner \
      -loglevel warning \
      -fflags nobuffer \
      -use_wallclock_as_timestamps 1 \
      -f h264 \
      -i pipe:0 \
      -c:v copy \
      -an \
      -flush_packets 1 \
      -f mpegts \
      "${PUBLISH_URL}"
}

while true; do
  if run_pipeline; then
    exit 0
  fi
  echo "Video publisher exited, restarting in 2s..." >&2
  sleep 2
done
