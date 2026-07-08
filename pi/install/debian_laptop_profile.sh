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

DEBIAN_LAPTOP_INSTALLER_CONFIG="/etc/roverd-installer.env"

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

derive_debian_laptop_alsa_card_from_device() {
	local device="$1"

	# The common ALSA hardware device shape is hw:CARD,DEVICE. Pulling the card
	# number from that string gives the installer a useful default while still
	# allowing the prompt to handle named cards or uncommon PCM strings.
	if [[ "$device" =~ ^hw:([0-9]+),[0-9]+$ ]]; then
		printf '%s\n' "${BASH_REMATCH[1]}"
		return
	fi

	printf '0\n'
}

read_debian_laptop_installer_value() {
	local prompt="$1"
	local default_value="$2"
	local value=""

	# Prompting through /dev/tty keeps this usable even when the installer is
	# launched through sudo with stdin redirected. The caller already checks for
	# an interactive terminal before reaching this function, so failure here is
	# genuinely unexpected and should stop the install instead of guessing.
	read -r -p "${prompt} [${default_value}]: " value </dev/tty
	if [[ -z "$value" ]]; then
		value="$default_value"
	fi
	printf '%s\n' "$value"
}

validate_debian_laptop_alsa_config() {
	# The PCM fields are written inside quoted ALSA strings, so keep them to the
	# device spellings ALSA normally uses for hardware/plugin PCMs. Rejecting
	# whitespace and shell/config punctuation prevents a bad installer config
	# from generating an asound.conf that changes structure instead of values.
	if [[ ! "$ROVERD_ALSA_PLAYBACK_DEVICE" =~ ^[A-Za-z0-9_.,:+/-]+$ ]]; then
		echo "Invalid ROVERD_ALSA_PLAYBACK_DEVICE: $ROVERD_ALSA_PLAYBACK_DEVICE" >&2
		exit 1
	fi
	if [[ ! "$ROVERD_ALSA_CAPTURE_DEVICE" =~ ^[A-Za-z0-9_.,:+/-]+$ ]]; then
		echo "Invalid ROVERD_ALSA_CAPTURE_DEVICE: $ROVERD_ALSA_CAPTURE_DEVICE" >&2
		exit 1
	fi

	# Softvol controls and ctl.!default need the playback card, because
	# TTSMaster, HornMaster, and ForwardMaster are all playback mixer controls.
	# Keep this numeric to match the prompt and avoid needing quoted ALSA card
	# ids in the generated config.
	if [[ ! "$ROVERD_ALSA_PLAYBACK_CARD" =~ ^[0-9]+$ ]]; then
		echo "Invalid ROVERD_ALSA_PLAYBACK_CARD: $ROVERD_ALSA_PLAYBACK_CARD" >&2
		exit 1
	fi
}

