# Rover learning service implementation tracker

## Resume here

Status: recording, bounded dataset/training, permanent named models, live inference,
checked autonomous command submission, and the verified VIP card are coded.
Human commands do not stop or pause autonomy (explicit latest user requirement).
Focused local checks passed; actual recording/training, live autonomous behavior,
concurrent server performance, and browser appearance remain unverified.
The standalone CPU benchmark was run successfully on the actual server.

This document preserves the conversation's decisions across compactions and
usage cutoffs. Keep the checklist and handoff section current during authorized
implementation. Do not treat proposals or open questions as user decisions.

The user explicitly authorized feature implementation with: "okay cool. begin
implementation, use the md to track. IPI". Continue the agreed implementation
without requesting IPI again. Follow the current
AGENTS.md instructions: targeted investigation, minimal edits, no new tests unless
requested, proportional direct verification, and no development processes left
running. This development machine is not the actual rover server.

The user declined the manual server checklist and explicitly asked to continue.
Do not block further work or repeatedly ask them to do it. Preserve the unverified
status and have the reader reject unusable recordings automatically.

Next work: verify the integrated feature against actual recordings and the real
camera/rover pipeline when that environment is available; inspect the VIP card in
the running browser. Do not invent successful driving results or block further
implementation on the previously declined manual checklist.

## Intended product

Learn from ordinary human rover use, then let a user select a saved model and
press Start to have it roam and operate the rover's controls. No destination or
structured route is required. Users should not need dedicated demonstration
sessions before collection becomes useful. Build the complete collection and
training pipeline; do not reduce the intended product to a single-route demo.

Chat is out of scope. The user explicitly dropped it to keep the model compact.
This is a learned control policy, not a language model generating instructions.

Learning useful behavior is an experimental objective, not a guaranteed result
of accumulating recordings. Autonomous performance must be observed; low training
loss or fast inference alone does not establish competent driving.

## Agreed requirements

- One self-contained server service, provisionally `roverLearningService`.
- Minimal integration elsewhere: configuration/startup, command recording hook,
  checked command submission hook, and the necessary UI connection.
- The service owns its video recorder processes. Do not move this feature into
  replay, rover management, turn management, or unrelated services.
- Configuration defaults to disabled. Disabled means no active feature runtime.
- Record every rover control input, video, and all available rover sensors.
- Model inputs use recent control history/current state, useful sensors, and
  video. Model outputs can use the rover's supported operating controls, not just
  wheel speeds. Available hardware/control capabilities must be accounted for.
- Record broadly; choosing training features must not discard raw source data
  prematurely within the configured retention window.
- Retain a reasonable bounded rolling training dataset, with ongoing background
  training. The model architecture/parameter count remains bounded as it learns.
- Periodically publish immutable named model versions. Two random words plus a
  unique identifier/sequence is the proposed naming scheme.
- Keep every published model permanently. No automatic model pruning.
- Users can choose which compatible model controls their rover.
- Add the UI card at the top of the VIP tab, using the existing verified-feature
  mechanism. The card is absent when the feature is disabled.
- Model control must use the same permissions and eligibility rules as manual
  rover control. Verified feature access does not grant rover control.
- Favorites are client-side saved model IDs only. No server favorite/pin state,
  endpoints, or retention behavior tied to favorites.
- All server information needed to populate the card arrives in one coherent
  state object. Action commands remain separate from that state object.

Earlier suggestions to prune old model versions or retain only server-pinned
favorites are superseded. Rolling retention applies to training data, not the
published model catalog.

## Architecture and containment

Proposed internal ownership (not a requirement to scaffold empty directories):

```text
server/src/services/roverLearningService/
  configuration.js       Schema/defaults; no runtime side effects
  index.js               Small enable/disable lifecycle entry point
  runtime.js             Enabled runtime coordination
  recording/             Commands, sensors, video processes, synchronization
  dataset/               Rolling storage, training sampling, retention
  training/              Training scheduling and checkpoint production
  models/                Permanent catalog, names, metadata, publication
  driving/               Inference sessions and action scheduling
  workers/               Python model/training implementation
  socketGateway.js       Full card state and authorized user actions
```

