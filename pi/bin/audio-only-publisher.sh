#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${VIDEO_ENV_FILE:-/var/lib/roverd/video.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish audio" >&2
	exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
AUDIO_ENABLE="${AUDIO_ENABLE:-0}"
if [[ "${AUDIO_ENABLE}" -ne 1 ]]; then
	echo "Audio capture disabled; skipping audio-only publisher" >&2
	exit 0
fi
: "${AUDIO_PUBLISH_URL:?AUDIO_PUBLISH_URL not set in ${ENV_FILE}}"

AUDIO_DEVICE="${AUDIO_DEVICE:-hw:0,0}"
AUDIO_RATE="${AUDIO_RATE:-48000}"
AUDIO_CHANNELS="${AUDIO_CHANNELS:-2}"

if [[ -n "${FFMPEG_BIN:-}" ]]; then
	FFMPEG_BIN_PATH="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then
	FFMPEG_BIN_PATH="$(command -v ffmpeg)"
else
	echo "ffmpeg not found; install it via apt install ffmpeg." >&2
	exit 1
fi

run_pipeline() {
	"${FFMPEG_BIN_PATH}" \
		-hide_banner \
		-loglevel warning \
		-fflags nobuffer \
		-rtbufsize 0 \
		-thread_queue_size 4096 \
		-f s32le \
		-ar "${AUDIO_RATE}" \
		-ac "${AUDIO_CHANNELS}" \
		-i <(arecord -D "${AUDIO_DEVICE}" -f S32_LE -c "${AUDIO_CHANNELS}" -r "${AUDIO_RATE}" -B 65536 -F 2048 -q -t raw) \
		-af "aresample=16000,pan=mono|c0=0.5*FL+0.5*FR,volume=40dB" \
		-c:a libopus \
		-b:a 24000 \
		-ar:a 16000 \
		-ac:a 1 \
		-application lowdelay \
		-frame_duration 20 \
		-compression_level 0 \
		-f mpegts \
		"${AUDIO_PUBLISH_URL}"
}

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Audio-only publisher exited, restarting in 2s..." >&2
	sleep 2
done
