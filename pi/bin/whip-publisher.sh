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

GST_BIN="${GST_BIN:-/usr/bin/gst-launch-1.0}"

if [[ ! -x "$GST_BIN" ]]; then
	if command -v gst-launch-1.0 >/dev/null 2>&1; then
		GST_BIN="$(command -v gst-launch-1.0)"
	else
		echo "gst-launch-1.0 not found; install gstreamer1.0-tools and plugins." >&2
		exit 1
	fi
fi

run_pipeline() {
	local bitrate_kbps=$((VIDEO_BITRATE / 1000))
	if [[ "$bitrate_kbps" -le 0 ]]; then
		bitrate_kbps=3000
	fi
	"${GST_BIN}" -e \
		libcamerasrc \
		! "video/x-raw,width=${VIDEO_WIDTH},height=${VIDEO_HEIGHT},framerate=${VIDEO_FPS}/1" \
		! queue \
		! videoconvert \
		! x264enc speed-preset=ultrafast tune=zerolatency bitrate="${bitrate_kbps}" key-int-max="${VIDEO_FPS}" byte-stream=true \
		! "video/x-h264,profile=baseline" \
		! h264parse config-interval=1 \
		! whipclientsink signaller::whip-endpoint="${WHIP_URL}"
}

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "WHIP publisher exited, restarting in 2s..." >&2
	sleep 2
done
