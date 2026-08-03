#!/usr/bin/env bash
# Static ffmpeg Installer Tests
# Purpose: Pins the arch mapping, the version discovery, and the WHIP verification - so the
# installer cannot install an ffmpeg that lacks the muxer it was downloaded for, and cannot
# claim support on an architecture where no such build exists.
# Scope: Pure functions only. No download and no install; the network case is a separate
# opt-in check below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0

source "${HERE}/common.sh"
source "${HERE}/ffmpeg_static.sh"

pass() { printf 'ok   %-54s -> %s\n' "$1" "$2"; }
fail() { printf 'FAIL %-54s -> %s (expected %s)\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); }

expect_arch() {
	local expected="$1" machine="$2" desc="$3"
	local actual
	# uname is shadowed rather than the real one being trusted, so every architecture can be
	# exercised from one machine.
	actual="$(
		uname() { [[ "${1:-}" == "-m" ]] && printf '%s' "$machine" || command uname "$@"; }
		ffmpeg_static_arch || printf 'UNSUPPORTED'
	)"
	[[ "$actual" == "$expected" ]] && pass "$desc" "$actual" || fail "$desc" "$actual" "$expected"
}

echo "=== architecture mapping ==="
expect_arch linuxarm64  aarch64 "aarch64 (64-bit Raspberry Pi OS)"
expect_arch linuxarm64  arm64   "arm64 alias"
expect_arch linux64     x86_64  "x86_64 (laptop rover profile)"
expect_arch linux64     amd64   "amd64 alias"
# The assertion that matters most on this list. A 32-bit Pi OS reports armv7l, and no static
# build at ffmpeg >= 7.1 exists for it, so claiming support would install something that cannot
# do WHIP. Those rovers stay on RTSP, which is the default and needs only ffmpeg 4.x+.
expect_arch UNSUPPORTED armv7l  "armv7l (32-bit Pi OS) is refused, not guessed"
expect_arch UNSUPPORTED armv6l  "armv6l (Pi Zero W v1) is refused"
expect_arch UNSUPPORTED riscv64 "an unknown arch is refused rather than defaulted"

echo ""
echo "=== WHIP verification ==="
# The installer's whole purpose is WHIP, so a binary that cannot mux it must be rejected before
# it is linked into PATH.
if ffmpeg_supports_whip /bin/true; then
	fail "a non-ffmpeg binary is not reported as whip-capable" "yes" "no"
else
	pass "a non-ffmpeg binary is not reported as whip-capable" "no"
fi
if ffmpeg_supports_whip /nonexistent/ffmpeg; then
	fail "a missing binary is not reported as whip-capable" "yes" "no"
else
	pass "a missing binary is not reported as whip-capable" "no"
fi

# Against the ffmpeg actually on this machine, whatever it is: the point is that the answer
# matches what ffmpeg itself reports, not that this machine happens to have a new build.
if command -v ffmpeg >/dev/null 2>&1; then
	expected="no"
	ffmpeg -hide_banner -muxers 2>/dev/null | grep -qE '^\s*E\s+whip\b' && expected="yes"
	actual="no"
	ffmpeg_supports_whip "$(command -v ffmpeg)" && actual="yes"
	[[ "$actual" == "$expected" ]] \
		&& pass "agrees with the local ffmpeg's own muxer list" "$actual" \
		|| fail "agrees with the local ffmpeg's own muxer list" "$actual" "$expected"

	# 7.1 is the floor for the whip muxer, so the version code has to order correctly across it.
	code="$(ffmpeg_version_code "$(command -v ffmpeg)")"
	if [[ -n "$code" ]] && (( code >= 400 )); then
		pass "version code parses to something comparable" "$code"
	else
		fail "version code parses to something comparable" "${code:-empty}" ">=400"
	fi
	if (( code >= 701 )) && [[ "$expected" == "no" ]]; then
		fail "version >= 7.1 implies a whip muxer" "$code with no whip" "consistent"
	else
		pass "version and whip support are consistent" "$code/$expected"
	fi
else
	echo "skip  no local ffmpeg to compare against"
fi

echo ""
echo "=== version discovery (network; skipped unless FFMPEG_STATIC_NET_TEST=1) ==="
if [[ "${FFMPEG_STATIC_NET_TEST:-0}" == "1" ]]; then
	for arch in linuxarm64 linux64; do
		url="$(ffmpeg_static_latest_asset "$arch")"
		# Must be a versioned release build, never a "master" snapshot, and must match the arch
		# asked for - picking the wrong arch would install a binary that cannot execute.
		if [[ "$url" =~ ffmpeg-n[0-9]+\.[0-9]+-latest-${arch}-gpl-[0-9]+\.[0-9]+\.tar\.xz$ ]]; then
			pass "resolves a stable versioned build for ${arch}" "$(basename "$url")"
		else
			fail "resolves a stable versioned build for ${arch}" "${url:-empty}" "ffmpeg-nX.Y-latest-${arch}-gpl-X.Y.tar.xz"
		fi
		if [[ "$url" == *master* ]]; then
			fail "does not pick a master snapshot for ${arch}" "$url" "a release branch"
		else
			pass "does not pick a master snapshot for ${arch}" "ok"
		fi
	done
else
	echo "skip  set FFMPEG_STATIC_NET_TEST=1 to check the live release listing"
fi

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
	echo "all static ffmpeg installer tests passed"
else
	echo "${FAILURES} test(s) failed"
	exit 1
fi
