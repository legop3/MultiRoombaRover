#!/usr/bin/env bash
#
# Installer for the roverd agent on Raspberry Pi

set -euo pipefail

BINARY_SRC="dist/roverd"
CONFIG_SRC="pi/roverd/roverd.sample.yaml"

usage() {
	cat <<'USAGE'
Usage: sudo ./pi/install_roverd.sh [options]

Options:
  -b, --binary <path>   Path to the roverd binary (default: dist/roverd)
  -c, --config <path>   Source config to install if /etc/roverd.yaml is missing
                        (default: pi/roverd/roverd.sample.yaml)
  -h, --help            Show this help text

The script must run from the repository root and as root (sudo). It will:
  * create system users/groups if needed
  * install /usr/local/bin/roverd and /etc/roverd.yaml
  * install /usr/local/bin/video-publisher and its systemd unit
  * enable roverd.service and video-publisher.service
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
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
	if ! id -u "$user" >/dev/null 2>&1; then
		if [[ -n "$groups" ]]; then
			useradd -r -s /usr/sbin/nologin -G "$groups" "$user"
		else
			useradd -r -s /usr/sbin/nologin "$user"
		fi
	elif [[ -n "$groups" ]]; then
		usermod -a -G "$groups" "$user"
	fi
}

log() {
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

if ! command -v rpicam-vid >/dev/null 2>&1 && ! command -v libcamera-vid >/dev/null 2>&1; then
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

ensure_user roverd "dialout,gpio,video,render,audio"
install -o roverd -g roverd -m 0755 "$BINARY_SRC" /usr/local/bin/roverd
log "Installed roverd binary"

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

install_video_deps
ensure_pwm_overlay

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
	log "Installing TTS/audio packages (flite, espeak)..."
	apt-get update
	apt-get install -y --no-install-recommends flite espeak
	if [[ "${alsa_reload_notice:-0}" -eq 1 ]]; then
		log "ALSA config updated; reboot recommended for overlay + audio changes"
	fi
}

# Install video publisher assets
install -D -o root -g root -m 0755 pi/bin/video-publisher.sh /usr/local/bin/video-publisher
install -m 0644 pi/systemd/video-publisher.service /etc/systemd/system/video-publisher.service
install -d -o roverd -g roverd /var/lib/roverd
cat > /var/lib/roverd/video.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
PUBLISH_URL=srt://192.168.0.86:9000?streamid=#!::r=CHANGE_ME,m=publish&latency=20&mode=caller&transtype=live&pkt_size=1316
VIDEO_WIDTH=1280
VIDEO_HEIGHT=720
VIDEO_FPS=30
VIDEO_BITRATE=3000000
AUDIO_ENABLE=1
AUDIO_DEVICE=plughw:0,0
AUDIO_RATE=48000
AUDIO_CHANNELS=2
AUDIO_BITRATE=64000
ENV
chown roverd:roverd /var/lib/roverd/video.env
chmod 0640 /var/lib/roverd/video.env

install_audio_support

systemctl daemon-reload
systemctl enable roverd.service
systemctl enable video-publisher.service
if [[ $CONFIG_EXISTS -eq 1 ]]; then
	systemctl restart roverd.service
	systemctl restart video-publisher.service
	log "Restarted roverd + video publisher"
else
	log "Skipped auto-start because config is the sample; edit $CONFIG_DEST then run: sudo systemctl restart roverd video-publisher"
fi

log "Install complete"
