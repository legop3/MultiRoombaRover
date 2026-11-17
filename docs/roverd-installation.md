# Rover installation and updates

Download `rover/bootstrap.sh` from the repository onto a Debian-based rover, then run `sudo bash bootstrap.sh`. No preexisting checkout is required. Enter the rover name and full server address, for example `ws://server:8080/rover` or `wss://example.org/rover`.

Bootstrap installs prerequisites, clones into `/opt/roverd`, invokes `rover/install_roverd.sh`, and starts the root roverd service. The checkout is root-owned and dedicated to installation and updates; keep development changes elsewhere. Rerunning bootstrap preserves an existing configuration rather than replacing its identity with the prompt answers.

The shared installer selects AMD64, ARM64, or ARMv6/ARMv7 for a 32-bit ARM OS. A Pi Zero 2 W uses ARM64 on a 64-bit OS and ARMv7 on a 32-bit OS. Binaries come from `dist/` in the repository; no release publishing or on-rover compilation is required.

Fleet Management configures the remaining settings. Media and native GPIO start disabled. Profiles are already in the checkout; selecting one causes its inline setup to run on roverd startup. See [media profiles](rover-media-profiles.md) and [AIY hardware settings](rover-hardware-config.md).

## Updates

The management update action launches `roverd-self-update` as an independent transient systemd service. It fast-forwards the registered checkout, invokes the same installer, and restarts only roverd. A modified/diverged checkout can make Git refuse the update; it is not forcibly reset.

The installer preserves `/etc/roverd.json`, `/etc/roverd/profiles/`, and `/var/lib/roverd/`. Replacing the installed executable and updater uses rename so running processes retain their existing executable/script. Update progress and the last result are atomically written to `/var/lib/roverd/update-status.json`, forwarded through management, and shown in Fleet Management after reconnecting. This reports completion of installation/service restart, not camera or audio health.

For detailed command output use `journalctl -u roverd-self-update`; for daemon startup use `journalctl -u roverd`. Failed update jobs report failure and release the old daemon's pending management action if it is still running. There is no rollback system. If installation fails after changing files, fix the reported error and rerun the installer/update.

## Deployment checks still required

On a fresh rover, run bootstrap and confirm management connects with the supplied identity. Select the hardware profiles and verify their output. Trigger an update and confirm progress, reconnection, final status, and preservation of JSON/custom profiles. Confirm a failed update reports its error and allows another management action. These host/systemd/network flows have not been executed on the development machine.
