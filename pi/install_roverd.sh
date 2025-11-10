#!/usr/bin/env bash
#
# Installer for the roverd agent on Raspberry Pi

set -euo pipefail

BINARY_SRC="dist/roverd"
CONFIG_SRC="pi/roverd/roverd.sample.yaml"
INSTALL_MEDIAMTX=0

usage() {
	cat <<'USAGE'
Usage: sudo ./pi/install_roverd.sh [options]

Options:
  -b, --binary <path>   Path to the roverd binary (default: dist/roverd)
  -c, --config <path>   Source config to install if /etc/roverd.yaml is missing
                        (default: pi/roverd/roverd.sample.yaml)
      --mediamtx        Also install mediaMTX unit/config (requires pi/mediamtx files)
  -h, --help            Show this help text

The script must run from the repository root and as root (sudo). It will:
  * create system users/groups if needed
  * install /usr/local/bin/roverd and /etc/roverd.yaml
  * install /etc/systemd/system/roverd.service and enable the service
  * optionally install mediaMTX config/unit when --mediamtx is set
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
		--mediamtx)
			INSTALL_MEDIAMTX=1
			shift
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
	local groups="$2"
	if ! id -u "$user" >/dev/null 2>&1; then
		useradd -r -s /usr/sbin/nologin -G "$groups" "$user"
	fi
}

log() {
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

ensure_user roverd "dialout,gpio"
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

systemctl daemon-reload
systemctl enable roverd.service
if [[ $CONFIG_EXISTS -eq 1 ]]; then
	systemctl restart roverd.service
	log "Restarted roverd.service"
else
	log "Skipped auto-start because config is the sample; edit $CONFIG_DEST then run: sudo systemctl restart roverd"
fi

if [[ $INSTALL_MEDIAMTX -eq 1 ]]; then
	if [[ ! -f "pi/mediamtx/mediamtx.yml" ]]; then
		echo "pi/mediamtx/mediamtx.yml missing, cannot install mediaMTX config" >&2
		exit 1
	fi
	if [[ ! -f "pi/systemd/mediamtx.service" ]]; then
		echo "pi/systemd/mediamtx.service missing, cannot install mediaMTX unit" >&2
		exit 1
	fi

	ensure_user mediamtx ""
	install -d -o mediamtx -g mediamtx /etc/mediamtx
	install -o mediamtx -g mediamtx -m 0644 pi/mediamtx/mediamtx.yml /etc/mediamtx/mediamtx.yml
	install -m 0644 pi/systemd/mediamtx.service /etc/systemd/system/mediamtx.service
	log "Installed mediamtx config and unit"

	systemctl daemon-reload
	systemctl enable mediamtx.service
	systemctl restart mediamtx.service
	log "Restarted mediamtx.service"
fi

log "Install complete"
