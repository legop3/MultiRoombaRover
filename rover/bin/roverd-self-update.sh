#!/usr/bin/env bash
# A separate systemd job survives replacement/restart of the roverd service.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root' >&2; exit 1; }
if [[ ${ROVERD_UPDATE_JOB:-} != 1 ]]; then
  exec systemd-run --unit=roverd-self-update --collect --wait \
    --property=Type=exec --setenv=ROVERD_UPDATE_JOB=1 "$0"
fi
exec 9>/var/lock/roverd-self-update.lock
flock -n 9 || exit 1
install -d /var/lib/roverd
status() {
  echo "$2"
  python3 - "$1" "$2" <<'PY'
import json, os, sys, time
path = '/var/lib/roverd/update-status.json'
with open(path + '.tmp', 'w') as f:
    json.dump(dict(state=sys.argv[1], message=sys.argv[2], timestamp=int(time.time()*1000)), f)
os.replace(path + '.tmp', path)
PY
}
trap 'result=$?; if (( result != 0 )); then status failed "Update failed (exit $result). See journalctl -u roverd-self-update."; fi' EXIT
source /etc/roverd-update.env
cd "$ROVERD_REPO_DIR"
status running 'Updating repository'
# This is a dedicated root-owned checkout; local configuration lives outside it.
git pull --ff-only
status running 'Installing rover software'
bash rover/install_roverd.sh
status running 'Restarting roverd'
systemctl restart roverd
status succeeded 'Update installed and roverd service restarted'
