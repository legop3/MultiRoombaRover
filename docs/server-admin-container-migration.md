# Server administration and container migration

## Status

This document is the live implementation tracker for the migration.

- [x] Phase 1, step 1: Establish the single data-directory contract
- [x] Phase 1, steps 2-5: Configuration database, manual setup-file import, setup, and centralized admin UI
- [ ] Phase 1, steps 6-9: Backup/restore, restart, and internal video proxy
- [ ] Phase 2: Containerization, GHCR publishing, and container lifecycle controls

The single data-directory implementation and local verification are complete. Real snapshot generation, legacy-directory cleanup, and runtime filesystem tracing remain deployment checks for the actual server; they do not leave the implementation step open.

The work is deliberately split into two phases:

1. Finish the server-side configuration, administration, persistence, backup, restore, and media-routing changes while the server still uses its current systemd deployment.
2. Containerize the already-finished application, publish images through GHCR, and add container-aware update and restart controls.

Phase 1 must be complete and verified before Phase 2 begins. Containerization must not become a second configuration migration or a reason to maintain two persistence layouts.

## Decision log

- 2026-09-14: Render the schema-driven configuration editor as a YAML-like tree inside one `CardFrame`. Every object or array introduces an ordered header and one indentation guide, every scalar occupies one key/value row, and array operations remain beside their item instead of moving to the far edge. Keep all route-specific RJSF styling in `webui/src/admin/styles.css`, outside the shared global stylesheet.
- 2026-09-14: Treat container deployment as a fresh installation. Neither startup nor the installer searches for, imports, removes, or otherwise manages an old `config.yaml`; the only old-file path retained is an operator-selected YAML upload on `/setup`. The separate command-line importer and its dry-run mode are removed. Internal SQLite schema migrations remain because they evolve the active database rather than discovering an old installation.
- 2026-09-14: Keep the one-time first-run setup code in `data/setup-code.txt` with owner-only permissions instead of writing the credential into server logs. Reuse it across restarts and delete it permanently when setup completes.
- 2026-09-14: Feature enablement is exactly the service-owned `enabled` boolean. A service-owned configuration definition marks itself with `feature: true` when that switch belongs in the public feature map; the configuration system derives the map for sessions and command availability, including nested service definitions, without a separate feature registry. Missing credentials, hardware, connections, data, or enabled dependencies are runtime health conditions and never silently change that choice.
- 2026-09-14: Keep configuration as one ordered hierarchical document, matching the former YAML layout. The admin application presents one continuous configuration page and saves the complete document as one revision. There are no artificial Hardware, Integrations, Media, or similar configuration categories and no backend or frontend section registries.
- 2026-09-13: Use an internal Node `/video` proxy. The public reverse proxy will send every site path to Node, Node will strip `/video` and stream WHEP signaling to MediaMTX on loopback, and MediaMTX port 8889 will not be exposed publicly. MediaMTX cannot independently add a WHEP base-path prefix; making `video` part of every stream name would still leave two HTTP servers competing for the public HTTPS listener.
- 2026-09-13: Preserve the existing flat `server/data` layout instead of moving established stores into decorative `state`, `cache`, or `generated` parents. Packaged application assets remain with the application.
- 2026-09-13: "The server" in the filesystem rule specifically means the main Node.js application. Every file it intentionally creates or modifies, including disposable scratch work, must be beneath `SERVER_DATA_DIR`. Installers, systemd, Docker, BlueZ, and unavoidable internal behavior of external libraries are outside that application boundary.

## Final goals

- `config.yaml` and `config.example.yaml` no longer exist.
- All operator-controlled server configuration is stored in a validated database and managed through the web UI.
- All mutable runtime state, generated files, caches, snapshots, recordings, and databases live under one server data directory.
- A complete backup can capture that one data directory consistently, and a restore can safely replace it.
- `/setup` may initialize the database from a YAML file explicitly selected by the operator; no automatic host migration exists.
- A dedicated `/admin` application contains all server administration.
- The public `/video` route is proxied to MediaMTX by the Node server, eliminating the special external MediaMTX proxy rule.
- The completed server is packaged as a replaceable container whose only persistent mount is the data directory.
- Release images are built automatically and published to GHCR.
- The admin UI can restart, update, health-check, and roll back the application container without giving the main application direct Docker access.
- The final host installation contains as little project-specific material as possible: a Compose file, a data directory, and unavoidable hardware preparation.

