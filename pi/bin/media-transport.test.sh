#!/usr/bin/env bash
set -euo pipefail

# These publishers contain hardware-facing infinite retry loops, so executing them in a unit
# test would require unsafe process-group traps and fake camera/ALSA devices. Pin the small
# transport boundary directly instead: every publisher must request RTSP/TCP and none may
# reintroduce the high-latency MPEG-TS muxer.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

assert_rtsp_tcp() {
	local file="$1"
	if ! grep -q -- '-f rtsp' "$file"; then
		echo "Missing RTSP muxer in $file" >&2
		exit 1
	fi
	if ! grep -q -- '-rtsp_transport tcp' "$file"; then
		echo "Missing RTSP/TCP pin in $file" >&2
		exit 1
	fi
	if grep -q -- '-f mpegts' "$file"; then
		echo "Unexpected MPEG-TS muxer in $file" >&2
		exit 1
	fi
}

assert_rtsp_tcp "$SCRIPT_DIR/video-publisher.sh"
assert_rtsp_tcp "$SCRIPT_DIR/debian-laptop-video-publisher.sh"
assert_rtsp_tcp "$SCRIPT_DIR/audio-only-publisher.sh"

# The speaker path reads rather than publishes, so it has no output muxer. It must still pin
# RTSP/TCP before its input URL to match the server's TCP-only listener.
if ! grep -q -- '-rtsp_transport tcp' "$SCRIPT_DIR/audio-forward-listener.sh"; then
	echo "Missing RTSP/TCP input pin in audio-forward-listener.sh" >&2
	exit 1
fi

echo "Media publisher transport checks passed"
