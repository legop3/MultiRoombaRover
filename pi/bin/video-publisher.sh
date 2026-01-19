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
    # Skip blank lines and full-line comments.
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    # Support optional leading 'export '
    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
    else
      # Ignore anything that isn't a simple assignment.
      continue
    fi

    # Trim leading/trailing whitespace in value.
    val="${val#${val%%[![:space:]]*}}"
    val="${val%${val##*[![:space:]]}}"

    # If value is wrapped in matching single or double quotes, unwrap.
    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    # Assign without evaluation.
    printf -v "$key" '%s' "$val"
    export "$key"
  done <<< "$content"
}

load_env_file
: "${PUBLISH_URL:?PUBLISH_URL not set in ${ENV_FILE}}"

# Defaults tuned for OV5647: use 4:3 output and force the common 2x2 binned full-FOV mode.
VIDEO_WIDTH="${VIDEO_WIDTH:-640}"
VIDEO_HEIGHT="${VIDEO_HEIGHT:-480}"
VIDEO_FPS="${VIDEO_FPS:-30}"
VIDEO_BITRATE="${VIDEO_BITRATE:-3000000}"
VIDEO_SENSOR_MODE="${VIDEO_SENSOR_MODE:-1296:972}"

# Flip the camera 180deg (supported by rpicam-vid/libcamera-vid)
FLIP_ARGS=(--rotation 180)

MODE_ARGS=()
if [[ -n "${VIDEO_SENSOR_MODE}" ]]; then
  MODE_ARGS=(--mode "${VIDEO_SENSOR_MODE}")
fi

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
