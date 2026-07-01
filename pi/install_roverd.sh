#!/usr/bin/env bash
#
# Installer for the roverd agent on Raspberry Pi and Debian laptop rover hosts.

set -euo pipefail

PROFILE="pi"
BINARY_SRC=""
CONFIG_SRC=""
REPO_ROOT="$(pwd -P)"

usage() {
	cat <<'USAGE'
Usage: sudo ./pi/install_roverd.sh [options]

Options:
  --profile <name>      Install profile: pi or debian-laptop (default: pi)
  --debian-laptop       Shortcut for --profile debian-laptop
  -b, --binary <path>   Path to the roverd binary (default: dist/roverd)
  -c, --config <path>   Source config to install if /etc/roverd.yaml is missing
                        (default: pi/roverd/roverd.sample.yaml)
  -h, --help            Show this help text

The script must run from the repository root and as root (sudo). It will:
  * create system users/groups if needed
  * install /usr/local/bin/roverd and /etc/roverd.yaml
  * install profile-specific video helpers and shared audio helpers
  * install Pi-only Google Chrome TTS assets when using the pi profile
  * install the fixed-command self-update helper used by admin-triggered updates
  * enable roverd.service and media publisher/listener services
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--profile)
			PROFILE="${2:-}"
			shift 2
			;;
		--debian-laptop)
			PROFILE="debian-laptop"
			shift
			;;
		-b|--binary)
			BINARY_SRC="${2:-}"
			shift 2
			;;
		-c|--config)
			CONFIG_SRC="${2:-}"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage
			exit 1
			;;
	esac
done

case "$PROFILE" in
	pi)
		BINARY_SRC="${BINARY_SRC:-dist/roverd}"
		CONFIG_SRC="${CONFIG_SRC:-pi/roverd/roverd.sample.yaml}"
		VIDEO_HELPER_SRC="pi/bin/video-publisher.sh"
		VIDEO_HELPER_DEST="/usr/local/bin/video-publisher"
		VIDEO_SERVICE_SRC="pi/systemd/video-publisher.service"
		VIDEO_SERVICE_NAME="video-publisher.service"
		ROVERD_GROUPS="dialout,gpio,video,render,audio"
		;;
	debian-laptop)
		BINARY_SRC="${BINARY_SRC:-dist/roverd-debian-laptop}"
		CONFIG_SRC="${CONFIG_SRC:-pi/roverd/roverd.debian-laptop.sample.yaml}"
		VIDEO_HELPER_SRC="pi/bin/debian-laptop-video-publisher.sh"
		VIDEO_HELPER_DEST="/usr/local/bin/debian-laptop-video-publisher"
		VIDEO_SERVICE_SRC="pi/systemd/debian-laptop-video-publisher.service"
		VIDEO_SERVICE_NAME="debian-laptop-video-publisher.service"
		ROVERD_GROUPS="dialout,video,render,audio"
		;;
	*)
		echo "Unknown profile: $PROFILE" >&2
		usage
		exit 1
		;;
esac

if [[ "${EUID}" -ne 0 ]]; then
	echo "Please run as root (sudo)" >&2
	exit 1
fi

if [[ ! -f "$BINARY_SRC" ]]; then
	echo "Binary not found at $BINARY_SRC" >&2
	exit 1
fi

if [[ ! -f "$CONFIG_SRC" ]]; then
	echo "Config source not found at $CONFIG_SRC" >&2
	exit 1
fi

ensure_user() {
	local user="$1"
	local groups="${2:-}"
	local existing_groups=""
	if ! id -u "$user" >/dev/null 2>&1; then
		if [[ -n "$groups" ]]; then
			local group
			IFS=',' read -ra group_list <<< "$groups"
			for group in "${group_list[@]}"; do
				if getent group "$group" >/dev/null 2>&1; then
					existing_groups="${existing_groups:+$existing_groups,}$group"
				else
					log "Skipping missing system group '$group' for $user"
				fi
			done
		fi
		if [[ -n "$existing_groups" ]]; then
			useradd -r -s /usr/sbin/nologin -G "$existing_groups" "$user"
		else
			useradd -r -s /usr/sbin/nologin "$user"
		fi
	elif [[ -n "$groups" ]]; then
		local group
		IFS=',' read -ra group_list <<< "$groups"
		for group in "${group_list[@]}"; do
			if getent group "$group" >/dev/null 2>&1; then
				existing_groups="${existing_groups:+$existing_groups,}$group"
			else
				log "Skipping missing system group '$group' for $user"
			fi
		done
		if [[ -n "$existing_groups" ]]; then
			usermod -a -G "$existing_groups" "$user"
		fi
	fi
}

