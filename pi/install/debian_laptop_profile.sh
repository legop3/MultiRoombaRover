#!/usr/bin/env bash

install_debian_laptop_deps() {
	# The laptop rover is a dedicated appliance, not a normal desktop/laptop audio
	# install. Keep this package set intentionally close to the Pi profile so the
	# same roverd TTS/playback/capture code paths are available on both targets.
	if command -v ffmpeg >/dev/null 2>&1 \
		&& command -v arecord >/dev/null 2>&1 \
		&& command -v aplay >/dev/null 2>&1 \
		&& command -v amixer >/dev/null 2>&1 \
		&& command -v v4l2-ctl >/dev/null 2>&1 \
		&& command -v flite >/dev/null 2>&1 \
		&& command -v espeak >/dev/null 2>&1 \
		&& command -v python3 >/dev/null 2>&1 \
		&& command -v curl >/dev/null 2>&1 \
		&& command -v xz >/dev/null 2>&1 \
		&& command -v unzip >/dev/null 2>&1 \
		&& ldconfig -p 2>/dev/null | grep -q 'libgcc_s\.so\.1' \
		&& ldconfig -p 2>/dev/null | grep -q 'libstdc\+\+\.so\.6' \
		&& ldconfig -p 2>/dev/null | grep -q 'libc++\.so\.1' \
		&& ldconfig -p 2>/dev/null | grep -q 'libc++abi\.so\.1'; then
		log "Debian laptop media/audio/TTS dependencies already installed; skipping apt install"
		return
	fi

	log "Installing Debian laptop rover dependencies (ffmpeg, ALSA tools, V4L2 tools, flite/espeak, Chrome TTS runtime deps)..."
	apt-get update
	apt-get install -y --no-install-recommends \
		ffmpeg alsa-utils v4l-utils ca-certificates flite espeak python3 curl xz-utils unzip libasound2-plugins libgcc-s1 libstdc++6 libc++1 libc++abi1 \
		|| apt-get install -y --no-install-recommends \
			ffmpeg alsa-utils v4l-utils ca-certificates flite espeak python3 curl xz-utils unzip libasound2-plugins libgcc-s1 libstdc++6 libc++1-14 libc++abi1-14
}

disable_debian_laptop_desktop_audio_stack() {
	# This profile is for a dedicated rover laptop. PipeWire/PulseAudio are good
	# desktop defaults, but they can grab the hardware device and make the rover's
	# root/systemd ALSA services fail or route through a moving per-user graph.
	# Mask them globally and kill already-running instances so ALSA owns the box,
	# which is the closest behavior to the Pi rover appliance setup.
	log "Disabling desktop audio daemons for dedicated laptop rover audio"

	local -a user_units=(
		pipewire.service
		pipewire.socket
		pipewire-pulse.service
		pipewire-pulse.socket
		wireplumber.service
		pulseaudio.service
		pulseaudio.socket
	)

	if command -v systemctl >/dev/null 2>&1; then
		systemctl --global disable "${user_units[@]}" >/dev/null 2>&1 || true
		systemctl --global mask "${user_units[@]}" >/dev/null 2>&1 || true
	fi

	pkill -x pipewire >/dev/null 2>&1 || true
	pkill -x pipewire-pulse >/dev/null 2>&1 || true
	pkill -x wireplumber >/dev/null 2>&1 || true
	pkill -x pulseaudio >/dev/null 2>&1 || true
}

install_debian_laptop_audio_support() {
	if [[ ! -f pi/asound.debian-laptop.conf ]]; then
		log "WARNING: pi/asound.debian-laptop.conf missing; skipping Debian laptop ALSA config install"
		return
	fi

	install -m 0644 pi/asound.debian-laptop.conf /etc/asound.conf
	log "Installed dedicated Debian laptop ALSA config to /etc/asound.conf"

	install -D -o root -g root -m 0755 pi/bin/chromegtts-daemon-laptop.py /usr/local/bin/chromegtts-daemon
	log "Installed laptop chromegtts daemon"

	install_google_tts_assets_laptop

	log "ALSA config updated; reboot recommended before testing laptop rover audio"
}

install_google_tts_assets_laptop() {
	local asset_dir="/opt/roverd/googletts"
	local voice_dir="${asset_dir}/en-us-x-multi-r30"
	local dist_url="https://storage.googleapis.com/chromeos-localmirror/distfiles/googletts-26.5.tar.xz"
	local tmp_dir
	local lib_member=""
	local member

	if [[ -f "${asset_dir}/libchrometts.so" && -f "${voice_dir}/pipeline.pb" ]]; then
		log "Google Chrome TTS assets already installed; skipping download"
		return
	fi

	tmp_dir="$(mktemp -d)"
	log "Downloading Google Chrome TTS assets for Debian laptop profile..."
	if ! curl -L -o "${tmp_dir}/googletts-26.5.tar.xz" "$dist_url"; then
		rm -rf "$tmp_dir"
		log "WARNING: failed to download Google Chrome TTS assets; chromegtts will be unavailable"
		return
	fi

	local -a candidate_libs=()
	case "$(uname -m)" in
		aarch64|arm64)
			candidate_libs=(libchrometts_arm64.so)
			;;
		armv7l|armhf)
			candidate_libs=(libchrometts_armv7.so)
			;;
		x86_64|amd64)
			candidate_libs=(libchrometts_x86_64.so libchrometts_amd64.so libchrometts_x64.so libchrometts.so)
			;;
		i386|i686)
			candidate_libs=(libchrometts_x86.so libchrometts_i386.so libchrometts.so)
			;;
		*)
			log "WARNING: unsupported Chrome TTS architecture $(uname -m); skipping Google TTS assets"
			rm -rf "$tmp_dir"
			return
			;;
	esac

	for member in "${candidate_libs[@]}"; do
		if tar -tf "${tmp_dir}/googletts-26.5.tar.xz" "$member" >/dev/null 2>&1; then
			lib_member="$member"
			break
		fi
	done

	if [[ -z "$lib_member" ]]; then
		log "WARNING: no libchrometts library matching $(uname -m) found in Google TTS archive; chromegtts will be unavailable"
		rm -rf "$tmp_dir"
		return
	fi

	if ! tar -xf "${tmp_dir}/googletts-26.5.tar.xz" -C "$tmp_dir" en-us-x-multi.zvoice "$lib_member"; then
		rm -rf "$tmp_dir"
		log "WARNING: failed to unpack Google Chrome TTS assets; chromegtts will be unavailable"
		return
	fi

	install -d -o root -g root -m 0755 "$asset_dir"
	install -o root -g root -m 0644 "${tmp_dir}/${lib_member}" "${asset_dir}/libchrometts.so"
	rm -rf "$voice_dir"
	install -d -o root -g root -m 0755 "$voice_dir"
	unzip -q "${tmp_dir}/en-us-x-multi.zvoice" -d "$voice_dir"
	chown -R root:root "$asset_dir"
	find "$asset_dir" -type d -exec chmod 0755 {} +
	find "$asset_dir" -type f -exec chmod 0644 {} +
	rm -rf "$tmp_dir"
	log "Installed Google Chrome TTS assets to $asset_dir using $lib_member"
}

install_debian_laptop_profile() {
	install_debian_laptop_deps
	disable_debian_laptop_desktop_audio_stack
	install_debian_laptop_audio_support
}
