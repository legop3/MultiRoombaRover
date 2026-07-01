#!/usr/bin/env bash

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
