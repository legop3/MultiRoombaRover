#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${ROVERD_MEDIA_ENV_FILE:-/var/lib/roverd/media.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish audio" >&2
	exit 1
fi

# Load KEY=VALUE pairs from media.env without evaluating shell syntax. URLs are data;
# sourcing this file would unnecessarily treat server-provided values as shell code.
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
: "${ROVERD_AUDIO_CAPTURE_ENABLE:?ROVERD_AUDIO_CAPTURE_ENABLE not set in ${ENV_FILE}}"
if [[ "${ROVERD_AUDIO_CAPTURE_ENABLE}" -ne 1 ]]; then
	echo "Audio capture disabled; skipping audio-only publisher" >&2
	exit 0
fi
: "${ROVERD_AUDIO_CAPTURE_PUBLISH_URL:?ROVERD_AUDIO_CAPTURE_PUBLISH_URL not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_CAPTURE_DEVICE:?ROVERD_AUDIO_CAPTURE_DEVICE not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_CAPTURE_SAMPLE_RATE:?ROVERD_AUDIO_CAPTURE_SAMPLE_RATE not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_CAPTURE_CHANNELS:?ROVERD_AUDIO_CAPTURE_CHANNELS not set in ${ENV_FILE}}"
: "${ROVERD_AUDIO_CAPTURE_BITRATE:?ROVERD_AUDIO_CAPTURE_BITRATE not set in ${ENV_FILE}}"

CAPTURE_DEVICE="${ROVERD_AUDIO_CAPTURE_DEVICE}"

# At the default 48 kHz stereo S32_LE capture format, the old 65,536-byte ALSA
# buffer represented about 171 ms before ffmpeg could publish microphone audio:
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
	local -a pipeline_statuses=()
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
		-ar "${ROVERD_AUDIO_CAPTURE_SAMPLE_RATE}"
		-ac "${ROVERD_AUDIO_CAPTURE_CHANNELS}"
		-i pipe:0

		# Keep the known-required microphone boost, but remove the old
		# resample/downmix filter. That old filter threw away stereo and
		# limited the stream to narrow 16 kHz mono before encoding.
		-af "volume=20dB"

		# Opus supports up to 510 kbps. Using that ceiling keeps the stream at
		# the highest practical quality browsers and MediaMTX can carry without
		# trying to push raw PCM through the live path.
		-c:a libopus
		-b:a "${ROVERD_AUDIO_CAPTURE_BITRATE}"
		-ar:a "${ROVERD_AUDIO_CAPTURE_SAMPLE_RATE}"
		-ac:a "${ROVERD_AUDIO_CAPTURE_CHANNELS}"

		# Use the audio profile for quality. Latency is still controlled by the
		# 20 ms Opus frame size and the low-buffering capture/publish options
		# around the encoder.
		-application audio
		-frame_duration 20
		-compression_level 0

		# RTSP carries the existing Opus stream directly, avoiding MediaMTX's costly
		# MPEG-TS demux without changing microphone capture or encoding quality. TCP is
		# required for the same reliable local-network behavior as the video publisher.
		-flush_packets 1
		-muxdelay 0
		-muxpreload 0
		-f rtsp
		-rtsp_transport tcp
		"${ROVERD_AUDIO_CAPTURE_PUBLISH_URL}"
	)

	# The capture format comes from roverd's normalized media config. Keeping
	# arecord and ffmpeg on the same env-backed values prevents the publisher
	# script from quietly disagreeing with roverd.yaml about sample rate or
	# channel count.
	#
	# The buffer and period are byte counts because arecord interprets -B/-F in
	# microseconds only when the value has an explicit time suffix. Keeping them
	# as byte-sized chunks gives direct control over the capture queue. The new
	# defaults are roughly 43 ms total buffer and 2.7 ms wakeup periods at
	# 48 kHz stereo S32_LE, which removes about 128 ms of avoidable capture
	# latency compared with the old 65,536-byte buffer.
	arecord -D "${CAPTURE_DEVICE}" -f S32_LE -c "${ROVERD_AUDIO_CAPTURE_CHANNELS}" -r "${ROVERD_AUDIO_CAPTURE_SAMPLE_RATE}" -B "${AUDIO_ALSA_BUFFER_BYTES}" -F "${AUDIO_ALSA_PERIOD_BYTES}" -q -t raw \
		| "${FFMPEG_BIN_PATH}" "${ffmpeg_args[@]}"
	pipeline_statuses=("${PIPESTATUS[@]}")

	# PIPESTATUS belongs to the pipeline that just finished and is replaced by the next shell
	# command. Capture it immediately, then return the publisher failure first because that is
	# normally the reason arecord receives a secondary broken pipe.
	LAST_ARECORD_STATUS="${pipeline_statuses[0]:-unknown}"
	LAST_FFMPEG_STATUS="${pipeline_statuses[1]:-unknown}"
	if [[ "${LAST_FFMPEG_STATUS}" != "0" ]]; then
		return "${LAST_FFMPEG_STATUS}"
	fi
	return "${LAST_ARECORD_STATUS}"
}

trap 'kill 0 2>/dev/null' EXIT INT TERM

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Audio-only publisher exited arecord=${LAST_ARECORD_STATUS:-unknown} ffmpeg=${LAST_FFMPEG_STATUS:-unknown}, restarting in 2s..." >&2
	sleep 2
done
