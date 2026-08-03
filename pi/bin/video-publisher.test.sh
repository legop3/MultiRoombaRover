#!/usr/bin/env bash
# Video Publisher Transport Tests
# Purpose: Pins which transport the publisher uses and that reporting it can never stop video.
# Scope: resolve_transport and write_transport_state; the encoding pipeline is identical across
# transports by construction, so only the output arguments differ.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/video-publisher.sh"
FAILURES=0

extract() {
  sed -n "/^$1()/,/^}/p" "$SRC"
}

pass() { printf 'ok   %-52s -> %s\n' "$1" "$2"; }
fail() { printf 'FAIL %-52s -> %s (expected %s)\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); }

expect_transport() {
  local expected="$1" desc="$2" env="$3"
  local actual
  actual="$(
    eval "$env"
    eval "$(extract resolve_transport)"
    resolve_transport 2>/dev/null
  )"
  [[ "$actual" == "$expected" ]] && pass "$desc" "$actual" || fail "$desc" "$actual" "$expected"
}

echo "=== transport selection ==="
# RTSP is the default because it is the fastest transport every current rover can run, and the
# URL is derived from the rover name so it needs no per-rover configuration.
expect_transport rtsp   "unset defaults to rtsp"            'ROVERD_VIDEO_TRANSPORT='
expect_transport rtsp   "rtsp explicitly"                   'ROVERD_VIDEO_TRANSPORT=rtsp'
expect_transport whip   "whip when asked for"                'ROVERD_VIDEO_TRANSPORT=whip'
expect_transport mpegts "mpegts restores the old behaviour"  'ROVERD_VIDEO_TRANSPORT=mpegts'
expect_transport mpegts "srt is an alias for mpegts"         'ROVERD_VIDEO_TRANSPORT=srt'
# A typo must cost latency at worst, never the stream.
expect_transport rtsp   "unknown value falls back to rtsp"   'ROVERD_VIDEO_TRANSPORT=banana'

echo ""
echo "=== transport reporting ==="

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT

run_writer() {
  (
    set -euo pipefail
    ROVERD_MEDIA_STATE_DIR="$1"
    eval "$(extract write_transport_state)"
    write_transport_state "$2"
  )
}

# The directory is created when absent, because /run/roverd does not exist on a fresh boot.
if run_writer "${STATE_DIR}/nested" rtsp && grep -qx "transport=rtsp" "${STATE_DIR}/nested/video-transport"; then
  pass "records the transport, creating the directory" "transport=rtsp"
else
  fail "records the transport, creating the directory" "missing" "transport=rtsp"
fi

# THE ASSERTION THAT MATTERS. Reporting is cosmetic and must never take video down. The publisher
# runs under `set -e`, so an unguarded failure here would kill the pipeline over a status file.
UNWRITABLE="${STATE_DIR}/unwritable"
mkdir -p "$UNWRITABLE"
chmod 500 "$UNWRITABLE"
if run_writer "$UNWRITABLE" rtsp >/dev/null 2>&1; then
  pass "unwritable state dir does not fail the publisher" "survived"
else
  fail "unwritable state dir does not fail the publisher" "nonzero exit" "success"
fi
chmod 700 "$UNWRITABLE"

# Same requirement when the path cannot be a directory at all.
BLOCKED="${STATE_DIR}/blocked"
: > "$BLOCKED"
if run_writer "$BLOCKED" rtsp >/dev/null 2>&1; then
  pass "state path blocked by a file does not fail" "survived"
else
  fail "state path blocked by a file does not fail" "nonzero exit" "success"
fi

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "all video transport tests passed"
else
  echo "${FAILURES} test(s) failed"
  exit 1
fi
