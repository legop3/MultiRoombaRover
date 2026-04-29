# REFACTOR RULES
- Do NOT change ANY functionality. All changes must be purely internal refactors.
- Refactor for simplification and maintainability.
- Remove unused files/code only when verified unused.
- No backwards compatability is needed anywhere. Clients and the server are both always up to date.
- Keep behavior/API contracts unchanged.

## Required safety checks for every change
- Preserve imports/exports and call signatures unless internal-only and non-observable.
- Validate no runtime behavior changes (manual flow checks + targeted tests when available).
- Make small, reviewable commits per service/component area.
- Treat `npm run build` output files committed into this repo as intentional deployment artifacts; do not discard them as noise.

## Server backend
- Every service must live in its own folder, even when it remains a single-file implementation.
- Convert every service into a folder-based structure.
- Split very large service files into smaller focused modules.
- Keep files concise and single-purpose.
- Add clear title comments at top of split files.
- Every service/module file should start with a descriptive comment header containing:
- a title line naming the service/module file
- a longer purpose/scope description (not a one-liner)

## WebUI frontend
- Every component must live in its own folder, even when it remains a single-file implementation.
- Split large JSX/components and large backing JS files into folderized modules.
- Keep modules clear and focused, with title comments.
- Every component/module file should start with a descriptive comment header containing:
- a title line naming the file/module
- a longer purpose/scope description (not a one-liner)
- Each component must live entirely inside its own folder; do not leave wrapper/compatibility component files outside that folder.
- Remove stale compatibility/leftover code only after usage verification.

# REFACTOR TRACKING
## Current phase
- [x] Phase 1: Inventory + usage mapping (server + webui)
- [x] Phase 2: Refactor highest-impact offenders first
- [ ] Phase 3: Sweep remaining services/components
- [ ] Phase 4: Dead code/file removal pass
- [ ] Phase 5: Final regression validation

## Server backend
### BIGGEST OFFENDERS
- [ ] audio forward service
- [ ] button box service
- [ ] chat service
- [x] discord bot service
- [x] home assistant service
- [ ] llm commentary service
- [x] private rover access request service
- [x] replay services (consolidated under replayEngineV2)
- [ ] room camera services (already partly split; reformat consistently)
- [ ] rover manager service (in progress: constants/state extracted)
- [x] session service
- [x] turn service
- [x] verification service
- [x] video auth service
- [x] All remaining services: reorganize to folder structure where needed

### COMPLETED SERVICES
- turn service
- session service

