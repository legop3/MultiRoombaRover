# Roverd rework plan and implementation tracker

Status: implementation authorized on 2026-11-16; repository/build, internal GPIO, and JSON/management backend implemented; live management verification and remaining stages pending.

This is the persistent plan and progress record for the roverd rework. Update it as implementation proceeds, recording completed work, decisions, verification evidence, and remaining work. Keep unfinished work unchecked; distinguish implemented behavior from runtime-verified behavior.

## Authorization and working rules

- The user explicitly authorized implementation with `IPI` on 2026-11-16.
- No backward compatibility: no migrations, old-path aliases, legacy fallbacks, or dual protocols. Roverd, server, and WebUI move together.
- Prefer the simplest effective implementation. The behavior below is the intended outcome; avoid adding frameworks or bookkeeping without a concrete need.
- Follow repository verification rules: no new tests unless requested, no automatic full-project checks, and use the smallest useful verification. This development machine is not the deployed server or rover hardware.

## Agreed design

### Repository and builds

- Rename `pi/` to `rover/`; update paths, imports, scripts, build commands, and documentation.
- Replace machine-specific builds and the `debian_laptop` distinction with architecture-specific Linux builds: ARMv6, ARMv7, ARM64, and AMD64.
- Hardware support depends on configuration and available hardware, not a Pi/laptop classification. Remove the existing laptop-specific hardware stubs as part of resolving this split.
- Keep prebuilt binaries committed in `dist/`. No published releases or release bundles are required.
- Detect the installed OS architecture during installation, including 32-bit ARM installations; do not select solely from CPU capability.
- Debian is the target platform across rover hardware.

### Internal Pi GPIO peripheral

- Provide one `piGpio` configuration section, presented as “Pi GPIO peripheral”, with a parent `enabled` switch defaulting to disabled.
- Keep all native GPIO settings inside this section, beneath the parent switch in the editor:
  - Camera servo: enablement, pin, PWM, calibration, limits, and movement settings.
  - Headlight and laser: individual enablement, pin/chip, polarity, and initial state.
  - BRC: enablement, pin/chip, pulse interval, and pulse width.
- Disabling the parent switch disables the entire internal peripheral without probing, initializing, or accessing GPIO resources. Preserve its saved settings for later re-enablement. No Pi GPIO settings remain scattered elsewhere in configuration.
- When enabled, register one internal peripheral named “Pi GPIO”, with a stable ID such as `pi-gpio`, offering only the configured enabled camera-servo/headlight/laser roles.
- Separate peripheral identity and role ownership from the Firmata transport. Use a small common provider interface for external Firmata peripherals and the internal GPIO peripheral, reusing the existing camera-servo and toggle controller interfaces.
- Call GPIO implementations directly in process; do not simulate serial connections or Firmata messages.
- The internal peripheral owns BRC startup and shutdown as an automatic background function, not a fake user-facing control.
- Apply one role-conflict rule across providers: if multiple peripherals advertise the same role, report the providers and leave that role unavailable until corrected. Keep management accessible. Remove the current implicit native-GPIO priority; different roles may come from different peripherals.
- Operational state uses the same `roverState` object regardless of whether its provider is internal GPIO or an external peripheral.
- This runtime switch replaces the machine-specific GPIO build distinction. GPIO being disabled must permit operation on non-Pi hosts without GPIO errors.

### Configuration ownership and saves

- Roverd owns one `/etc/roverd.json` object containing all rover settings and supplies its JSON Schema.
- Include selected media profiles, enablement, devices, and media settings in configuration. Derive runtime values such as complete streaming URLs in roverd.
- Management hello sends current configuration, schema, and available media profiles.
- The server holds these only in memory. Reconnection repopulates them; there is no configuration database or offline change queue.
- Every save transmits the complete configuration object, even when only one field changed.
- Roverd validates the proposed configuration, atomically writes it, acknowledges the save, stops motion and child processes, and restarts. Its next hello reports the configuration actually loaded.
- Invalid submissions return an error without replacing the file.
- No deltas, configuration versions, or rollback system.
- Existing JSON tags omit some settings; do not mistake current hello metadata serialization for a complete configuration representation.

