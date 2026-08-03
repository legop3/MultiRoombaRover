#!/usr/bin/env bash
# Audio Capture Transport Tests
# Purpose: Pins which transport the rover MICROPHONE publishes over. Not the speaker path - that
# is audio-forward-listener.sh, which reads audio the server produces.
# Scope: resolve_audio_transport and write_audio_transport_state.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/audio-only-publisher.sh"
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
    eval "$(extract resolve_audio_transport)"
    resolve_audio_transport 2>/dev/null
  )"
  [[ "$actual" == "$expected" ]] && pass "$desc" "$actual" || fail "$desc" "$actual" "$expected"
}

echo "=== microphone transport selection ==="
# RTSP carries an Opus-only stream fine and works on ffmpeg 4.x+, so a rover on bookworm's
# ffmpeg 5.1 gets the improvement without upgrading anything.
expect_transport rtsp   "unset defaults to rtsp"           'ROVERD_AUDIO_CAPTURE_TRANSPORT='
expect_transport rtsp   "rtsp explicitly"                  'ROVERD_AUDIO_CAPTURE_TRANSPORT=rtsp'
expect_transport whip   "whip when asked for"              'ROVERD_AUDIO_CAPTURE_TRANSPORT=whip'
expect_transport mpegts "mpegts restores the old behaviour" 'ROVERD_AUDIO_CAPTURE_TRANSPORT=mpegts'
expect_transport mpegts "srt is an alias for mpegts"        'ROVERD_AUDIO_CAPTURE_TRANSPORT=srt'
expect_transport rtsp   "unknown value falls back to rtsp"  'ROVERD_AUDIO_CAPTURE_TRANSPORT=banana'

echo ""
echo "=== transport reporting ==="

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT

run_writer() {
  (
    set -euo pipefail
    ROVERD_MEDIA_STATE_DIR="$1"
    eval "$(extract write_audio_transport_state)"
    write_audio_transport_state "$2"
  )
}

# Its own file, so it cannot be confused with the video or speaker transport.
if run_writer "${STATE_DIR}/nested" rtsp && grep -qx "transport=rtsp" "${STATE_DIR}/nested/audio-capture-transport"; then
  pass "records to audio-capture-transport" "transport=rtsp"
else
  fail "records to audio-capture-transport" "missing" "transport=rtsp"
fi

# Reporting must never silence the microphone: the publisher runs under `set -e`.
UNWRITABLE="${STATE_DIR}/unwritable"
mkdir -p "$UNWRITABLE"
chmod 500 "$UNWRITABLE"
if run_writer "$UNWRITABLE" rtsp >/dev/null 2>&1; then
  pass "unwritable state dir does not fail the publisher" "survived"
else
  fail "unwritable state dir does not fail the publisher" "nonzero exit" "success"
fi
chmod 700 "$UNWRITABLE"

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "all audio capture transport tests passed"
else
  echo "${FAILURES} test(s) failed"
  exit 1
fi
