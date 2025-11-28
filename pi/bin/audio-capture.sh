#!/usr/bin/env bash
set -euo pipefail

FIFO="${AUDIO_FIFO:-/var/lib/roverd/audio.pcm}"
DEVICE="${AUDIO_DEVICE:-hw:0,0}"
RATE="${AUDIO_RATE:-48000}"
CHANNELS="${AUDIO_CHANNELS:-2}"
FORMAT="${AUDIO_FORMAT:-S32_LE}"

prepare_fifo() {
	install -o roverd -g audio -m 0660 /dev/null "$FIFO" 2>/dev/null || true
	if [[ ! -p "$FIFO" ]]; then
		rm -f "$FIFO"
		mkfifo "$FIFO"
		chown roverd:audio "$FIFO"
		chmod 0660 "$FIFO"
	fi
}

prepare_fifo

exec arecord -D "$DEVICE" -f "$FORMAT" -c "$CHANNELS" -r "$RATE" -q -t raw "$FIFO"
