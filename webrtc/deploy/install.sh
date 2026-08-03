#!/usr/bin/env bash
# WebRTC media server VPS installer
# Purpose: Installs MediaMTX as a systemd service configured for low-latency rover ingest and browser egress.
# Scope: Media server only. It does not install the node app server, and it does not touch any firewall.
set -euo pipefail

MEDIAMTX_VERSION="v1.19.3"
INSTALL_DIR="/opt/rover-media"
SERVICE_NAME="rover-mediamtx"
RUN_USER="rover-media"

usage() {
  cat <<'USAGE'
Usage: sudo ./install.sh [options]

  --public-ip ADDR     VPS public IPv4. Default: auto-detected from the default route.
  --public-host NAME   DNS name clients use. Default: the public IP.
  --auth-url URL       Node server auth endpoint, e.g. http://127.0.0.1:8080/mediamtx/auth
                       Default: http://127.0.0.1:8080/mediamtx/auth
  --no-auth            Install with NO authentication. Anyone who can reach the ports can
                       publish and read. Only for a throwaway test box.
  --port-base N        First port of a contiguous block of 8. Default 8889 keeps MediaMTX's
                       familiar layout; set this when your host only grants a port range.
                       Example: --port-base 15939
  --dry-run            Show what would be done and write nothing.
  -h, --help           This text.

Ports are derived from --port-base as an 8-port contiguous block:

  base+0  WebRTC signalling   tcp   public
  base+1  WebRTC ICE          udp   public  <- media flows here
  base+1  WebRTC ICE          tcp   public  (same number, fallback for UDP-blocked clients)
  base+2  RTSP control        tcp   rovers
  base+3  RTSP RTP            udp   rovers
  base+4  RTSP RTCP           udp   rovers
  base+5  SRT                 udp   rovers
  base+6  API                 tcp   loopback only
  base+7  metrics             tcp   loopback only

Installs to /opt/rover-media and runs as an unprivileged user. Opens no firewall rules -
see README-VPS.md for the ports you must allow.
USAGE
}

PUBLIC_IP=""
PUBLIC_HOST=""
AUTH_URL="http://127.0.0.1:8080/mediamtx/auth"
DRY_RUN=0
# 8889 reproduces MediaMTX's own WebRTC port so the default install looks familiar. Hosts that
# grant only a contiguous range override it.
PORT_BASE=8889

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-ip) PUBLIC_IP="$2"; shift 2 ;;
    --public-host) PUBLIC_HOST="$2"; shift 2 ;;
    --auth-url) AUTH_URL="$2"; shift 2 ;;
    --no-auth) AUTH_URL=""; shift ;;
    --port-base) PORT_BASE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! [[ "$PORT_BASE" =~ ^[0-9]+$ ]] || [[ "$PORT_BASE" -lt 1024 ]] || [[ "$PORT_BASE" -gt 65528 ]]; then
  echo "--port-base must be a number between 1024 and 65528 (it needs 8 consecutive ports)." >&2
  exit 1
fi

# One contiguous block, so a host that grants a port range needs no per-service arithmetic.
PORT_WEBRTC=$((PORT_BASE + 0))
PORT_ICE=$((PORT_BASE + 1))
PORT_RTSP=$((PORT_BASE + 2))
PORT_RTP=$((PORT_BASE + 3))
PORT_RTCP=$((PORT_BASE + 4))
PORT_SRT=$((PORT_BASE + 5))
PORT_API=$((PORT_BASE + 6))
PORT_METRICS=$((PORT_BASE + 7))

log() { printf '\n== %s\n' "$*"; }
run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then
  echo "Needs root to install a systemd service. Re-run with sudo, or use --dry-run." >&2
  exit 1
fi

# Prefer the address on the default route over an external echo service: it needs no network
# call and is right for the common case where the public address is on the interface.
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  echo "Could not detect a public IP. Pass --public-ip explicitly." >&2
  exit 1
fi
PUBLIC_HOST="${PUBLIC_HOST:-$PUBLIC_IP}"