### Communication channels

Control channel:

- Driving and other rover actions, with their acknowledgements.
- Roomba sensor telemetry.
- Complete `roverState` messages.

Management channel (a separate WebSocket):

- Configuration and profile management.
- Reboot and software update commands/results.
- Media process control, status, and output.
- Host statistics.
- Daemon status notices, including autocharge timer notices and watchdog diagnostics.

Classify existing events by purpose rather than moving the entire existing event stream wholesale. Update server handlers and UI consumers along with their producers. Headlight and laser state are operational state, not management.

Start management before hardware initialization so hardware configuration errors remain remotely diagnosable and fixable. Use the existing admin authorization path for management operations. Preserve motion-stop behavior for reboot, update, and configuration restart. Control-connection safety behavior must remain tied to control availability, not be satisfied by a live management connection.

### One current rover state

- Roverd owns one `roverState` JSON object for operational state such as headlight and laser states.
- Send the full object on control connection/reconnection and whenever its contents change.
- The server replaces its current object for that rover and uses that single copy for all consumers and UI updates.
- Remove separate headlight/laser state stores and per-field state events. No patches or deltas.
- Clear current state on disconnect so stale values are not presented as live.
- Roomba telemetry and management status remain separate from `roverState`.

### WebUI

- Reuse the existing React JSON Schema form library for each rover's configuration page.
- “Save to this rover” submits the complete configuration.
- “Apply this field to all rovers” replaces that field in each connected rover's own configuration, then sends each its complete resulting object. Preserve every rover's other settings.
- Show individual results; skip offline rovers without queued changes.
- Include profile selection, custom profile editing, media status/output, reboot, and software update controls.

### Audio devices and ALSA routing

- One audio configuration selects the physical input device and physical output device on every architecture. Input and output may belong to different sound cards; prefer stable ALSA device names over fixed card numbers.
- The microphone streamer uses the selected input. Forwarded audio, TTS, and horn share the selected output, with simultaneous playback and independent volume controls.
- Roverd generates ALSA routing from these settings as part of configuration startup. Supported format conversion belongs in the ALSA routing rather than assuming every device accepts the AIY format.
- Media profiles consume the resulting logical audio devices through the command environment instead of hardcoding physical devices such as `hw:0,0`.
- AIY-specific setup enables the HAT hardware; it uses this same audio configuration and routing system, not a separate set of device settings.
- Audio changes use the ordinary whole-object configuration save/restart flow. Device selection remains in the WebUI configuration, not the bootstrap questionnaire.

### Media profiles

- Keep three accessible YAML catalogs under `rover/profiles/`: video publishing, microphone publishing, and audio playback.
- Each profile has an identifier, name, description, optional `setup` command, and `run` command. Support multiline shell commands and pipelines.
- Read bundled profiles directly from the managed repository checkout. No separate profile installation or registration.
- Allow exactly one custom YAML profile per category under `/etc/roverd/profiles/`, editable through management. These files remain outside the checkout and survive updates.
- JSON configuration selects profiles and supplies settings such as devices, resolution, and bitrate.
- Profiles may contain hardware-specific configurations contributed by rover builders; no plugin API or custom code module is needed for each encoder.
- Preserve Google AIY Voice HAT support as an explicit option, while supporting configurable audio devices on every architecture. Do not treat Pi/ARM as synonymous with AIY hardware or assume sound card zero.
- Audit setup-specific assumptions beyond streamers, including TTS/horn/mixer routing, boot overlays, PWM/I2S pin conflicts, cameras, serial devices, and TTS assets. Generalize where useful and document the exact selections needed for the existing rover in [hardware configuration notes](rover-hardware-config.md).

### Command variables and setup

