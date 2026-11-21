# Rover state and non-Roomba protocol

Status: implementation complete; deployment and live rover/browser verification pending.
Created: 2026-11-19.

## Objective

Official roverd rovers and non-Roomba implementations report operational state through the same `roverState` object. The server and UI use that object exclusively for the state it owns. Non-Roomba rovers can send sensor JSON directly to the existing sensor processing and UI without generating Roomba packets.

Maintain this document as the implementation tracker. Produce one separate, complete rover/server protocol reference at `docs/rover-protocol.md`. Keep the master README untouched.

## Agreed boundaries

- This repository's actual roverd is the only officially supported rover daemon. Allowing non-Roomba clients to send state and sensors does not make those clients supported roverd implementations.
- The protocol reference documents how the current code communicates; it is not a separately maintained public protocol or compatibility promise. Server and official roverd evolve together. Custom client authors are responsible for keeping their implementations up to date.
- No third-party client support matrix, protocol release process, or compatibility maintenance.
- No new capabilities announcement, compatibility framework, hardware abstraction framework, or protocol version negotiation.
- Keep the existing Roomba sensor packet input. Add direct JSON sensor input that reaches the same processing and UI.
- Official roverd derives operational state from its hardware locally; the server does not reconstruct it from Roomba telemetry.
- State, sensors, and commands use the existing control connection. Management remains for configuration, profiles, logs, notices, host statistics, reboot, and update. No new connection is required.
- Generic accessories remain hello descriptions, commands, and acknowledgements. Accessory feedback is not part of this work.
- Existing headlight and laser role state remains in `roverState`, independently of which peripheral implements the role.
- Do not expand this into redesigning media, installation, or hardware drivers.
- Remove fleet reports and rover odometry as part of this work, rather than adapting them to the new state interface. Remove their service wiring, API/UI surfaces, scheduled work, and unused dependencies. Review shared consumers before removing derived wheel-speed handling used by safety code.
- Keep the wheel-speed sensor calculation and its safety consumers. Remove distance/odometer tracking, not measured wheel speeds.
- Keep ordinary driving commands unchanged. The command work is limited to docking actions and the stop/cancel behavior needed to interrupt them.

## Docking command boundary

The server requests one of three actions; the rover performs the hardware-specific behavior:

| Action | Responsibility |
| --- | --- |
| Undock | Prepare hardware, optionally back away from dock contact, stop, and enter driving mode. Preserve the existing backoff option. |
| Dock assist | Prepare for user-driven docking, then handle dock contact and charging initiation. This is not autonomous dock-seeking. |
| Auto dock | Autonomously seek the dock. Unsupported implementations return an error. |

Wire names are `undock`, `dockAssist`, and `autoDock`; `cancelDocking` interrupts an operation. Do not expand this into redesigning driving or a general hardware framework.

The server retains permissions, driver ownership, administrative/battery locks, manual-assist UI and sensor-based safety policy. Assist-specific camera handling and speed limits belong to roverd. Official roverd owns Roomba opcodes, sequencing, contact handling, and local operation deadlines. The existing `roverState.docking` flag means autonomous seeking, not manual assistance, which is reported separately as roverState.dockAssist.

Explicit stop/cancel must interrupt the operation and prevent queued movement from restarting. Ordinary neutral drive input must not accidentally cancel undocking. Driver/control loss must cause server cancellation; rover connection loss or unavailable hardware must cancel an active undocking operation locally. Preserve the existing delayed disconnect auto-dock fallback separately.

Known behavior to preserve when relocating the current server sequence:

- Roomba preparation sequence 128 → 143 → 132, with settling delays and observed mode checks.
- Existing 1.5-second telemetry, four-second overall undock, and one-second reverse limits.
- Stop wheels and motors at dock contact, then return to passive mode and let local autocharge initiate charging as needed. No separate server-side wheel-settling workflow.
- Overcurrent protection of undocking reverse, including reduced output and stop requests. Relocation must not bypass it.
- Local autocharge and disconnect recovery plus server dock guard use the same rover-side auto-dock behavior; repeated requests must not continually restart it.

