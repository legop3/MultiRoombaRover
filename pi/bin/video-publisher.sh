#!/usr/bin/env bash
set -euo pipefail

# Keep history expansion off so values containing "!" are safe.
set +H

ENV_FILE="${ROVERD_MEDIA_ENV_FILE:-/var/lib/roverd/media.env}"

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
: "${ROVERD_VIDEO_ENABLE:?ROVERD_VIDEO_ENABLE not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_PUBLISH_URL:?ROVERD_VIDEO_PUBLISH_URL not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_WIDTH:?ROVERD_VIDEO_WIDTH not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_HEIGHT:?ROVERD_VIDEO_HEIGHT not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_FPS:?ROVERD_VIDEO_FPS not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_BITRATE:?ROVERD_VIDEO_BITRATE not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_INVERT:?ROVERD_VIDEO_INVERT not set in ${ENV_FILE}}"

if [[ "${ROVERD_VIDEO_ENABLE}" -ne 1 ]]; then
  echo "Video publisher disabled by roverd media config; skipping" >&2
  exit 0
fi

# The inversion decision is made in roverd.yaml and written into media.env, so
# this script only converts the configured logical value into libcamera flags.
FLIP_ARGS=()
if [[ "${ROVERD_VIDEO_INVERT}" -ne 0 ]]; then
  FLIP_ARGS=(--rotation 180)
fi

MODE_ARGS=()
if [[ -n "${ROVERD_VIDEO_SENSOR_MODE:-}" ]]; then
  MODE_ARGS=(--mode "${ROVERD_VIDEO_SENSOR_MODE}")
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

# Transport selection.
#
# Measured on the latency harness in webrtc/: publishing these same encoded frames
# without the MPEG-TS container takes glass-to-glass latency from ~172ms to ~12ms. The
# delay is inside MediaMTX's mpegts demux, so no ffmpeg flag on this side reaches it -
# the container itself has to go. SRT latency, encoder settings, and the browser were
# all eliminated as causes; see webrtc/README.md for the full attribution.
#
# Three transports, chosen by roverd.yaml. roverd validates the value and writes it here,
# so this script does not second-guess it:
#
#   rtsp    Default. Works on ffmpeg 4.x+, so every current rover can use it. Requires
#           `rtsp: yes` on the media server. TCP, always - see below.
#   whip    Faster still (27ms vs 39ms) and steadier, but the muxer needs ffmpeg >= 7.1
#           and Raspberry Pi OS bookworm ships 5.1. Set it once ffmpeg is upgraded.
#   mpegts  The old path. Slowest, always available; set this to get the previous
#           behaviour back.
#
# RTSP is TCP, not UDP. Measured against a real VPS: RTSP/TCP gave 39ms against 199-235ms
# for MPEG-TS/SRT, while RTSP/UDP failed outright - the stream published, MediaMTX reported
# the path ready, and no WebRTC reader ever started because no complete keyframe assembled.
# Plain RTP/UDP has no retransmission where the SRT it replaces has ARQ, so UDP here is
# strictly worse than what it replaces. TCP's cost is head-of-line blocking on a bad radio;
# if that ever bites, the answer is whip, not udp.
resolve_transport() {
  case "${ROVERD_VIDEO_TRANSPORT:-rtsp}" in
    srt) echo "mpegts" ;;
    whip) echo "whip" ;;
    mpegts) echo "mpegts" ;;
    *) echo "rtsp" ;;
  esac
}

# Output arguments for the selected transport. Everything before this point in the
# pipeline is identical across transports, so switching cannot change what is encoded -
# only how it is carried.
transport_output_args() {
  case "$1" in
    whip)
      # pkt_size 1200 keeps RTP payloads inside a typical 1500-byte MTU so packets are
      # not fragmented leaving the rover.
      printf '%s\n' -f whip -pkt_size 1200 "${ROVERD_VIDEO_WHIP_URL}"
      ;;
    rtsp)
      printf '%s\n' -f rtsp -rtsp_transport "${ROVERD_VIDEO_RTSP_TRANSPORT:-tcp}" "${ROVERD_VIDEO_RTSP_URL}"
      ;;
    *)
      printf '%s\n' -f mpegts "${ROVERD_VIDEO_PUBLISH_URL}"
      ;;
  esac
}

run_pipeline() {
  local transport="$1"
  local -a output_args=()
  while IFS= read -r arg; do output_args+=("$arg"); done < <(transport_output_args "$transport")

  "${LIBCAMERA_BIN_PATH}" \
    --inline \
    --timeout 0 \
    "${MODE_ARGS[@]}" \
    --width "${ROVERD_VIDEO_WIDTH}" \
    --height "${ROVERD_VIDEO_HEIGHT}" \
    "${FLIP_ARGS[@]}" \
    --framerate "${ROVERD_VIDEO_FPS}" \
    --bitrate "${ROVERD_VIDEO_BITRATE}" \
    --codec h264 \
    --intra 120 \
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
      -muxdelay 0 \
      -muxpreload 0 \
      "${output_args[@]}"
}

# Records the transport in use so roverd can show it in the Pi stats card. Best-effort: a
# missing or read-only state directory must never stop video, and `set -e` is active, so each
# step is guarded.
write_transport_state() {
  local dir="${ROVERD_MEDIA_STATE_DIR:-/run/roverd}"
  mkdir -p "$dir" 2>/dev/null || return 0
  printf 'transport=%s\n' "$1" >"${dir}/video-transport" 2>/dev/null || true
  return 0
}

TRANSPORT="$(resolve_transport)"
echo "Video publisher using transport: ${TRANSPORT}" >&2
write_transport_state "$TRANSPORT"

# Restart on exit. systemd has Restart=always as the outer net; this loop keeps the restart
# quick and keeps the state file accurate without a service bounce.
while true; do
  if run_pipeline "$TRANSPORT"; then
    exit 0
  fi
  echo "Video publisher exited, restarting in 2s..." >&2
  sleep 2
done
