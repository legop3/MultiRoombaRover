#!/usr/bin/env bash

write_media_env_placeholder() {
	install -d -o roverd -g roverd /var/lib/roverd

	case "$PROFILE" in
		pi)
			# roverd rewrites media.env after loading /etc/roverd.yaml. These
			# values only make the services syntactically usable before the first
			# successful roverd run, so they mirror the Pi defaults instead of
			# trying to become a second source of truth.
			cat > /var/lib/roverd/media.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
ROVERD_VIDEO_ENABLE=1
ROVERD_VIDEO_PUBLISHER=pi-libcamera
ROVERD_VIDEO_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_VIDEO_DEVICE=
ROVERD_VIDEO_INPUT_FORMAT=
ROVERD_VIDEO_WIDTH=640
ROVERD_VIDEO_HEIGHT=480
ROVERD_VIDEO_FPS=30
ROVERD_VIDEO_BITRATE=2000000
ROVERD_VIDEO_INVERT=1
ROVERD_VIDEO_SENSOR_MODE=1296:972
ROVERD_AUDIO_CAPTURE_ENABLE=0
ROVERD_AUDIO_CAPTURE_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME-audio,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_AUDIO_CAPTURE_DEVICE=hw:0,0
ROVERD_AUDIO_CAPTURE_SAMPLE_RATE=48000
ROVERD_AUDIO_CAPTURE_CHANNELS=2
ROVERD_AUDIO_CAPTURE_BITRATE=510000
ROVERD_AUDIO_PLAYBACK_ENABLE=1
ROVERD_AUDIO_PLAYBACK_FORWARD_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME-fwd,m=request&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_AUDIO_PLAYBACK_DEVICE=forward
ROVERD_AUDIO_PLAYBACK_NORMALIZE=1
ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER=dynaudnorm=f=75:g=15:m=10:p=0.9,alimiter=limit=0.85:level=disabled
ENV
			;;
		debian-laptop)
			# The laptop placeholder uses the same logical ALSA names as the
			# installed laptop asound.conf. That keeps forwarded audio under the
			# ForwardMaster mixer control while TTS and horn keep their own paths.
			cat > /var/lib/roverd/media.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
ROVERD_VIDEO_ENABLE=1
ROVERD_VIDEO_PUBLISHER=debian-laptop-v4l2
ROVERD_VIDEO_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_VIDEO_DEVICE=/dev/video0
ROVERD_VIDEO_INPUT_FORMAT=mjpeg
ROVERD_VIDEO_WIDTH=640
ROVERD_VIDEO_HEIGHT=480
ROVERD_VIDEO_FPS=30
ROVERD_VIDEO_BITRATE=2000000
ROVERD_VIDEO_INVERT=0
ROVERD_VIDEO_SENSOR_MODE=
ROVERD_AUDIO_CAPTURE_ENABLE=1
ROVERD_AUDIO_CAPTURE_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME-audio,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_AUDIO_CAPTURE_DEVICE=default
ROVERD_AUDIO_CAPTURE_SAMPLE_RATE=48000
ROVERD_AUDIO_CAPTURE_CHANNELS=2
ROVERD_AUDIO_CAPTURE_BITRATE=510000
ROVERD_AUDIO_PLAYBACK_ENABLE=1
ROVERD_AUDIO_PLAYBACK_FORWARD_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME-fwd,m=request&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_AUDIO_PLAYBACK_DEVICE=forward
ROVERD_AUDIO_PLAYBACK_NORMALIZE=1
ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER=dynaudnorm=f=75:g=15:m=10:p=0.9,alimiter=limit=0.85:level=disabled
ENV
			;;
	esac

	chown roverd:roverd /var/lib/roverd/media.env
	chmod 0640 /var/lib/roverd/media.env
}

install_audio_fifo() {
	local fifo_path="/var/lib/roverd/audio.pcm"

	# The capture service and publisher service meet at this FIFO. Recreating
	# it only when it is missing or the path is not a FIFO preserves a working
	# service pipe while still fixing accidental regular-file leftovers.
	if [[ -p "$fifo_path" ]]; then
		chown roverd:audio "$fifo_path"
		chmod 0660 "$fifo_path"
	else
		rm -f "$fifo_path"
		mkfifo "$fifo_path"
		chown roverd:audio "$fifo_path"
		chmod 0660 "$fifo_path"
	fi
}
