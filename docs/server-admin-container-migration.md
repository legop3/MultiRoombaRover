# Server administration and container migration

## Status

This document is the live implementation tracker for the migration.

- [x] Phase 1, step 1: Establish the single data-directory contract
- [x] Phase 1, steps 2-5: Configuration database, manual setup-file import, setup, and centralized admin UI
- [x] Phase 1, steps 6-8: Restart, backup/restore, and internal video proxy
- [x] Phase 1, step 9: Complete the remaining legacy-deployment integration and hardware verification
- [x] Phase 2, step 10: Build and locally verify the production application image
- [x] Phase 2, steps 11-12: Add the single-container Compose deployment and locally verify its host-access contract
- [x] Phase 2, step 13: Add application and container health checks
- [x] Phase 2, step 14: Add the restricted lifecycle container and connect the System UI
- [x] Phase 2, step 15: Build pull requests and publish the main branch to the single GHCR `latest` channel
- [ ] Phase 2: Containerization, GHCR publishing, and container lifecycle controls

Phase 1 is complete. The current application has run successfully on the production server with the new configuration, administration, persistence, backup/restore, and internal video-proxy contracts.

The work is deliberately split into two phases:

1. Finish the server-side configuration, administration, persistence, backup, restore, and media-routing changes while the server still uses its current systemd deployment.
2. Containerize the already-finished application, publish images through GHCR, and add container-aware update and restart controls.

Phase 1 must be complete and verified before Phase 2 begins. Containerization must not become a second configuration migration or a reason to maintain two persistence layouts.

## Decision log

- 2026-09-14: Publish `ghcr.io/legop3/multiroombarover:latest` only from the repository's main branch. Every other repository branch publishes one moving development image named for that branch, with invalid tag separators normalized; these are development selectors rather than numbered releases. Pull requests only verify that the image builds. There are no release numbers, semantic-version tags, stable/edge channels, or operator-facing version selection. Docker image digests remain an internal mechanism for detecting an available update and retaining the previously running image for rollback.
- 2026-09-15: Support only `linux/amd64` for the central server image. Rover computers remain independently ARM-capable, but publishing an untested ARM server image would multiply native-worker, media-binary, TTS-library, and hardware validation without serving the current deployment. ARM server support can be added later when a real ARM server exists to verify it.
- 2026-09-15: Mount the application data directory from the Docker-managed `multirover-data` named volume instead of a host bind path. Docker initializes the empty volume with the image's non-root ownership, eliminating host UID matching, directory creation, ownership commands, and root application startup. The admin backup/restore system is the supported portable interface to the complete data tree.
- 2026-09-14: Apply every committed configuration revision immediately. The configuration coordinator atomically replaces the process-wide snapshot, compares top-level service sections, serially reloads only affected service runtimes, and then refreshes all sessions. Long-lived HTTP/socket handlers remain registered once and delegate to the current runtime; integrations may reconnect or replace their own child process, worker, client, timers, and subscriptions without restarting Node.
- 2026-09-14: Render the schema-driven configuration editor as a YAML-like tree inside one `CardFrame`. Every object or array introduces an ordered header and one indentation guide, every scalar occupies one key/value row, and array operations remain beside their item instead of moving to the far edge. Keep all route-specific RJSF styling in `webui/src/admin/styles.css`, outside the shared global stylesheet.
- 2026-09-14: Restart only the application process, never the host. A lockdown administrator with recent password confirmation requests one audited restart, Node acknowledges and announces it, then sends itself SIGTERM. Existing service signal handlers clean up their owned children, while systemd `Restart=always` and the later container restart policy start the application again.
- 2026-09-14: Keep backup and restore together in one server service after application restart exists. Neither operation stops running services or writers, and no command-line interface is maintained. Backup uses online SQLite snapshots and stable copies of non-database files; restore validates and stages an uploaded archive, records a marker, and uses the normal application restart to replace the data directory during earliest startup.
- 2026-09-14: Define this server's canonical `publicUrl` once at the top of configuration beside `timezone`. Discord links, inter-instance identity, page metadata, and MediaMTX's primary public ICE hostname derive from it. Browser WHEP and WHIP signaling always uses the same-origin `/video` path; `media.additionalHosts` remains only for genuinely additional ICE names or addresses.
- 2026-09-14: Treat container deployment as a fresh installation. Neither startup nor the installer searches for, imports, removes, or otherwise manages an old `config.yaml`; the only old-file paths retained are operator-selected YAML uploads on `/setup` and the protected Configuration page. The separate command-line importer and its dry-run mode are removed. Internal SQLite schema migrations remain because they evolve the active database rather than discovering an old installation.
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
- `/setup` may initialize the database from a YAML file explicitly selected by the operator, and the protected Configuration page may explicitly replace configuration from one later; no automatic host migration or persistent YAML source exists.
- A dedicated `/admin` application contains all server administration.
- The public `/video` route is proxied to MediaMTX by the Node server, eliminating the special external MediaMTX proxy rule.
- The completed server is packaged as a replaceable container whose only persistent mount is the data directory.
- The latest successful main-branch image is built automatically and published to GHCR as `ghcr.io/legop3/multiroombarover:latest`.
- The admin UI can restart, update, health-check, and roll back the application container without giving the main application direct Docker access.
- The final host installation contains as little project-specific material as possible: a Compose file, one Docker-managed data volume, and unavoidable hardware preparation.

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
- Shared editor infrastructure owns loading, dirty state, validation errors, revision conflicts, secret operations, and live-application status for the whole document.
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
3. Atomically replace the process-wide configuration snapshot.
4. Compare the old and new top-level sections.
5. Reload every service that owns a changed section, replacing its complete internal runtime when necessary.
6. Report per-service application failures without preventing unrelated services from applying the revision.
7. Refresh sessions only after all affected service reloads finish.

