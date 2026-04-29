#!/usr/bin/env bash
# Rover Snapshot Writer Hook
# Purpose: Runs under mediaMTX runOnReady to keep per-rover JPEG snapshots updated on disk.
# Scope: Writes only rover video path snapshots and ignores audio/forward/room paths.
set -euo pipefail

PATH_NAME="${MTX_PATH:-}"
SNAP_DIR="${ROVER_SNAPSHOT_DIR:-/var/lib/rover-snapshots}"

# Ignore non-rover-video paths.
case "$PATH_NAME" in
  ""|*-audio|*-fwd|room/*)
    exit 0
    ;;
esac

mkdir -p "$SNAP_DIR"

exec ffmpeg -hide_banner -loglevel warning -nostdin -y \
  -i "srt://127.0.0.1:9000?streamid=read:${PATH_NAME}" \
  -an \
  -vf fps=2 \
  -q:v 6 \
  -update 1 \
  "${SNAP_DIR}/${PATH_NAME}.jpg"