Persistent video, datasets, checkpoints, and catalog metadata belong under the
application's existing data-path convention, not the service source directory.
The agreed root is `<data>/rover-learning/`, normally `/data/rover-learning/` in
the deployed container (`SERVER_DATA_DIR`), or `server/data/rover-learning/` with
the default development path. Intended layout:

```text
rover-learning/
  recordings/       Rolling video/events/session metadata (implemented)
  models/           Permanent UUID directories: weights.pt and model.json
  training/         resume.pt, schedule.json, and current job.json
```

Training/model directories are created only when service and training are enabled.
Session/model manifests and a small scheduling ledger are sufficient at present;
the previously proposed catalog.sqlite is not needed or created.
Python compute and video processing must not block the Node event loop. Worker
dependencies, deployment packaging, and process shutdown must be included in the
implementation plan; installing Python packages at server startup is not assumed.

The outside command system should know only about optional observation and
checked submission. It should know nothing about model architecture, datasets,
training, model names, or video recorders.

### Existing integration findings (recheck before edits)

- `server/index.js` explicitly loads services.
- `server/src/configuration/definition.js` assembles service-owned configuration
  fragments. `configuration/index.js` provides live reload handlers.
- `server/src/services/commandService/index.js` exports `issueCommand()` and
  `commandEvents`. Existing `observation` events intentionally omit payloads;
  they are analytics events and insufficient as training examples.
- `issueCommand()` is a low-level send function. Many authorization, turn,
  cooldown, private-drive safety, and overcurrent checks occur in the browser
  command handler before calling it. Direct autonomous calls must not bypass
  those checks.
- `roverManager.managerEvents` already emits decoded `sensor` events and rover
  lifecycle events. The sensor event is not necessarily every raw telemetry field;
  inventory what is available before claiming complete sensor capture.
- `fleetReportService` demonstrates subscriptions and configuration lifecycle,
  but its persistent storage/lifecycle is not automatically the desired disabled
  behavior for this new service.
- `replayEngineV2` demonstrates FFmpeg capture and RTSP/TCP source handling. Reuse
  applicable media conventions without making this feature depend on replay
  being enabled or sharing replay's retention ownership.

### Command recording

Proposed optional observation contract includes timestamp, rover, operator/source,
requested command payload, dispatched payload, outcome, and command ID where
available. Requested and dispatched values can differ due to safety processing.
Distinguish dispatched/acknowledged commands from measured physical execution.

Record human, autonomous, and service-generated commands with distinct provenance.
Autonomous predictions are not automatically correct human training labels.
Include rejected/ignored outcomes where relevant; do not present them as executed
actions. Inventory control paths outside the common browser command handler so
camera/accessory controls are not silently omitted.

The hook only enqueues bounded work. Recording failures or disk pressure must not
block/fail manual command delivery. Preserve the existing payload-free analytics
event contract instead of putting detailed recordings into general logging.
Requested payload snapshots must precede any in-place command transformation.

### Checked command sending and ownership

Proposed implementation: extract a reusable checked submission path from the
current browser command handler, preserving existing manual behavior. Autonomy
submits on behalf of its initiating user's actual control context. Do not invent
an admin identity or send directly to the rover WebSocket.

Recheck permissions server-side for actions and continued control. Losing the
turn/assignment/connection or otherwise losing eligibility stops the autonomous
session. A safe stop must still be possible after ordinary permission is revoked.
Explicit user decision: incoming human commands do not stop or pause autonomy.
Both pass through the existing checked command path; subsequent model commands
can replace human commands. Stop remains explicit, with permission/disconnect,
stale input, and worker failure stops. Model-influenced sessions are excluded
from human demonstration recording, including manual inputs during autonomy.

Model actions describe operating controls, not arbitrary server maintenance.
Inventory reboot/update/raw commands and capability restrictions explicitly rather
than allowing unrestricted command dictionaries from model outputs.

