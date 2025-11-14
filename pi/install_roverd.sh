#!/usr/bin/env bash
#
# Installer for the roverd agent on Raspberry Pi

set -euo pipefail

BINARY_SRC="dist/roverd"
CONFIG_SRC="pi/roverd/roverd.sample.yaml"
FFMPEG_WHIP_VERSION="0.0.0"
FFMPEG_WHIP_BASE_URL="https://github.com/steel-dev/ffmpeg-whip/releases/download/v${FFMPEG_WHIP_VERSION}"
FFMPEG_WHIP_DIR="/usr/local/lib/ffmpeg-whip"
FFMPEG_WHIP_BIN="/usr/local/bin/ffmpeg-whip"

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
  * install /usr/local/bin/whip-publisher and its systemd unit
  * enable roverd.service and whip-publisher.service
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

if ! command -v curl >/dev/null 2>&1; then
	echo "curl is required by this installer" >&2
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

install_ffmpeg_whip() {
	local arch asset tmp
	arch="$(uname -m)"
	case "$arch" in
		aarch64)
			asset="ffmpeg-whip-linux-arm64.tar.gz"
			;;
		x86_64|amd64)
			asset="ffmpeg-whip-linux-amd64.tar.gz"
			;;
		*)
			log "WARNING: ffmpeg-whip binary not available for architecture ${arch}; ensure a WHIP-capable ffmpeg is installed manually."
			return
	esac
	tmp="$(mktemp -d)"
	log "Downloading ffmpeg-whip ${FFMPEG_WHIP_VERSION} (${asset})"
	if ! curl -fsSL "${FFMPEG_WHIP_BASE_URL}/${asset}" -o "${tmp}/${asset}"; then
		rm -rf "$tmp"
		echo "Failed to download ffmpeg-whip from ${FFMPEG_WHIP_BASE_URL}/${asset}" >&2
		exit 1
	fi
	rm -rf "${FFMPEG_WHIP_DIR}"
	mkdir -p "${FFMPEG_WHIP_DIR}"
	tar -xzf "${tmp}/${asset}" -C "${FFMPEG_WHIP_DIR}"
	rm -rf "$tmp"
	cat > "${FFMPEG_WHIP_BIN}" <<'EOF'
#!/usr/bin/env bash
export LD_LIBRARY_PATH=/usr/local/lib/ffmpeg-whip/lib:${LD_LIBRARY_PATH}
exec /usr/local/lib/ffmpeg-whip/bin/ffmpeg "$@"
EOF
	chmod 0755 "${FFMPEG_WHIP_BIN}"
	log "Installed ${FFMPEG_WHIP_BIN}"
}

ensure_user roverd "dialout,gpio,video,render"
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

install_ffmpeg_whip

# Install WHIP publisher assets
install -D -o root -g root -m 0755 pi/bin/whip-publisher.sh /usr/local/bin/whip-publisher
install -m 0644 pi/systemd/whip-publisher.service /etc/systemd/system/whip-publisher.service
install -d -o roverd -g roverd /var/lib/roverd
if [[ ! -f /var/lib/roverd/whip.env ]]; then
	cat > /var/lib/roverd/whip.env <<'ENV'
# Managed by roverd; placeholder values will be overwritten at runtime.
WHIP_URL=http://192.168.0.86:8889/whip/CHANGE_ME
VIDEO_WIDTH=1280
VIDEO_HEIGHT=720
VIDEO_FPS=30
VIDEO_BITRATE=3000000
ENV
	chown roverd:roverd /var/lib/roverd/whip.env
	chmod 0640 /var/lib/roverd/whip.env
fi

systemctl daemon-reload
systemctl enable roverd.service
systemctl enable whip-publisher.service
if [[ $CONFIG_EXISTS -eq 1 ]]; then
	systemctl restart roverd.service
	systemctl restart whip-publisher.service
	log "Restarted roverd + WHIP publisher"
else
	log "Skipped auto-start because config is the sample; edit $CONFIG_DEST then run: sudo systemctl restart roverd whip-publisher"
fi

log "Install complete"
