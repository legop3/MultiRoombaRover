#!/usr/bin/env bash

install_self_update_support() {
  local quoted_repo_root
  printf -v quoted_repo_root '%q' "$REPO_ROOT"
  printf 'ROVERD_REPO_DIR=%s\n' "$quoted_repo_root" > /etc/roverd-update.env
  chmod 0600 /etc/roverd-update.env
  install -D -o root -g root -m 0755 rover/bin/roverd-self-update.sh /usr/local/sbin/roverd-self-update.new
  # Keep the running updater on its original inode until it exits.
  mv -f /usr/local/sbin/roverd-self-update.new /usr/local/sbin/roverd-self-update
  log "Registered update checkout at $REPO_ROOT"
}
