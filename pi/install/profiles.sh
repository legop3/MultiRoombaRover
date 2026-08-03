#!/usr/bin/env bash

PROFILE="pi"
BINARY_SRC=""
CONFIG_SRC=""
INSTALL_FFMPEG_STATIC=0

usage() {
	cat <<'USAGE'
Usage: sudo ./pi/install_roverd.sh [options]

Options:
  --profile <name>      Install profile: pi or debian-laptop (default: pi)
  --debian-laptop       Shortcut for --profile debian-laptop
  -b, --binary <path>   Path to the roverd binary (default depends on profile)
  -c, --config <path>   Source config to install if /etc/roverd.yaml is missing
                        (default depends on profile)
  --ffmpeg-static       Download and install a static ffmpeg with the WHIP muxer
                        (~100MB, arm64/x86_64 only). Only needed for transport:
                        whip - the default RTSP transport works on the apt ffmpeg.
  -h, --help            Show this help text

The script must run from the repository root and as root (sudo). It will:
  * create system users/groups if needed
  * install /usr/local/bin/roverd and /etc/roverd.yaml
  * install profile-specific video helpers and shared audio helpers
  * install profile-specific ALSA/system audio setup
  * install the fixed-command self-update helper used by admin-triggered updates
  * enable roverd.service and media publisher/listener services
USAGE
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--profile)
				PROFILE="${2:-}"
				shift 2
				;;
			--debian-laptop)
				PROFILE="debian-laptop"
				shift
				;;
			# Opt-in rather than default: it is a ~100MB fetch of a third-party binary, and the
			# default transport (RTSP) works fine on the apt ffmpeg. Only WHIP needs this.
			--ffmpeg-static)
				INSTALL_FFMPEG_STATIC=1
				shift
				;;
			-b|--binary)
				BINARY_SRC="${2:-}"
				shift 2
				;;
			-c|--config)
				CONFIG_SRC="${2:-}"
				shift 2
				;;
			-h|--help)
				usage
				exit 0
				;;
			*)
				echo "Unknown option: $1" >&2
				usage
				exit 1
				;;
		esac
	done
}

select_profile() {
	case "$PROFILE" in
		pi)
			BINARY_SRC="${BINARY_SRC:-dist/roverd}"
			CONFIG_SRC="${CONFIG_SRC:-pi/roverd/roverd.sample.yaml}"
			VIDEO_HELPER_SRC="pi/bin/video-publisher.sh"
			VIDEO_HELPER_DEST="/usr/local/bin/video-publisher"
			VIDEO_SERVICE_SRC="pi/systemd/video-publisher.service"
			VIDEO_SERVICE_NAME="video-publisher.service"
			ROVERD_GROUPS="dialout,gpio,video,render,audio"
			;;
		debian-laptop)
			BINARY_SRC="${BINARY_SRC:-dist/roverd-debian-laptop}"
			CONFIG_SRC="${CONFIG_SRC:-pi/roverd/roverd.debian-laptop.sample.yaml}"
			VIDEO_HELPER_SRC="pi/bin/debian-laptop-video-publisher.sh"
			VIDEO_HELPER_DEST="/usr/local/bin/debian-laptop-video-publisher"
			VIDEO_SERVICE_SRC="pi/systemd/debian-laptop-video-publisher.service"
			VIDEO_SERVICE_NAME="debian-laptop-video-publisher.service"
			ROVERD_GROUPS="dialout,video,render,audio"
			;;
		*)
			echo "Unknown profile: $PROFILE" >&2
			usage
			exit 1
			;;
	esac
}

install_selected_profile() {
	case "$PROFILE" in
		pi)
			# The Pi profile owns the board-specific camera, PWM, and AIY audio
			# setup. Keeping that hardware work behind this dispatcher prevents
			# the laptop profile from accidentally inheriting Pi overlays or
			# card-index assumptions.
			install_pi_profile
			;;
		debian-laptop)
			# The Debian laptop profile only installs ordinary Debian packages
			# and a laptop ALSA routing file. Anything that depends on Pi GPIO,
			# overlays, or the Google Voice HAT stays out of this path.
			install_debian_laptop_profile
			;;
	esac
}