### Disabled lifecycle

Only configuration metadata and a small lifecycle handler remain registered while
disabled, to support live enablement. Lazy-load runtime modules on enable.

When disabled there are no feature recording subscriptions, command observers,
video/Python workers, runtime timers, dataset scans, open feature databases,
created directories, inference/training, or feature socket handlers. The existing
config/feature mechanism hides the card without starting this runtime.

On disable: stop autonomous motion, detach observers, stop and await owned child
processes, flush/close storage appropriately, remove socket handlers/timers, and
release runtime state. Preserve all saved data/models. Serialize enable/disable
transitions so overlapping reloads cannot leave duplicate workers or listeners.

## Data and model design

The benchmark architecture is a representative workload, not a selected final
policy. It uses four RGB frames at 160x120, 32 sensor and 32 control/state values
per frame, a spatial CNN and GRU, eight continuous outputs, and sixteen button
logits. These counts are placeholders, not the actual rover control schema.

- Past controls/current state are inputs; the human's next action is a training
  target. Avoid future-action leakage into model input.
- Maintain temporal coherence. Independent guesses can hesitate or oscillate;
  multiple human intentions must not simply average into meaningless controls.
- Continuous controls and discrete button/toggle events require different output
  semantics. Do not retrigger a one-shot action every inference tick.
- Include camera pose/state when available, and supported control capabilities.
- Preserve synchronized timestamps and sequence boundaries. Server receive time
  does not prove which frame the remote driver saw. Exact displayed-frame timing
  may need a small frontend timing hook; that is not yet designed or authorized as
  a settled integration requirement.
- Human takeovers/corrections are valuable demonstrations. Do not indiscriminately
  discard playful behavior: the goal includes human-like unstructured roaming.
- An action timeout/stale-video stop and existing hardware safety remain outside
  the model's learned decision-making.

Training proposal: shuffle windows from retained sessions, including recent and
older examples. Publish after a configured amount of training work, potentially
with a minimum elapsed interval. Steps/examples are less ambiguous than epochs
over a continuously changing dataset. Continue training independently of active
inference; published models are immutable and do not change beneath a session.

Background work should be resource-limited and lower priority. Pausing after
sufficient reuse of unchanged data is proposed; continuous repeated passes are
not automatically useful. A small reserve of older valuable sessions was suggested
to reduce forgetting but is not a settled retention requirement.

Training readers must not lose files mid-batch to retention. Publish checkpoints
atomically so clients cannot select partially written models. Store sufficient
architecture, feature/action schema, normalization, and training metadata to load
each permanent model correctly or report it as incompatible.

## Model catalog and UI mechanics

Proposed model names: `curious-otter-0042`, `amber-finch-0043`. Names are display
labels; stable unique IDs are used for selection and local favorites. Record
creation time, architecture/schema identity, training progress, and dataset
provenance/summary. Never assume a newer model is better.

Card scope: model selection with local favorites, Start/Stop, current session
status, and compact training status. Reuse current VIP appearance and existing
settings persistence rather than inventing a new storage layer. UI implementation
locations have not been inspected yet.

Illustrative single state object (not a finalized protocol):

```js
{
  available: true,
  roverId,
  control: { canStart, canStop, reason },
  session: { status, modelId, startedBy, startedAt },
  models: [{ id, name, createdAt, trainingSteps, compatible }],
  training: { status, examplesProcessed, latestModelId }
}
```

Derive per-user permissions on the server and recheck on execution. State updates
should be coherent and event-driven/coalesced, not broadcast at camera frequency.
The permanent catalog can grow; avoid blocking command handling while assembling
or delivering card state. Any future pagination must preserve the user's single
card-state contract rather than silently introducing independent UI data feeds.

Selection semantics proposed earlier: stop before switching an active model,
reset temporal state, and resume only explicitly. Confirm exact behavior as part
of UI design. Client favorites do not affect server retention or permissions.