HTTP routes, Socket.IO connection handlers, and process signal handlers are registered once. They consult live state or delegate to the current service runtime, preventing duplicate listeners after repeated saves. Service reloads may reconnect an integration or restart an application-owned child such as MediaMTX, ffmpeg, Kinect, or the Balance Board worker, but never restart the Node application.

Operational actions such as changing server mode, locking a rover, or issuing a rover command remain direct live actions rather than configuration edits.

After migration is complete:

- Remove the YAML configuration loader.
- Remove `SERVER_CONFIG`.
- Remove `config.yaml` and `config.example.yaml` from the repository and installation process.
- Remove `js-yaml` if MediaMTX generation is changed to avoid it or if it is otherwise no longer needed. Generated MediaMTX YAML is an internal artifact, not operator configuration, so retaining `js-yaml` solely for that generator is acceptable.

## 3. Add explicit configuration-file upload to setup and administration

Container deployment starts with a new data directory and never discovers an old installation automatically. As a convenience, the first-run setup page may initialize the empty database from a YAML configuration file deliberately selected by the operator. The protected Configuration page may later replace only the configuration from another explicitly selected legacy file. Neither path is a startup loader, installer migration, command-line workflow, or permanent second source of truth.

Every upload must:

- Accept only an explicitly selected YAML file from `/setup` or the protected Configuration page.
- Parse the complete document.
- Map every recognized field into the new configuration schema.
- Preserve secrets without printing them.
- Apply current defaults for absent fields.
- Ignore fields that do not exist in the current schema, while reporting invalid values supplied for current fields.
- Validate the entire result before writing anything.
- Record the uploaded filename without storing secret values in the audit event.

The setup upload additionally must:

- Require the one-time setup code before processing it.
- Preserve existing bcrypt administrator password hashes, lockdown roles, and Discord IDs.
- Refuse to replace an already-configured database.
- Write the configuration, administrators, and audit event atomically.

The initialized-server upload additionally must:

- Require a lockdown administrator with recent password confirmation.
- Use optimistic revision checking so it cannot overwrite an intervening edit.
- Ignore the entire legacy `admins` collection and leave all current accounts unchanged.
- Preserve stored secrets omitted from the file, replace supplied secrets, and clear explicitly empty secrets.
- Commit through the normal revision path and immediately reload affected services.

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

## 6. Standardize application restart

Replace the current host reboot operation with one deployment-neutral **Restart application** operation.

The restart operation must:

1. Require a lockdown administrator and recent password confirmation.
2. Reject a second request while one is already pending.
3. Persist an audit event, acknowledge the requester, and notify connected browsers.
4. Stop accepting new HTTP connections and send SIGTERM to the Node process after a short acknowledgement delay.
5. Reuse the cleanup hooks already owned by MediaMTX, ffmpeg, Kinect, Balance Board, and other child-process services.
6. Exit normally and rely on the process supervisor to start the application again.