- Launch commands through a shell. Supply string values through environment variables rather than inserting them into shell source or creating a template language.
- Supply rover name, server host, audio/video devices, media settings, complete publish/playback URLs, and profile working directory to both setup and run commands.
- Example: `ffmpeg -i "$ROVER_VIDEO_DEVICE" … "$ROVER_VIDEO_PUBLISH_URL"`.
- Each profile gets a persistent working directory under `/var/lib/roverd/profiles/` for downloads, builds, and other generated files.
- At every roverd startup, run each selected enabled profile's setup command before its run command. Commands must be safe to repeat.
- No persistent setup-success tracking. Profile changes save configuration and restart roverd, naturally running setup for the newly selected profile.
- Routine streamer retries run only the run command.
- Setup failure is visible and prevents that streamer from launching, without stopping roverd or the other streamers.

### Media supervision and output

- Roverd directly supervises the three media commands as child processes.
- Restart exited commands after a short retry delay. Server restarts and Wi-Fi interruptions are routine retry situations.
- Streamer failure never stops or restarts roverd. Management connection loss does not stop streamers.
- Shutdown stops complete child process groups, including pipelines.
- Capture stdout/stderr and continuously forward output through management while connected. Use bounded buffering so noisy commands or disconnections cannot block streamers or consume unlimited memory.
- No viewer subscriptions or output-demand tracking.
- Remove old streamer systemd services and the code managing them. Systemd supervises only roverd, running as root.

### Standalone bootstrap

The bootstrap script works without an existing repository on the rover:

1. Install basic Debian prerequisites.
2. Clone the repository into `/opt/roverd`.
3. Invoke the checkout's installation script.
4. Automatically select the committed binary matching the installed OS architecture.
5. Create initial configuration and working directories.
6. Install and start the single root roverd service.

Ask for only rover name and server address. Everything else starts with defaults and is configured through management; no camera, encoder, audio, or machine-profile questionnaire.

`/opt/roverd` belongs to roverd and is not a development working directory. Profile setup handles hardware-specific dependencies.

### Self-update

- Use a helper that survives roverd restarting.
- Update the managed checkout, invoke the same installation script used by bootstrap, install the matching committed binary, and restart roverd.
- Bundled profiles update with the checkout. Preserve local JSON configuration, custom profiles, and persistent profile working directories.
- Forward progress through management while available and make the update result available after reconnection.
- Routine updates restart the service without rebooting the computer.

## Implementation checklist

The order below is a working sequence, not a requirement to leave incompatible intermediate states deployed.

- [x] Receive explicit `IPI` before code implementation (2026-11-16).
- [x] Rename `pi/` to `rover/` and update references.
- [x] Replace machine-specific build targets/tags with architecture-specific artifacts and resolve hardware support split.
- [x] Group every native GPIO setting under the disabled-by-default Pi GPIO peripheral switch in the current configuration and samples.
- [ ] Expose the grouped Pi GPIO configuration in the new JSON schema/UI.
- [x] Register Pi GPIO through the common peripheral provider path, including BRC lifecycle ownership and uniform role-conflict handling.
- [ ] Connect peripheral operational state to the new shared `roverState` object.
- [x] Gate GPIO provider registration, initialization, and BRC startup behind the parent switch; retain saved child settings. Hardware validation remains pending.
- [x] Implement complete JSON configuration serialization, schema, validation, atomic saves, and restart flow (live save/reconnect verification pending).
- [x] Implement separate management connection and in-memory server management state.
- [x] Move reboot, update, media management, host statistics, and daemon status messages to management; update consumers. Preserve the separately authorized user reboot path.
- [x] Separate management lifecycle from hardware startup failures (deployment verification pending).
- [ ] Implement full-object `roverState` and consolidate server/UI operational-state consumers.
- [ ] Add bundled YAML catalogs and one custom YAML profile per media category.
- [ ] Preserve AIY HAT as an explicit profile and expose ordinary audio-device selection on every architecture, including TTS/horn/mixer paths.
- [ ] Generate ALSA routing from shared input/output selections; connect microphone, TTS, horn, forwarded audio, and independent volume controls to the resulting logical devices.
- [ ] Document exact configuration for the existing AIY rover and audit other machine-specific assumptions.
- [ ] Implement command environments, persistent working directories, and setup on each daemon startup.
- [ ] Replace media systemd management with child-process supervision and continuous bounded output forwarding.
- [x] Implement per-rover schema editor and complete-object saves (browser/live verification pending).
- [x] Implement apply-one-field-to-all-connected-rovers with individual results (browser/live verification pending).
- [ ] Add profile editing/selection, media output/status, reboot, and update UI.
- [ ] Implement standalone bootstrap with only name/address input and automatic OS architecture selection.
- [ ] Implement shared checkout installation and self-update with reconnect-visible results.
- [ ] Remove obsolete services, configuration files, scripts, build distinctions, and documentation.
- [ ] Update user/contributor documentation, including profile variables, setup expectations, building, installation, and updates.
- [ ] Perform focused available verification and record results below.
- [ ] Record deployment/hardware checks still required; do not claim those verified locally.

