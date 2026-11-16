#!/usr/bin/env bash
#
# Installer entry point for roverd hosts.
#
# The detailed work lives in rover/install/*.sh so platform-specific setup stays
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

source rover/install/common.sh
source rover/install/profiles.sh
source rover/install/self_update.sh
source rover/install/pi_profile.sh
source rover/install/debian_laptop_profile.sh
source rover/install/media_env.sh
source rover/install/systemd.sh

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
	install_media_units
	write_media_env_placeholder
	install_audio_fifo
	enable_and_restart_units

	log "Install complete for profile $PROFILE"
}

main "$@"