### LARGE CHANGES
- Folderized all files in `server/src/services/` into per-service folders with `index.js` entrypoints and updated internal relative imports for new path depth.
- Split `server/src/services/turnService/index.js` by extracting constants, shared state helpers, and side-effect action helpers into `turnService/constants.js`, `turnService/state.js`, and `turnService/actions.js`.
- Split `server/src/services/sessionService/index.js` by extracting config/timing constants, sync-throttle state storage, and visibility filter helpers into `sessionService/constants.js`, `sessionService/state.js`, and `sessionService/filters.js`.
- Began splitting `server/src/services/roverManager/index.js` by extracting immutable constants and shared state containers into `roverManager/constants.js` and `roverManager/state.js`.
- Continued `roverManager` split by extracting socket event wiring/handlers into `roverManager/socketHandlers.js` with dependency injection to keep existing behavior unchanged.
- Continued `roverManager` split by extracting numeric/private-safety normalization and battery math into `roverManager/mathUtils.js`.
- Continued `roverManager` split by extracting control lifecycle/switching logic into `roverManager/roverLifecycle.js`.
- Continued `roverManager` split by extracting sensor processing + private safety + dock guard logic into `roverManager/sensorPipeline.js`.
- Finished `roverManager` decomposition by extracting private access policy, roster lifecycle, and spectator/auto-close orchestration into `roverManager/privateAccess.js`, `roverManager/rosterLifecycle.js`, and `roverManager/spectatorAccess.js`; `roverManager/index.js` is now a thin composition layer.
- Hotfix: corrected `llmCommentaryService` prompt file path to `server/prompts/commentary_system.txt` after service folder move.
- Hotfix: added `server/src/helpers/dataPaths.js` and rewired data-backed services to resolve canonical + legacy data-file locations safely after folderization (`adminReason`, `audioLevels`, `buttonBox`, `communityGoal`, `discordGuildStore`, `verification`, `replayEngineV2`).
- Began `llmCommentaryService` decomposition by extracting immutable runtime limits/path/frequency normalization to `llmCommentaryService/constants.js` and pure prompt/text output helpers to `llmCommentaryService/formatters.js`.
- Continued `llmCommentaryService` decomposition by extracting admin/runtime projection + failure-normalization helpers to `llmCommentaryService/runtimeHelpers.js`.
- Continued `llmCommentaryService` decomposition by extracting sensor activity aggregation and snapshot assembly to `llmCommentaryService/snapshotEngine.js`; rewired commentary tick/event flow to use the new engine.
- Continued `llmCommentaryService` decomposition by extracting socket/role/rover event wiring into `llmCommentaryService/hooks.js` and keeping `index.js` focused on orchestration.
- Finished major `llmCommentaryService` decomposition by extracting tick scheduling, run-loop orchestration, and history-reset behavior into `llmCommentaryService/runner.js`; `llmCommentaryService/index.js` is now a thin composition layer.
- Began `audioForwardService` decomposition by extracting permission/path policy helpers to `audioForwardService/policy.js` and rover/turn/socket event wiring to `audioForwardService/hooks.js`; rewired service entrypoint to use extracted modules.
- Continued `audioForwardService` decomposition by extracting ffmpeg worker lifecycle, upload playback, and WHIP ownership/session control into `audioForwardService/workerEngine.js`; `audioForwardService/index.js` is now a thin composition layer.
- Finished `buttonBoxService` decomposition by extracting persisted state management to `buttonBoxService/store.js`, reward/effect workflows to `buttonBoxService/core.js`, and HTTP transport wiring to `buttonBoxService/httpRoute.js`; `buttonBoxService/index.js` is now a thin composition layer.
- Finished `verificationService` decomposition by extracting persisted store handling to `verificationService/store.js`, identity/selector normalization to `verificationService/identity.js`, verification/deterrence/request lifecycle logic to `verificationService/verificationFlow.js`, `verificationService/deterrenceFlow.js`, and `verificationService/requestFlow.js`, plus socket/role event wiring to `verificationService/hooks.js`; `verificationService/index.js` is now a thin composition layer.
- Finished `videoAuthService` decomposition by extracting MediaMTX stream parsing to `videoAuthService/streamParsing.js`, role/mode/stream policy checks to `videoAuthService/policy.js`, and auth HTTP transport wiring to `videoAuthService/httpRoute.js`; `videoAuthService/index.js` is now a thin composition layer.
- Finished `privateRoverAccessRequestService` decomposition by extracting in-memory maps/events/constants to `privateRoverAccessRequestService/state.js`, shared keying/lookup helpers to `privateRoverAccessRequestService/helpers.js`, request/grant business logic to `privateRoverAccessRequestService/core.js`, and rover/socket event wiring to `privateRoverAccessRequestService/hooks.js`; `privateRoverAccessRequestService/index.js` is now a thin composition layer.
- Finished `homeAssistantService` decomposition by extracting shared runtime caches/constants to `homeAssistantService/state.js`, entity/trigger normalization helpers to `homeAssistantService/entityHelpers.js`, automation/state engine logic to `homeAssistantService/runtimeEngine.js`, websocket transport/reconnect lifecycle to `homeAssistantService/transport.js`, and mode/turn/socket event wiring to `homeAssistantService/hooks.js`; `homeAssistantService/index.js` is now a thin composition layer.
- Finished `discordBotService` decomposition by extracting presence rotation/state to `discordBotService/presence.js`, channel/typing transport helpers to `discordBotService/channelIO.js`, command routing and admin command handlers to `discordBotService/commandHandlers.js`, and event-bus/chat-bridge/moderation DM workflows to `discordBotService/integrations.js`; `discordBotService/index.js` is now a thin composition layer.
- Finished `replayEngineV2` decomposition by extracting environment/path constants to `replayEngineV2/constants.js`, mutable runtime state to `replayEngineV2/state.js`, source discovery/worker arg building to `replayEngineV2/sources.js`, ffmpeg worker lifecycle to `replayEngineV2/workerManager.js`, segment indexing/retention/health snapshot logic to `replayEngineV2/segmentStore.js`, sidebar SVG/video rendering to `replayEngineV2/sidebarRenderer.js`, and replay assembly pipeline to `replayEngineV2/replayBuilder.js`; `replayEngineV2/index.js` is now a thin orchestration layer.
- Consolidated replay-related single-file services into `replayEngineV2` by moving cooldown state (`cooldown.js`), user-facing replay source validation/defaults (`replaySources.js`), and replay socket hooks (`socketHooks.js`) into the engine folder; removed obsolete standalone services `replayBuildService`, `replayService`, `replaySourceService`, and `replaySocketService` and rewired dependents to import directly from `replayEngineV2`.

