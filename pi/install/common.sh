#!/usr/bin/env bash

CONFIG_DEST="/etc/roverd.yaml"

log() {
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

ensure_user() {
	local user="$1"
	local groups="${2:-}"
	local existing_groups=""
	local group

	if [[ -n "$groups" ]]; then
		IFS=',' read -ra group_list <<< "$groups"
		for group in "${group_list[@]}"; do
			if getent group "$group" >/dev/null 2>&1; then
				existing_groups="${existing_groups:+$existing_groups,}$group"
			else
				# Different Debian-family installs expose slightly different
				# hardware groups. Skipping missing optional groups lets one
				# profile script cover ordinary laptops and Raspberry Pi OS.
				log "Skipping missing system group '$group' for $user"
			fi
		done
	fi

	if ! id -u "$user" >/dev/null 2>&1; then
		if [[ -n "$existing_groups" ]]; then
			useradd -r -s /usr/sbin/nologin -G "$existing_groups" "$user"
		else
			useradd -r -s /usr/sbin/nologin "$user"
		fi
	elif [[ -n "$existing_groups" ]]; then
		usermod -a -G "$existing_groups" "$user"
	fi
}

require_root() {
	if [[ "${EUID}" -ne 0 ]]; then
		echo "Please run as root (sudo)" >&2
		exit 1
	fi
}

validate_install_inputs() {
	if [[ ! -f "$BINARY_SRC" ]]; then
		echo "Binary not found at $BINARY_SRC" >&2
		exit 1
	fi

	if [[ ! -f "$CONFIG_SRC" ]]; then
		echo "Config source not found at $CONFIG_SRC" >&2
		exit 1
	fi
}

install_roverd_binary() {
	ensure_user roverd "$ROVERD_GROUPS"
	install -o roverd -g roverd -m 0755 "$BINARY_SRC" /usr/local/bin/roverd
	log "Installed roverd binary for profile $PROFILE"
}

install_roverd_config() {
	CONFIG_EXISTS=0
	if [[ -f "$CONFIG_DEST" ]]; then
		CONFIG_EXISTS=1
		log "Existing $CONFIG_DEST found; leaving it in place"
	else
		install -D -o roverd -g roverd -m 0640 "$CONFIG_SRC" "$CONFIG_DEST"
		log "Installed sample config to $CONFIG_DEST (edit before starting service)"
	fi
}

install_roverd_unit() {
	install -m 0644 pi/systemd/roverd.service /etc/systemd/system/roverd.service
	log "Installed roverd systemd unit"
}