Acceptance is not completion. The UI needs pending, completion, cancellation, and failure handling without adding operation/error fields to physical rover state. A command-result message correlated by the existing command ID was proposed; finalize the smallest necessary mechanism during implementation rather than treating it as a new general job system.

## Agreed roverState object

```json
{
  "drivingMode": true,
  "dockAssist": false,
  "docking": false,
  "docked": false,
  "battery": {
    "percent": 74,
    "charging": false,
    "low": false,
    "critical": false,
    "needsCharge": false
  },
  "headlightOn": true,
  "laserOn": null
}
```

| Field | Meaning |
| --- | --- |
| `drivingMode` | Hardware is in its drive-enabled operating mode; not wheel movement, driver ownership, or permission to bypass server locks. |
| `dockAssist` | Rover-owned manual docking assistance is active; null when unavailable. |
| `docking` | Reported passive mode while not on the dock. |
| `docked` | Physically on the dock. |
| `battery.percent` | Percentage from 0 to 100, with decimals allowed. |
| `battery.charging` | In the charging process, including normal waiting pauses; not a claim that current is flowing at every instant. |
| `battery.low` | Current reading has reached the rover-defined low threshold. |
| `battery.critical` | Current reading has reached the rover-defined critical threshold. |
| `battery.needsCharge` | Charging is still required before normal use should resume. Includes recovery history rather than merely mirroring the current low threshold. |
| `headlightOn` | Current headlight role state. |
| `laserOn` | Current laser role state. |

Every field allows `null` for unknown or unsupported. Send the complete object on connection and whenever it changes; replace the stored object rather than applying deltas. Define disconnect and loss-of-reading handling so stale or missing data cannot manufacture state transitions.

Server-owned assignments, administrative locks, permissions, and command restrictions remain server-owned. Roomba OI codes and raw battery readings may remain diagnostic telemetry, but must not override these fields.

## Investigation findings

- `rover/roverd/wsclient.go` currently reports only headlight and laser state. `sensor_stream.go` extracts charging samples for local autocharge but does not yet provide the battery/state inputs needed here.
- `server/src/services/roverConnectionService/index.js` accepts base64 Roomba sensor messages and rover state. `roverManager/rosterLifecycle.js` validates the two existing state flags.
- `roverManager/sensorPipeline.js` decodes packets, computes battery state, derives docking, performs safety processing, and emits browser/internal sensor events in one path.
- `roverManager/mathUtils.js` calculates battery percentage and warning state. `webui/src/lib/battery.js` can independently reconstruct display percentage.
- Charging-code interpretation differs between autocharge, docking, battery management, and reporting.
- Dock/drive UI infers behavior from Roomba OI mode. `dockingService` also executes actual Roomba opcode sequences during undocking.
- `odometerService` currently interprets encoders using Roomba-specific constants. It will be removed; shared safety consumers of its derived wheel speeds must be addressed.
- `cmd/roverd/main.go` opens Roomba serial before the control connection starts. This is a known boundary for any future non-Roomba hardware support inside roverd; this project does not automatically imply building a generic hardware backend.

## Implementation checklist

### 1. Settle the contract and behavior

- [x] Define exact state message validation, initial state, replacement, reconnect, and unknown/stale behavior.
- [x] Define direct JSON sensor envelope, timestamps, field types/units, and replacement versus partial-update behavior. Do not leave old readings silently present after they become unavailable.
- [x] Inventory existing UI sensor fields and document which UI elements consume each one. Reuse actual meanings, not just similarly shaped numbers.
- [x] Define Roomba driving-mode mapping and how roverd knows docking is active, completed, or cancelled. Passive OI mode alone is insufficient.
- [x] Preserve the existing five-continuous-minute waiting recovery rule and minimum-charge condition inside roverd. Define `battery.needsCharge` initialization, recovery, and interaction with server battery locks; do not substitute reaching 100% for this rule.
  - The current minimum is `(charge - warn) / (full - warn) >= 0.01`, not 1% displayed battery. Preserve it explicitly.
  - Account for remembered low-battery history, existing lock-entry exceptions, administrative unlocks, and daemon restarts. Unknown readings must not release a battery lock or count toward confirmed waiting time.
