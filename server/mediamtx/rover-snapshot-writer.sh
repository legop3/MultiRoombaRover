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

FILTER="fps=1"
QUALITY="6"

case "$PATH_NAME" in
  ptz-camera)
    # PTZ snapshots are shown to non-operators specifically to avoid sending the
    # full live video stream. The PTZ publisher is full-resolution 16:9 video,
    # so resize the JPEGs at the snapshot writer boundary before Node ever reads
    # and fans them out over Socket.IO.
    FILTER="fps=1,scale=480:-2"
    QUALITY="10"
    ;;
esac

exec ffmpeg -hide_banner -loglevel warning -nostdin -y \
  -i "srt://127.0.0.1:9000?streamid=read:${PATH_NAME}" \
  -an \
  -vf "$FILTER" \
  -q:v "$QUALITY" \
  -update 1 \
  "${SNAP_DIR}/${PATH_NAME}.jpg"
