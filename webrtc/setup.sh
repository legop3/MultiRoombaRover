#!/usr/bin/env bash
# WebRTC Latency Harness Setup
# Purpose: Fetches the pinned third-party binaries the harness measures through.
# Scope: Downloads only; running measurements is harness/measure.js.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="${HERE}/vendor"

# Pinned so a latency number is always attributable to a specific server build.
# Bumping this is a change to the experiment and should be measured like one.
MEDIAMTX_VERSION="v1.19.3"

case "$(uname -m)" in
  x86_64)  MTX_ARCH="amd64" ;;
  aarch64) MTX_ARCH="arm64v8" ;;
  armv7l)  MTX_ARCH="armv7" ;;
  *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

MTX_TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_${MTX_ARCH}.tar.gz"
MTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MTX_TARBALL}"

mkdir -p "$VENDOR"

if [[ -x "${VENDOR}/mediamtx" ]] && "${VENDOR}/mediamtx" --version 2>/dev/null | grep -qF "$MEDIAMTX_VERSION"; then
  echo "mediamtx ${MEDIAMTX_VERSION}: already present"
else
  echo "Fetching mediamtx ${MEDIAMTX_VERSION} (${MTX_ARCH})..."
  curl -fsSL -o "${VENDOR}/${MTX_TARBALL}" "$MTX_URL"
  tar xzf "${VENDOR}/${MTX_TARBALL}" -C "$VENDOR" mediamtx
  rm -f "${VENDOR}/${MTX_TARBALL}"
  chmod +x "${VENDOR}/mediamtx"
  echo "mediamtx: $(${VENDOR}/mediamtx --version)"
fi

echo "Installing harness dependencies..."
npm --prefix "${HERE}/harness" install --no-fund --no-audit

# Chromium lands under vendor/ so a checkout stays self-contained and nothing is
# written to a shared per-user browser cache that another project could change.
echo "Installing headless Chromium..."
PLAYWRIGHT_BROWSERS_PATH="${VENDOR}/browsers" \
  "${HERE}/harness/node_modules/.bin/playwright" install chromium

for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
ffmpeg -hide_banner -protocols 2>/dev/null | tr ' ' '\n' | grep -qx srt \
  || { echo "This ffmpeg lacks SRT support; the rover transport cannot be reproduced." >&2; exit 1; }

echo ""
echo "Setup complete. Run a measurement with:"
echo "  node ${HERE}/harness/measure.js"