- [x] Play the charge-completion sound once when a docked rover transitions from needing charge to recovered. Do not preserve a separate 100%-based completion model just for the sound.
- [x] Preserve existing Roomba battery calibration when moving calculation into roverd; establish one reported percentage rather than separate server/display interpretations.
- [x] Finalize the three docking action payloads and explicit stop/cancel semantics. Move hardware sequences to the rover rather than making the server select non-Roomba versus Roomba opcode sequences.
- [x] Define minimal command acceptance/result handling for asynchronous docking operations and unsupported actions.
- [x] Ensure unchanged state does not stall server timers; hardware-read freshness is separate from the age of an unchanged state snapshot.

### 2. Official roverd state reporting

- [x] Extend state types and hardware sample extraction in `wsclient.go`, `sensor_defs.go`, and `sensor_stream.go`.
- [x] Calculate `battery.percent`, `low`, `critical`, `charging`, and `needsCharge` locally using the agreed behavior. No `batteryFull` field.
- [x] Track driving mode, docking, contact, and charging locally; handle commands and subsequent hardware observations consistently.
- [x] Keep headlight/laser state updates and send complete snapshots on connect/change.
- [x] Coordinate local autocharge with the same state interpretation.
- [x] Implement undock, dock assist, and auto dock using the existing Roomba behavior, local deadlines, and shared dock-seek handling. Preserve cancellation and safety integration.
- [x] Rebuild the committed architecture binaries when implementing the Go changes.

### 3. Server authority and state consumers

- [x] Extend state ingestion/validation and roster delivery in `roverConnectionService` and `roverManager/rosterLifecycle.js`.
- [x] Remove independent dock/battery sources and sensor-derived fallbacks for agreed state fields.
- [x] Trigger operational transitions from state messages, even when no sensor messages arrive.
- [x] Update `batteryManager`, assignment ranking, rover leave rules, idle-undock protection, and help detection.
- [x] Update `dockingService` state inputs and preserve server-owned command protection/operation progress separately.
  - Keep manual-assist UI and server command restrictions. Move assist camera handling and speed limits into roverd. Relocate physical undocking/contact/charging sequences and their deadlines to roverd; server pending/error presentation follows command outcomes and rover state.
- [x] Replace normal server-generated raw Roomba docking sequences with the three action requests, including automatic dock guard. Keep ordinary drive commands unchanged.
- [x] Convert idle-service dock-all and the All Dock (`dockPanic`) reward from raw opcode 143 to the standard auto-dock action. Audit other command producers, not just the docking UI.
- [x] Update command dispatch paths that assume Roomba mode or send Roomba-specific automatic commands, including battery-warning songs.
- [x] Update operator status commands, chat context, Overseer, and commentary.
- [x] Update Discord status/announcements, replay snapshots, and rover-learning recording/policy inputs where they depend on these fields.
- [x] Remove fleet reporting end to end, including battery-session qualification logic; it no longer imposes state-field requirements.
- [x] Remove the fleet database requirement from backup creation, manifest/schema inspection, and restore. Remove Discord daily-report scheduling and report feature/configuration wiring.
- [x] Remove rover odometry end to end while retaining wheel-speed sensor calculation and all shared safety consumers. Keep directly reported sensor speeds usable without retaining distance tracking.
- [x] Remove odometer session snapshots and socket subscription/update paths as well as its UI and persistence.