During Phase 1, systemd uses `Restart=always`. During Phase 2, the container uses a restart policy such as `unless-stopped`. An explicit operator `systemctl stop` or container stop remains stopped; only a process exit is restarted. The browser shows the announced reconnect state and reloads the active administration snapshot after Socket.IO reconnects.

Host rebooting is a separate privilege and is not part of this application contract. The server never invokes `systemctl reboot`.

## 7. Implement complete backup and restore

Everything durable living under one data directory makes the backup boundary simple. Backup and restore remain together under one `backupRestoreService`; there is no generic maintenance framework and no command-line workflow.

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

The backup operation must:

1. Require a lockdown administrator and recent password confirmation.
2. Leave every service and writer running.
3. Create consistent SQLite snapshots using SQLite's online backup support rather than copying active WAL files.
4. Copy non-database durable files and verify their size and modification time before and after each copy, retrying a file that changed during the copy.
5. Exclude `runtime/`, backup/restore staging, SQLite WAL/SHM files, and incomplete files that never become stable during bounded retries.
6. Produce a manifest containing creation time, application version, schema versions, included paths, sizes, and checksums.
7. Stream the completed archive to the authorized browser and remove temporary staging afterward.

The downloaded archive contains credentials and integration secrets. The UI must say so clearly. It must not be exposed through a permanent public URL or retained indefinitely inside the data directory.

`runtime/` is inside the filesystem boundary but is not durable backup content. Audio FIFOs, incomplete uploads, and in-progress replay builds have no restore value and are excluded without stopping their owners. The initial implementation provides only the authoritative full backup.

### Restore

Restore cannot safely overwrite databases underneath running services. It must be a staged, restart-bound operation.

The restore operation must:

1. Require a lockdown administrator and recent password confirmation.
2. Upload the archive into bounded staging controlled by the data directory.
3. Enforce an upload-size limit that is appropriate for full media-inclusive backups.
4. Reject absolute paths, `..` traversal, symlinks, device files, and unexpected archive structures.
5. Validate the manifest and every checksum before altering active data.
6. Check that the backup version has a supported forward migration path.
7. Display exactly what will be replaced.
8. Require a final explicit confirmation.
9. Record a pending-restore marker.
10. Request the normal application restart.
11. Apply the restore before ordinary services open their databases on the next start.
12. Run database migrations against the restored data when necessary.
13. Start the application and verify its health.

The startup restore path must preserve a local rollback snapshot until the restored server passes validation. If extraction, migration, or startup validation fails, it must put the prior data back and report the failure. Restore coordination files may live under `data/system/restore`, but they must be excluded from the restored payload where necessary to avoid recursively restoring an in-progress operation.