## Important boundary: application files versus server data

The data-directory rule applies to everything mutable or instance-specific that the server reads, writes, generates, or persists at runtime. It does not mean copying the application itself into the data directory.

Packaged, read-only application material remains with the application and later inside the image:

- Server source and production dependencies
- Built web UI assets
- Static sound and image assets shipped by the repository
- MediaMTX, ffmpeg, ffprobe, neolink, and TTS tools
- Kinect and Balance Board workers
- Helper scripts shipped as part of the application

The single data directory owns:

- Server configuration and secrets
- Administrator accounts
- Identity and permission records
- Fleet reports
- Persistent service state
- Audit history
- Generated MediaMTX configuration
- Snapshots and replay segments
- Finished replays
- PTZ-generated audio
- Barcode/TTS caches
- Disposable audio-forward and replay-build work under `runtime/`
- Backup and restore coordination state
- Any future file deliberately created or modified by the Node application

Application-owned scratch work must use `SERVER_DATA_DIR/runtime`, even when it is safe to lose on restart. Tests may use the operating system temporary directory because they are not the running server application. Packaged programs and host services can manage their own internal temporary state, but any output path explicitly selected by Node must follow the single-root rule.

# Phase 1: complete the application before containerization

Phase 1 is server, web UI, installer, and migration work only. The current systemd deployment remains the runtime while these contracts are changed and verified.

## 1. Establish the single data-directory contract

The normal development and legacy-install location remains `server/data`. The path continues to be overridable through `SERVER_DATA_DIR`, which will later be set to `/data` in the container.

A representative final layout is:

```text
server/data/
├── configuration.sqlite
├── identity.sqlite
├── fleet-reports.sqlite
├── mediamtx.yml
├── existing service JSON stores
├── barcode-tts-cache/
├── rover-snapshots/
├── replay-segments/
├── replays/
├── ptz-camera-audio/
├── runtime/
│   ├── audio-forward/
│   ├── replay-builds/
│   └── room-camera-replay-builds/
└── system/
    ├── backup-staging/
    └── restore/
```

The exact number of databases is not important. A centralized admin UI does not require unrelated services to share one SQLite connection. Keeping identity and high-volume fleet reporting in their existing databases may remain simpler, provided every database is under the same data directory.

Required work:

- Audit every server filesystem read and write.
- Make every persistent path resolve from the shared data-path helper.
- Move rover and PTZ snapshots out of `/var/lib/rover-snapshots` and into the data directory.
- Remove separate persistent replay path configuration and keep replay segments and completed replays under the data directory.
- Keep generated MediaMTX configuration at its established `data/mediamtx.yml` path.
- Keep barcode speech, PTZ speech, and similar caches under the data directory.
- Check native workers and child-process scripts for hidden working-directory assumptions.
- Update health reporting to inspect the new paths.
- Update the legacy installer so the service receives one `SERVER_DATA_DIR` rather than several unrelated persistent paths.
- Add a focused test that runs services against a temporary data directory and proves that no test artifact escapes it.
- Document which files are durable and which cache directories may be discarded.

The audit must search direct filesystem calls as well as environment-variable defaults. Existing calls that default to `/var/lib`, the repository directory, or an implicit current working directory must be corrected.

## 2. Replace YAML with a configuration database

Implementation architecture:

- Each configurable service owns a side-effect-free fragment containing its key, safe default, and strict schema. One short composition list assembles those fragments into the ordered hierarchical document.
- The database validates and commits that complete document as one coherent immutable revision.
- The admin UI presents one continuous configuration page in the same top-to-bottom order as the former YAML file.
- Nested cards make object relationships readable, but do not create separate categories, navigation destinations, persistence boundaries, or registries.
- Shared editor infrastructure owns loading, dirty state, validation errors, revision conflicts, secret operations, and restart-required status for the whole document.
- The browser receives this same schema from the protected admin endpoint and renders it with a maintained JSON Schema form library.
- Standard JSON Schema types drive ordinary fields, nested objects, enums, and arrays. One field-agnostic widget handles every `writeOnly` secret; there are no feature-specific configuration components in React.

Create a synchronous configuration service backed by `better-sqlite3`. Synchronous reads preserve the server's current startup model, in which many services load their configuration while modules are required.

The configuration database should own at least:

- The current complete configuration document
- A monotonically increasing configuration revision
- Previous configuration revisions
- The administrator account catalog and password hashes
- Persistent administrative audit events
- Database/schema migration state

