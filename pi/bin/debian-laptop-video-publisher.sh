#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${ROVERD_MEDIA_ENV_FILE:-/var/lib/roverd/media.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish laptop video" >&2
	exit 1
fi

# Load roverd's generated media.env as data instead of sourcing it as shell. URLs are
# configuration data, so evaluating the file would be both fragile and unnecessary.
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
: "${ROVERD_VIDEO_ENABLE:?ROVERD_VIDEO_ENABLE not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_PUBLISH_URL:?ROVERD_VIDEO_PUBLISH_URL not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_DEVICE:?ROVERD_VIDEO_DEVICE not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_INPUT_FORMAT:?ROVERD_VIDEO_INPUT_FORMAT not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_WIDTH:?ROVERD_VIDEO_WIDTH not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_HEIGHT:?ROVERD_VIDEO_HEIGHT not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_FPS:?ROVERD_VIDEO_FPS not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_BITRATE:?ROVERD_VIDEO_BITRATE not set in ${ENV_FILE}}"
: "${ROVERD_VIDEO_INVERT:?ROVERD_VIDEO_INVERT not set in ${ENV_FILE}}"

if [[ "${ROVERD_VIDEO_ENABLE}" -ne 1 ]]; then
	echo "Laptop video publisher disabled by roverd media config; skipping" >&2
	exit 0
fi

if [[ -z "${ROVERD_VIDEO_DEVICE}" ]]; then
	echo "ROVERD_VIDEO_DEVICE is required for the debian-laptop V4L2 publisher" >&2
	exit 1
fi

INPUT_FORMAT_ARGS=()
if [[ -n "${ROVERD_VIDEO_INPUT_FORMAT}" ]]; then
	# Many laptop webcams expose both compressed MJPEG and raw YUYV modes. The
	# wrong negotiated format can still produce a decodable stream, but the
	# picture appears as green/noisy mush because ffmpeg is interpreting the
	# frame bytes with the wrong pixel format. Passing input_format pins V4L2 to
	# the camera mode selected in roverd.yaml.
	INPUT_FORMAT_ARGS=(-input_format "${ROVERD_VIDEO_INPUT_FORMAT}")
fi

if [[ -n "${FFMPEG_BIN:-}" ]]; then
	FFMPEG_BIN_PATH="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then
	FFMPEG_BIN_PATH="$(command -v ffmpeg)"
else
	echo "ffmpeg not found; install it via apt install ffmpeg." >&2
	exit 1
fi

VIDEO_FILTER_ARGS=()
if [[ "${ROVERD_VIDEO_INVERT}" -ne 0 ]]; then
	# The Pi publisher uses libcamera rotation. With a generic webcam, ffmpeg's
	# transpose pair gives the same 180-degree correction without assuming a
	# camera-specific driver feature.
	VIDEO_FILTER_ARGS=(-vf "transpose=2,transpose=2")
fi

run_pipeline() {
	# Keep laptop rovers on the same transport contract as Pi camera rovers. This changes
	# only the encoded stream's carrier; V4L2 capture and H264 encoding remain untouched.
	"${FFMPEG_BIN_PATH}" \
		-hide_banner \
		-loglevel warning \
		-fflags nobuffer \
		-flags low_delay \
		-thread_queue_size 4096 \
		-f v4l2 \
		"${INPUT_FORMAT_ARGS[@]}" \
		-framerate "${ROVERD_VIDEO_FPS}" \
		-video_size "${ROVERD_VIDEO_WIDTH}x${ROVERD_VIDEO_HEIGHT}" \
		-i "${ROVERD_VIDEO_DEVICE}" \
		"${VIDEO_FILTER_ARGS[@]}" \
		-an \
		-c:v libx264 \
		-preset veryfast \
		-tune zerolatency \
		-profile:v baseline \
		-pix_fmt yuv420p \
		-b:v "${ROVERD_VIDEO_BITRATE}" \
		-maxrate "${ROVERD_VIDEO_BITRATE}" \
		-bufsize "$((ROVERD_VIDEO_BITRATE / 2))" \
		-g "${ROVERD_VIDEO_FPS}" \
		-keyint_min "${ROVERD_VIDEO_FPS}" \
		-sc_threshold 0 \
		-flush_packets 1 \
		-muxdelay 0 \
		-muxpreload 0 \
		-f rtsp \
		-rtsp_transport tcp \
		"${ROVERD_VIDEO_PUBLISH_URL}"
}

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Debian laptop video publisher exited, restarting in 2s..." >&2
	sleep 2
done
