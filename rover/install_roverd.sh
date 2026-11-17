#!/usr/bin/env bash
# Shared installation path for bootstrap and self-update.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"
[[ $EUID == 0 ]] || { echo 'Run as root' >&2; exit 1; }
case "$(dpkg --print-architecture)" in
  amd64) arch=amd64 ;; arm64) arch=arm64 ;;
  armhf) case "$(uname -m)" in armv6*) arch=armv6 ;; *) arch=armv7 ;; esac ;;
  *) echo 'Unsupported OS architecture' >&2; exit 1 ;;
esac
# Rename avoids overwriting an executable that the running service has mapped.
install -m 0755 "dist/roverd-linux-$arch" /usr/local/bin/roverd.new
mv -f /usr/local/bin/roverd.new /usr/local/bin/roverd
apt-get update
apt-get install -y git ca-certificates python3 util-linux flite espeak curl xz-utils unzip alsa-utils libc++1 libc++abi1
install -d /etc/roverd/profiles /var/lib/roverd
if [[ ! -f /etc/roverd.json ]]; then
  /usr/local/bin/roverd -print-default-config > /etc/roverd.json.new
  chmod 600 /etc/roverd.json.new
  python3 - <<'PYCONFIG'
import json, os
path = '/etc/roverd.json.new'
with open(path) as f:
    config = json.load(f)
config['name'] = os.environ.get('ROVERD_INITIAL_NAME', config['name'])
config['serverUrl'] = os.environ.get('ROVERD_INITIAL_SERVER', config['serverUrl'])
with open(path, 'w') as f:
    json.dump(config, f, indent=2)
PYCONFIG
  /usr/local/bin/roverd -config /etc/roverd.json.new -check-config
  mv /etc/roverd.json.new /etc/roverd.json
  echo 'Initial configuration created. Configure devices and enabled profiles through Fleet Management.'
fi
install -m 0644 rover/systemd/roverd.service /etc/systemd/system/roverd.service
# Use this checkout directly for catalogs and command resources.
install -d /etc/systemd/system/roverd.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/local/bin/roverd -config /etc/roverd.json -repo "%s"\n' "$REPO_ROOT" > /etc/systemd/system/roverd.service.d/repository.conf
install -m 0755 rover/bin/chromegtts-daemon.py /usr/local/bin/chromegtts-daemon
bash rover/bin/setup-tts.sh
printf -v quoted_repo_root '%q' "$REPO_ROOT"
printf 'ROVERD_REPO_DIR=%s\n' "$quoted_repo_root" > /etc/roverd-update.env
chmod 0600 /etc/roverd-update.env
install -D -o root -g root -m 0755 rover/bin/roverd-self-update.sh /usr/local/sbin/roverd-self-update.new
# Keep the running updater on its original inode until it exits.
mv -f /usr/local/sbin/roverd-self-update.new /usr/local/sbin/roverd-self-update
echo "Registered update checkout at $REPO_ROOT"
systemctl daemon-reload
systemctl enable roverd.service
echo 'Installation complete; caller can now restart roverd.'
