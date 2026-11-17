#!/usr/bin/env bash
# Download this file and run it with sudo; no existing checkout is needed.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo bash bootstrap.sh' >&2; exit 1; }
# Existing installations keep their identity; only fresh hosts need prompts.
if [[ ! -f /etc/roverd.json && ! -f /etc/roverd.yaml ]]; then
  read -r -p 'Rover name: ' rover_name </dev/tty
  read -r -p 'Server address (ws://host:port/rover or wss://host/rover): ' server_address </dev/tty
  [[ -n "$rover_name" && -n "$server_address" ]] || { echo 'Name and address are required' >&2; exit 1; }
  export ROVERD_INITIAL_NAME="$rover_name" ROVERD_INITIAL_SERVER="$server_address"
fi
apt-get update
apt-get install -y git ca-certificates python3 python3-yaml
# The old installer used /opt/roverd for speech assets, not a checkout.
if [[ -d /opt/roverd && ! -e /opt/roverd/.git ]]; then
  install -d -m 0700 /var/backups/roverd
  previous=$(mktemp -d /var/backups/roverd/old-directory.XXXXXXXX)
  mv /opt/roverd "$previous/roverd"
  echo "Previous /opt/roverd saved in $previous/roverd"
fi
if [[ ! -e /opt/roverd ]]; then
  git clone https://github.com/legop3/MultiRoombaRover.git /opt/roverd
fi
[[ -d /opt/roverd/.git ]] || { echo '/opt/roverd must be a repository checkout' >&2; exit 1; }
git -C /opt/roverd pull --ff-only
export ROVERD_MIGRATE=1
bash /opt/roverd/rover/install_roverd.sh
systemctl restart roverd
