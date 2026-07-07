#!/usr/bin/env bash

install_pi_video_deps() {
	if command -v ffmpeg >/dev/null 2>&1 && (command -v rpicam-vid >/dev/null 2>&1 || command -v libcamera-vid >/dev/null 2>&1); then
		log "Video dependencies already installed; skipping apt install"
		return
	fi
	log "Installing video dependencies (libcamera-apps, ffmpeg)..."
	apt-get update
	apt-get install -y --no-install-recommends libcamera-apps ffmpeg
}

find_boot_config() {
	if [[ -f /boot/firmware/config.txt ]]; then
		printf "/boot/firmware/config.txt"
		return 0
	fi
	if [[ -f /boot/config.txt ]]; then
		printf "/boot/config.txt"
		return 0
	fi
	return 1
}

ensure_pwm_overlay() {
	local boot_config
	if ! boot_config="$(find_boot_config)"; then
		log "WARNING: unable to locate /boot config.txt; please ensure dtoverlay=pwm-2chan is added manually for servo support"
		return
	fi
	if grep -Eq '^\s*dtoverlay=pwm(-2chan)?' "$boot_config"; then
		log "PWM overlay already present in $boot_config"
		return
	fi
	local backup="${boot_config}.roverd.$(date +%Y%m%d%H%M%S).bak"
	cp "$boot_config" "$backup"
	{
		echo ""
		echo "# Added by roverd installer to expose PWM hardware for camera servo control on GPIO12/13 (leaves GPIO18/19 free for I2S)"
		echo "dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4"
	} >> "$boot_config"
	log "Enabled dtoverlay=pwm-2chan on GPIO12/13 in $boot_config (backup at $backup). Reboot required for changes to apply."
}

install_pi_audio_support() {
	local boot_config
	if ! boot_config="$(find_boot_config)"; then
		log "WARNING: unable to locate /boot config.txt; please enable googlevoicehat-soundcard overlay manually"
	else
		# Ensure onboard audio is disabled (prevents card index flapping)
		if grep -Eq '^\s*dtparam=audio=on\b' "$boot_config"; then
			log "Disabling onboard audio (dtparam=audio=on -> off) in $boot_config"
			sed -i 's/^\s*dtparam=audio=on\b/# roverd disabled onboard audio\ndtparam=audio=off/' "$boot_config"
		fi
		if ! grep -Eq '^\s*dtparam=audio=off\b' "$boot_config"; then
			log "Adding dtparam=audio=off to $boot_config"
			echo "dtparam=audio=off" >> "$boot_config"
		fi
		if ! grep -Eq '^\s*dtparam=i2s=on\b' "$boot_config"; then
			log "Adding dtparam=i2s=on to $boot_config"
			echo "dtparam=i2s=on" >> "$boot_config"
		fi
		if ! grep -Eq '^\s*dtoverlay=googlevoicehat-soundcard\b' "$boot_config"; then
			local backup="${boot_config}.roverd.$(date +%Y%m%d%H%M%S).bak"
			cp "$boot_config" "$backup"
			{
				echo ""
				echo "# Added by roverd installer to enable Google AIY v1 sound card"
				echo "dtoverlay=googlevoicehat-soundcard"
			} >> "$boot_config"
			log "Enabled googlevoicehat-soundcard overlay in $boot_config (backup at $backup). Reboot required."
		else
			log "googlevoicehat-soundcard overlay already present in $boot_config"
		fi
	fi
	if [[ -f pi/asound.conf ]]; then
		install -m 0644 pi/asound.conf /etc/asound.conf
		log "Installed ALSA config to /etc/asound.conf"
		alsa_reload_notice=1
	else
		log "WARNING: pi/asound.conf missing; skipping ALSA config install"
	fi

	if [[ "${alsa_reload_notice:-0}" -eq 1 ]]; then
		log "ALSA config updated; reboot recommended for overlay + audio changes"
	fi

	log "Installing TTS/audio packages (flite, espeak, Chrome TTS runtime deps)..."
	if command -v flite >/dev/null 2>&1 \
		&& command -v espeak >/dev/null 2>&1 \
		&& command -v python3 >/dev/null 2>&1 \
		&& command -v curl >/dev/null 2>&1 \
		&& command -v xz >/dev/null 2>&1 \
		&& command -v unzip >/dev/null 2>&1 \
		&& command -v aplay >/dev/null 2>&1 \
		&& ldconfig -p 2>/dev/null | grep -q 'libc++\.so\.1' \
		&& ldconfig -p 2>/dev/null | grep -q 'libc++abi\.so\.1'; then
		log "Core TTS packages already installed; skipping apt install"
	else
		apt-get update
		apt-get install -y --no-install-recommends flite espeak python3 curl xz-utils unzip alsa-utils libc++1 libc++abi1 \
			|| apt-get install -y --no-install-recommends flite espeak python3 curl xz-utils unzip alsa-utils libc++1-14 libc++abi1-14
	fi

	install -D -o root -g root -m 0755 pi/bin/chromegtts-daemon.py /usr/local/bin/chromegtts-daemon
	log "Installed chromegtts daemon"

	install_google_tts_assets
}

install_google_tts_assets() {
	local asset_dir="/opt/roverd/googletts"
	local voice_dir="${asset_dir}/en-us-x-multi-r30"
	local dist_url="https://storage.googleapis.com/chromeos-localmirror/distfiles/googletts-26.5.tar.xz"
	local tmp_dir
	local lib_member

	case "$(uname -m)" in
		aarch64|arm64)
			lib_member="libchrometts_arm64.so"
			;;
		armv7l|armhf)
			lib_member="libchrometts_armv7.so"
			;;
		*)
			log "WARNING: unsupported Chrome TTS architecture $(uname -m); skipping Google TTS assets"
			return
			;;
	esac

	if [[ -f "${asset_dir}/libchrometts.so" && -f "${voice_dir}/pipeline.pb" ]]; then
		log "Google Chrome TTS assets already installed; skipping download"
		return
	fi

	tmp_dir="$(mktemp -d)"
	log "Downloading Google Chrome TTS assets..."
	curl -L -o "${tmp_dir}/googletts-26.5.tar.xz" "$dist_url"
	tar -xf "${tmp_dir}/googletts-26.5.tar.xz" -C "$tmp_dir" en-us-x-multi.zvoice "$lib_member"

	install -d -o root -g root -m 0755 "$asset_dir"
	install -o root -g root -m 0644 "${tmp_dir}/${lib_member}" "${asset_dir}/libchrometts.so"
	rm -rf "$voice_dir"
	install -d -o root -g root -m 0755 "$voice_dir"
	unzip -q "${tmp_dir}/en-us-x-multi.zvoice" -d "$voice_dir"
	chown -R root:root "$asset_dir"
	find "$asset_dir" -type d -exec chmod 0755 {} +
	find "$asset_dir" -type f -exec chmod 0644 {} +
	rm -rf "$tmp_dir"
	log "Installed Google Chrome TTS assets to $asset_dir"
}

install_pi_profile() {
	if ! command -v rpicam-vid >/dev/null 2>&1 && ! command -v libcamera-vid >/dev/null 2>&1; then
		log "WARNING: neither rpicam-vid nor libcamera-vid found in PATH; install libcamera-apps."
	fi
	install_pi_video_deps
	ensure_pwm_overlay
	install_pi_audio_support
}
