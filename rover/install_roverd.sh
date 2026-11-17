#!/usr/bin/env bash
# Installs from an existing checkout. Standalone bootstrap is a later stage.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"
[[ $EUID == 0 ]] || { echo 'Run as root' >&2; exit 1; }
case "$(dpkg --print-architecture)" in
  amd64) arch=amd64 ;; arm64) arch=arm64 ;; armhf) arch=armv6 ;;
  *) echo 'Unsupported OS architecture' >&2; exit 1 ;;
esac
install -m 0755 "dist/roverd-linux-$arch" /usr/local/bin/roverd
install -d /etc/roverd/profiles /var/lib/roverd
if [[ ! -f /etc/roverd.json ]]; then
  /usr/local/bin/roverd -print-default-config > /etc/roverd.json
  chmod 600 /etc/roverd.json
  echo 'Set name, serverUrl, devices, and enabled profiles in /etc/roverd.json before starting roverd.'
fi
install -m 0644 rover/systemd/roverd.service /etc/systemd/system/roverd.service
# Use this checkout directly for catalogs and command resources.
install -d /etc/systemd/system/roverd.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/local/bin/roverd -config /etc/roverd.json -repo "%s"\n' "$REPO_ROOT" > /etc/systemd/system/roverd.service.d/repository.conf
install -m 0755 rover/bin/chromegtts-daemon.py /usr/local/bin/chromegtts-daemon
bash rover/bin/setup-tts.sh
log() { echo "$*"; }
source rover/install/self_update.sh
install_self_update_support
systemctl daemon-reload
systemctl enable roverd.service
echo 'Installed. Run systemctl restart roverd after configuring this rover.'