Restoring configuration also restores administrator accounts and secrets. The initiating browser may therefore lose authentication after restart; the reconnect UI must explain this and return to login normally. Backup and restore exist only in the protected admin application.

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
- The setup upload ignores nonexistent fields and reports invalid values supplied for current fields.
- Startup and installation do not search for or modify an old `config.yaml`.
- All mutable server state is contained by the configured data directory.
- A complete backup can be downloaded and validated.
- A restore replaces the server state only after validation and survives restart.
- Failed restore validation leaves the current server unchanged.
- Configuration, administrator accounts, and secrets survive restart.
- The final lockdown administrator cannot be removed accidentally.
- All administrative surfaces are available through `/admin` with server-side authorization.
- Configuration changes create auditable revisions and apply to the running services without an application restart.
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
- Added the same explicit legacy YAML picker to the protected Configuration page for replacing an initialized server's configuration. It requires recent lockdown-password confirmation, ignores every YAML administrator entry, filters nonexistent settings, validates current fields, preserves omitted secrets, applies explicitly supplied or empty secrets, uses optimistic revision checking, records the selected filename in audit history, and reloads affected services immediately.
- The one-time setup upload now passes its committed configuration through the same live-application coordinator, so a fresh installation does not need an immediate restart after importing YAML.
- Made setup-file import recursively retain only fields present in the current schema. Stale keys from the permissive YAML era are ignored without aliases or historical translations, while invalid values for real current settings still fail validation; stream-only and snapshot-only room-camera entries remain accepted as they were by the runtime.
- Added safe empty-data startup, a file-backed one-time setup code, the restricted `/setup` route, and a console administrator-recovery command. The credential persists at `data/setup-code.txt` across restarts with `0600` permissions, never appears in logs, and is deleted when setup completes.
- Added the centralized `/admin` route with Overview, Fleet operations, Users and administrators, and one schema-generated hierarchical Configuration page in legacy YAML order.
- Replaced every feature-specific configuration form with `@rjsf/core`; the protected admin snapshot supplies the server's assembled schema, and one generic widget handles all schema-declared secrets.
- Replaced RJSF's unthemed Bootstrap markup with a generic MultiRover tree renderer. The complete document now follows schema order as indented object, array, item, and key/value rows; array controls remain readable text beside each item, and the route-specific styling lives outside the global stylesheet.
- Replaced the editor's custom section borders, header backgrounds, and indentation guides with the application's shared `CardFrame` at every object, array, and array-item layer. Scalar settings remain compact key/value rows, descriptions use the wider value column, and collection actions stay beside their content instead of moving to the far edge.
- Disabled RJSF's internal checkbox label and description generically, leaving the shared field row as the single owner of each boolean setting's name, required marker, and description.
- Restored the former example YAML's installation-specific values as both schema-owned input examples and the actual initial values for non-secret settings and collection shapes. The only intentionally empty defaults are the three credentials and active driver HTML; their placeholders still explain the expected input without falsely marking credentials as configured or publishing sample content.
- Strengthened top-level hierarchy with a 1.5-rem sibling gap while retaining compact spacing within each configuration section.
- Extended `CardFrame` with an optional explicit accent while preserving its assigned-rover default, then gave every configuration nesting level its own complete header-and-border accent. Nested CardFrames themselves now carry the YAML-like indentation, scalar contents remain aligned with their owning card, and descriptions use a larger, higher-contrast treatment.
- Added an opt-in sticky-header behavior to the shared `CardFrame`. Top-level configuration titles use it beneath the independently sticky action toolbar while nested titles remain in normal flow to prevent overlap, and scalar key labels are now visually stronger than their descriptions.
- Traced all 156 schema nodes to their runtime consumers and added operator-facing descriptions for every root, section, collection, array item, and scalar option. A recursive configuration test now rejects any future schema node without a description; currently reserved settings explicitly state that they have no runtime effect.
- Converged feature control into service-owned configuration: each public feature opts in beside its own schema, and the configuration system derives those exact `enabled` switches for sessions and command discovery. The former server feature registry was removed; configuration completeness and hardware availability remain visible as runtime status instead of becoming hidden enablement rules.
- Lazy-loaded setup and administration so the schema-form dependency is not included in ordinary driver-page downloads.
- Reused the existing fleet and identity administration surfaces, added password reconfirmation for sensitive operations, and prevented removal or demotion of the final lockdown administrator.
- Added configuration revision history, rollback, audit history, and immediate application reporting.
- Added a serialized live-configuration coordinator and converted configurable service runtimes to apply changed sections without restarting Node. Passive policies read the current immutable snapshot; network, hardware, timer, and child-process services replace or retune their owned runtime while stable HTTP/socket handlers continue delegating to it. The admin editor reports any service-specific reload failure after the revision is safely committed.
- Replaced the privileged host-reboot action with one lockdown-only, recently confirmed, audited application restart on the admin Overview. Node announces the restart, stops accepting new HTTP connections, and signals itself after acknowledging the browser; the existing service signal hooks clean up owned child processes, and systemd now restarts clean application exits without making `systemctl stop` ineffective.
- Added one protected backup-and-restore service and admin page. Backups keep the application online, use SQLite's online snapshot API for all three databases, make verified stable copies of the remaining durable files, and produce a checksummed archive through a short-lived one-use download. Restore uploads are size-limited, reject unsafe archive entries, verify the complete manifest, checksums, SQLite integrity, and supported schema versions, then remain staged until explicit recent-password confirmation.
- Restore now uses the normal application restart rather than stopping services itself. The earliest server startup swaps the validated replacement into the data directory, retains one rollback copy, and removes that copy only after the restored application reaches a stabilization point; an interrupted or failed first startup automatically puts the previous data back on the following start. Backup/restore control files and all staging remain inside `data/backup-restore`.
- Fixed production WAL-mode snapshots creating unmanifested SQLite `-wal` and `-shm` files during schema inspection. Backup and restore validation now remove only those temporary staged sidecars before archiving or applying data, and the regression fixture uses WAL mode to match the real databases.
- Added the early streaming `/video` middleware with `http-proxy-middleware`. Express removes the public prefix before forwarding WHEP/WHIP requests to `127.0.0.1:8889`, while root-relative MediaMTX session locations receive the prefix again so subsequent browser `PATCH` and `DELETE` requests follow the same path. MediaMTX signaling now binds to loopback; its ICE UDP/TCP listener remains directly reachable on port 8189.
- Replaced Discord's `siteUrl`, the inter-instance profile's `publicUrl`, and media `whepBaseUrl` with one top-level `publicUrl`. A numbered internal database migration transforms every saved configuration revision before current validation, and the media section now contains only optional additional ICE hosts. WHEP and microphone WHIP URLs are fixed relative paths, so they work through the current origin without knowing its hostname.
- Discord command authorization and lockdown moderation recipients now read the live administrator registry, so setup imports and later Discord-ID or role edits take effect without restarting the server.
- Full-data restore now leaves `runtime/` untouched, matching its existing exclusion from backup archives and preventing the non-root application from trying to remove lifecycle-controller state owned by the root controller container.
- The Users and administrators tab now requests at most 100 lightweight identity summaries through one bounded SQLite query. Search and moderation filters run on the server, while complete signals, permissions, and feature state load only after selecting a user, preventing large identity databases from blocking Socket.IO heartbeats or freezing the browser.
- Removed the remaining server-local SRT hops after Fedora's newer libSRT rejected the zero-payload ACKACK packets emitted by MediaMTX's GoSRT implementation on every acknowledgement cycle. PTZ publishing, replay capture, and snapshot capture now share the existing RTSP/TCP listener, SRT is disabled, and browser-session authorization is bypassed only for loopback readers and rover `-fwd` speaker feeds.
- Fixed inter-instance public payload generation to read feature flags and social links from the same live configuration revision. Social links enabled through the new configuration system no longer trigger an undefined legacy-config reference and an HTTP 500 response.