## Hardware and measured feasibility

Actual server: Fedora 43, two Xeon E5-2620 v4 processors, 16 physical cores / 32
threads, AVX2, about 125 GiB RAM with 118 GiB available in the initial sample.
The server only runs the rover server. Approximately 80% CPU idle was measured
under normal working load, not on an otherwise idle test machine.

The relevant benchmark is the custom vision/control workload, not the earlier
Qwen text benchmark. Server run: Python 3.14.7, PyTorch 2.14.0+cpu, FP32,
488,008 parameters, four RGB frames at 160x120. Training batch size 16.

| Mode | Threads | Rover/training batch | p50 ms | p95 ms | Max ms | Examples/s | CPU cores used | Peak MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Inference | 4 | 1 | 5.8 | 8.0 | 16.5 | 165.43 | 3.97 | 321 |
| Inference | 4 | 2 | 10.4 | 13.6 | 24.1 | 187.39 | 3.96 | 334 |
| Inference | 4 | 4 | 18.7 | 25.1 | 34.1 | 207.08 | 3.96 | 357 |
| Inference | 8 | 1 | 4.4 | 5.9 | 12.9 | 219.98 | 7.95 | 318 |
| Inference | 8 | 2 | 7.5 | 9.2 | 13.2 | 272.28 | 7.95 | 330 |
| Inference | 8 | 4 | 15.3 | 17.5 | 26.0 | 263.88 | 7.81 | 359 |
| Inference | 16 | 1 | 4.9 | 7.3 | 23.1 | 191.94 | 15.77 | 318 |
| Inference | 16 | 2 | 7.5 | 10.9 | 21.0 | 257.54 | 15.76 | 333 |
| Inference | 16 | 4 | 11.6 | 17.9 | 33.6 | 319.84 | 14.98 | 359 |
| Training | 4 | 16 | 210.7 | 227.4 | 245.5 | 75.36 | 3.79 | 655 |
| Training | 8 | 16 | 141.2 | 172.8 | 176.5 | 108.57 | 7.09 | 673 |
| Training | 16 | 16 | 121.6 | 228.9 | 263.4 | 112.37 | 13.29 | 669 |

Inference latency is per entire batch, not per rover within it. CPU measurements
are saturation runs, not paced 10 Hz operation. Eight threads is a promising
starting point, not a finalized resource allocation. At 10 Hz there are 36,000
training windows per recorded rover-hour; one pass takes about 5.5 compute-only
minutes at eight threads. Dataset hours and repeat passes multiply that cost.

Limits: synthetic data/random weights, no decoding/resizing/network/dataset I/O,
no concurrent inference and training, and no measured autonomous driving quality.
The target of 10 decisions/second is provisional. A larger model or higher image
resolution requires renewed measurement. These results do not mandate a GPU.

Approximate storage for this architecture: 1.9 MiB FP32 inference weights; 5.6 MiB
for weights plus Adam optimizer state, before metadata/serialization overhead.
One hundred inference versions are about 186 MiB. Dataset video dominates storage.
Published inference artifacts and resumable training state need not be identical.

## Open implementation decisions

- Exact operating-control catalog, continuous/event action encoding, capability
  masking, selected sensors, model architecture/history, and update rate.
- Dataset disk budget, segment format, sampling strategy, session quality markers,
  and whether to retain a reserved historical subset.
- Time alignment between video observed by the driver and command generation.
- Python packaging, IPC, process supervision, CPU limits, and worker failure policy.
- Checkpoint cadence/names, resume-state retention, evaluation metadata, and how
  new versions become selectable. Do not add an unrequested admin approval flow.
- Exact ownership/takeover behavior, disconnect/turn-loss handling, model switch
  behavior, and which user may stop an active session under existing permissions.
- Card fields and existing client persistence mechanism; current UI paths still
  need targeted inspection.

## Implementation checklist