log() {
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

if [[ "$PROFILE" == "pi" ]] && ! command -v rpicam-vid >/dev/null 2>&1 && ! command -v libcamera-vid >/dev/null 2>&1; then
	log "WARNING: neither rpicam-vid nor libcamera-vid found in PATH; install libcamera-apps."
fi

install_video_deps() {
	if command -v ffmpeg >/dev/null 2>&1 && (command -v rpicam-vid >/dev/null 2>&1 || command -v libcamera-vid >/dev/null 2>&1); then
		log "Video dependencies already installed; skipping apt install"
		return
	fi
	log "Installing video dependencies (libcamera-apps, ffmpeg)..."
	apt-get update
	apt-get install -y --no-install-recommends libcamera-apps ffmpeg
}

install_debian_laptop_deps() {
	# The debian-laptop profile is intentionally Debian-specific, so using apt
	# and systemd directly is simpler than pretending this installer is a
	# cross-distro abstraction. v4l-utils is included for local camera inspection
	# with tools such as v4l2-ctl while ffmpeg owns publishing.
	if command -v ffmpeg >/dev/null 2>&1 \
		&& command -v arecord >/dev/null 2>&1 \
		&& command -v aplay >/dev/null 2>&1 \
		&& command -v v4l2-ctl >/dev/null 2>&1; then
		log "Debian laptop media dependencies already installed; skipping apt install"
		return
	fi
	log "Installing Debian laptop media dependencies (ffmpeg, ALSA tools, V4L2 tools)..."
	apt-get update
	apt-get install -y --no-install-recommends ffmpeg alsa-utils v4l-utils ca-certificates
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

install_profile_dependencies() {
	case "$PROFILE" in
		pi)
			install_video_deps
			ensure_pwm_overlay
			;;
		debian-laptop)
			install_debian_laptop_deps
			;;
	esac
}

install_profile_audio_support() {
	case "$PROFILE" in
		pi)
			install_audio_support
			;;
		debian-laptop)
			# Laptop audio uses the distro's normal ALSA "default" device by
			# default. Avoid installing the Raspberry Pi AIY asound.conf because
			# that would break ordinary laptop sound routing.
			log "Skipping Pi AIY audio setup for debian-laptop profile"
			;;
	esac
}

ensure_user roverd "$ROVERD_GROUPS"
install -o roverd -g roverd -m 0755 "$BINARY_SRC" /usr/local/bin/roverd
log "Installed roverd binary for profile $PROFILE"

install_self_update_support() {
	local sudoers_file="/etc/sudoers.d/roverd-self-update"
	local update_env="/etc/roverd-update.env"
	local quoted_repo_root

	# The self-update helper must know which checkout should receive the git
	# pull. Recording the repository root during the normal installer run keeps
	# the runtime websocket command simple and prevents the rover from accepting
	# a caller-controlled path.
	printf -v quoted_repo_root '%q' "$REPO_ROOT"
	install -D -o root -g root -m 0644 /dev/null "$update_env"
	cat > "$update_env" <<ENV
# Managed by pi/install_roverd.sh.
# This path is intentionally captured from the installer working directory so
# admin-triggered rover updates always operate on the same full repository that
# was used for the manual install.
ROVERD_REPO_DIR=$quoted_repo_root
ENV
	log "Registered roverd update repository at $REPO_ROOT"

	# The helper is root-owned and argument-free. sudoers grants the roverd
	# service user exactly this command and nothing broader, which is important
	# because update requests arrive over the rover websocket.
	install -D -o root -g root -m 0755 pi/bin/roverd-self-update.sh /usr/local/sbin/roverd-self-update
	cat > "$sudoers_file" <<'SUDOERS'
# Managed by pi/install_roverd.sh.
# Allow only the roverd service account to run the fixed self-update helper.
roverd ALL=(root) NOPASSWD: /usr/local/sbin/roverd-self-update
SUDOERS
	chown root:root "$sudoers_file"
	chmod 0440 "$sudoers_file"
	if command -v visudo >/dev/null 2>&1; then
		visudo -cf "$sudoers_file" >/dev/null
	fi
	log "Installed roverd self-update helper and sudoers rule"
}

install_self_update_support

CONFIG_DEST="/etc/roverd.yaml"
CONFIG_EXISTS=0
if [[ -f "$CONFIG_DEST" ]]; then
	CONFIG_EXISTS=1
	log "Existing $CONFIG_DEST found; leaving it in place"