## Verification record

2026-11-16, foundation stage:

- Focused existing peripheral tests passed: `go test . -run 'Test(DisabledNativeRolesResolveToFirmataOnEveryHostBuild|MissingNativeAndFirmataRolesRemainDisabled|ConflictingRolesRemainUnavailableWithoutInitializingGPIO|Peripheral)' -count=1` in `rover/roverd`. Adapted existing expectations for the deliberately changed config/role-conflict behavior; no new test files were created. These exercise Firmata behavior, parent-disabled selection with enabled saved children, and conflicts that must not initialize native hardware.
- An initial test invocation from the repository root failed because the Go module is under `rover/roverd`; reran from that module as above.
- Architecture builds passed for ARMv6, ARMv7, ARM64, and AMD64. Regenerated all four artifacts after final shutdown/error-handling corrections; all builds passed.
- `git diff --check` passed for tracked changes.
- `bash -n rover/install/profiles.sh` passed. Actual installation was not run on this development machine.
- GPIO electrical behavior, BRC timing, and AIY audio remain unverified on hardware. On the actual rover, check startup inventory/role conflicts and exercise configured light/servo/BRC outputs; capture journal output and observed behavior.


Record each meaningful check with the affected behavior, command or action, result, and limitations. In particular, distinguish local evidence from actual rover/server verification of connection recovery, motion stopping, process cleanup, media streaming, and updates.

## Progress and decisions

- 2026-11-15: Consolidated the agreed design and user corrections into this persistent tracker. Implementation is pending `IPI`.
- 2026-11-16: Added the internal Pi GPIO peripheral design after inspecting current role ownership and BRC handling. All native GPIO options belong under one parent enable switch; disabled means no GPIO access. Implementation remains pending `IPI`.
- 2026-11-16: Received `IPI` and started the repository/build and internal GPIO foundation. The user additionally required universal device options while retaining an explicit AIY HAT setup; recorded existing assumptions in `rover-hardware-config.md`.
- Rejected complexity: release publishing, separate profile installation, persistent setup tracking, viewer-dependent output forwarding, and backward compatibility.
- Settled state boundary: operational state uses complete `roverState` objects on control; configuration/host/process/daemon management uses the management connection.

## Remaining implementation details

Resolve these with the simplest approach during implementation and record the result here; they do not change the agreed behavior:

- Exact profile YAML shape, environment variable names, and architecture artifact names.
- Exact management message shapes and remaining existing event classifications.
- Update target selection using the existing repository workflow, without introducing release publishing.
- Startup defaults that let a newly installed rover connect for configuration before its hardware is configured.

### Foundation implementation notes (2026-11-16)

- Added common role providers and the internal `pi-gpio` peripheral. Conflicts and role initialization failures leave that role unavailable while other roles continue; existing hello/controller behavior remains until the communication rework.
- BRC belongs to the internal peripheral and waits for its writer to stop before releasing GPIO. Shutdown interrupts long pulses.
- The installer now chooses the architecture artifact independently of its existing media setup profile. Media setup profiles and YAML config are still the old implementation, pending their planned replacement; this is not a parallel compatibility path.
- Removed obsolete generic/laptop daemon artifacts and the duplicate daemon binary inside the source tree. New architecture binaries live in `dist/`.
- JSON configuration/schema and management backend were subsequently implemented below. Full rework and hardware deployment verification are not complete.