### 4. Direct JSON sensors

- [x] Separate Roomba decoding from shared sensor processing in `roverManager/sensorPipeline.js`.
- [x] Accept validated JSON readings without constructing Roomba packets.
- [x] Route both inputs through existing browser sensor delivery and relevant safety processing.
- [x] Preserve absent/unknown readings instead of manufacturing false/zero values.
- [x] Extract and retain wheel-speed calculation as sensor processing while removing distance/odometer tracking. Preserve directly reported wheel speeds and their safety consumers.
- [x] Ensure raw charging/battery diagnostics never replace authoritative rover state.

### 5. UI consumers

- [x] Update shared telemetry/state selectors in `context/telemetryViews.js`, `TelemetryContext.jsx`, and the control pipeline as needed.
- [x] Remove battery recalculation from `lib/battery.js`; render reported percentage and flags.
- [x] Update drive/dock controls and overlays to use explicit state rather than OI mode.
- [x] Update battery overlays, driver/spectator HUDs, roster, queues, desktop/mobile controls, mini summary, and server display.
- [x] Keep raw electrical and Roomba diagnostics in telemetry views where useful.
- [ ] Verify existing sensor widgets with live direct JSON readings and unavailable fields in the browser; input validation and selector changes are implemented.
- [x] Preserve accessory hello/command behavior; add no generic accessory feedback mechanism.
- [x] Keep raw OI commands and sensor-stream restart controls out of generic docking actions. Review browser command helpers so non-Roomba actions do not implicitly send these requests.

### 6. One complete protocol reference

- [x] Create `docs/rover-protocol.md`, checked against the implementation.
- [x] State the support boundary prominently: only this repository's roverd is officially supported; the document describes the current interface, and custom clients must track changes themselves.
- [x] Document `/rover` and `/rover/management`, connection identity, hello payloads, heartbeat, reconnect, and disconnect behavior.
- [x] Document every roverState field and state ownership rule.
- [x] Document both sensor input formats, all supported fields/nesting/units, and their UI destinations.
- [x] Document commands, values/units, IDs, acknowledgements, errors, and Roomba-specific operations.
- [x] Document undock, dock assist, auto dock, interruption, and operation outcomes; distinguish user-driven assistance from autonomous seeking.
- [x] Document accessory hello descriptions and generic accessory command addressing.
- [x] Document management schema/config messages, profiles, output/events, host stats, reboot, update, and update status.
- [x] Document media publishing paths/naming needed by a rover implementation.
- [x] Include a minimal non-Roomba example from hello through state/sensors and a drive command acknowledgement.
- [x] Distinguish required core messages from optional management/media features based on actual server requirements.

## Verification and completion

Use focused existing checks and direct runtime verification where practical. Do not create or expand tests without the user's authorization. Hardware/server/browser verification must be reported separately from syntax or build checks.

- [ ] A Roomba roverd reports all agreed state fields correctly, including reconnect and unknown readings.
- [ ] A non-Roomba connection can report state without Roomba sensor frames; roster, battery, dock/drive UI, and server policies react.
- [ ] Direct JSON sensor readings reach the existing widgets without packet emulation.
- [ ] Unsupported/missing data does not become false, zero, or misleading safety state.
- [ ] Roomba-specific automation is not applied to a non-Roomba connection.
- [x] Audit remaining references to `chargingSources`, `chargingState`, OI mode, `batteryState`, and duplicate `docked` values; retain only justified hardware/diagnostic uses.
- [x] Protocol examples match the final implementation.
- [x] Fleet reports and rover odometry have no remaining active service, API, UI, or scheduling paths; affected shared safety consumers are accounted for.
- [ ] Wheel-speed reporting and protection remain functional after odometer removal.
- [ ] All three docking actions, explicit cancellation, neutral input during undocking, control/connection loss, deadlines, and protection work across the new ownership boundary.

## Progress log

