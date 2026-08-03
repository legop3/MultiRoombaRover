#!/usr/bin/env bash
set -euo pipefail
set +H

ENV_FILE="${ROVERD_MEDIA_ENV_FILE:-/var/lib/roverd/media.env}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file ${ENV_FILE} missing; cannot publish audio" >&2
	exit 1
fi

# Load KEY=VALUE pairs from media.env without evaluating shell syntax. SRT URLs
# contain characters such as '&' and '#!', so sourcing this file would treat a
# data file as code and can split a valid URL into shell control operators.
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

# This is the rover MICROPHONE going up to the server, published as "<rover>-audio". Not to
# be confused with the speaker path in audio-forward-listener.sh, which reads audio the
# server produces. See docs/media-transports.md.
#
# RTSP by default: it carries an Opus-only stream fine (MediaMTX reports a single Opus track)
# and works on ffmpeg 4.x+, so a rover on bookworm's ffmpeg 5.1 gets the improvement without
# upgrading anything. Measured 330ms over MPEG-TS against 183.7ms over RTSP.
resolve_audio_transport() {
	case "${ROVERD_AUDIO_CAPTURE_TRANSPORT:-rtsp}" in
		srt) echo "mpegts" ;;
		whip) echo "whip" ;;
		mpegts) echo "mpegts" ;;
		*) echo "rtsp" ;;
	esac
}

audio_transport_output_args() {
	case "$1" in
		whip)
			printf '%s\n' -f whip -pkt_size 1200 "${ROVERD_AUDIO_CAPTURE_WHIP_URL}"
			;;
		rtsp)
			# TCP for the same reason as video: RTSP/UDP has no retransmission and failed
			# outright over a real internet path. See video-publisher.sh.
			printf '%s\n' -f rtsp -rtsp_transport "${ROVERD_AUDIO_CAPTURE_RTSP_TRANSPORT:-tcp}" "${ROVERD_AUDIO_CAPTURE_RTSP_URL}"
			;;
		*)
			printf '%s\n' -f mpegts "${ROVERD_AUDIO_CAPTURE_PUBLISH_URL}"
			;;
	esac
}

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

		# Mirror the video publisher's MPEG-TS low-latency settings. Without
		# these, ffmpeg is allowed to hold packets for mux timing, which is
		# exactly the wrong tradeoff for live rover feedback.
		-flush_packets 1
		-muxdelay 0
		-muxpreload 0
	)

	# Transport, chosen the same way the video publisher chooses it and for the same
	# reason. Measured in webrtc/: the microphone path costs 338ms over MPEG-TS and 181ms
	# over WHIP, a 157ms saving that matches the video finding almost exactly, because the
	# delay is in the server's mpegts demux rather than anywhere on this side.
	#
	# Opus is already WebRTC's native audio codec, so nothing is transcoded on the way
	# through - only the container changes.
	local -a transport_args=()
	while IFS= read -r arg; do transport_args+=("$arg"); done < <(audio_transport_output_args "$AUDIO_TRANSPORT")
	ffmpeg_args+=("${transport_args[@]}")

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
}

trap 'kill 0 2>/dev/null' EXIT INT TERM

# Records the transport in use so roverd can show it. Best-effort: a missing or read-only
# state directory must never stop audio.
write_audio_transport_state() {
	local dir="${ROVERD_MEDIA_STATE_DIR:-/run/roverd}"
	mkdir -p "$dir" 2>/dev/null || return 0
	printf 'transport=%s\n' "$1" >"${dir}/audio-capture-transport" 2>/dev/null || true
	return 0
}

AUDIO_TRANSPORT="$(resolve_audio_transport)"
echo "Audio-only publisher using transport: ${AUDIO_TRANSPORT}" >&2
write_audio_transport_state "$AUDIO_TRANSPORT"

while true; do
	if run_pipeline; then
		exit 0
	fi
	echo "Audio-only publisher exited arecord=${PIPESTATUS[0]} ffmpeg=${PIPESTATUS[1]}, restarting in 2s..." >&2
	sleep 2
done