## WebUI frontend
### BIGGEST OFFENDERS
- [x] mini summary app
- [x] spectator app
- [x] vip audio upload card
- [x] admin panel
- [x] drive dock action
- [x] gamepad mapping settings
- [x] mobile controls
- [x] top down map
- [x] video tile
- [x] Sweep `webui` for unused or unneeded files/code with verification

### COMPLETED COMPONENTS
- mini summary app
- spectator app
- video tile
- vip audio upload card
- admin panel
- drive dock action
- gamepad mapping settings
- mobile controls
- top down map

### LARGE CHANGES
- Split `webui/src/mini/MiniSummaryApp.jsx` into folderized modules under `webui/src/mini/MiniSummaryApp/` with a compatibility entrypoint preserved.
- Split `webui/src/spectate/SpectatorApp.jsx` into folderized modules under `webui/src/spectate/SpectatorApp/` with a compatibility entrypoint preserved.
- Split `webui/src/components/VideoTile.jsx` by extracting HUD, overlays, chat input, and constants into `webui/src/components/VideoTile/` while preserving the existing `VideoTile.jsx` public component API.
- Split `webui/src/components/vip/VipAudioUploadCard.jsx` by extracting transport/audio helpers and UI atoms into `webui/src/components/vip/VipAudioUploadCard/` while preserving the existing `VipAudioUploadCard.jsx` import/export API.
- Split `webui/src/components/AdminPanel.jsx` into `webui/src/components/AdminPanel/` and extracted monitor/health/log/LLM helper modules; updated consumers to folder entrypoint and removed external wrapper file.
- Moved `DriveDockAction` to `webui/src/components/DriveDockAction/index.jsx` and updated all consumers to folder entrypoint imports.
- Split `webui/src/components/GamepadMappingSettings.jsx` into `webui/src/components/GamepadMappingSettings/` with extracted constants/helpers/SliderField modules and removed the standalone component file.
- Split `webui/src/components/MobileControls.jsx` into `webui/src/components/MobileControls/` with extracted joystick/aux/constants modules; preserved named exports and moved app import to folder entrypoint.
- Split `webui/src/components/TopDownMap.jsx` into `webui/src/components/TopDownMap/` with extracted geometry/color helpers and visual SVG primitive modules; updated all consumers to folder entrypoint.
- Folderized all remaining top-level files under `webui/src/components/` into per-component `index.jsx` folders and rewired component imports to match the new structure.
- Removed unreferenced components `CameraServoPanel` and `ControlSummary` after dependency-map verification and successful rebuild.

## Done criteria (per item)
- [ ] Folderized structure created.
- [ ] Large functions extracted into focused files.
- [ ] Imports/exports updated with no external behavior change.
- [ ] Verified references/usages still resolve.
- [ ] Passed targeted checks/tests for touched area.