### JSON and management backend (2026-11-16)

- Replaced YAML settings with complete JSON configs, including repository samples and dummy configs. No legacy decoder or migration path. The existing media implementation remains until its planned replacement.
- Added generated draft-7 JSON Schema using `invopop/jsonschema` and validation using `santhosh-tekuri/jsonschema/v6`; retained semantic validation and excluded derived media URLs from persisted configuration.
- Added CLI default/schema export and hardware-free configuration checking. Atomic saves block new control commands, stop motion, acknowledge, unwind hardware, and re-execute roverd.
- Added `/rover/management` and admin Socket.IO read/save/command endpoints. Management state is separate from the control roster, so startup failures do not hide a rover from management.
- Moved host statistics and daemon events (including autocharge notices) to management. Operational toggle events remain on control until the unified state stage.
- Existing admin reboot/update and the user-owned-rover reboot path now use management transport. The existing user authorization/cooldown policy is preserved; generic media management now requires admin access.
- Management hello currently has empty profile catalogs: profiles are not implemented yet. Shared audio-device fields will be introduced with functioning ALSA routing, not exposed as inactive settings.
- See [protocol and deployment checks](roverd-management.md). No live server or rover services were started on this development machine.

Verification for this stage:

- The actual AMD64 daemon's `-check-config` accepted both JSON samples, the checked-in rover config, and the first dummy config. It rejected `{}` with missing-required-property errors before hardware initialization. Schema export also succeeded.
- Syntax checks passed for the new management server service, WebSocket routing, command routing, and control connection handler.
- Refreshed ARMv6, ARMv7, ARM64, and AMD64 artifacts successfully after the final shutdown changes. Server management syntax and tracked diff whitespace checks passed.
- Live acknowledgement/save/restart/reconnect, motion stopping, role authorization, and hardware-failure recovery remain unverified. Follow the deployment checks above and record their results here.

### Handoff after usage-budget notice (2026-11-16)

- Stopped after the JSON/management backend stage; no UI or ALSA implementation started in this stage.
- Final shutdown handling pauses automatic charging, blocks control commands and watchdog recovery, and cancels disconnect actions before stopping motion. If a management action fails before commitment, control and automatic charging resume. Live motion behavior remains unverified.
- Existing media helper scripts, machine-specific installer setup, and Chrome TTS variants are still present intentionally as unfinished rework items, not completed universal audio support.
- Next work: the schema-driven WebUI editor and field-to-all save flow against the documented management API, followed by unified rover state and the media/audio stages. Existing IPI authorization remains in effect.
- No live server/rover processes were launched or left running. No commits were made. Work remains in the shared working tree, including newly added files and generated architecture binaries.

### Apply-field backend (2026-11-16)

- Implemented admin-only `roverManagement:applyField` with object-field paths, independent whole-object submissions, connection-change detection, and individual outcomes. Offline rovers are not queued.
- Node syntax check passed. Live fleet saves remain unverified. WebUI editor and apply-field controls are still pending; the combined checklist item remains unchecked.

### Configuration WebUI (2026-11-16)

- Added `/admin?section=fleet` for admins and lockdown admins, independent of lockdown-only server configuration.
- The page lists management connections, renders the rover-supplied schema, saves complete objects, and lets an administrator select a field from the draft for fleet-wide application with individual results.
- Offline drafts remain mounted; server reconnection refreshes the roster. Authoritative changed configuration replaces the draft. Switching the selected rover starts its form from the latest reported configuration.
- Focused ESLint passed for the new component and AdminApp, after correcting the initial command working directory to `webui`. No full build or browser/server process was started.
- Verify the page against actual server/rover connections: admin access, hardware-failure management visibility, form validation, save/reconnect, and fleet success/error reporting. Production WebUI assets have not been regenerated.
- Configuration UI/backend implementation is now present; end-to-end deployment verification remains pending. Profile/status/output controls, unified rover state, audio/media supervision, and bootstrap/update rework are still separate outstanding stages.

- Placement correction: rover configuration is embedded in the existing fleet management panel alongside the rover roster. Removed the separate administration tab.