load_debian_laptop_installer_config_file() {
	local config_path="$1"
	local line key val

	# Read only the small allowlist this installer owns. Avoid sourcing the file
	# because it lives in /etc and is meant to be installer data, not shell code.
	while IFS= read -r line || [[ -n "$line" ]]; do
		[[ "$line" =~ ^[[:space:]]*$ ]] && continue
		[[ "$line" =~ ^[[:space:]]*# ]] && continue

		if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
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

		case "$key" in
			ROVERD_ALSA_PLAYBACK_DEVICE|ROVERD_ALSA_PLAYBACK_CARD|ROVERD_ALSA_CAPTURE_DEVICE)
				printf -v "$key" '%s' "$val"
				export "$key"
				;;
		esac
	done < "$config_path"
}

write_debian_laptop_installer_config_file() {
	local config_path="$1"
	local tmp_path

	tmp_path="$(mktemp)"
	# This file is intentionally plain KEY=VALUE shell-style data so future
	# installs can reuse the same laptop-specific card choices without asking
	# again. It is still parsed by an allowlist reader instead of sourced.
	cat > "$tmp_path" <<EOF
# Created by install_roverd.sh for the Debian laptop rover profile.
# These values choose the physical ALSA hardware behind the rover's logical
# mixer devices: tts, horn, forward, default playback, and rovermic capture.
ROVERD_ALSA_PLAYBACK_DEVICE="${ROVERD_ALSA_PLAYBACK_DEVICE}"
ROVERD_ALSA_PLAYBACK_CARD="${ROVERD_ALSA_PLAYBACK_CARD}"
ROVERD_ALSA_CAPTURE_DEVICE="${ROVERD_ALSA_CAPTURE_DEVICE}"
EOF
	install -o root -g root -m 0644 "$tmp_path" "$config_path"
	rm -f "$tmp_path"
}

load_or_create_debian_laptop_alsa_config() {
	if [[ -f "$DEBIAN_LAPTOP_INSTALLER_CONFIG" ]]; then
		load_debian_laptop_installer_config_file "$DEBIAN_LAPTOP_INSTALLER_CONFIG"
		log "Using Debian laptop ALSA installer config from $DEBIAN_LAPTOP_INSTALLER_CONFIG"
	elif [[ -n "${ROVERD_ALSA_PLAYBACK_DEVICE:-}" && -n "${ROVERD_ALSA_PLAYBACK_CARD:-}" && -n "${ROVERD_ALSA_CAPTURE_DEVICE:-}" ]]; then
		# This keeps unattended installs possible without adding a pile of CLI
		# flags. The generated /etc file still becomes the durable source for
		# future installs on the same laptop.
		validate_debian_laptop_alsa_config
		write_debian_laptop_installer_config_file "$DEBIAN_LAPTOP_INSTALLER_CONFIG"
		log "Wrote Debian laptop ALSA installer config to $DEBIAN_LAPTOP_INSTALLER_CONFIG from environment"
	else
		if ! { true </dev/tty >/dev/tty; } 2>/dev/null; then
			echo "Missing $DEBIAN_LAPTOP_INSTALLER_CONFIG and no interactive terminal is available for ALSA setup." >&2
			echo "Run sudo ./pi/install_roverd.sh --debian-laptop once from a terminal, then reuse the generated config for future installs." >&2
			exit 1
		fi

		log "No $DEBIAN_LAPTOP_INSTALLER_CONFIG found; creating Debian laptop ALSA installer config"
		if command -v aplay >/dev/null 2>&1; then
			echo "Playback devices from aplay -l:" >/dev/tty
			aplay -l >/dev/tty 2>/dev/tty || true
		fi
		if command -v arecord >/dev/null 2>&1; then
			echo "Capture devices from arecord -l:" >/dev/tty
			arecord -l >/dev/tty 2>/dev/tty || true
		fi

		ROVERD_ALSA_PLAYBACK_DEVICE="$(read_debian_laptop_installer_value "ALSA playback device for rover speaker output" "${ROVERD_ALSA_PLAYBACK_DEVICE:-hw:0,0}")"
		ROVERD_ALSA_PLAYBACK_CARD="$(read_debian_laptop_installer_value "ALSA playback card number for mixer controls" "${ROVERD_ALSA_PLAYBACK_CARD:-$(derive_debian_laptop_alsa_card_from_device "$ROVERD_ALSA_PLAYBACK_DEVICE")}")"
		ROVERD_ALSA_CAPTURE_DEVICE="$(read_debian_laptop_installer_value "ALSA capture device for rover microphone input" "${ROVERD_ALSA_CAPTURE_DEVICE:-$ROVERD_ALSA_PLAYBACK_DEVICE}")"

		validate_debian_laptop_alsa_config
		write_debian_laptop_installer_config_file "$DEBIAN_LAPTOP_INSTALLER_CONFIG"
		log "Wrote Debian laptop ALSA installer config to $DEBIAN_LAPTOP_INSTALLER_CONFIG"
	fi

	ROVERD_ALSA_PLAYBACK_DEVICE="${ROVERD_ALSA_PLAYBACK_DEVICE:-hw:0,0}"
	ROVERD_ALSA_PLAYBACK_CARD="${ROVERD_ALSA_PLAYBACK_CARD:-$(derive_debian_laptop_alsa_card_from_device "$ROVERD_ALSA_PLAYBACK_DEVICE")}"
	ROVERD_ALSA_CAPTURE_DEVICE="${ROVERD_ALSA_CAPTURE_DEVICE:-$ROVERD_ALSA_PLAYBACK_DEVICE}"
	validate_debian_laptop_alsa_config
}

render_debian_laptop_asound_config() {
	local tmp_path

	tmp_path="$(mktemp)"
	# The rover-facing ALSA names stay stable even when the laptop's physical
	# sound card changes. dmixer owns the one real playback PCM, while tts,
	# horn, and forward each wrap that mixer with a separate softvol control.
	cat > "$tmp_path" <<EOF
# Dedicated ALSA routing for the Debian laptop rover profile.
#
# Generated by install_roverd.sh from $DEBIAN_LAPTOP_INSTALLER_CONFIG.
# Change the physical devices there, then rerun the Debian laptop installer.
#
# Logical playback devices:
#   tts      - default text-to-speech output with TTSMaster softvol
#   horn     - horn synth output with HornMaster softvol
#   forward  - browser-forwarded audio with ForwardMaster softvol
#   default  - TTS playback plus rovermic capture
#
# Physical routing selected for this laptop:
#   playback PCM:  ${ROVERD_ALSA_PLAYBACK_DEVICE}
#   playback card: ${ROVERD_ALSA_PLAYBACK_CARD}
#   capture PCM:   ${ROVERD_ALSA_CAPTURE_DEVICE}

# Mix multiple playback clients in software with a fixed low-cost format.
pcm.dmixer {
    type dmix
    ipc_key 1024
    ipc_perm 0666
    slave {
        pcm "${ROVERD_ALSA_PLAYBACK_DEVICE}"
        format S16_LE
        rate 16000
        channels 1
        period_time 0
        period_size 1024
        buffer_size 4096
    }
}

# TTS volume control. TTS uses the default playback route, so this control lets
# generated speech move independently from horns and forwarded browser audio.
pcm.tts_softvol {
    type softvol
    slave.pcm "dmixer"
    control {
        name "TTSMaster"
        card ${ROVERD_ALSA_PLAYBACK_CARD}
    }
    min_dB -60.0
    max_dB 12.0
}

# Horn volume control. The horn synth opens the logical "horn" device, which
# keeps horn loudness adjustable without changing the shared hardware PCM.
pcm.horn_softvol {
    type softvol
    slave.pcm "dmixer"
    control {
        name "HornMaster"
        card ${ROVERD_ALSA_PLAYBACK_CARD}
    }
    min_dB -60.0
    max_dB 12.0
}

# Forwarded audio volume control. The browser-audio listener opens "forward",
# so remote audio can be mixed with local rover sounds without bypassing dmix.
pcm.forward_softvol {
    type softvol
    slave.pcm "dmixer"
    control {
        name "ForwardMaster"
        card ${ROVERD_ALSA_PLAYBACK_CARD}
    }
    min_dB -60.0
    max_dB 12.0
}

# Per-source playback PCMs.
pcm.tts {
    type plug
    slave.pcm "tts_softvol"
}

pcm.horn {
    type plug
    slave.pcm "horn_softvol"
}

pcm.forward {
    type plug
    slave.pcm "forward_softvol"
}

# Capture alias used by laptop rover config defaults. Capture is deliberately
# separate from playback because laptop speakers and microphones often appear
# on different ALSA cards.
pcm.rovermic {
    type plug
    slave.pcm "${ROVERD_ALSA_CAPTURE_DEVICE}"
}

# Defaults: TTS direct playback + raw capture on the selected laptop devices.
pcm.!default {
    type asym
    playback.pcm "tts"
    capture.pcm "rovermic"
}

ctl.!default {
    type hw
    card ${ROVERD_ALSA_PLAYBACK_CARD}
}
EOF
	install -o root -g root -m 0644 "$tmp_path" /etc/asound.conf
	rm -f "$tmp_path"
	log "Installed dedicated Debian laptop ALSA config to /etc/asound.conf using playback ${ROVERD_ALSA_PLAYBACK_DEVICE}"
}

install_debian_laptop_audio_support() {
	load_or_create_debian_laptop_alsa_config
	render_debian_laptop_asound_config

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
