#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${WHIP_ENV_FILE:-/var/lib/roverd/whip.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish" >&2
	exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${WHIP_URL:?WHIP_URL not set in ${ENV_FILE}}"

VIDEO_WIDTH="${VIDEO_WIDTH:-1280}"
VIDEO_HEIGHT="${VIDEO_HEIGHT:-720}"
VIDEO_FPS="${VIDEO_FPS:-30}"
VIDEO_BITRATE="${VIDEO_BITRATE:-3000000}"

LIBCAMERA_BIN="${LIBCAMERA_BIN:-/usr/bin/libcamera-vid}"
FFMPEG_BIN="${FFMPEG_BIN:-/usr/bin/ffmpeg}"

if [[ ! -x "$LIBCAMERA_BIN" ]]; then
	echo "libcamera-vid not found at ${LIBCAMERA_BIN}" >&2
	exit 1
fi
if [[ ! -x "$FFMPEG_BIN" ]]; then
	echo "ffmpeg not found at ${FFMPEG_BIN}" >&2
	exit 1
fi

run_pipeline() {
	"${LIBCAMERA_BIN}" \
		--inline \
		--timeout 0 \
		--width "${VIDEO_WIDTH}" \
		--height "${VIDEO_HEIGHT}" \
		--framerate "${VIDEO_FPS}" \
		--bitrate "${VIDEO_BITRATE}" \
		--codec h264 \
		--denoise cdn_off \
		--nopreview \
		--output - |
	"${FFMPEG_BIN}" \
		-hide_banner \
		-loglevel warning \
		-f h264 \
		-i pipe:0 \
		-c:v copy \
		-an \
		-f whip \
		"${WHIP_URL}"
}

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "WHIP publisher exited, restarting in 2s..." >&2
	sleep 2
done
