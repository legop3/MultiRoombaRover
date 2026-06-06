#!/usr/bin/env bash
set -euo pipefail

MEDIAMTX_VERSION="1.15.3"
MEDIAMTX_BASE_URL="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}"
MEDIAMTX_BIN="/usr/local/bin/mediamtx"
MEDIAMTX_CONF_DIR="/etc/mediamtx"
MEDIAMTX_CONFIG="$MEDIAMTX_CONF_DIR/mediamtx.yml"
ROVER_SNAPSHOT_WRITER_BIN="/usr/local/bin/rover-snapshot-writer.sh"
MEDIAMTX_SERVICE="/etc/systemd/system/mediamtx.service"
MULTIROVER_SERVICE="/etc/systemd/system/multirover.service"
SNAPSHOT_DIR="/var/lib/rover-snapshots"
REPLAY_SEGMENT_DIR="/var/lib/replay-segments"
KINECT_UDEV_RULE="/etc/udev/rules.d/99-kinect-world.rules"

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
MEDIAMTX_TEMPLATE="$SERVER_DIR/mediamtx/mediamtx.yml"
ROVER_SNAPSHOT_WRITER_TEMPLATE="$SERVER_DIR/mediamtx/rover-snapshot-writer.sh"

echo "[1/6] Installing dependencies..."
# The Kinect tooling uses a native libfreenect worker/probe rather than a
# Python wrapper.  Install both runtime and development headers here so a fresh
# Fedora server can build the worker locally and then run it under the same
# normal user that owns the rover service.
dnf install -y \
  nodejs \
  npm \
  curl \
  tar \
  gcc-c++ \
  make \
  pkgconf-pkg-config \
  libfreenect \
  libfreenect-devel \
  libusb1-devel >/dev/null
NODE_BIN="$(command -v node)"

echo "      Installing Kinect udev rule -> $KINECT_UDEV_RULE"
cat > "$KINECT_UDEV_RULE" <<'EOF'
# Xbox 360 / Kinect v1 exposes motor, audio, and camera as separate Microsoft
# USB devices.  Fedora/OpenNI PrimeSense rules can leave the camera node as
# root:primesense 0660, which makes libfreenect fail with LIBUSB_ERROR_ACCESS
# when the rover server runs as the normal service user.  This late 99-* rule is
# intentionally broad for local rover hardware: every Microsoft Kinect sibling
# gets world read/write access so the native libfreenect worker can open the
# camera without running the whole server as root.
SUBSYSTEM=="usb", ATTR{idVendor}=="045e", MODE="0666", GROUP="root", TAG+="uaccess"
EOF
chmod 644 "$KINECT_UDEV_RULE"
udevadm control --reload-rules

echo "[2/6] Installing Node production deps..."
runuser -u "$TARGET_USER" -- bash -c "cd '$SERVER_DIR' && npm install --production"

if [[ -f "$SERVER_DIR/src/services/kinectService/native/Makefile" ]]; then
  echo "      Building native Kinect worker..."
  runuser -u "$TARGET_USER" -- bash -c "cd '$SERVER_DIR/src/services/kinectService/native' && make"
fi

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
if [[ ! -f "$MEDIAMTX_TEMPLATE" ]]; then
  echo "mediaMTX template missing at $MEDIAMTX_TEMPLATE" >&2
  exit 1
fi
if [[ ! -f "$ROVER_SNAPSHOT_WRITER_TEMPLATE" ]]; then
  echo "Snapshot writer template missing at $ROVER_SNAPSHOT_WRITER_TEMPLATE" >&2
  exit 1
fi
echo "      Installing mediaMTX config -> $MEDIAMTX_CONFIG"
rm -f "$MEDIAMTX_CONFIG"
install -m 0644 "$MEDIAMTX_TEMPLATE" "$MEDIAMTX_CONFIG"
echo "      Installing rover snapshot writer -> $ROVER_SNAPSHOT_WRITER_BIN"
install -m 0755 "$ROVER_SNAPSHOT_WRITER_TEMPLATE" "$ROVER_SNAPSHOT_WRITER_BIN"
chown -R "$TARGET_USER":"$TARGET_USER" "$MEDIAMTX_CONF_DIR"

echo "[4/6] Writing systemd units..."
mkdir -p "$SNAPSHOT_DIR"
chown "$TARGET_USER":"$TARGET_USER" "$SNAPSHOT_DIR"
mkdir -p "$REPLAY_SEGMENT_DIR"
chown "$TARGET_USER":"$TARGET_USER" "$REPLAY_SEGMENT_DIR"
cat > "$MEDIAMTX_SERVICE" <<EOF
[Unit]
Description=mediaMTX WebRTC Server
After=network-online.target
Wants=network-online.target

[Service]
User=$TARGET_USER
Group=$TARGET_USER
WorkingDirectory=$MEDIAMTX_CONF_DIR
Environment=ROVER_SNAPSHOT_DIR=$SNAPSHOT_DIR
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
Environment=ROVER_SNAPSHOT_DIR=$SNAPSHOT_DIR
Environment=REPLAY_SEGMENT_DIR=$REPLAY_SEGMENT_DIR
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
systemctl restart mediamtx.service
systemctl restart multirover.service

echo "[6/6] Done."
echo
echo "Services installed:"
echo "  mediamtx.service (WebRTC fan-out)"
echo "  multirover.service (Node.js control server)"
echo
echo "Update $CONFIG_PATH to set admins, lockdown settings, and media parameters."
echo "Kinect/libfreenect packages and udev permissions were installed."
echo "If a Kinect is already plugged in, unplug/replug its USB/power before testing so the new udev rule applies."
