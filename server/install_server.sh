#!/usr/bin/env bash
set -euo pipefail

MEDIAMTX_VERSION="1.15.3"
MEDIAMTX_BASE_URL="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}"
MEDIAMTX_BIN="/usr/local/bin/mediamtx"
MEDIAMTX_CONF_DIR="/etc/mediamtx"
MEDIAMTX_CONFIG="$MEDIAMTX_CONF_DIR/mediamtx.yml"
MEDIAMTX_SERVICE="/etc/systemd/system/mediamtx.service"
MULTIROVER_SERVICE="/etc/systemd/system/multirover.service"

if [[ $EUID -ne 0 ]]; then
  echo "This installer must be run with sudo/root." >&2
  exit 1
fi

if [[ -z "${SUDO_USER:-}" || "${SUDO_USER}" == "root" ]]; then
  echo "Run this script via 'sudo' from the normal user that owns the repo." >&2
  exit 1
fi

TARGET_USER="$SUDO_USER"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SERVER_DIR="$SCRIPT_DIR"
CONFIG_PATH="$SERVER_DIR/config.yaml"

echo "[1/6] Installing dependencies..."
dnf install -y nodejs npm curl tar >/dev/null
NODE_BIN="$(command -v node)"

echo "[2/6] Installing Node production deps..."
runuser -u "$TARGET_USER" -- bash -c "cd '$SERVER_DIR' && npm install --production"

if [[ ! -f "$CONFIG_PATH" ]]; then
  cp "$SERVER_DIR/config.example.yaml" "$CONFIG_PATH"
  chown "$TARGET_USER":"$TARGET_USER" "$CONFIG_PATH"
  echo "Copied config.example.yaml to config.yaml; edit it before exposing the service."
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

arch=$(uname -m)
case "$arch" in
  x86_64|amd64)
    mediamtx_pkg="mediamtx_v${MEDIAMTX_VERSION}_linux_amd64.tar.gz"
    ;;
  aarch64)
    mediamtx_pkg="mediamtx_v${MEDIAMTX_VERSION}_linux_arm64.tar.gz"
    ;;
  armv7l)
    mediamtx_pkg="mediamtx_v${MEDIAMTX_VERSION}_linux_armv7.tar.gz"
    ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

echo "[3/6] Installing mediaMTX ${MEDIAMTX_VERSION}..."
curl -L "$MEDIAMTX_BASE_URL/$mediamtx_pkg" -o "$tmpdir/mediamtx.tgz"
tar -xzf "$tmpdir/mediamtx.tgz" -C "$tmpdir" mediamtx
install -m 0755 "$tmpdir/mediamtx" "$MEDIAMTX_BIN"

mkdir -p "$MEDIAMTX_CONF_DIR"
if [[ ! -f "$MEDIAMTX_CONFIG" ]]; then
  cat > "$MEDIAMTX_CONFIG" <<'CFG'
logLevel: info
api: yes
apiAddress: 0.0.0.0:9997
webrtc: yes
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189

authMethod: http
authHTTPAddress: http://127.0.0.1:8080/mediamtx/auth
authHTTPExclude:
  - action: api
  - action: metrics
  - action: pprof

paths:
  all:
    source: publisher
CFG
fi
chown -R "$TARGET_USER":"$TARGET_USER" "$MEDIAMTX_CONF_DIR"

echo "[4/6] Writing systemd units..."
cat > "$MEDIAMTX_SERVICE" <<EOF
[Unit]
Description=mediaMTX WebRTC Server
After=network-online.target
Wants=network-online.target

[Service]
User=$TARGET_USER
Group=$TARGET_USER
WorkingDirectory=$MEDIAMTX_CONF_DIR
ExecStart=$MEDIAMTX_BIN $MEDIAMTX_CONFIG
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat > "$MULTIROVER_SERVICE" <<EOF
[Unit]
Description=Multi-Roomba Rover control server
After=network-online.target mediamtx.service
Wants=network-online.target

[Service]
User=$TARGET_USER
Group=$TARGET_USER
WorkingDirectory=$SERVER_DIR
Environment=NODE_ENV=production
Environment=SERVER_CONFIG=$CONFIG_PATH
ExecStart=$NODE_BIN $SERVER_DIR/index.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$MEDIAMTX_SERVICE" "$MULTIROVER_SERVICE"

echo "[5/6] Enabling services..."
systemctl daemon-reload
systemctl enable --now mediamtx.service
systemctl enable --now multirover.service

echo "[6/6] Done."
echo
echo "Services installed:"
echo "  mediamtx.service (WebRTC fan-out)"
echo "  multirover.service (Node.js control server)"
echo
echo "Update $CONFIG_PATH to set admins, lockdown settings, and media parameters."