- 2026-11-19: Read-only investigation completed across state/sensor transport, roverd sampling, battery/docking/safety consumers, UI selectors, accessories, and reporting integrations. Agreed scope recorded here. No implementation or runtime verification performed.
- 2026-11-19: Clarified that only the repository's roverd is officially supported. The communication reference introduces no third-party compatibility or protocol maintenance commitment.
- 2026-11-19: Recorded the nested battery object and charging-recovery semantics. User requested removal of fleet reports and rover odometry, and authorized simplifying the completion sound rather than preserving its separate 100% rule. Implementation has not started.
- 2026-11-19: User explicitly retained wheel-speed calculation. Added the agreed undock/dock-assist/auto-dock boundary, relocation of Roomba sequences into roverd, and bounded cancellation/result work. Ordinary driving and accessory commands are not being redesigned. Implementation has not started.

- 2026-11-21: Implemented the state contract in roverd, server, and UI; direct JSON sensors share the existing delivery/protection path. State-only readouts no longer require a sensor frame.
- 2026-11-21: Moved physical docking into roverd. The server retains assist presentation, permissions, and protection. Undock uses existing command IDs plus a final commandResult; local deadlines, disconnect, management shutdown, and cancellation stop the sequence. There is no new Stop button.
- 2026-11-21: Battery recovery history is saved as one boolean in /var/lib/roverd/battery-needs-charge.json. Waiting duration restarts after missing readings or daemon restart. Existing near-full lock-entry exception remains; unknown state cannot release battery locks.
- 2026-11-21: Removed fleet reporting, Discord scheduling, backup/restore database requirements, odometer persistence/subscriptions/UI, and uplot. Encoder-derived wheel speed remains separate sensor processing.
- 2026-11-21: Added docs/rover-protocol.md. Master README remains untouched. Driving-model input semantics now use roverState; existing model version advanced to 6, so old models require retraining.
- 2026-11-21: Local validation covers Go compilation for all four committed architectures, WebUI production compilation, changed JavaScript syntax, focused UI lint, and direct state/sensor/config validator calls. Deployment, actual charging recovery, physical docking/protection, and browser rendering remain unverified here. The unchecked verification items above are the deployment checklist, not claims of completed hardware testing.

- 2026-11-21: Replaced the incomplete protocol overview with a detailed implementation reference after user review. Added OI-specification sensor ranges/encodings/enums/bitfields and firmware caveats, JSON validation and UI scales, all peripheral control types and local output/role declarations, full command examples, management payloads/events, and host-stat units. Documented existing reserved-field names, stasis information loss, and ignored command fields rather than implying missing behavior is implemented. Documentation only; runtime code and master README unchanged.

- Follow-up after rover deployment: restored the original reported OI mapping (off=1, passive=2, safe=3, full=4). The shifted mapping mislabeled passive in Discord and prevented the undock reverse stage from recognizing Full. Preserved Start → Seek Dock → Full, settling delays, backoff preference, maximum-speed/protection settings, contact-based stop, and timeouts; restored sensor-stream restart after mode commands.
- Dock assist is now rover-owned including camera angle and 60 mm/s limit. It ignores requests while docked, restores the previous camera angle when ending, and reports dockAssist in roverState. Server no longer positions the camera or implements assist speed reduction. Requires server and rover update together; physical verification remains pending.
- Follow-up verification: all four architecture binaries and the production WebUI built successfully; changed server JavaScript syntax and diff whitespace checks passed. Physical dock/undock and assist behavior require deployment testing on a rover.

- Docking follow-up: docking now derives from passive mode and absent dock contact. Restored assist entry/exit/contact/contact-loss sounds; retain assist until charging is confirmed. Both docking paths take control, stop wheel/auxiliary motors on contact, and immediately request charging without a stationary-wheel wait. Local command handling blocks held motor commands while docked; deliberate undocking remains exempt. Hardware verification pending.
