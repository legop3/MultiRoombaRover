#!/usr/bin/env bash
#
# Installs a static ffmpeg build new enough to have the WHIP muxer.
#
# Why this exists: WHIP is the fastest transport measured (27ms against 39ms for RTSP/TCP, and
# far steadier), but the muxer landed in ffmpeg 7.1 and Raspberry Pi OS bookworm ships 5.1. apt
# will not get you there, so the only route is a static build.
#
# Why this source: it is the only one publishing versioned static Linux builds at or above 7.1.
# Checked at the time of writing - johnvansickle.com, the other well-known mirror, is on 7.0.2
# for its release build and its git snapshot is from June 2024, both of which predate WHIP.
#
# This is a network fetch of a third-party binary, so it is opt-in via --ffmpeg-static rather
# than something every install silently does, and the version is verified after installing
# rather than assumed.

FFMPEG_STATIC_REPO="${FFMPEG_STATIC_REPO:-BtbN/FFmpeg-Builds}"
FFMPEG_STATIC_PREFIX="${FFMPEG_STATIC_PREFIX:-/opt/roverd-ffmpeg}"
# /usr/local/bin precedes /usr/bin in a default PATH, so linking here overrides the apt ffmpeg
# for the publisher scripts without removing it - the apt build stays as a fallback.
FFMPEG_STATIC_BINDIR="${FFMPEG_STATIC_BINDIR:-/usr/local/bin}"

# Maps uname -m onto the asset naming this source uses.
#
# armhf is deliberately unsupported and says so. A 32-bit Raspberry Pi OS reports armv7l, and
# no current static build at 7.1+ exists for it from any source checked - so a 32-bit rover
# cannot have WHIP, and the honest answer is to say that rather than install something that
# will not work. Those rovers stay on RTSP, which is the default anyway and needs ffmpeg 4.x+.
ffmpeg_static_arch() {
	case "$(uname -m)" in
		aarch64 | arm64) printf 'linuxarm64' ;;
		x86_64 | amd64) printf 'linux64' ;;
		*) return 1 ;;
	esac
}

# Picks the highest stable release-branch build for this architecture.
#
# The asset names look like ffmpeg-n8.1-latest-linuxarm64-gpl-8.1.tar.xz. Deriving the version
# from the listing rather than hardcoding one means this keeps working when 8.2 lands, and the
# "master" builds are excluded on purpose: those are snapshots, not stable releases.
ffmpeg_static_latest_asset() {
	local arch="$1"
	curl -fsSL --max-time 60 "https://api.github.com/repos/${FFMPEG_STATIC_REPO}/releases/latest" |
		grep -oE "\"browser_download_url\": *\"[^\"]*ffmpeg-n[0-9]+\.[0-9]+-latest-${arch}-gpl-[0-9]+\.[0-9]+\.tar\.xz\"" |
		sed -E 's/.*"(https[^"]+)"/\1/' |
		sort -V |
		tail -1
}

# Reports the ffmpeg version as a comparable integer, e.g. 7.1 -> 701, 8.1 -> 801.
ffmpeg_version_code() {
	local bin="$1" raw
	raw="$("$bin" -hide_banner -version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)" || return 1
	[[ -n "$raw" ]] || return 1
	printf '%d' "$(( ${raw%%.*} * 100 + ${raw##*.} ))"
}

# THE CHECK THE INSTALL IS FOR. A build that cannot mux WHIP is not worth installing, so this
# runs the binary and asks it, rather than trusting the version number or the filename.
ffmpeg_supports_whip() {
	local bin="$1"
	[[ -x "$bin" ]] || return 1
	"$bin" -hide_banner -muxers 2>/dev/null | grep -qE '^\s*E\s+whip\b'
}

# Reports what a given ffmpeg can do for each transport this project uses. Called after
# installing, and also on its own so an operator can check an existing install.
report_ffmpeg_capabilities() {
	local bin="${1:-ffmpeg}"
	if ! command -v "$bin" >/dev/null 2>&1 && [[ ! -x "$bin" ]]; then
		log "ffmpeg not found at '${bin}'"
		return 1
	fi
	local version muxers
	version="$("$bin" -hide_banner -version 2>/dev/null | head -1)"
	muxers="$("$bin" -hide_banner -muxers 2>/dev/null)"
	log "ffmpeg in use: $(command -v "$bin" 2>/dev/null || printf '%s' "$bin")"
	log "  ${version:-unknown version}"
	if grep -qE '^\s*E\s+whip\b' <<<"$muxers"; then
		log "  whip   YES - the lowest-latency transport is available (transport: whip)"
	else
		log "  whip   no  - needs ffmpeg >= 7.1; rovers stay on RTSP, which is the default"
	fi
	if grep -qE '^\s*E\s+rtsp\b' <<<"$muxers"; then
		log "  rtsp   YES - the default transport is available"
	else
		# This would be unusual and is worth shouting about, because rtsp is the default
		# transport and there is no automatic fallback to mpegts.
		log "  rtsp   NO  - the DEFAULT transport is unavailable. Set transport: mpegts in"
		log "              /etc/roverd.yaml or this rover will not publish."
	fi
}

