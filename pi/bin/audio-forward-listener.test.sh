#!/usr/bin/env bash
# Audio Forward Listener Tests
# Purpose: Pins which URL the rover reads SPEAKER audio from - audio the server produces, such as
# TTS, bonk, a VIP upload, or a driver's forwarded microphone. Not the rover's own microphone,
# which is audio-only-publisher.sh.
# Scope: resolve_forward_transport, forward_url_for, write_forward_transport_state.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/audio-forward-listener.sh"
FAILURES=0

SRT_URL='srt://host:9000?streamid=#!::r=rover-fwd,m=request'
RTSP_URL='rtsp://host:8554/rover-fwd'

extract() {
  sed -n "/^$1()/,/^}/p" "$SRC"
}

pass() { printf 'ok   %-52s -> %s\n' "$1" "$2"; }
fail() { printf 'FAIL %-52s\n     got      %s\n     expected %s\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); }

expect_transport() {
  local expected="$1" desc="$2" env="$3"
  local actual
  actual="$(
    eval "$env"
    eval "$(extract resolve_forward_transport)"
    resolve_forward_transport 2>/dev/null
  )"
  [[ "$actual" == "$expected" ]] && pass "$desc" "$actual" || fail "$desc" "$actual" "$expected"
}

expect_url() {
  local expected="$1" desc="$2" transport="$3"
  local actual
  actual="$(
    ROVERD_AUDIO_PLAYBACK_RTSP_URL="$RTSP_URL"
    ROVERD_AUDIO_PLAYBACK_FORWARD_URL="$SRT_URL"
    eval "$(extract forward_url_for)"
    forward_url_for "$transport" 2>/dev/null
  )"
  [[ "$actual" == "$expected" ]] && pass "$desc" "ok" || fail "$desc" "$actual" "$expected"
}

echo "=== speaker transport selection ==="
# There is no whip option here: the rover READS this stream and WHIP publishes. The read-side
# equivalent would be WHEP, which ffmpeg cannot consume.
expect_transport rtsp   "unset defaults to rtsp"                'ROVERD_AUDIO_PLAYBACK_TRANSPORT='
expect_transport rtsp   "rtsp explicitly"                       'ROVERD_AUDIO_PLAYBACK_TRANSPORT=rtsp'
expect_transport mpegts "mpegts restores the old behaviour"      'ROVERD_AUDIO_PLAYBACK_TRANSPORT=mpegts'
expect_transport mpegts "srt is an alias for mpegts"             'ROVERD_AUDIO_PLAYBACK_TRANSPORT=srt'
expect_transport rtsp   "whip is not selectable, falls to rtsp"  'ROVERD_AUDIO_PLAYBACK_TRANSPORT=whip'
expect_transport rtsp   "unknown value falls back to rtsp"       'ROVERD_AUDIO_PLAYBACK_TRANSPORT=banana'

echo ""
echo "=== read URL for the chosen transport ==="
expect_url "$RTSP_URL" "rtsp reads the rtsp url" rtsp
expect_url "$SRT_URL"  "mpegts reads the srt url" mpegts

echo ""
echo "=== transport reporting ==="

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT

run_writer() {
  (
    set -euo pipefail
    ROVERD_MEDIA_STATE_DIR="$1"
    eval "$(extract write_forward_transport_state)"
    write_forward_transport_state "$2"
  )
}

if run_writer "${STATE_DIR}/nested" rtsp && grep -qx "transport=rtsp" "${STATE_DIR}/nested/audio-playback-transport"; then
  pass "records to audio-playback-transport" "transport=rtsp"
else
  fail "records to audio-playback-transport" "missing" "transport=rtsp"
fi

# Reporting must never silence the rover speaker: this script runs under `set -e`.
UNWRITABLE="${STATE_DIR}/unwritable"
mkdir -p "$UNWRITABLE"
chmod 500 "$UNWRITABLE"
if run_writer "$UNWRITABLE" rtsp >/dev/null 2>&1; then
  pass "unwritable state dir does not fail the listener" "survived"
else
  fail "unwritable state dir does not fail the listener" "nonzero exit" "success"
fi
chmod 700 "$UNWRITABLE"

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "all audio forward listener tests passed"
else
  echo "${FAILURES} test(s) failed"
  exit 1
fi
