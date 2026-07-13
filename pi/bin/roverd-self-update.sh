#!/usr/bin/env bash
#
# Fixed-purpose self-update helper for Raspberry Pi rover hosts.
#
# roverd itself runs as the unprivileged "roverd" service user, but updating the
# installed agent requires root because the installer writes to /usr/local/bin,
# /etc, /opt, /var/lib/roverd, and systemd unit locations. This helper is the
# narrow privilege boundary: sudoers allows roverd to run this exact file with no
# arguments, and this file decides the complete update sequence internally.

set -euo pipefail

ENV_FILE="/etc/roverd-update.env"
LOCK_FILE="/var/lock/roverd-self-update.lock"
LOG_FILE="/var/log/roverd-self-update.log"

log() {
	# Log to stdout so systemd/journal captures the message when launched by
	# roverd, and also append to a stable file so an admin can inspect the last
	# update attempt after the roverd service restarts.
	local message
	message="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
	echo "$message"
	echo "$message" >> "$LOG_FILE"
}

if [[ "${EUID}" -ne 0 ]]; then
	echo "roverd-self-update must run as root" >&2
	exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Missing $ENV_FILE; run pi/install_roverd.sh once to register the repository path" >&2
	exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${ROVERD_REPO_DIR:-}" ]]; then
	echo "ROVERD_REPO_DIR is not set in $ENV_FILE" >&2
	exit 1
fi

if [[ ! -d "$ROVERD_REPO_DIR/.git" ]]; then
	echo "ROVERD_REPO_DIR does not point at a git checkout: $ROVERD_REPO_DIR" >&2
	exit 1
fi

if [[ ! -x "$ROVERD_REPO_DIR/pi/install_roverd.sh" ]]; then
	echo "Installer is missing or not executable: $ROVERD_REPO_DIR/pi/install_roverd.sh" >&2
	exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 0644 "$LOG_FILE"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
	log "Another roverd self-update is already running; refusing to start a second one"
	exit 1
fi

cd "$ROVERD_REPO_DIR"
log "Starting roverd self-update in $ROVERD_REPO_DIR"

repo_uid="$(stat -c '%u' "$ROVERD_REPO_DIR")"

# Fetch through the normal git remote instead of downloading just one artifact.
# That keeps the binary, installer, scripts, systemd units, and any other rover
# files from this repository on the same commit.
if [[ "$repo_uid" -eq 0 ]]; then
	git pull --ff-only
else
	# The helper runs as root only for installation privileges. The git checkout
	# usually belongs to the human deploy user, so running the pull as that owner
	# avoids Git's dubious-ownership protection and preserves whatever SSH/HTTPS
	# credentials that user normally uses for this repository.
	sudo -H -u "#${repo_uid}" git -C "$ROVERD_REPO_DIR" pull --ff-only
fi
log "Repository fast-forward pull complete"

# The installer already owns the full desired rover host state. Reusing it here
# prevents this update helper from becoming a second, partial installer that can
# drift away from the normal manual install path.
"$ROVERD_REPO_DIR/pi/install_roverd.sh"
log "Installer completed successfully"
systemctl reboot