The configuration schema must explicitly describe every supported field. A validation library should be used rather than assembling an ad hoc validator by hand.

Current configuration areas to migrate include:

- Server timezone and public instance identity
- Administrator accounts and Discord identities
- Inter-instance directories and profile
- LLM commentary and Overseer Control
- Barcode games
- Media and WebRTC ICE candidates
- Bandwidth-saving policy
- Audio forwarding and global audio levels
- Home Assistant, Neato, lift, entities, and button mappings
- Room cameras and PTZ camera
- Kinect and Balance Board
- Button box and barcode scanner
- Command names
- Discord bot, channels, and roles
- Social links and driver content
- Fleet-report collection, retention, privacy, and delivery

Required behavior:

- A missing value receives a documented safe default.
- Optional integrations default to disabled.
- Unknown fields are rejected rather than silently ignored.
- Invalid configuration never becomes the active revision.
- A complete revision is written atomically.
- Updates include the acting administrator and timestamp.
- Concurrent editors use revision checking so an older browser cannot overwrite a newer change silently.
- Secrets are never included in ordinary configuration responses, logs, diffs, or audit metadata.
- Secret inputs support replace and clear operations without returning the current value to the browser.
- At least one lockdown administrator must always remain.
- An administrator cannot accidentally remove the only account capable of repairing administration.

Configuration changes use one intentionally simple application rule:

1. Validate the complete proposed document.
2. Commit it as a new database revision.
3. Report that an application restart is required.
4. Let the administrator restart immediately or later.
5. Load one coherent configuration snapshot at the next process start.

Operational actions such as changing server mode, locking a rover, or issuing a rover command remain live actions and do not become restart-required configuration edits.

After migration is complete:

- Remove the YAML configuration loader.
- Remove `SERVER_CONFIG`.
- Remove `config.yaml` and `config.example.yaml` from the repository and installation process.
- Remove `js-yaml` if MediaMTX generation is changed to avoid it or if it is otherwise no longer needed. Generated MediaMTX YAML is an internal artifact, not operator configuration, so retaining `js-yaml` solely for that generator is acceptable.

## 3. Add optional configuration-file upload to setup

Container deployment starts with a new data directory and never discovers an old installation automatically. As a convenience, the first-run setup page may initialize the empty database from a YAML configuration file deliberately selected by the operator. This is not a startup loader, installer migration, command-line workflow, or permanent second source of truth.

The setup upload must:

- Accept only an explicitly selected YAML file from `/setup`.
- Require the one-time setup code before processing it.
- Parse the complete document.
- Map every recognized field into the new configuration schema.
- Preserve existing bcrypt administrator password hashes.
- Preserve lockdown roles and Discord IDs.
- Preserve secrets without printing them.
- Apply current defaults for absent fields.
- Report unknown or invalid fields instead of discarding them.
- Validate the entire result before writing anything.
- Refuse to replace an already-configured database.
- Write the configuration, administrators, and audit event atomically.
- Record the uploaded filename without storing secret values in the audit event.

The browser uploads the selected contents directly. The server never scans the host for a file, and it does not retain, watch, remove, or reuse the uploaded YAML after the database transaction completes.

## 4. Add first-run setup

The server must boot safely with an empty data directory and without any YAML file.

Required flow:

1. Initialize the databases and safe default configuration.
2. Keep all optional external integrations disabled.
3. Generate a one-time setup code in `data/setup-code.txt` with owner-only permissions. Logs report the file location but never the credential.
4. Serve a restricted `/setup` application.
5. Require the setup code before creating the first lockdown administrator.
6. Offer manual YAML configuration-file upload as an alternative to creating the first administrator from scratch.
7. Otherwise collect only the minimum information needed to establish the instance.
8. Permanently disable setup after the first lockdown administrator exists.

A recovery command must be available for resetting or creating a lockdown administrator from the server console. Environment variables must not act as a recurring authentication bypass on every boot.

## 5. Build the centralized admin application

Create a dedicated `/admin` route instead of continuing to expand the existing driver-page admin panel.

The application should provide these top-level destinations:

- Overview and service health
- Fleet and rover operations
- Users, administrators, verification, and permissions
- Configuration, presented as one hierarchical page

Overview may include application logs, persistent audit history, configuration revisions, backup and restore, and system restart or later container-update state. These operational views do not divide the configuration document into categories.