case "$(uname -m)" in
  x86_64)  MTX_ARCH="amd64" ;;
  aarch64) MTX_ARCH="arm64v8" ;;
  armv7l)  MTX_ARCH="armv7" ;;
  *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

log "Target"
echo "  public ip:   ${PUBLIC_IP}"
echo "  public host: ${PUBLIC_HOST}"
echo "  auth:        ${AUTH_URL:-DISABLED (--no-auth)}"
echo "  install dir: ${INSTALL_DIR}"
echo "  mediamtx:    ${MEDIAMTX_VERSION} (${MTX_ARCH})"
echo "  ports:       ${PORT_BASE}-${PORT_METRICS}"

if [[ -z "$AUTH_URL" ]]; then
  echo ""
  echo "  WARNING: authentication is disabled. Anyone who can reach the ingest ports can"
  echo "  publish to any path, including impersonating a rover, and read any stream."
fi

log "Creating service user and directories"
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  run useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
fi
run mkdir -p "$INSTALL_DIR"

log "Fetching MediaMTX"
TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_${MTX_ARCH}.tar.gz"
URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${TARBALL}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  [dry-run] curl -fsSL -o ${INSTALL_DIR}/${TARBALL} ${URL}"
  echo "  [dry-run] tar xzf ... mediamtx"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL -o "${TMP}/${TARBALL}" "$URL"
  tar xzf "${TMP}/${TARBALL}" -C "$TMP" mediamtx
  install -m755 "${TMP}/mediamtx" "${INSTALL_DIR}/mediamtx"
  "${INSTALL_DIR}/mediamtx" --version
fi

log "Writing configuration"
CONFIG_DEST="${INSTALL_DIR}/mediamtx.yml"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  [dry-run] would write ${CONFIG_DEST} from mediamtx-vps.yml.template"
else
  # An existing config is preserved rather than overwritten. Clobbering a hand-tuned config on
  # a re-run would be a nasty surprise on a live server.
  if [[ -f "$CONFIG_DEST" ]]; then
    cp -a "$CONFIG_DEST" "${CONFIG_DEST}.bak.$(date +%s)"
    echo "  existing config backed up"
  fi
  sed \
    -e "s|__PUBLIC_IP__|${PUBLIC_IP}|g" \
    -e "s|__AUTH_URL__|${AUTH_URL}|g" \
    -e "s|__PORT_WEBRTC__|${PORT_WEBRTC}|g" \
    -e "s|__PORT_ICE__|${PORT_ICE}|g" \
    -e "s|__PORT_RTSP__|${PORT_RTSP}|g" \
    -e "s|__PORT_RTP__|${PORT_RTP}|g" \
    -e "s|__PORT_RTCP__|${PORT_RTCP}|g" \
    -e "s|__PORT_SRT__|${PORT_SRT}|g" \
    -e "s|__PORT_API__|${PORT_API}|g" \
    -e "s|__PORT_METRICS__|${PORT_METRICS}|g" \
    "${HERE}/mediamtx-vps.yml.template" > "$CONFIG_DEST"

  # A leftover placeholder would make MediaMTX fail to parse with a confusing message, so catch
  # it here where the cause is obvious. Comments are excluded: the template documents its own
  # placeholder names in a header comment, and matching that would reject a perfectly
  # substituted config - which it did before this exclusion was added.
  if grep -vE '^\s*#' "$CONFIG_DEST" | grep -q '__PORT_\|__PUBLIC_\|__AUTH_'; then
    echo "Template still contains unsubstituted placeholders:" >&2
    grep -nvE '^\s*#' "$CONFIG_DEST" | grep '__PORT_\|__PUBLIC_\|__AUTH_' >&2
    exit 1
  fi

  # With --no-auth the http method has no address to call, which MediaMTX rejects. Swap to the
  # internal method and allow everything, so the intent is explicit in the file itself.
  if [[ -z "$AUTH_URL" ]]; then
    python3 - "$CONFIG_DEST" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("authMethod: http\nauthHTTPAddress: \n", """# Installed with --no-auth: no authentication at all. Replace this block with the http
# method and a real authHTTPAddress before exposing this server to anyone.
authMethod: internal
authInternalUsers:
  - user: any
    pass:
    permissions:
      - action: publish
      - action: read
      - action: api
      - action: metrics
""")
open(path, 'w').write(text)
PYEOF
  fi
  chown -R "${RUN_USER}:${RUN_USER}" "$INSTALL_DIR"
  chmod 640 "$CONFIG_DEST"