Local verification completed:

- All 119 server tests passed, including populated legacy-style default coverage, complete schema-description and input-example coverage, file-backed setup-code lifecycle and symlink rejection, service-definition-derived feature projection, schema-derived secret paths, configuration defaults and strict validation, full-document revision conflicts, secret preservation, administrator invariants, setup and initialized-server YAML import safety, recursive removal of nonexistent fields, inter-instance payload generation with social links enabled, and the earlier filesystem coverage.
- All 27 server test files passed after live application, backup/restore, the internal media proxy, and the inter-instance regression coverage were added. The media tests stream exact SDP and trickle-ICE bodies through `POST`, `PATCH`, and `DELETE`, preserve headers, verify prefix and session-location rewriting, confirm loopback-only signaling, and derive the public ICE hostname from the canonical URL. The database migration and production-style WAL backup/restore paths are also covered. Application restart was not signaled on the development machine.
- Focused admin, route, and identity UI lint passed.
- All 20 existing focused web UI tests passed.
- The production web UI build completed successfully and regenerated the checked-in server assets.
- Installer syntax and repository whitespace checks passed.
- A local startup smoke test reached listener initialization. MediaMTX then exited because `/usr/local/bin/mediamtx` is intentionally absent on this development machine; actual enabled integrations and media remain deployment checks for the real server.
- A second empty-data startup smoke test loaded every reloadable service and reached the HTTP listener without listener-limit warnings. A deliberately substituted failing MediaMTX executable then ended the process as expected; enabled hardware and external integrations still require verification on the actual server.

Testing-server verification completed:

- A full backup created from the running application successfully validated and restored through the admin UI after the WAL-sidecar fix.
- WHEP video playback works when the testing server is published through an ordinary whole-application reverse proxy. No special `/video` upstream, prefix rewrite, buffering rule, or direct public MediaMTX signaling route is present, confirming that Node now owns the complete public signaling path.

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
- Build for `linux/amd64` rather than copying checked-in workstation binaries.

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
- Include ordinary OCI source metadata linking the image to this repository, without introducing an application version number.
- Handle `SIGTERM` through the Phase 1 graceful shutdown coordinator.

