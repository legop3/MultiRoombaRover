#!/usr/bin/env bash
set -euo pipefail
log() { echo "$*"; }
apt-get update
apt-get install -y flite espeak python3 curl xz-utils unzip alsa-utils libc++1 libc++abi1
install_google_tts_assets() {
	local asset_dir="/var/lib/roverd/googletts"
	local voice_dir="${asset_dir}/en-us-x-multi-r30"
	local dist_url="https://storage.googleapis.com/chromeos-localmirror/distfiles/googletts-26.5.tar.xz"
	local tmp_dir
	local lib_member=""
	local member

	if [[ -f "${asset_dir}/libchrometts.so" && -f "${voice_dir}/pipeline.pb" ]]; then
		log "Google Chrome TTS assets already installed; skipping download"
		return
	fi

	tmp_dir="$(mktemp -d)"
	log "Downloading Google Chrome TTS assets for this architecture..."
	if ! curl -L -o "${tmp_dir}/googletts-26.5.tar.xz" "$dist_url"; then
		rm -rf "$tmp_dir"
		log "WARNING: failed to download Google Chrome TTS assets; chromegtts will be unavailable"
		return
	fi

	local -a candidate_libs=()
	case "$(dpkg --print-architecture)" in
		arm64)
			candidate_libs=(libchrometts_arm64.so)
			;;
		armhf)
			if [[ "$(uname -m)" == armv6l ]]; then
                log "Chrome TTS has no ARMv6 library; use flite or espeak on this host"
                rm -rf "$tmp_dir"
                return
            fi
            candidate_libs=(libchrometts_armv7.so)
			;;
		amd64)
			candidate_libs=(libchrometts_x86_64.so libchrometts_amd64.so libchrometts_x64.so libchrometts.so)
			;;
		i386)
			candidate_libs=(libchrometts_x86.so libchrometts_i386.so libchrometts.so)
			;;
		*)
			log "WARNING: unsupported Chrome TTS architecture $(uname -m); skipping Google TTS assets"
			rm -rf "$tmp_dir"
			return
			;;
	esac

	for member in "${candidate_libs[@]}"; do
		if tar -tf "${tmp_dir}/googletts-26.5.tar.xz" "$member" >/dev/null 2>&1; then
			lib_member="$member"
			break
		fi
	done

	if [[ -z "$lib_member" ]]; then
		log "WARNING: no libchrometts library matching $(uname -m) found in Google TTS archive; chromegtts will be unavailable"
		rm -rf "$tmp_dir"
		return
	fi

	if ! tar -xf "${tmp_dir}/googletts-26.5.tar.xz" -C "$tmp_dir" en-us-x-multi.zvoice "$lib_member"; then
		rm -rf "$tmp_dir"
		log "WARNING: failed to unpack Google Chrome TTS assets; chromegtts will be unavailable"
		return
	fi

	install -d -o root -g root -m 0755 "$asset_dir"
	install -o root -g root -m 0644 "${tmp_dir}/${lib_member}" "${asset_dir}/libchrometts.so"
	rm -rf "$voice_dir"
	install -d -o root -g root -m 0755 "$voice_dir"
	unzip -q "${tmp_dir}/en-us-x-multi.zvoice" -d "$voice_dir"
	chown -R root:root "$asset_dir"
	find "$asset_dir" -type d -exec chmod 0755 {} +
	find "$asset_dir" -type f -exec chmod 0644 {} +
	rm -rf "$tmp_dir"
	log "Installed Google Chrome TTS assets to $asset_dir using $lib_member"
}

install_google_tts_assets