fi

log "Installing systemd unit"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  [dry-run] would write ${UNIT_PATH}"
else
  cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=Rover WebRTC media server (MediaMTX)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/mediamtx ${INSTALL_DIR}/mediamtx.yml
Restart=always
RestartSec=2

# Media servers are network-facing and this one runs unprivileged, so the usual hardening
# applies. ReadWritePaths is needed because MediaMTX writes its self-signed certs into its
# working directory on startup.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${INSTALL_DIR}
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
# Media is UDP and TCP over IPv4/IPv6, plus AF_NETLINK.
#
# AF_NETLINK is NOT optional and omitting it is a subtle trap. Go's net.Interfaces() opens a
# netlink socket to enumerate addresses, which pion needs to gather ICE candidates. Without it
# every WHEP request fails with
#   400 error getting local interfaces: route ip+net: netlinkrib:
#       address family not supported by protocol
# because systemd denies the socket and Go reports EAFNOSUPPORT. The message names network
# interfaces and reaches the client as an HTTP error, so it looks like anything but a sandbox
# restriction on the server.
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 2
  systemctl --no-pager --lines=15 status "$SERVICE_NAME" || true
fi

log "Done"
cat <<SUMMARY

Ports to allow in your VPS firewall (this script changed no firewall rules):

  ${PORT_WEBRTC}/tcp   WebRTC signalling  (WHEP for viewers, WHIP for browser mic)   PUBLIC
  ${PORT_ICE}/udp   WebRTC ICE/media   REQUIRED - if blocked, streams never start  PUBLIC
  ${PORT_ICE}/tcp   WebRTC ICE fallback for UDP-blocked clients                    PUBLIC
  ${PORT_RTSP}/tcp   RTSP control       rover ingest, low latency                    ROVERS ONLY
  ${PORT_RTP}/udp   RTSP RTP           rover ingest media                           ROVERS ONLY
  ${PORT_RTCP}/udp   RTSP RTCP          rover ingest control                         ROVERS ONLY
  ${PORT_SRT}/udp   SRT                rover ingest fallback (existing rovers)      ROVERS ONLY
  ${PORT_API}/tcp   API                loopback only - do NOT open
  ${PORT_METRICS}/tcp   metrics            loopback only - do NOT open

Restrict the rover ingest ports to your rovers' addresses if they are static. Authentication
is the real control, but reducing exposure costs nothing.

Verify locally on the VPS:
  curl -s http://127.0.0.1:${PORT_API}/v3/paths/list
  journalctl -u ${SERVICE_NAME} -f

Confirm the listeners bound where expected, and that nothing extra appeared:
  journalctl -u ${SERVICE_NAME} | grep 'started with listener'

Rover URLs for roverd.yaml:
  video   rtspUrl: rtsp://${PUBLIC_HOST}:${PORT_RTSP}/<rover-id>
  audio   rtspUrl: rtsp://${PUBLIC_HOST}:${PORT_RTSP}/<rover-id>-audio
  forward rtspUrl: rtsp://${PUBLIC_HOST}:${PORT_RTSP}/<rover-id>-fwd

Measure from a machine that can reach it. The API is loopback-only, so tunnel it first:
  ssh -N -L ${PORT_API}:127.0.0.1:${PORT_API} user@${PUBLIC_HOST} &

  MEDIA_HOST=${PUBLIC_HOST} \\
  MEDIA_WEBRTC_PORT=${PORT_WEBRTC} \\
  MEDIA_RTSP_PORT=${PORT_RTSP} \\
  MEDIA_SRT_PORT=${PORT_SRT} \\
  MEDIA_API_PORT=${PORT_API} \\
    node webrtc/harness/measure.js baseline

MEDIA_HOST switches every probe to the remote server and, because it is remote, the harness
measures without starting or stopping anything.
SUMMARY
