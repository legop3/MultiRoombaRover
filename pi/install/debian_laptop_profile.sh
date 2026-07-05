#!/usr/bin/env bash

install_debian_laptop_deps() {
	# This profile is deliberately Debian-only. Using apt directly is simpler
	# than adding a fake cross-distro layer, and it keeps the installed package
	# set easy to inspect on the actual rover laptop.
	if command -v ffmpeg >/dev/null 2>&1 \
		&& command -v arecord >/dev/null 2>&1 \
		&& command -v aplay >/dev/null 2>&1 \
		&& command -v amixer >/dev/null 2>&1 \
		&& command -v v4l2-ctl >/dev/null 2>&1 \
		&& command -v flite >/dev/null 2>&1 \
		&& command -v espeak >/dev/null 2>&1; then
		log "Debian laptop media/audio dependencies already installed; skipping apt install"
		return
	fi

	log "Installing Debian laptop dependencies (ffmpeg, ALSA tools, V4L2 tools, flite, espeak)..."
	apt-get update
	apt-get install -y --no-install-recommends ffmpeg alsa-utils v4l-utils ca-certificates flite espeak
}

install_debian_laptop_audio_support() {
	if [[ ! -f pi/asound.debian-laptop.conf ]]; then
		log "WARNING: pi/asound.debian-laptop.conf missing; skipping Debian laptop ALSA config install"
		return
	fi

	# The laptop profile still uses roverd's existing audio contract: TTS plays
	# to ALSA's default output, horn plays to the named "horn" device, and
	# forwarded web audio plays to the named "forward" device. Installing one
	# profile-specific asound.conf gives those paths independent softvol mixer
	# controls without changing the TTS runtime code.
	install -m 0644 pi/asound.debian-laptop.conf /etc/asound.conf
	log "Installed Debian laptop ALSA config to /etc/asound.conf"
	log "ALSA config updated; restarting audio clients or rebooting is recommended before testing laptop audio"
}

install_debian_laptop_profile() {
	install_debian_laptop_deps
	install_debian_laptop_audio_support
}