- [x] Discuss scope: autonomous roaming, full rover controls, no chat.
- [x] Add standalone CPU benchmark and verify its execution locally.
- [x] Obtain and interpret results from the actual server.
- [x] Record containment, default-disabled behavior, VIP placement, permissions,
  permanent model retention, client favorites, and single card-state requirement.
- [x] Obtain IPI for feature implementation.
- [ ] Inspect remaining UI/control paths and settle concrete contracts.
- [x] Add service-owned config and dormant lifecycle integration.
- [x] Add optional detailed command observer and shared checked submission path.
- [ ] Implement timestamped recording, video worker ownership, and bounded dataset.
  Code is implemented for common commands, raw/decoded rover sensor frames,
  host stats, and existing rover state events. Live video/timing/retention
  verification and full control-path inventory remain; do not mark complete yet.
- [x] Implement feature/action encoding and training worker with resource limits.
  Runtime import/dependency checks passed; training on actual recordings is still
  unverified. The current schema limits and next inference work are described below.
- [x] Implement atomic checkpoint publication and permanent model catalog.
  Code complete; no actual-data published checkpoint has been produced locally.
- [x] Implement model inference, ownership, explicit stops, and worker cleanup.
  Human input does not stop autonomy; live execution remains unverified.
- [x] Implement service socket gateway with complete per-user card state.
- [x] Implement verified VIP card at top, model selection, local favorites, controls,
  and expandable diagnostics. Browser appearance remains unverified.
- [ ] Verify disabled startup and enable/disable cleanup directly.
- [ ] Verify manual-control behavior remains intact and autonomous permission loss
  stops motion using an appropriate authorized runtime.
- [ ] Measure real video pipeline and concurrent training/inference on the server.
- [ ] Evaluate autonomous behavior with supervised rover runs before claiming
  useful driving performance.

Verification must follow user policy: no new/expanded tests unless explicitly
requested; use existing small relevant checks or actual affected runtime. Do not
automatically run full suites/builds. Hardware/server checks must be handed to
the user when the development environment cannot perform them.

## Handoff log

### First implementation increment

Implemented files:

- `server/src/services/roverLearningService/configuration.js`: default disabled;
  recording budget 20 GiB, minimum free space 2 GiB, session duration 300 seconds.
  These are initial implementation defaults, adjustable in the existing admin
  configuration editor, not measured final production sizing.
- `server/src/services/roverLearningService/index.js`: serialized lifecycle bridge;
  lazy runtime require; no recording side effects while disabled.
- `server/src/services/roverLearningService/runtime.js`: enabled-only subscriptions,
  recorder ownership, bounded startup/rotation event buffering, retention scheduling,
  disconnect/rotation handling, and signal/disable cleanup.
- `server/src/services/roverLearningService/recording.js`: per-session metadata,
  bounded NDJSON output, and FFmpeg RTSP/TCP video packet copy into Matroska.
  No camera re-encoding, Python process, training, or autonomous commands yet.
- `server/src/services/roverLearningService/storage.js`: oldest-first recording
  retention, free-space enforcement, and interrupted-session recovery.
- `server/src/services/commandService/recording.js`: optional failure-isolated
  request/dispatch/result/ack observer with payload snapshots and IDs. Source is
  `client` or `server`; browser automation is not falsely classified as proven
  intentional human action. Async safety timers do not retain client attribution.

External changes are limited to startup, configuration definition, command-hook
wiring, and adding the new feature to an existing configuration test's expected
feature list (required by the feature addition). No new tests were created.
Raw sensor capture reads `lastSensor.raw` during the existing synchronous sensor
event; rover manager/sensor pipeline did not need modification.

Recording format:

```text
recordings/<unix-ms>-<uuid>/
  session.json      Schema version, rover/session identity, timing description,
                    start/end/reason/error, loss count, video exit information
  events.ndjson    Unix ms + process monotonic ns, kind, data
  video.mkv        Original video codec; receiver wall-clock PTS retained
```

