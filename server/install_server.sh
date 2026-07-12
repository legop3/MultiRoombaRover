#!/usr/bin/env bash
set -euo pipefail

MEDIAMTX_VERSION="1.15.3"
NEOLINK_VERSION="0.6.2"
MEDIAMTX_BASE_URL="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}"
NEOLINK_BASE_URL="https://github.com/QuantumEntangledAndy/neolink/releases/download/v${NEOLINK_VERSION}"
MEDIAMTX_BIN="/usr/local/bin/mediamtx"
NEOLINK_BIN="/usr/local/bin/neolink"
CHROMEGTTS_WAV_BIN="/usr/local/bin/chromegtts-wav"
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
CHROMEGTTS_WAV_TEMPLATE="$SERVER_DIR/bin/chromegtts-wav.py"

install_google_tts_assets() {
  local asset_dir="/opt/roverd/googletts"
  local voice_dir="${asset_dir}/en-us-x-multi-r30"
  local dist_url="https://storage.googleapis.com/chromeos-localmirror/distfiles/googletts-26.5.tar.xz"
  local lib_member=""
  local arch_name
  arch_name=$(uname -m)

  # The PTZ camera is not a rover, so Google speech must be synthesized on the
  # server before neolink sends a WAV to the camera. These assets are the same
  # offline ChromeOS local TTS assets that rover installers already use; keeping
  # the layout identical lets the server helper and rover daemon share loader
  # assumptions.
  if [[ -f "${asset_dir}/libchrometts.so" && -f "${voice_dir}/pipeline.pb" ]]; then
    echo "      Google TTS assets already installed"
    return
  fi

  case "$arch_name" in
    x86_64|amd64)
      lib_member="libchrometts_x86_64.so"
      ;;
    aarch64)
      lib_member="libchrometts_arm64.so"
      ;;
    armv7l|armv6l)
      lib_member="libchrometts_armv7.so"
      ;;
    *)
      echo "Unsupported Google TTS architecture: $arch_name" >&2
      exit 1
      ;;
  esac

  echo "      Installing Google TTS assets -> $asset_dir"
  curl -L -o "$tmpdir/googletts-26.5.tar.xz" "$dist_url"
  tar -xf "$tmpdir/googletts-26.5.tar.xz" -C "$tmpdir" en-us-x-multi.zvoice "$lib_member"
  install -d -o root -g root -m 0755 "$asset_dir"
  install -o root -g root -m 0644 "$tmpdir/$lib_member" "${asset_dir}/libchrometts.so"
  rm -rf "$voice_dir"
  install -d -o root -g root -m 0755 "$voice_dir"
  # The .zvoice member is a zip archive inside the outer tar.xz. Match the
  # rover installers here; trying to untar it fails after the large download.
  unzip -q "$tmpdir/en-us-x-multi.zvoice" -d "$voice_dir"
  chown -R root:root "$asset_dir"
  find "$asset_dir" -type d -exec chmod 0755 {} +
  find "$asset_dir" -type f -exec chmod 0644 {} +
}

verify_google_tts_helper() {
  local smoke_wav="$tmpdir/chromegtts-smoke.wav"

  echo "      Verifying Chrome Google TTS helper"
  # libchrometts is a native ChromeOS library. Rendering one tiny WAV during
  # install catches missing shared-library dependencies, bad asset extraction,
  # and helper path mistakes before multirover.service starts accepting PTZ TTS
  # requests that would fail later in logs.
  if ! "$CHROMEGTTS_WAV_BIN" \
    --text "test" \
    --voice tpf \
    --pitch 1 \
    --speed 1 \
    --output "$smoke_wav"; then
    echo "Chrome Google TTS helper smoke render failed." >&2
    return 1
  fi
  if [[ ! -s "$smoke_wav" ]]; then
    echo "Chrome Google TTS helper did not create a WAV file." >&2
    return 1
  fi
}

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
  unzip \
  xz \
  gcc-c++ \
  make \
  pkgconf-pkg-config \
  flite \
  espeak \
  python3 \
  libcxx \
  libcxxabi \
  gstreamer1 \
  gstreamer1-plugins-base \
  gstreamer1-plugins-good \
  gstreamer1-plugins-bad-free \
  gstreamer1-rtsp-server \
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

if [[ ! -f "$CHROMEGTTS_WAV_TEMPLATE" ]]; then
  echo "Chrome Google TTS WAV helper missing at $CHROMEGTTS_WAV_TEMPLATE" >&2
  exit 1
fi
echo "      Installing Chrome Google TTS WAV helper -> $CHROMEGTTS_WAV_BIN"
install -m 0755 "$CHROMEGTTS_WAV_TEMPLATE" "$CHROMEGTTS_WAV_BIN"

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
    neolink_pkg="neolink_linux_x86_64_ubuntu.zip"
    ;;
  aarch64)
    mediamtx_pkg="mediamtx_v${MEDIAMTX_VERSION}_linux_arm64.tar.gz"
    neolink_pkg="neolink_linux_arm64.zip"
    ;;
  armv7l)
    mediamtx_pkg="mediamtx_v${MEDIAMTX_VERSION}_linux_armv7.tar.gz"
    neolink_pkg="neolink_linux_armhf.zip"
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

echo "      Installing neolink ${NEOLINK_VERSION} -> $NEOLINK_BIN"
curl -L "$NEOLINK_BASE_URL/$neolink_pkg" -o "$tmpdir/neolink.zip"
unzip -q "$tmpdir/neolink.zip" -d "$tmpdir/neolink"
neolink_extracted=$(find "$tmpdir/neolink" -type f -name neolink -perm /111 | head -n 1)
if [[ -z "$neolink_extracted" ]]; then
  neolink_extracted=$(find "$tmpdir/neolink" -type f -name neolink | head -n 1)
fi
if [[ -z "$neolink_extracted" ]]; then
  echo "neolink binary missing from $neolink_pkg" >&2
  exit 1
fi
install -m 0755 "$neolink_extracted" "$NEOLINK_BIN"
install_google_tts_assets
if ! verify_google_tts_helper; then
  echo "      Reinstalling Google TTS assets after failed verification"
  rm -rf /opt/roverd/googletts
  install_google_tts_assets
  verify_google_tts_helper
fi

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
SuccessExitStatus=130 143

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