Existing components and server operations should be moved or reused rather than duplicated. The identity database page and other isolated administrative pages should become destinations within this centralized application where doing so preserves their existing behavior.

Authorization rules:

- Normal administrators may perform routine fleet operations.
- Lockdown administrators manage accounts, secrets, server configuration, backup restoration, and other destructive operations.
- Sensitive changes require recent password confirmation.
- Server-side authorization remains authoritative for every operation; hiding a control in React is not an access check.

Configuration uses one schema-generated typed form rather than a raw YAML or JSON text editor. Repeatable values such as cameras, entities, links, and buttons receive the form library's generic add, remove, and reorder workflow.

## 6. Implement complete backup and restore

Everything durable living under one data directory makes the backup boundary simple, but copying live SQLite files and JSON files without coordination would not guarantee a consistent backup. The implementation must create a consistent snapshot before archiving it.

### Full backup

The primary admin action is **Download full backup**. A full backup includes the entire durable data payload:

- Configuration and secrets
- Administrator accounts
- Identity and permissions
- Fleet history
- Persistent service state
- Snapshots and replay media
- Generated and cached files that are part of the current server state
- A manifest describing the application and schema versions

The backup service must:

1. Require a lockdown administrator and recent password confirmation.
2. Enter a short maintenance/snapshot state that prevents new persistent mutations.
3. Ask services with buffered state to flush it, stop active audio/replay workers, and clear `runtime/` so FIFOs and incomplete scratch files are never archived.
4. Create consistent SQLite snapshots using SQLite's supported backup/checkpoint facilities rather than copying active WAL files blindly.
5. Copy non-database durable files into temporary staging.
6. Produce a manifest containing creation time, application version, schema versions, included paths, sizes, and checksums.
7. Create the archive in temporary storage and stream it to the browser.
8. Remove temporary staging whether the operation succeeds or fails.
9. Resume normal mutations after the consistent snapshot has been captured; archive compression does not need to hold the server in maintenance mode.

The downloaded archive contains credentials and integration secrets. The UI must say so clearly. It must not be exposed through a permanent public URL or retained indefinitely inside the data directory.

`runtime/` is inside the filesystem boundary but is not durable backup content. Excluding it is necessary because an audio FIFO is a live process primitive rather than a regular file, and incomplete uploads or replay builds have no restore value. The backup coordinator must quiesce the owning services before clearing it so exclusion cannot disrupt active work.

An optional smaller **Download settings and state backup** may exclude explicitly regenerable, high-volume snapshots, replay segments, completed replays, and caches. This is secondary; the full backup remains the authoritative complete-server backup.

### Restore

Restore cannot safely overwrite databases underneath running services. It must be a staged, restart-bound operation.

The restore service must:

1. Require a lockdown administrator and recent password confirmation.
2. Upload the archive into bounded staging controlled by the data directory.
3. Enforce an upload-size limit that is appropriate for full media-inclusive backups.
4. Reject absolute paths, `..` traversal, symlinks, device files, and unexpected archive structures.
5. Validate the manifest and every checksum before altering active data.
6. Check that the backup version has a supported forward migration path.
7. Display exactly what will be replaced.
8. Require a final explicit confirmation.
9. Record a pending-restore marker.
10. Gracefully stop the application.
11. Apply the restore before ordinary services open their databases on the next start.
12. Run database migrations against the restored data when necessary.
13. Start the application and verify its health.

The startup restore path must preserve a local rollback snapshot until the restored server passes validation. If extraction, migration, or startup validation fails, it must put the prior data back and report the failure. Restore coordination files may live under `data/system/restore`, but they must be excluded from the restored payload where necessary to avoid recursively restoring an in-progress operation.

Restoring configuration also restores administrator accounts and secrets. The initiating browser may therefore lose authentication after restart; the reconnect UI must explain this and return to login normally.

### Command-line recovery

Backup and restore must also have command-line entry points that use the same implementation as the admin UI. They are needed when the web server cannot start or authentication data is damaged.

The command-line tools must support:

- Creating a consistent backup while the server is stopped
- Validating a backup without applying it
- Restoring while the server is stopped
- Printing a concise manifest summary
- Refusing unsafe or malformed archives

The UI and command line must not develop separate archive formats or validation behavior.

## 7. Standardize graceful application restart

Replace the current host reboot operation with a deployment-neutral **Restart application** operation.

The restart coordinator must:

1. Authorize and acknowledge the request.
2. Stop accepting new persistent mutations.
3. Flush or close persistent stores.
4. Stop MediaMTX, ffmpeg, and native workers.
5. Close HTTP and socket listeners within a bounded timeout.
6. Exit with the status expected by the current supervisor.

During Phase 1, systemd restarts the process. During Phase 2, the container restart policy or lifecycle service restarts it. The browser should show a reconnect state and confirm the active configuration revision after reconnecting.

Host rebooting is a separate privilege and is not part of this application restart contract.

## 8. Internalize MediaMTX WHEP signaling

The current external proxy maps public `/video/<path>` requests to MediaMTX after stripping `/video`. Node should own that mapping directly.

The final request path is:

```text
Browser:   /video/<stream>/whep
Node:      strips /video and streams the request internally
MediaMTX:  /<stream>/whep on 127.0.0.1:8889
```

Required work:

- Add a maintained HTTP proxy library rather than manually reproducing proxy semantics.
- Register the media proxy early enough that request bodies remain unmodified.
- Stream request and response bodies without buffering.
- Forward `POST`, `PATCH`, `DELETE`, authorization, content type, forwarded protocol, and relevant WHEP response headers.
- Apply bounded but media-appropriate proxy timeouts.
- Bind MediaMTX's WHEP listener to loopback.
- Generate browser WHEP URLs relative to the current site origin.
- Remove `media.whepBaseUrl` from configuration.
- Keep public and LAN ICE candidate hostnames as validated admin configuration.
- Test the exact `/video` prefix removal.
- Confirm that MediaMTX's internal HTTP authorization callback still reaches Node.

The actual WebRTC media does not pass through this HTTP proxy. MediaMTX's ICE TCP/UDP port must remain reachable by browsers.

Afterward, the public TLS proxy sends all paths for the site to Node and no longer needs a separate MediaMTX `/video` upstream.

## 9. Phase 1 verification and completion gate

Phase 1 is complete only when all of the following are true:

- The current systemd installation runs without `config.yaml`.
- A completely empty data directory can be initialized through `/setup`.
- An explicitly selected YAML file can initialize the empty database exactly once.
- The setup upload reports unknown or invalid values instead of discarding them.
- Startup and installation do not search for or modify an old `config.yaml`.
- All mutable server state is contained by the configured data directory.
- A complete backup can be downloaded and validated.
- A restore replaces the server state only after validation and survives restart.
- Failed restore validation leaves the current server unchanged.
- Configuration, administrator accounts, and secrets survive restart.
- The final lockdown administrator cannot be removed accidentally.
- All administrative surfaces are available through `/admin` with server-side authorization.
- Configuration changes create auditable revisions and apply after restart.
- `/video` works through Node without a special public proxy rule for MediaMTX.
- Rover sockets, RTSP publishing, WHEP playback, snapshots, replays, PTZ, Discord, Home Assistant, Kinect, Balance Board, and reporting retain their intended behavior when enabled.

### Filesystem boundary implementation notes

Implemented on 2026-09-13:

- Removed the obsolete `server/src/data` fallback so there is one default data root.
- Added a shared rover-snapshot directory resolver beneath `SERVER_DATA_DIR`.
- Converted rover snapshot polling, PTZ snapshot reads, and health reporting to that resolver.
- Made the MediaMTX supervisor pass its resolved `SERVER_DATA_DIR` to runOnReady hooks.
- Converted the snapshot writer to require that data root and write to `rover-snapshots` beneath it.
- Removed the separate snapshot and replay-segment locations from the systemd unit generated by the installer.
- Made the installer create and own the canonical data and snapshot directories.
- Preserved the existing flat data layout; established SQLite, JSON, replay, cache, and generated MediaMTX paths were already within the boundary.
- Moved audio-forward FIFOs/uploads and both replay-rendering workspaces from the host temporary directory to `data/runtime`.
- Removed the configurable audio-forward runtime path so configuration cannot direct application writes outside `SERVER_DATA_DIR`.
- Kept prompts, public assets, helper binaries, native workers, and TTS assets with the packaged application because they are read-only application material.
- Left any old `/var/lib/rover-snapshots` and `/var/lib/replay-segments` directories untouched but reported during installation. Nothing reads or writes them after the upgraded service starts, and the operator can remove them after verifying the new paths on the actual server.

Local verification completed:

- Data-path helper tests passed for the default root and an overridden temporary root.
- MediaMTX supervisor testing confirmed that the resolved root reaches child hooks.
- The snapshot writer created `rover-snapshots` beneath a temporary data root and failed closed when no data root was supplied.
- All 91 server tests passed, including the new data-path and MediaMTX supervisor coverage.
- Installer and snapshot-writer shell syntax checks passed.
- Source inventory found no remaining application runtime use of the operating system temporary directory, the old snapshot/replay environment variables, or `/var/lib` paths; only tests use OS temporary directories and the installer retains a deliberate legacy-directory notice.
- Real snapshot generation and legacy-directory cleanup still require verification on the actual server during deployment.

### Configuration and administration implementation notes

Implemented on 2026-09-14:

- Added one ordered, strictly validated hierarchical configuration assembled from side-effect-free definitions owned by the services that consume each value.
- Added immutable SQLite configuration revisions, active-revision tracking, administrator accounts, schema migrations, and persistent administrative audit events under the shared data directory.
- Added full-document saves with optimistic revision checking. A stale browser cannot overwrite a newer revision, and invalid or unknown fields cannot become active.
- Redacted secrets from browser responses and audit data. The one complete save operation preserves stored secrets unless the administrator explicitly replaces or clears them.
- Converted every runtime configuration consumer to the synchronous database-backed configuration service and removed the YAML loader, `SERVER_CONFIG`, and the tracked example YAML.
- Added an explicit one-time YAML upload to `/setup`. Existing bcrypt hashes, lockdown roles, Discord identities, configuration, and secrets can be imported only when the operator selects the file; the installer and startup perform no automatic discovery or migration, and there is no command-line importer.
- Added safe empty-data startup, a file-backed one-time setup code, the restricted `/setup` route, and a console administrator-recovery command. The credential persists at `data/setup-code.txt` across restarts with `0600` permissions, never appears in logs, and is deleted when setup completes.
- Added the centralized `/admin` route with Overview, Fleet operations, Users and administrators, and one schema-generated hierarchical Configuration page in legacy YAML order.
- Replaced every feature-specific configuration form with `@rjsf/core`; the protected admin snapshot supplies the server's assembled schema, and one generic widget handles all schema-declared secrets.
- Replaced RJSF's unthemed Bootstrap markup with a generic MultiRover tree renderer. The complete document now follows schema order as indented object, array, item, and key/value rows; array controls remain readable text beside each item, and the route-specific styling lives outside the global stylesheet.
- Replaced the editor's custom section borders, header backgrounds, and indentation guides with the application's shared `CardFrame` at every object, array, and array-item layer. Scalar settings remain compact key/value rows, descriptions use the wider value column, and collection actions stay beside their content instead of moving to the far edge.
- Disabled RJSF's internal checkbox label and description generically, leaving the shared field row as the single owner of each boolean setting's name, required marker, and description.
- Restored the former example YAML's installation-specific values as both schema-owned input examples and the actual initial values for non-secret settings and collection shapes. The only intentionally empty defaults are the three credentials and active driver HTML; their placeholders still explain the expected input without falsely marking credentials as configured or publishing sample content.
- Strengthened top-level hierarchy with a 1.5-rem sibling gap while retaining compact spacing within each configuration section.
- Extended `CardFrame` with an optional explicit accent while preserving its assigned-rover default, then gave every configuration nesting level its own complete header-and-border accent. Nested CardFrames themselves now carry the YAML-like indentation, scalar contents remain aligned with their owning card, and descriptions use a larger, higher-contrast treatment.
- Traced all 156 schema nodes to their runtime consumers and added operator-facing descriptions for every root, section, collection, array item, and scalar option. A recursive configuration test now rejects any future schema node without a description; currently reserved settings explicitly state that they have no runtime effect.
- Converged feature control into service-owned configuration: each public feature opts in beside its own schema, and the configuration system derives those exact `enabled` switches for sessions and command discovery. The former server feature registry was removed; configuration completeness and hardware availability remain visible as runtime status instead of becoming hidden enablement rules.
- Lazy-loaded setup and administration so the schema-form dependency is not included in ordinary driver-page downloads.
- Reused the existing fleet and identity administration surfaces, added password reconfirmation for sensitive operations, and prevented removal or demotion of the final lockdown administrator.
- Added configuration revision history, rollback, audit history, and restart-required reporting. Graceful restart itself remains step 7.

Local verification completed:

- All 106 server tests passed, including populated legacy-style default coverage, complete schema-description and input-example coverage, file-backed setup-code lifecycle and symlink rejection, service-definition-derived feature projection, schema-derived secret paths, configuration defaults and strict validation, full-document revision conflicts, secret preservation, administrator invariants, explicit setup-file import, and the earlier filesystem coverage.
- Focused admin, route, and identity UI lint passed.
- All 20 existing focused web UI tests passed.
- The production web UI build completed successfully and regenerated the checked-in server assets.
- Installer syntax and repository whitespace checks passed.
- A local startup smoke test reached listener initialization. MediaMTX then exited because `/usr/local/bin/mediamtx` is intentionally absent on this development machine; actual enabled integrations and media remain deployment checks for the real server.

# Phase 2: containerization and image delivery

Phase 2 packages the completed Phase 1 application. It must not introduce a second configuration source or a second persistent-data layout.

## 10. Build the production application image

Use a Fedora-based multi-stage build to remain close to the dependencies already installed by the server installer and to avoid Alpine/musl compatibility problems with native modules and the ChromeOS TTS library.

### Web UI build stage

- Install locked web UI dependencies with `npm ci`.
- Run the production Vite build.
- Copy only the built assets into the final server tree.

### Server dependency stage

- Install locked server dependencies with `npm ci --omit=dev`.
- Supply compiler tooling only in the build stage for native Node modules.
- Copy production dependencies into the final image.

### Native worker stage

- Build the Kinect worker against libfreenect/libusb.
- Build the Balance Board worker against wiiuse/BlueZ.
- Build for the target image architecture rather than copying checked-in workstation binaries.

### Packaged runtime tools

At image-build time:

- Download pinned MediaMTX and neolink releases.
- Verify checksums.
- Install ffmpeg, ffprobe, TTS engines, required GStreamer libraries, and runtime native libraries.
- Install the ChromeOS TTS library and voice data.
- Install the TTS and snapshot helper scripts.
- Run reasonable build-time smoke checks.

The actual server must never download or compile these dependencies during container startup.

### Final image

The final image should:

- Contain no compiler toolchain, Git checkout, development dependencies, or build cache.
- Run Node as a dedicated non-root user.
- Use a minimal init process to reap child processes.
- Treat `/data` as its only persistent writable location.
- Use `/tmp` only for disposable work.
- Include release version and commit metadata.
- Handle `SIGTERM` through the Phase 1 graceful shutdown coordinator.

## 11. Compose deployment

The host-visible installation should be only:

```text
multirover/
├── compose.yaml
└── data/
```

The Compose project contains:

- The main Multirover application container
- A small lifecycle container used for application update and restart

The application mounts:

```text
./data:/data
```

Host networking is the initial preferred design because it most closely preserves current rover RTSP, WebRTC ICE, UDP media, camera, and LAN integration behavior. The exact listeners must be audited before finalizing the Compose file.

Expected externally relevant listeners are:

- Node HTTP, Socket.IO, and proxied WHEP signaling on TCP 8080
- Rover RTSP publishing on TCP 8554
- WebRTC media on TCP and UDP 8189

MediaMTX WHEP on 8889, API/metrics listeners, and server-local SRT should stay on loopback unless an identified remote consumer requires otherwise.

## 12. Hardware access with minimal host setup

The host must still provide the kernel and system services that containers cannot safely configure for themselves.

Kinect requirements:

- One host udev rule granting the intended device access
- The necessary USB device mount, likely `/dev/bus/usb` because Kinect device numbering can change
- libfreenect and the worker inside the image

Balance Board requirements:

- Host Bluetooth daemon configuration required by the existing raw HID design
- Access to the host BlueZ D-Bus socket
- Only the network capabilities required by the native worker
- No fully privileged main application container

The exact capabilities and device permissions must be proven on the real server hardware. This development machine is not the actual server and cannot complete that validation.

The host should not need Node, npm, MediaMTX, ffmpeg, neolink, application source, or a Multirover systemd unit after cutover.

## 13. Health checks

Add an internal health endpoint that verifies:

- Node is accepting requests.
- Configuration initialization and migrations succeeded.
- The data directory is readable and writable.
- Required SQLite databases are usable.
- MediaMTX is running and its internal endpoint responds.

Optional remote integrations should report degraded status to administrators without forcing a container restart loop. Home Assistant, Discord, a camera, or an LLM server being offline does not mean the application process itself is unhealthy.