Request/dispatch/ack IDs let later training join requested and applied commands.
The recorded `source` is provenance, not proof of a correct demonstration.
Queued events preserve their observation timestamp; file order around a new
session's snapshot is not necessarily chronological. Sort by timestamps when
constructing training windows. Rotations can have video gaps; do not train across
session boundaries as if footage were continuous.

Limits and follow-up:

- Retention is checked every 15 seconds and is a soft disk budget, not a filesystem
  quota. Active files are closed before becoming eligible for pruning. Low free
  space pauses capture. Models/training paths are never traversed by retention.
- Record only rovers with a connected human driver who currently passes the
  existing control checks, including deterrence. Membership is required even for
  admins so an admin login alone does not record unattended rovers. Preserve pauses
  within an eligible human-control session. Driver/turn/mode/permission changes
  reconcile recording immediately; telemetry buffering uses the same eligibility.
  This supersedes the initial all-connected-rovers policy at the user's request.
  Autonomous sessions will need explicit exclusion/provenance when implemented;
  there are currently no autonomous controllers.
- Each event stream has a 2 MiB pending-write bound; startup/rotation buffering has
  a shared 4 MiB bound. Session loss counters/capture-gap events identify overload.
- Video timestamps represent packet receipt at this server, not the frame a human
  browser displayed. Actual FFmpeg output PTS still needs inspection on the server.
- Enabled recorders are stopped on disable and awaited; process-exit hooks kill
  surviving children. Existing MediaMTX shutdown can exit the whole Node process
  before async metadata flush finishes; next enable marks those sessions interrupted.
- Storage leases for concurrent training reads are pending with dataset sampling.
- Safe command submission extraction, autonomous provenance, model selection,
  client favorites, and UI remain pending. Training/catalog code follows below.

Verification completed:

- `node --check` on new recording/lifecycle modules and modified command service:
  passed (repeat only for subsequently changed modules as needed).
- `node --test server/src/configuration/configuration.test.js`: 14 passed, 1 failed.
  The failing pre-existing default-values assertion omits
  `$.discord.channels.liveStatus`; the current HEAD already defines it as empty.
  New configuration validation, descriptions, normalization, and feature flags
  passed. Leave the unrelated Discord assertion untouched.
- Direct disabled service startup with a disposable `SERVER_DATA_DIR` returned
  `{"runtimeLoaded":false,"storageCreated":false}` and exited normally. Temporary
  configuration storage was removed. No development service was left running.
- Local FFmpeg help confirms the RTSP transport and timeout options used.
- No full build, full lint, new tests, live server startup, or rover hardware run.

Optional server verification reference (user declined doing this checklist;
do not require it before continuing implementation):

1. Deploy normally, initially disabled; confirm no `rover-learning` directory or
   learning FFmpeg workers are created by a fresh disabled startup.
2. Enable `roverLearning.enabled` through the existing admin configuration. An
   online unattended rover must not produce recordings. Take human control and
   confirm session files appear beneath the actual data mount; pauses should keep
   recording. Release control/disconnect the last eligible driver and confirm
   capture stops. Repeat across turn changes and mode/permission changes.
3. Drive, move the camera, and operate accessories. Check that event records contain
   requested and dispatched payloads with matching IDs, sensor frames, and host stats.
4. For a completed session, inspect video with:
   `ffprobe -v error -select_streams v:0 -read_intervals '%+#3' -show_entries packet=pts_time,dts_time -of json /actual/session/video.mkv`.
   Compare packet timestamps (seconds) with event timestamps (milliseconds).
   Report FFmpeg/session errors rather than assuming timestamp alignment is correct.
5. Disable: confirm owned FFmpeg processes exit, session metadata closes, no further
   writes occur, and saved recordings remain. Re-enable to check clean restart.
6. Verify rotation and retention with an intentionally chosen small recording
   budget, and confirm manual driving remains responsive during recording.

Actual server capture/timing and live cleanup remain unverified. These steps are
a reference for future runtime investigation, not a pending request to the user.

### Dataset/training/checkpoint increment

The user supplied IPI, then asked to continue after a rate-limit interruption.
Authorization remains in effect. Implemented:

- `workers/policy.py`: fixed-size spatial CNN/GRU with 64 action-shape slots and
  up to 8 numeric output fields per shape. Four 160x120 RGB frames, spaced roughly
  300 ms apart, with 32 selected sensors plus missing-value masks and previous
  command values/ages/known flags. About 805k parameters (larger than the benchmark).
- Numeric controls are normalized with `2/pi * atan(value/scale)`; the model
  produces per-shape event logits and numeric values for the next 100 ms.
  Command types supported: drive, motors, servo, headlight, laser, horn, peripheral,
  song, raw. Strings/bools/arrays remain exact template constants; variable-size
  songs/raw OI payloads are discrete demonstrations, not generated arbitrary bytes.
  Maintenance commands, audio/text and sensor-stream setup are not action targets.
  All recordings remain intact until normal dataset retention, regardless of
  whether the trainer can use their commands.
- The schema grows only into unused fixed slots and is saved with each model.
  Overflow (64 shapes/8 numeric fields/4096-byte commands) skips the affected
  recording with a reason instead of silently truncating controls. This is a
  concrete initial encoding limit, not a promise to represent unlimited hardware
  or arbitrary song libraries. Revisit it if real recordings exhaust capacity.
- `workers/dataset.py`: bounded event loading (64 MiB/session), PyAV decoding,
  absolute timestamp checks, causal sensor/action history, accepted-client-command
  targets, and masks for observed action slots. Actual measured wheel speeds are
  among the selected sensor inputs. Missing/stale sensors, video gaps, clock shifts,
  incomplete recordings, data loss, and ambiguous conflicting actions are excluded.
  Server-generated control overrides are history/boundaries, not demonstrations.
- Validation is automatic and cannot establish what frame a browser displayed.
  A session is only accepted after its video finishes decoding; samples from a
  subsequently corrupt session are discarded. Commands/sensors at future times
  do not enter observation history.
- `workers/train.py`: finite CPU jobs, lower OS priority, shuffled bounded reservoir
  sampling, sparse-event classification plus masked numeric regression, gradient
  clipping, finite-loss checks, and AdamW resume state. Never sends rover commands.
- `training.js`: one owned worker, recording leases acquired within serialized
  maintenance, bounded stdout/stderr, interval and wall-clock limits, shutdown,
  persistent per-recording visit/rejection ledger, and progress state for the
  future card. Retention protects leased recordings. Disk pressure cancels the
  training job before files become eligible for pruning again.
- Atomic `training/resume.pt` includes model and optimizer state, schema, cumulative
  steps/examples, and publication progress. Permanent model directories are
  atomically renamed into visibility with weights and metadata together.
- `models.js`: reads the permanent metadata catalog. Each model has a UUID, two-word
  generated name plus UUID suffix, creation time, steps/examples, schema, source
  session IDs, trained rover IDs, training loss, parameter count, weight hash/size,
  and `evaluation: unevaluated`. No model pruning, favorites, or server pin state.
- Dockerfile packages a CPU-only Python venv at `/opt/rover-learning` during image
  build. Pinned requirements: torch 2.14.0+cpu, NumPy 2.5.3, PyAV 18.1.0. No runtime
  downloads/installers. A disabled service does not load or run these dependencies.

Training defaults beneath `roverLearning.training`:

| Setting | Default |
|---|---:|
| enabled (still gated by outer service enabled=false) | true |
| threads | 8 |
| batchSize | 16 |
| maxSamples / minimumSamples | 1024 / 128 |
| passesPerJob | 2 |
| roundsPerSession | 3 |
| maxStepsPerJob | 200 |
| checkpointEverySteps | 100 |
| intervalSeconds | 60 |
| maxJobSeconds | 600 |

Defaults tuned to the user's dual E5-2620 v4 server benchmark: eight training
threads improved throughput substantially over four, while sixteen gave little
additional benefit. The larger sample pool and shorter interval are starting
choices for its available resources, not measured learning-quality improvements.
Inference remains four threads per rover. Existing explicit configuration values
override these defaults; this change does not rewrite deployed configuration.