### Production image implementation notes

Implemented and locally verified on 2026-09-15:

- Added one root multi-stage `Dockerfile` that builds the Vite application, locked production Node dependencies, Kinect worker, and Balance Board worker, then copies only their runtime outputs into a Fedora 43 image.
- Downloaded pinned amd64 MediaMTX 1.15.3, Neolink 0.6.2, and ChromeOS Google TTS 26.5 artifacts during the build and rejected downloads that did not match their recorded SHA-256 checksums.
- Installed the media, TTS, USB, Bluetooth, and native-worker runtime libraries without Fedora weak dependencies. This avoids pulling unrelated desktop recommendations into the headless image while retaining the libraries explicitly required by the current server installer.
- Added a root `.dockerignore` so local dependencies, mutable server data, generated public assets, compiled host workers, logs, and Git metadata cannot leak into the image build context.
- Configured `/data` as `SERVER_DATA_DIR`, ran Node as the dedicated uid 1000 `multirover` user, retained only the Balance Board worker's required capabilities, and used `tini` as the container init process.
- Successfully built and loaded `multiroombarover:local` for `linux/amd64`. Its registry-style compressed content size is approximately 828 MB; Docker reports approximately 2.87 GB of local unpacked disk usage because the complete GStreamer, ffmpeg, Kinect, Node, and offline TTS runtime is intentionally included.
- Confirmed at build time that Chrome TTS loads its packaged voice model and produces a nonempty WAV file.
- Replaced Fedora's restricted `ffmpeg-free` package with RPM Fusion Free's complete `ffmpeg` package after development-container testing exposed that `ffmpeg-free` omits the `libx264` encoder required by rover replay capture, room-camera replay rendering, replay sidebars, and final replay assembly.
- Started the image with host networking and a temporary SELinux-relabeled `/data` bind mount. The application reached its HTTP listener, generated first-run state only inside the mount, and started the packaged MediaMTX with its generated configuration under `/data`.
- Confirmed `/`, `/setup`, and `/admin` return the production UI; `/video/` reaches the loopback MediaMTX proxy; MediaMTX and Neolink execute; both native workers link against the runtime image; and the Balance Board worker retains only `cap_net_admin` and `cap_net_bind_service`.
- Restarted the same container and confirmed the setup credential and configuration database were byte-for-byte unchanged, then confirmed `/admin` returned successfully again.
- Stopped and removed the smoke-test container and deleted its temporary data. No test server process was left running on the development machine.

## 11. Compose deployment

The host-visible project installation should be only:

```text
multirover/
└── compose.yaml
```

Docker owns the separately persisted `multirover-data` volume. Operators move
or inspect its complete contents through the administration backup/restore UI
rather than coordinating host filesystem ownership with the container user.

The Compose project contains:

- The main Multirover application container
- A small lifecycle container used for application update and restart

The application mounts:

```text
data:/data
```

Host networking is the initial preferred design because it most closely preserves current rover RTSP, WebRTC ICE, UDP media, camera, and LAN integration behavior. The exact listeners must be audited before finalizing the Compose file.

Expected externally relevant listeners are:

- Node HTTP, Socket.IO, and proxied WHEP signaling on TCP 8080
- Rover RTSP publishing on TCP 8554
- WebRTC media on TCP and UDP 8189

MediaMTX WHEP on 8889 and API/metrics listeners should stay on loopback unless an identified remote consumer requires otherwise. Publishers and server-local replay/snapshot readers use the single RTSP/TCP listener on 8554; SRT is disabled.

### Compose implementation notes

Implemented and locally verified on 2026-09-15:

- Added one root `compose.yaml` containing only the main application. It uses `ghcr.io/legop3/multiroombarover:latest`, host networking, `restart: unless-stopped`, and the single `data:/data` persistent named-volume mount. The lifecycle service remains a later, separate step rather than a placeholder in the initial deployment.
- Added both possible local data directories to `.dockerignore`, alongside the legacy `server/data`, so credentials, databases, recordings, backups, and generated state cannot enter later image builds even during development or manual inspection.
- Started the exact Compose definition from an empty Docker-managed volume using the locally built image tagged with the final GHCR name. The application created its configuration database, setup credential, and generated MediaMTX configuration only under that volume.
- Confirmed the production UI responds on `/`, `/setup`, and `/admin`. A request to `/video/` reached the internal MediaMTX proxy and received MediaMTX's expected not-found response because the empty configuration had no requested stream.
- Restarted through Compose and confirmed the setup credential and configuration database remained byte-for-byte unchanged. A separate marker created through `/data` also remained present after restart.

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

