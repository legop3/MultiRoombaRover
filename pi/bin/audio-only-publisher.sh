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

# The old 65,536-byte ALSA buffer represented about 171 ms before ffmpeg could
# even publish the microphone audio:
#   65,536 / (48,000 samples * 2 channels * 4 bytes) = 0.1707 seconds
# Keep the defaults much smaller because this publisher feeds an interactive
# rover stream, where late-but-smooth audio is less useful than fresher audio.
# These remain environment-overridable so a noisy Pi or sound card can be tuned
# in the field without changing the installed script.
AUDIO_ALSA_BUFFER_BYTES="${AUDIO_ALSA_BUFFER_BYTES:-16384}"
AUDIO_ALSA_PERIOD_BYTES="${AUDIO_ALSA_PERIOD_BYTES:-1024}"

if [[ -n "${FFMPEG_BIN:-}" ]]; then
	FFMPEG_BIN_PATH="$FFMPEG_BIN"
elif command -v ffmpeg >/dev/null 2>&1; then
	FFMPEG_BIN_PATH="$(command -v ffmpeg)"
else
	echo "ffmpeg not found; install it via apt install ffmpeg." >&2
	exit 1
fi

run_pipeline() {
	local ffmpeg_args=(
		-hide_banner
		-loglevel warning
		-fflags nobuffer
		-rtbufsize 0
		-thread_queue_size 4096

		# Match the raw ALSA stream exactly so ffmpeg does not guess the pipe
		# format and so the published audio stays full-band stereo before the
		# Opus encoder sees it.
		-f s32le
		-ar 48000
		-ac 2
		-i pipe:0

		# Keep the known-required microphone boost, but remove the old
		# resample/downmix filter. That old filter threw away stereo and
		# limited the stream to narrow 16 kHz mono before encoding.
		-af "volume=20dB"

		# Opus supports up to 510 kbps. Using that ceiling keeps the stream at
		# the highest practical quality browsers and MediaMTX can carry without
		# trying to push raw PCM through the live path.
		-c:a libopus
		-b:a 510000
		-ar:a 48000
		-ac:a 2

		# Use the audio profile for quality. Latency is still controlled by the
		# 20 ms Opus frame size and the low-buffering capture/publish options
		# around the encoder.
		-application audio
		-frame_duration 20
		-compression_level 0

		# Mirror the video publisher's MPEG-TS low-latency settings. Without
		# these, ffmpeg is allowed to hold packets for mux timing, which is
		# exactly the wrong tradeoff for live rover feedback.
		-flush_packets 1
		-muxdelay 0
		-muxpreload 0
		-f mpegts
		"${AUDIO_PUBLISH_URL}"
	)

	# The Google Voice HAT microphone path is intentionally fixed instead of
	# configurable. The previous env-driven sample rate/channel knobs made it
	# easy for the rover config and the actual ffmpeg pipeline to drift apart,
	# while the hardware path we install is always 48 kHz stereo capture.
	#
	# The buffer and period are byte counts because arecord interprets -B/-F in
	# microseconds only when the value has an explicit time suffix. Keeping them
	# as byte-sized chunks gives direct control over the capture queue. The new
	# defaults are roughly 43 ms total buffer and 2.7 ms wakeup periods at
	# 48 kHz stereo S32_LE, which removes about 128 ms of avoidable capture
	# latency compared with the old 65,536-byte buffer.
	arecord -D "${AUDIO_DEVICE}" -f S32_LE -c 2 -r 48000 -B "${AUDIO_ALSA_BUFFER_BYTES}" -F "${AUDIO_ALSA_PERIOD_BYTES}" -q -t raw \
		| "${FFMPEG_BIN_PATH}" "${ffmpeg_args[@]}"
}

trap 'kill 0 2>/dev/null' EXIT INT TERM

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Audio-only publisher exited arecord=${PIPESTATUS[0]} ffmpeg=${PIPESTATUS[1]}, restarting in 2s..." >&2
	sleep 2
done
