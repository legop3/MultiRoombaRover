#!/usr/bin/env bash
set -euo pipefail
# Disable history expansion so PUBLISH_URL values with "!" are safe when sourcing env files.
set +H

ENV_FILE="${VIDEO_ENV_FILE:-/var/lib/roverd/video.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish" >&2
	exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
: "${PUBLISH_URL:?PUBLISH_URL not set in ${ENV_FILE}}"

VIDEO_WIDTH="${VIDEO_WIDTH:-1920}"
VIDEO_HEIGHT="${VIDEO_HEIGHT:-1080}"
VIDEO_FPS="${VIDEO_FPS:-30}"
VIDEO_BITRATE="${VIDEO_BITRATE:-3000000}"
AUDIO_ENABLE="${AUDIO_ENABLE:-0}"
AUDIO_DEVICE="${AUDIO_DEVICE:-plughw:0,0}"
AUDIO_RATE="${AUDIO_RATE:-16000}"
AUDIO_CHANNELS="${AUDIO_CHANNELS:-1}"
AUDIO_BITRATE="${AUDIO_BITRATE:-64000}"

# Normalize device if env still says "default"
if [[ "${AUDIO_DEVICE}" == "default" ]]; then
	AUDIO_DEVICE="plughw:0,0"
fi
# Flip the camera 180deg (supported by rpicam-vid/libcamera-vid)
FLIP_ARGS=(--rotation 180)

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

# Flip using the native rotation flag (0/180 supported per rpicam-vid --help).
FLIP_ARGS=(--rotation 180)

run_pipeline() {
	if [[ "${AUDIO_ENABLE}" -eq 1 ]]; then
		# Try audio + video; if audio device is missing, fallback to video-only.
		if ! "${LIBCAMERA_BIN_PATH}" \
			--inline \
			--timeout 0 \
			--width "${VIDEO_WIDTH}" \
			--height "${VIDEO_HEIGHT}" \
			"${FLIP_ARGS[@]}" \
			--framerate "${VIDEO_FPS}" \
			--bitrate "${VIDEO_BITRATE}" \
			--codec h264 \
			--profile baseline \
			--denoise cdn_off \
			--nopreview \
			--awb custom \
			--awbgains 1.5,1.8 \
			--output - \
			| "${FFMPEG_BIN_PATH}" \
				-hide_banner \
				-loglevel warning \
				-fflags nobuffer \
				-use_wallclock_as_timestamps 1 \
				-f h264 \
				-i pipe:0 \
				-f alsa \
				-thread_queue_size 512 \
				-ac "${AUDIO_CHANNELS}" \
				-ar "${AUDIO_RATE}" \
				-i "${AUDIO_DEVICE}" \
				-c:v copy \
				-c:a aac \
				-b:a "${AUDIO_BITRATE}" \
				-ac "${AUDIO_CHANNELS}" \
				-ar "${AUDIO_RATE}" \
				-flush_packets 1 \
				-f mpegts \
				"${PUBLISH_URL}"
		then
			echo "Audio pipeline failed; falling back to video-only this run" >&2
			AUDIO_ENABLE=0
		fi
	fi

	if [[ "${AUDIO_ENABLE}" -ne 1 ]]; then
		"${LIBCAMERA_BIN_PATH}" \
			--inline \
			--timeout 0 \
			--width "${VIDEO_WIDTH}" \
			--height "${VIDEO_HEIGHT}" \
			"${FLIP_ARGS[@]}" \
			--framerate "${VIDEO_FPS}" \
			--bitrate "${VIDEO_BITRATE}" \
			--codec h264 \
			--profile baseline \
			--denoise cdn_off \
			--nopreview \
			--awb custom \
			--awbgains 1.5,1.8 \
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
	fi
}

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Video publisher exited, restarting in 2s..." >&2
	sleep 2
done