### Hardware-access implementation notes

Implemented and locally verified as far as this development host permits on 2026-09-15:

- Added the BlueZ command-line package to the runtime image because the Balance Board service commissions devices through `bluetoothctl`; the rebuilt image reports BlueZ 5.87.
- Exposed `/dev/bus/usb` so reconnecting Kinect devices do not depend on a temporary bus/device number, and granted only `NET_ADMIN` for the Balance Board worker rather than using privileged mode.
- Mounted only the host system D-Bus socket for BlueZ access. Docker's per-container SELinux label is disabled because Fedora blocks access to the shared host socket and USB device nodes otherwise, while relabeling the system socket would affect the host; the process remains non-root and Docker's namespace, capability, and seccomp isolation remain active.
- Confirmed the container can open the mounted system D-Bus socket and that its native Balance Board worker retains only its existing file capabilities. The development host's Bluetooth daemon is inactive and no production Kinect or Balance Board is attached, so real discovery, reconnect, and streaming remain part of the actual-server validation.

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

### Health-check implementation notes

Implemented on 2026-09-15:

- Added an unauthenticated `GET /health` readiness endpoint that exposes only two non-sensitive booleans: whether the application user can read and write the configured data directory and whether MediaMTX answers through its loopback-only metrics listener.
- Treated successful route execution as proof that Node is accepting HTTP and that configuration initialization completed. This avoids repeatedly querying every SQLite database or turning optional integrations and currently offline media sources into container restart conditions.
- Added the image-level Docker health check using Node's built-in `fetch`, so Compose receives the readiness state without installing another command-line probe utility.

## 14. Restricted lifecycle container

The main web application must not mount the Docker socket. Docker socket access is effectively host-root access.

A small lifecycle container should be the only component with Docker control. It should:

- Have no public network port.
- Accept requests only through a shared Unix socket under `data/system` or another private Compose-only channel.
- Operate only on the fixed Multirover application service.
- Reject arbitrary command lines, service names, image names, and Compose arguments.
- Persist update job state so it survives replacement of the application container.
- Compare the running image's internal digest with the current `latest` digest.
- Pull the fixed `ghcr.io/legop3/multiroombarover:latest` image.
- Restart or recreate the application container.
- Wait for the application health check.
- Retain and restore the previous image when the replacement fails.

The `/admin` System section should expose:

- Whether the running application is current or an update is available
- Check for update
- Update and restart
- Restart application
- Update progress and recent output
- Last update result
- Rollback result

These operations require a lockdown administrator and recent password confirmation. The browser must expect its socket to disappear, show a reconnect state, and retrieve the persistent job result after the new application becomes healthy.

The Compose contract should remain stable so ordinary main-branch image updates replace only the application image. Updating the lifecycle component or changing host mounts/capabilities is a separate, rarer deployment-format update and must not be disguised as an ordinary application update.

### Lifecycle-controller implementation notes

Implemented on 2026-09-15:

- Reused the single published application image for the lifecycle service with a controller-only command. This avoids a second Dockerfile, image name, GHCR workflow, and release lifecycle while the two containers still run separate processes with separate privileges.
- Mounted `/var/run/docker.sock` only in the network-disabled lifecycle container. The application communicates through a dedicated Unix-socket volume and cannot submit an image name, container name, command, or Docker option; the controller operates only on the fixed `multirover` container and the deployment-selected MultiRover image.
- Added fixed status, update-check, restart, and update operations. Update checks pull the configured moving image and compare Docker image IDs. Updates retain the previous image ID, recreate the application with its existing Compose host contract, wait for the image health check, and restore the previous image when replacement health fails.
- Persisted the current operation and result in the private lifecycle Unix-socket volume. This survives ordinary application replacement and browser reconnection without mounting the root lifecycle controller into the application's `/data` volume, leaving all application runtime paths owned by the non-root server.
- Connected the existing lockdown-administrator password confirmation and audit history to the lifecycle operations. The Administration overview polls persisted progress, reports update and rollback results, and keeps the legacy process-level restart only when no controller socket exists.
- Accepted self-updates, administrator restarts, and backup-restore restarts share a helper that sets the persistent admin reason to "server is restarting" and removes every current rover driver with the same notice. This does not change server mode or automatically clear the reason after startup.
- Defined the deployment image once through a Compose YAML anchor. Both services and the controller target reuse that exact value, so production stays on `ghcr.io/legop3/multiroombarover:latest` and development requires changing only the single visible selector line to a branch tag.