install_ffmpeg_static() {
	local arch
	if ! arch="$(ffmpeg_static_arch)"; then
		log "WARNING: no static ffmpeg build available for $(uname -m)."
		log "         WHIP needs ffmpeg >= 7.1 and no static 32-bit build at that version exists."
		log "         This rover can still use RTSP, which is the default and needs only ffmpeg 4.x+."
		log "         To get WHIP on a Pi, reinstall with 64-bit Raspberry Pi OS."
		return 0
	fi

	# Idempotent: an existing install that already muxes WHIP is left alone, so re-running the
	# installer does not re-download 100MB.
	if ffmpeg_supports_whip "${FFMPEG_STATIC_BINDIR}/ffmpeg"; then
		log "Static ffmpeg already installed and supports whip; skipping download"
		report_ffmpeg_capabilities "${FFMPEG_STATIC_BINDIR}/ffmpeg"
		return 0
	fi

	log "Resolving the latest stable static ffmpeg for ${arch}..."
	local url
	if ! url="$(ffmpeg_static_latest_asset "$arch")" || [[ -z "$url" ]]; then
		log "WARNING: could not resolve a static ffmpeg download for ${arch}; leaving the existing ffmpeg in place"
		return 0
	fi
	log "  ${url}"

	local tmp
	tmp="$(mktemp -d)"
	# Trapped rather than cleaned at each exit point: the download is ~100MB and leaving it in
	# /tmp on a Pi's small root filesystem is a real cost.
	trap 'rm -rf "$tmp"' RETURN

	if ! curl -fL --max-time 900 -o "${tmp}/ffmpeg.tar.xz" "$url"; then
		log "WARNING: static ffmpeg download failed; leaving the existing ffmpeg in place"
		return 0
	fi
	if ! tar -xJf "${tmp}/ffmpeg.tar.xz" -C "$tmp"; then
		log "WARNING: static ffmpeg archive could not be extracted; leaving the existing ffmpeg in place"
		return 0
	fi

	local extracted
	extracted="$(find "$tmp" -mindepth 2 -maxdepth 2 -type d -name bin | head -1)"
	if [[ -z "$extracted" || ! -x "${extracted}/ffmpeg" ]]; then
		log "WARNING: no ffmpeg binary in the downloaded archive; leaving the existing ffmpeg in place"
		return 0
	fi

	# Verified BEFORE it is linked into PATH. Installing a build that cannot do the one thing it
	# was downloaded for, and only finding out when a rover fails to publish, is the outcome this
	# ordering exists to prevent.
	if ! ffmpeg_supports_whip "${extracted}/ffmpeg"; then
		log "WARNING: the downloaded ffmpeg does not report a whip muxer. NOT installing it."
		log "         The existing ffmpeg is untouched and this rover stays on RTSP."
		return 1
	fi

	log "Installing to ${FFMPEG_STATIC_PREFIX}..."
	rm -rf "${FFMPEG_STATIC_PREFIX}.old"
	[[ -d "$FFMPEG_STATIC_PREFIX" ]] && mv "$FFMPEG_STATIC_PREFIX" "${FFMPEG_STATIC_PREFIX}.old"
	mkdir -p "$FFMPEG_STATIC_PREFIX"
	cp "${extracted}/ffmpeg" "${FFMPEG_STATIC_PREFIX}/ffmpeg"
	[[ -x "${extracted}/ffprobe" ]] && cp "${extracted}/ffprobe" "${FFMPEG_STATIC_PREFIX}/ffprobe"
	chmod 0755 "${FFMPEG_STATIC_PREFIX}/ffmpeg"
	[[ -f "${FFMPEG_STATIC_PREFIX}/ffprobe" ]] && chmod 0755 "${FFMPEG_STATIC_PREFIX}/ffprobe"

	mkdir -p "$FFMPEG_STATIC_BINDIR"
	ln -sfn "${FFMPEG_STATIC_PREFIX}/ffmpeg" "${FFMPEG_STATIC_BINDIR}/ffmpeg"
	[[ -f "${FFMPEG_STATIC_PREFIX}/ffprobe" ]] && ln -sfn "${FFMPEG_STATIC_PREFIX}/ffprobe" "${FFMPEG_STATIC_BINDIR}/ffprobe"

	# Re-checked through the symlink, because that is the path the publishers will actually
	# resolve. If it fails here the links come straight back out, so the rover falls back to the
	# apt ffmpeg rather than being left with a broken one.
	if ! ffmpeg_supports_whip "${FFMPEG_STATIC_BINDIR}/ffmpeg"; then
		log "WARNING: the installed ffmpeg failed verification through ${FFMPEG_STATIC_BINDIR}; reverting"
		rm -f "${FFMPEG_STATIC_BINDIR}/ffmpeg" "${FFMPEG_STATIC_BINDIR}/ffprobe"
		[[ -d "${FFMPEG_STATIC_PREFIX}.old" ]] && { rm -rf "$FFMPEG_STATIC_PREFIX"; mv "${FFMPEG_STATIC_PREFIX}.old" "$FFMPEG_STATIC_PREFIX"; }
		return 1
	fi
	rm -rf "${FFMPEG_STATIC_PREFIX}.old"

	log "Static ffmpeg installed and verified."
	report_ffmpeg_capabilities "${FFMPEG_STATIC_BINDIR}/ffmpeg"
	log "WHIP is available but not automatic. To use it, set in /etc/roverd.yaml:"
	log "    media.video.transport: whip"
	log "    media.audioCapture.transport: whip"
	log "  then restart the media services. See docs/media-transports.md."
	return 0
}
