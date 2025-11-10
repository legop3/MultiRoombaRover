#!/usr/bin/env bash
#
# Installer for the roverd agent on Raspberry Pi

set -euo pipefail

BINARY_SRC="dist/roverd"
CONFIG_SRC="pi/roverd/roverd.sample.yaml"
INSTALL_MEDIAMTX=0
MEDIAMTX_VERSION="1.8.6"

usage() {
	cat <<'USAGE'
Usage: sudo ./pi/install_roverd.sh [options]

Options:
  -b, --binary <path>   Path to the roverd binary (default: dist/roverd)
  -c, --config <path>   Source config to install if /etc/roverd.yaml is missing
                        (default: pi/roverd/roverd.sample.yaml)
      --mediamtx        Install/download mediaMTX (binary, config, systemd unit)
      --mediamtx-version <v>  Override mediaMTX release tag (default: 1.8.6)
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
		--mediamtx-version)
			MEDIAMTX_VERSION="${2:-}"
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

detect_mediamtx_asset() {
	local arch
	arch="$(uname -m)"
	case "$arch" in
		armv7l|armv6l)
			echo "mediamtx_v${MEDIAMTX_VERSION}_linux_armv7.tar.gz"
			;;
		aarch64|arm64)
			echo "mediamtx_v${MEDIAMTX_VERSION}_linux_arm64.tar.gz"
			;;
		x86_64|amd64)
			echo "mediamtx_v${MEDIAMTX_VERSION}_linux_amd64.tar.gz"
			;;
		*)
			echo ""
			;;
	esac
}

install_mediamtx_binary() {
	if ! command -v curl >/dev/null 2>&1; then
		echo "curl is required to download mediaMTX" >&2
		exit 1
	fi
	local asset
	asset="$(detect_mediamtx_asset)"
	if [[ -z "$asset" ]]; then
		echo "Unsupported architecture $(uname -m) for mediaMTX download" >&2
		exit 1
	fi
	local url="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/${asset}"
	local tmpdir
	tmpdir="$(mktemp -d)"
	log "Downloading mediaMTX ${MEDIAMTX_VERSION} (${asset})"
	if ! curl -fsSL "$url" -o "${tmpdir}/${asset}"; then
		echo "Failed to download mediaMTX from ${url}" >&2
		rm -rf "$tmpdir"
		exit 1
	fi
	tar -xzf "${tmpdir}/${asset}" -C "$tmpdir" mediamtx
	install -o mediamtx -g mediamtx -m 0755 "${tmpdir}/mediamtx" /usr/local/bin/mediamtx
	log "Installed /usr/local/bin/mediamtx"
	rm -rf "$tmpdir"
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
	install_mediamtx_binary
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