else
	install -D -o roverd -g roverd -m 0640 "$CONFIG_SRC" "$CONFIG_DEST"
	log "Installed sample config to $CONFIG_DEST (edit before starting service)"
fi

install -m 0644 pi/systemd/roverd.service /etc/systemd/system/roverd.service
log "Installed roverd systemd unit"

install_profile_dependencies

# Enable Google AIY v1 sound card, ALSA defaults, and TTS engines
install_audio_support() {
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
	# check for flite and espeak before installing, and then install them if either is missing
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

# Install the profile-specific video publisher. The audio publisher/listener are
# shared because both Pi and Debian laptop profiles use the same media.env audio
# contract and ffmpeg/ALSA command shape.
install -D -o root -g root -m 0755 "$VIDEO_HELPER_SRC" "$VIDEO_HELPER_DEST"
log "Installed $PROFILE video publisher helper"
install -m 0644 "$VIDEO_SERVICE_SRC" "/etc/systemd/system/$VIDEO_SERVICE_NAME"
log "Installed $PROFILE video publisher systemd unit"
# Install audio-only publisher assets
install -D -o root -g root -m 0755 pi/bin/audio-only-publisher.sh /usr/local/bin/audio-only-publisher
install -m 0644 pi/systemd/audio-only-publisher.service /etc/systemd/system/audio-only-publisher.service
log "Installed audio-only publisher helper + systemd unit"
# Install audio-forward listener assets
install -D -o root -g root -m 0755 pi/bin/audio-forward-listener.sh /usr/local/bin/audio-forward-listener
install -m 0644 pi/systemd/audio-forward-listener.service /etc/systemd/system/audio-forward-listener.service
log "Installed audio-forward listener helper + systemd unit"
install -d -o roverd -g roverd /var/lib/roverd
case "$PROFILE" in
	pi)
		cat > /var/lib/roverd/media.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
ROVERD_VIDEO_ENABLE=1
ROVERD_VIDEO_PUBLISHER=pi-libcamera
ROVERD_VIDEO_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_VIDEO_DEVICE=
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
		cat > /var/lib/roverd/media.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
ROVERD_VIDEO_ENABLE=1
ROVERD_VIDEO_PUBLISHER=debian-laptop-v4l2
ROVERD_VIDEO_PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316
ROVERD_VIDEO_DEVICE=/dev/video0
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
ROVERD_AUDIO_PLAYBACK_DEVICE=default
ROVERD_AUDIO_PLAYBACK_NORMALIZE=1
ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER=dynaudnorm=f=75:g=15:m=10:p=0.9,alimiter=limit=0.85:level=disabled
ENV
		;;
esac
chown roverd:roverd /var/lib/roverd/media.env
chmod 0640 /var/lib/roverd/media.env
# Create persistent audio FIFO for capture -> publisher
FIFO_PATH="/var/lib/roverd/audio.pcm"
if [[ -p "$FIFO_PATH" ]]; then
	chown roverd:audio "$FIFO_PATH"
	chmod 0660 "$FIFO_PATH"
else
	rm -f "$FIFO_PATH"
	mkfifo "$FIFO_PATH"
	chown roverd:audio "$FIFO_PATH"
	chmod 0660 "$FIFO_PATH"
fi
if [[ "$PROFILE" == "pi" ]]; then
	# Ensure ALSA config is in place for the Raspberry Pi Google Voice HAT
	# rovermic/forward devices. Debian laptop installs should keep their normal
	# distro sound configuration and use device: default in roverd.yaml.
	install -m 0644 pi/asound.conf /etc/asound.conf
	log "Installed ALSA config (/etc/asound.conf)"
fi

install_profile_audio_support

systemctl daemon-reload
systemctl enable roverd.service
systemctl enable "$VIDEO_SERVICE_NAME"
systemctl enable audio-only-publisher.service
systemctl enable audio-forward-listener.service
if [[ $CONFIG_EXISTS -eq 1 ]]; then
	systemctl restart roverd.service
	systemctl restart "$VIDEO_SERVICE_NAME"
	systemctl restart audio-only-publisher.service
	systemctl restart audio-forward-listener.service
	log "Restarted roverd + media publishers/listener"
else
	log "Skipped auto-start because config is the sample; edit $CONFIG_DEST then run: sudo systemctl restart roverd ${VIDEO_SERVICE_NAME%.service} audio-only-publisher audio-forward-listener"
fi

log "Install complete for profile $PROFILE"
