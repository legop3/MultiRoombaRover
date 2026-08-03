#!/usr/bin/env bash
#
# Installer entry point for roverd hosts.
#
# The detailed work lives in pi/install/*.sh so platform-specific setup stays
# local to the profile that needs it. This file should read like the install
# order: choose a profile, validate inputs, install shared roverd pieces,
# install profile support, then enable the services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

# The helper scripts use repository-relative paths because those same paths are
# shown in docs and logs. Moving to the repository root once keeps every module
# simple and prevents each function from needing its own path resolver.
cd "$REPO_ROOT"

source pi/install/common.sh
source pi/install/profiles.sh
source pi/install/self_update.sh
source pi/install/pi_profile.sh
source pi/install/debian_laptop_profile.sh
source pi/install/media_env.sh
source pi/install/systemd.sh
source pi/install/ffmpeg_static.sh

main() {
	parse_args "$@"
	select_profile
	require_root
	validate_install_inputs

	install_roverd_binary
	install_self_update_support
	install_roverd_config
	install_roverd_unit

	install_selected_profile

	# After the profile, so the apt ffmpeg is already present and the static build overrides a
	# known-good baseline rather than being the only ffmpeg on the box.
	if [[ "${INSTALL_FFMPEG_STATIC:-0}" == "1" ]]; then
		install_ffmpeg_static
	fi

	install_media_units
	write_media_env_placeholder
	install_audio_fifo
	enable_and_restart_units

	# Reported on every install, not only when --ffmpeg-static was passed. The transports this
	# rover can use depend entirely on which ffmpeg is on PATH, and finding that out from the
	# install log beats finding out from a rover that will not publish.
	report_ffmpeg_capabilities ffmpeg || true

	log "Install complete for profile $PROFILE"
}

main "$@"
