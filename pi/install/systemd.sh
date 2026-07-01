#!/usr/bin/env bash

install_media_units() {
	# Video publishing is the only profile-specific media service right now:
	# Pi uses libcamera/rpicam, while Debian laptops publish from a V4L2 webcam.
	install -D -o root -g root -m 0755 "$VIDEO_HELPER_SRC" "$VIDEO_HELPER_DEST"
	log "Installed $PROFILE video publisher helper"
	install -m 0644 "$VIDEO_SERVICE_SRC" "/etc/systemd/system/$VIDEO_SERVICE_NAME"
	log "Installed $PROFILE video publisher systemd unit"

	# Audio capture publishing and forwarded-audio playback use the same ffmpeg
	# and ALSA contract on both profiles, so they stay as shared installer work.
	install -D -o root -g root -m 0755 pi/bin/audio-only-publisher.sh /usr/local/bin/audio-only-publisher
	install -m 0644 pi/systemd/audio-only-publisher.service /etc/systemd/system/audio-only-publisher.service
	log "Installed audio-only publisher helper + systemd unit"

	install -D -o root -g root -m 0755 pi/bin/audio-forward-listener.sh /usr/local/bin/audio-forward-listener
	install -m 0644 pi/systemd/audio-forward-listener.service /etc/systemd/system/audio-forward-listener.service
	log "Installed audio-forward listener helper + systemd unit"
}

enable_and_restart_units() {
	systemctl daemon-reload
	systemctl enable roverd.service
	systemctl enable "$VIDEO_SERVICE_NAME"
	systemctl enable audio-only-publisher.service
	systemctl enable audio-forward-listener.service

	if [[ $CONFIG_EXISTS -eq 1 ]]; then
		# An existing config means this host was already configured, so restart
		# immediately to pick up the new binary, helpers, units, and media env.
		systemctl restart roverd.service
		systemctl restart "$VIDEO_SERVICE_NAME"
		systemctl restart audio-only-publisher.service
		systemctl restart audio-forward-listener.service
		log "Restarted roverd + media publishers/listener"
	else
		# A freshly installed sample config usually still has placeholder names
		# and URLs. Enabling without starting avoids connecting a half-configured
		# rover to the control server by accident.
		log "Skipped auto-start because config is the sample; edit $CONFIG_DEST then run: sudo systemctl restart roverd ${VIDEO_SERVICE_NAME%.service} audio-only-publisher audio-forward-listener"
	fi
}