## 15. GHCR publishing automation

Add repository automation that:

- On pull requests, runs all required verification and proves that the production image builds without publishing it.
- On each repository branch push, builds the production image from a clean checkout.
- Uses the production Dockerfile as the single verification path. Its locked dependency installs, web UI production build, native worker builds, external-artifact checksum checks, and TTS smoke test must all pass before publication.
- Builds the supported `linux/amd64` image without QEMU or a multi-architecture manifest.
- Publishes `ghcr.io/legop3/multiroombarover:latest` from main and one sanitized branch-name tag from every other repository branch; there are no numbered, commit, stable, edge, or release tags.
- Leaves the previously published image for that branch untouched when any required verification or build step fails.
- Uses registry-generated digests only inside the lifecycle implementation for update comparison and rollback.

The deployed server pulls the prebuilt `latest` image. It does not run `git pull`, `npm install`, native compilation, or web UI compilation.

### GHCR automation implementation notes

Implemented on 2026-09-15:

- Added one `Container image` GitHub Actions workflow. Pull requests build the complete production Dockerfile without logging in or publishing. Main-branch pushes publish `ghcr.io/legop3/multiroombarover:latest`, while every other repository branch publishes one moving image using its sanitized branch name.
- Used GitHub's repository-scoped token with only contents-read and packages-write permissions. No separate registry secret, release process, version calculation, QEMU setup, or custom tag-generation code is required.
- Kept one Buildx job for all event types so pull-request verification, development branches, and main-branch publication cannot drift into different image recipes. Docker's maintained metadata action owns branch-name sanitization, and GitHub Actions layer caching avoids repeatedly downloading and rebuilding the image's large pinned media and TTS dependencies.
- Removed the legacy package-lock ignore rules and added the server lockfile required by `npm ci` to the migration change set. Local Docker builds and clean GitHub checkouts now receive the same locked server and web UI dependency inputs instead of allowing an ignored workstation file to mask a missing build input.
- The workflow file was parsed locally and its event, permission, architecture, tag-selection, and conditional-publish contract were checked. The first actual GHCR publication necessarily remains a GitHub-hosted verification after these changes are pushed.

## 16. Container cutover

The actual deployment migration should:

1. Download and validate a full Phase 1 backup.
2. Stop and disable the legacy Multirover systemd service.
3. Ensure no legacy MediaMTX service remains active.
4. Place the Compose file on the host; Docker creates the named data volume on first start.
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

- A new host can start from one Compose file and an automatically created empty data volume.
- Existing state can be restored from a Phase 1 full backup.
- `data:/data` is the only persistent application mount.
- Replacing the application container preserves all state.
- The special external `/video` MediaMTX route is unnecessary.
- The main container has no Docker socket access and is not fully privileged.
- Admin-triggered restart works.
- Admin-triggered update works and persists progress across reconnection.
- A failed image health check rolls back to the prior image.
- The GHCR `latest` image is reproducibly built from the newest successful main-branch commit.
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
- [x] Apply every configuration revision to running services without restarting the application.
- [x] Standardize graceful application restart.
- [x] Implement online backup and restart-bound staged restore in one service.
- [x] Add the internal `/video` proxy and make the special external route unnecessary.
- [x] Run the full Phase 1 completion gate on the legacy deployment.
- [x] Build and verify the production application image.
- [x] Add Compose, data mounting, networking, and hardware access.
- [x] Add GHCR build and publication automation.
- [x] Add the restricted lifecycle container and connect the System UI.
- [ ] Test update, rollback, backup restore, and hardware on the actual server.
- [ ] Perform the final systemd-to-Compose cutover.

This order gives each invasive change one clear source of failures and leaves the container phase responsible for packaging and supervision rather than unfinished application architecture.