Compose should use the health endpoint and a restart policy suitable for unattended operation.

## 14. Restricted lifecycle container

The main web application must not mount the Docker socket. Docker socket access is effectively host-root access.

A small lifecycle container should be the only component with Docker control. It should:

- Have no public network port.
- Accept requests only through a shared Unix socket under `data/system` or another private Compose-only channel.
- Operate only on the fixed Multirover application service.
- Reject arbitrary command lines, service names, image names, and Compose arguments.
- Persist update job state so it survives replacement of the application container.
- Report current version and image digest.
- Pull the configured release image.
- Restart or recreate the application container.
- Wait for the application health check.
- Retain and restore the previous image when the replacement fails.

The `/admin` System section should expose:

- Current version and image digest
- Check for update
- Update and restart
- Restart application
- Update progress and recent output
- Last update result
- Rollback result

These operations require a lockdown administrator and recent password confirmation. The browser must expect its socket to disappear, show a reconnect state, and retrieve the persistent job result after the new application becomes healthy.

The Compose contract should remain stable so ordinary application releases replace only the application image. Updating the lifecycle component or changing host mounts/capabilities is a separate, rarer deployment-format update and must not be disguised as an ordinary application update.

## 15. GHCR release automation

Add repository automation that:

- Builds the production image from a clean checkout.
- Runs server tests, focused web UI tests/lint, and the production web build before publishing.
- Builds each explicitly supported server architecture.
- Publishes immutable commit/release tags to GHCR.
- Publishes one documented stable channel used by the lifecycle updater.
- Records image digests and source revision metadata.
- Avoids publishing when required verification fails.

The deployed server pulls a prebuilt image. It does not run `git pull`, `npm install`, native compilation, or web UI compilation.

## 16. Container cutover

The actual deployment migration should:

1. Download and validate a full Phase 1 backup.
2. Stop and disable the legacy Multirover systemd service.
3. Ensure no legacy MediaMTX service remains active.
4. Place the Compose file beside the existing data directory or move that directory once while the service is stopped.
5. Start the application and lifecycle containers.
6. Confirm that database migrations complete.
7. Confirm the active configuration revision and administrator access.
8. Verify rover connectivity, media publishing, WHEP playback, replay, cameras, and enabled hardware/integrations.
9. Exercise application restart through `/admin`.
10. Exercise an image update and health-check result.
11. Retain the Phase 1 backup until the container deployment has been accepted.

The old systemd application and the Compose application must never run concurrently because they would compete for HTTP and media ports.

## 17. Phase 2 completion gate

Containerization is complete when:

- A new host can start from one Compose file and an empty data directory.
- Existing state can be restored from a Phase 1 full backup.
- `./data:/data` is the only persistent application mount.
- Replacing the application container preserves all state.
- The special external `/video` MediaMTX route is unnecessary.
- The main container has no Docker socket access and is not fully privileged.
- Admin-triggered restart works.
- Admin-triggered update works and persists progress across reconnection.
- A failed image health check rolls back to the prior image.
- GHCR images are reproducibly built from repository releases.
- Kinect and Balance Board behavior has been verified on the actual host.
- Node, npm, application source, and media binaries are no longer installed directly on the host.

# Recommended implementation order

Within the two hard phase boundaries, the safest order is:

- [x] Complete the filesystem audit and single data-directory migration.
- [x] Add the configuration schema/database and administrator storage.
- [x] Add first-run setup and explicit YAML configuration-file upload.
- [x] Convert every configuration consumer and remove YAML runtime loading.
- [x] Converge optional feature control into service-owned `enabled` switches and derive the public feature map from those definitions.
- [x] Build the centralized admin configuration UI.
- [x] Add persistent audit history.
- [ ] Implement coordinated backup and staged restore.
- [ ] Standardize graceful application restart.
- [ ] Add the internal `/video` proxy and remove the special external route.
- [ ] Run the full Phase 1 completion gate on the legacy deployment.
- [ ] Build and verify the production application image.
- [ ] Add Compose, data mounting, networking, and hardware access.
- [ ] Add GHCR build and publication automation.
- [ ] Add the restricted lifecycle container and connect the System UI.
- [ ] Test update, rollback, backup restore, and hardware on the actual server.
- [ ] Perform the final systemd-to-Compose cutover.

This order gives each invasive change one clear source of failures and leaves the container phase responsible for packaging and supervision rather than unfinished application architecture.