At most four completed retained sessions are selected per job. Samples are spread
over each full video via reservoir sampling, not always taken from its beginning.
The rounds limit is sampled training visits, not full passes over all recorded
frames. Once retained data reaches that limit, training waits for new sessions.
Candidate publication happens at job boundaries after enough accumulated steps;
it does not automatically deploy a model. No all-no-action sample pool is trained.

Container rebuild is needed to include Python packages. For a non-container
deployment, install `workers/requirements.txt` into a dedicated venv and set
`training.python` to its Python path. The default path is container-specific.

Verification performed in this increment:

- Installed the actual pinned requirements in `/tmp/rover-bench-check-env`.
- Ran the production worker's `--check-dependencies`: PyTorch/PyAV/NumPy imports,
  dataset imports, policy construction, and specification output succeeded.
- Four existing focused configuration tests passed (defaults, descriptions,
  generated feature paths, normalization). The unrelated prior Discord default
  assertion was not rerun or changed.
- Node syntax checks on scheduler/runtime/catalog passed.
- No new tests, fake recording fixtures, or throwaway test programs were created.
- No real recordings are available locally. Actual decoding/alignment, optimizer
  execution against recordings, checkpoint publication/resume, and concurrent
  server performance are not claimed verified. No full container build was run.

The following controller/UI increment implements those remaining code paths.
Real-data and live-hardware verification still remain before claiming usable autonomy. The initial model is an experimental imitation policy, not a demonstrated
competent driver or a final architecture choice.

When resuming after implementation begins, append concrete changed files, commands
run/results, unresolved failures, decisions approved by the user, and the next
bounded task here. Do not mark a checkbox complete merely because code exists;
record verification limits and outstanding server/hardware work explicitly.


### Controller and VIP card increment

- `commandService/index.js` exports the existing checked handler as `submitCommand`;
  browser behavior remains in the same handler. Recording distinguishes model
  requests from human requests without changing command payloads.
- `driving.js` owns per-rover CPU workers under the initiating live socket's
  permissions. Explicit Stop, permission/connection loss, stale predictions, or
  worker failure stop the session and send zero drive/motors and horn stop.
  Human commands deliberately neither stop nor pause the model.
- `workers/infer.py` consumes live RTSP/TCP video plus sensor/command observations,
  uses the training history format, validates weights/specification, resolves
  competing command families, and latches discrete actions. It never writes to
  the rover directly. Driving defaults: four CPU threads, 0.7 action threshold,
  2000ms stale limit, with a 30-second worker startup allowance.
- `capabilities.js` matches recorded hardware control profiles against the target
  rover. Recordings, resumable training state, and published manifests preserve
  those profiles; models without a matching profile are not selectable for Start.
- `runtime.js` excludes autonomous sessions from human demonstrations, manages
  controller shutdown, and supplies bounded recent activity and storage state.
- `socketGateway.js` emits one complete authorized card object every second to
  subscribers, refreshes the permanent catalog every 15 seconds, and accepts
  checked Start/Stop actions. No server-side favorites are stored.
- `VipRoverLearningCard.jsx` is at the top of the verified VIP tab, gated by the
  service feature flag. It uses existing CardFrame, field/button/surface styles;
  favorites use browser settings. Its expandable section includes storage,
  recording sessions, dataset rejection reasons, training progress/resource
  limits, model size/loss/control count, inference timing, last action, and events.
- Verification: focused ESLint on the new card and VipPanel passed; four existing
  configuration tests passed. The live worker's actual `--help` entry point loaded
  PyTorch/PyAV/NumPy successfully. Shared-handler diff reviewed with whitespace
  ignored: extraction preserves the previous command handler logic.
- No real dataset, checkpoint, camera stream, or rover was available locally;
  end-to-end inference/training and browser rendering remain unverified. No new
  tests or background processes were added for verification, and no full build
  or full test suite was run.
