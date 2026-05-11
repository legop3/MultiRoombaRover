# Dead Code Audit (Static)

Generated: 2026-05-10T21:29:09-04:00

## A) High-confidence never used files
- server/src/services/overseerControlService/tools/chatSay.js (not registered in tools/index.js, no refs)
- server/prompts/commentary_system_backup_small.txt (no refs)
- server/prompts/commentary_system_backup_pre_lobotomy.txt (no refs)
- webui/src/App.css (not imported)
- webui/src/assets/react.svg (no refs)
- server/assets/test-audio.mp3 (no refs)
- webui/public/vite.svg (no refs from app/server)
- webui/dist/assets/index-APFDmmUd.js (build artifact, not runtime-wired)
- webui/dist/assets/index-DoNH_msu.css (build artifact, not runtime-wired)
- dist/dummy1.yml (no refs)
- dist/dummy2.yml (no refs)
- dist/dummy3.yml (no refs)

## B) Unused dependency candidates
- webui/package.json: react-joystick-component (no imports)

## C) Commented-out JSX/UI blocks (never rendered while commented)
webui/src/App.jsx:85:        {/* <SessionSnapshot /> */}
webui/src/App.jsx:153:              {/* {showTelemetry ? <TelemetryPanel /> : null} */}
webui/src/App.jsx:183:      {/* <ControlSummary /> */}
webui/src/App.jsx:211:          {/* <TelemetryPanel /> */}
webui/src/components/QuickstartOverlay/index.jsx:82:          {/* <button type="button" onClick={onClose} className="button-dark px-1 py-0.25 text-[0.8rem]">
webui/src/components/QuickstartOverlay/index.jsx:84:          </button> */}
webui/src/components/QuickstartOverlay/index.jsx:90:          {/* {!isDesktop? <div className='w-full h-1 bg-blue-500'></div> : null} */}
webui/src/components/QuickstartOverlay/index.jsx:116:            {/* <button type="button" onClick={onOpenHelp} className="button-dark px-1 py-0.25">
webui/src/components/QuickstartOverlay/index.jsx:118:            </button> */}
webui/src/components/DriveDockAction/index.jsx:261:            {/* {!isMobile && expanded ? ( */}
webui/src/components/UserListPanel/index.jsx:263:                              {/* {isSelf && <span className="text-[0.7rem] text-white">YOU</span>} */}
webui/src/components/AuthPanel/index.jsx:48:      {/* <div className="flex gap-0.5 text-sm">
webui/src/components/AuthPanel/index.jsx:55:      </div> */}
webui/src/components/ModeGateOverlay/index.jsx:85:          {/* {reasonUpdatedAt ? (
webui/src/components/ModeGateOverlay/index.jsx:89:          ) : null} */}
webui/src/components/ModeGateOverlay/index.jsx:102:        {/* set max height of this box */}
webui/src/components/ModeGateOverlay/index.jsx:108:        {/* <p className="text-xs text-slate-500">
webui/src/components/ModeGateOverlay/index.jsx:111:        </p> */}
webui/src/components/RoomCameraPanel/index.jsx:103:              {/* <header className="space-y-0.5">
webui/src/components/RoomCameraPanel/index.jsx:106:              </header> */}
webui/src/components/DriverVideoPanel/index.jsx:145:          {/* colored button to visit the spectator page */}
webui/src/components/TelemetryPanel/index.jsx:43:      {/* <div className="text-sm text-slate-400">
webui/src/components/TelemetryPanel/index.jsx:49:      </div> */}

## D) Unused exports reported by knip (server)
Unused exports (66)
CHARGING_STATE                   src/helpers/sensorDecoder.js:224:3                         
pickRandomReward                 src/rewards/index.js:44:3                                  
MAX_REASON_LENGTH                src/services/adminReasonService/index.js:97:3              
setAudioLevels                   src/services/audioLevelsService/index.js:153:3             
pushLevelsToRover                src/services/audioLevelsService/index.js:154:3             
isAdmin                          src/services/authService/index.js:80:3                     
isLockdownAdmin                  src/services/authService/index.js:81:3                     
authenticate                     src/services/authService/index.js:82:3                     
isDuplicate                      src/services/chatService/contentFilters.js:57:3            
handleIncoming                   src/services/chatService/index.js:32:3                     
buildTypingPayload               src/services/chatService/index.js:35:3                     
rateBuckets                      src/services/chatService/state.js:44:3                     
buildRoverStatusSnapshot         src/services/discordBotService/batteryEmbeds.js:132:3      
eventBus                         src/services/eventBus/index.js:56:3                        
subscribeAll                     src/services/eventBus/index.js:59:3                        
MAX_GOAL_LENGTH                  src/services/globalObjectiveService/index.js:107:3         
refreshIdleState                 src/services/idleService/index.js:86:3                     
DEFAULT_FREQUENCY_MS             src/services/llmCommentaryService/constants.js:31:3        
MIN_FREQUENCY_MS                 src/services/llmCommentaryService/constants.js:32:3        
normalizeCommentary              src/services/llmCommentaryService/formatters.js:175:3      
enforceLockdown                  src/services/lockdownGuard/index.js:29:3                   
disconnectForLockdown            src/services/lockdownGuard/index.js:30:3                   
parseOverseerOutput              src/services/overseerControlService/runtimeHelpers.js:114:3
TOOL_DEFINITIONS                 src/services/overseerControlService/tools/index.js:87:3    
getToolById                      src/services/overseerControlService/tools/index.js:91:3    
getIdForSignature                src/services/overseerControlService/tools/index.js:92:3    
DM_APPROVE_EMOJI                 src/services/privateRoverAccessRequestService/index.js:25:3
DM_DENY_EMOJI                    src/services/privateRoverAccessRequestService/index.js:26:3
createRequest                    src/services/privateRoverAccessRequestService/index.js:29:3
hasClosedPrivateAccessForSocket  src/services/privateRoverAccessRequestService/index.js:30:3
FFMPEG_BIN                       src/services/replayEngineV2/sources.js:66:3                
upsertRover                      src/services/roverManager/index.js:234:3                   
removeRover                      src/services/roverManager/index.js:235:3                   
setPrivateOpen                   src/services/roverManager/index.js:237:3                   
setPrivateSafety                 src/services/roverManager/index.js:238:3                   
getRoster                        src/services/roverManager/index.js:239:3                   
getRosterForSocket               src/services/roverManager/index.js:240:3                   
broadcastRoster                  src/services/roverManager/index.js:241:3                   
setNightVisionState              src/services/roverManager/index.js:242:3                   
handleSensorFrame                src/services/roverManager/index.js:243:3                   
requestControl                   src/services/roverManager/index.js:244:3                   
releaseControl                   src/services/roverManager/index.js:245:3                   
removeSocket                     src/services/roverManager/index.js:246:3                   
isDriver                         src/services/roverManager/index.js:247:3                   
canDrive                         src/services/roverManager/index.js:248:3                   
enableSpectator                  src/services/roverManager/index.js:249:3                   
disableSpectator                 src/services/roverManager/index.js:250:3                   
getRoversForSocket               src/services/roverManager/index.js:253:3                   
getPrimaryRoverForSocket         src/services/roverManager/index.js:254:3                   
canSeeRover                      src/services/roverManager/index.js:255:3                   
canRequestControl                src/services/roverManager/index.js:256:3                   
applyPrivateDriveSafety          src/services/roverManager/index.js:257:3                   
canReplayRoverId                 src/services/roverManager/index.js:258:3                   
computeBatteryDisplayPercent     src/services/roverManager/mathUtils.js:136:3               
buildSession                     src/services/sessionService/index.js:340:3                 
syncSocket                       src/services/sessionService/index.js:341:3                 
syncAll                          src/services/sessionService/index.js:342:3                 
driverAdded                      src/services/turnService/index.js:284:3                    
driverRemoved                    src/services/turnService/index.js:285:3                    
cleanupRover                     src/services/turnService/index.js:286:3                    
canDrive                         src/services/turnService/index.js:287:3                    
createSession                    src/services/videoSessions/index.js:68:3                   
getSession                       src/services/videoSessions/index.js:69:3                   
revokeSession                    src/services/videoSessions/index.js:70:3                   
revokeBySocket                   src/services/videoSessions/index.js:71:3                   
revokeWhere                      src/services/videoSessions/index.js:72:3                   

## E) Unused exports reported by knip (webui)
Unused exports (18)
deriveDriveDockState        function  src/components/DriveDockAction/index.jsx:9:17  
HelpContentView             function  src/components/HelpContentView/index.jsx:179:17
default                     function  src/components/UserListPanel/index.jsx:50:25   
normalizeDriveVector        function  src/controls/controlMath.js:22:17              
useOvercurrentLimiter                 src/controls/index.js:6:10                     
cloneProfile                function  src/controls/inputs/gamepadBindings.js:14:17   
getGamepadHubState          function  src/controls/inputs/gamepadHub.js:109:17       
deriveCodeForKey            function  src/controls/keymapUtils.js:36:17              
createKeyToken              function  src/controls/keymapUtils.js:47:17              
createCodeToken             function  src/controls/keymapUtils.js:52:17              
DEFAULT_OVERCURRENT_LIMITS            src/controls/overcurrentLimiter.js:12:14       
HELP_LAYOUTS                          src/help/content.js:3:14                       
HELP_CONTENT                          src/help/content.js:7:14                       
default                     function  src/hooks/useFullscreenPrompt.js:169:16        
normalizeRoverColor         function  src/lib/roverColor.js:5:17                     
roverSwatchStyle            function  src/lib/roverColor.js:35:17                    
useSettings                           src/settings/index.js:3:28                     
useSettings                 function  src/settings/SettingsProvider.jsx:58:17        
Duplicate exports (2)
HelpContentView|default      src/components/HelpContentView/index.jsx
useFullscreenPrompt|default  src/hooks/useFullscreenPrompt.js        

## F) Server State-Machine Contradictions (Proof-Based)

### F1) `lockdown-admin` role branches are unreachable in current role producer graph
**Why unreachable:**
- All server role writes are done through `setRole(socket, role)` in auth flows.
- Role assignments are only `user`, `spectator`, `admin`, `lockdown`.
- No assignment path sets `lockdown-admin`.

**Role producers (source of truth):**
- `server/src/services/authService/index.js` (`initialRole` user/spectator, login role admin/lockdown, role:set only user/spectator)
- `server/src/services/roleService/index.js` (just stores whatever caller sets; no separate producer)
- Searched for any `setRole(..., 'lockdown-admin')` / `socket.data.role = 'lockdown-admin'`: none

**Dead branches/cases under this graph:**
- `server/src/services/adminLogService/index.js`
- `server/src/services/llmCommentaryService/runtimeHelpers.js`
- `server/src/services/overseerControlService/runtimeHelpers.js`
- `server/src/services/verificationService/identity.js`
- `server/src/services/discordBotService/integrations/helpers.js`
- `server/src/services/replayEngineV2/sidebarRenderer.js`
- `webui/src/components/ModeGateOverlay/index.jsx`
- `webui/src/components/UserListPanel/index.jsx`
- `webui/src/components/ChatMessageRow/index.jsx`
- `webui/src/components/RoverQueuesPanel/index.jsx`
- `webui/src/components/RawUserPilePanel/index.jsx`
- `webui/src/components/AdminPanel/AdminPanelContent.jsx`
- `webui/src/controls/overcurrentLimiter.js`

**Confidence:** High

### F2) `clearLockdownTimer` currently has no possible effect
**Why unreachable/effectively dead:**
- `clearLockdownTimer(socket)` only clears `socket.data.lockdownTimer`.
- No code ever sets `socket.data.lockdownTimer` anywhere in repo.
- Therefore the condition is always false and this function is a no-op in current runtime.

**Evidence:**
- `server/src/services/lockdownGuard/index.js` (only reads/clears `lockdownTimer`)
- global search for `lockdownTimer` assignments: none
- caller: `server/src/services/authService/index.js` (invokes `clearLockdownTimer` after login)

**Confidence:** High

### F3) `PERIODIC_SYNC_MS` config path is dead (constant + import)
**Why unreachable/effectively dead:**
- `PERIODIC_SYNC_MS` is imported into session service but only used in a commented-out `setInterval` block.
- No runtime path consumes this value.

**Evidence:**
- `server/src/services/sessionService/constants.js` exports `PERIODIC_SYNC_MS`
- `server/src/services/sessionService/index.js` imports it and references it only in commented block

**Confidence:** High

### F4) Video request parser supports `room` request shape, but runtime contract rejects it
**Why semantically contradictory:**
- `videoSocketService.normalizeRequest()` accepts room request payloads (`roomCameraId` / `{type:'room'}`).
- The handler then always throws for `target.type === 'room'` with “Room cameras now use the snapshot feed”.
- So room-video request acceptance code is legacy compatibility surface with guaranteed failure.

**Evidence:**
- `server/src/services/videoSocketService/index.js`

**Note:** This is reachable only if a client attempts room video via `video:request`; it is not a successful runtime feature path.

**Confidence:** High

### F5) `useVideoRequests` still contains room-source normalization path unused by current first-party call sites
**Why currently redundant:**
- `useVideoRequests` can normalize `roomCameraId` / `type:'room'`.
- Current call sites pass rover-only entries:
  - `webui/src/components/DriverVideoPanel/index.jsx`
  - `webui/src/spectate/SpectatorApp/SpectatorContent.jsx`
  - `webui/src/mini/MiniSummaryApp/MiniSummaryContent.jsx`
- This aligns with room camera delivery moving to snapshot socket feed.

**Evidence:**
- `webui/src/hooks/useVideoRequests.js`
- call-site inspection above

**Confidence:** Medium-High (internal app paths only; external/future caller may use room shape)

## G) Legacy Compatibility Surface (Single-Program Dead Ends)

### G1) Duplicate socket event listeners: only `session:*` names are used by this client
**Observation:** webui emits only `session:*` variants for control-role operations.

**WebUI emit calls:**
- `session:setRole`
- `session:requestControl`
- `session:releaseControl`
- `session:lockRover`
- `session:privateSafety:set`
- `session:subscribeAll`
(see `webui/src/context/SessionContext.jsx`)

**Server still listens to both old + namespaced aliases:**
- `requestControl` + `session:requestControl`
- `releaseControl` + `session:releaseControl`
- `lockRover` + `session:lockRover`
- `privateSafety:set` + `session:privateSafety:set`
- `subscribeAll` + `session:subscribeAll`
(see `server/src/services/roverManager/socketHandlers.js`)

- `role:set` + `session:setRole`
(see `server/src/services/authService/index.js`)

**Why dead under single-program assumption:**
- No first-party client emits old names; old listeners are compatibility-only.

**Confidence:** High

### G2) Server emits protocol events with no first-party subscribers
**Server emits:**
- `rovers` (on connect and roster updates)
- `auth:role`
- `mode`
- `controlGranted`
- `lockdown`

**Evidence of emitters:**
- `server/src/services/roverManager/socketHandlers.js` (`rovers`, `controlGranted`)
- `server/src/services/roverManager/rosterLifecycle.js` (`rovers`)
- `server/src/services/authService/index.js` (`auth:role`)
- `server/src/services/modeManager/index.js` (`mode`)
- `server/src/services/lockdownGuard/index.js` (`lockdown`)

**Client-side consumption check:**
- No `socket.on('rovers' | 'auth:role' | 'mode' | 'controlGranted' | 'lockdown')` anywhere in `webui/src`.
- Session-driven UI uses `session:sync` instead.

**Why dead under single-program assumption:**
- Event emissions exist for older/external clients only.

**Confidence:** High

### G3) `video:request` still accepts room payload shapes that are hard-rejected
**Current behavior:**
- Request normalization accepts room forms (`roomCameraId`, `{type:'room', id}`)
- Handler immediately throws for room type: "Room cameras now use the snapshot feed"
(see `server/src/services/videoSocketService/index.js`)

**Why compatibility-only:**
- Room WHEP path retained in request parsing despite product contract migrating to snapshot feed.
- First-party room camera path uses `roomCamera:*` snapshot sockets.

**Confidence:** High

### G4) Global-objective legacy filename fallback likely one-time migration shim
**Behavior:**
- Reads canonical `global-objective.json`, else attempts legacy `community-goal.json`.
(see `server/src/services/globalObjectiveService/index.js`)

**Why likely compatibility-only:**
- This fallback exists purely for pre-rename data compatibility.
- In a single coordinated deployment, once migrated, legacy read path is dead.

**Confidence:** Medium-High (depends on whether legacy file still exists in your deployed data dir)

### G5) Data directory legacy fallback path is compatibility shim
**Behavior:**
- `resolveDataPath`/`resolveDataDir` checks canonical `server/data` and legacy `server/src/data` style location.
(see `server/src/helpers/dataPaths.js`)

**Why likely compatibility-only:**
- Exists to preserve prior storage layout after refactor.
- If deployment has stabilized on canonical path or explicit `SERVER_DATA_DIR`, legacy branch never used.

**Confidence:** Medium-High (environment dependent)

### G6) Overseer output parser keeps legacy one-line fallback parser
**Behavior:**
- Attempts JSON parse first; on failure falls back to historical one-line parse protocol.
(see `server/src/services/overseerControlService/runtimeHelpers.js`)

**Why compatibility-only:**
- Current prompt/protocol can be constrained to structured JSON output.
- Fallback branch preserves old non-JSON output compatibility.

**Confidence:** Medium (depends on model output guarantees / prompt hardening)

## H) Additional Deep Sweep Findings (Repo-Wide)

### H1) Uncalled helper export: `eventBus.subscribeAll`
**Evidence:**
- Declared/exported in `server/src/services/eventBus/index.js`
- No call sites in `server/src` or `webui/src`

**Assessment:** hard dead utility export in current codebase.
**Confidence:** High

### H2) Uncalled helper export: `overseerControl.runtimeHelpers.parseOverseerOutput`
**Evidence:**
- Declared/exported in `server/src/services/overseerControlService/runtimeHelpers.js`
- `overseerControl/index.js` imports only `{ isAdminRole, buildAdminState, buildFailureInfo }`
- No other call sites in repo

**Assessment:** dead parser path (including its legacy one-line fallback) in current wiring.
**Confidence:** High

### H3) Uncalled helper export: `overseerControl.tools.getIdForSignature`
**Evidence:**
- Declared/exported in `server/src/services/overseerControlService/tools/index.js`
- No call sites in repo

**Assessment:** dead compatibility/helper function.
**Confidence:** High

### H4) `socket.emit('rovers', ...)` channel appears fully orphaned
**Evidence:**
- Emitted by server in rover manager connect/roster paths:
  - `server/src/services/roverManager/socketHandlers.js`
  - `server/src/services/roverManager/rosterLifecycle.js`
- No `socket.on('rovers', ...)` consumer in `webui/src`

**Assessment:** legacy protocol emission; superseded by `session:sync` usage.
**Confidence:** High

### H5) `auth:role` and `mode` push events appear orphaned for first-party UI
**Evidence:**
- Emitted by:
  - `server/src/services/authService/index.js` (`auth:role`)
  - `server/src/services/modeManager/index.js` (`mode`)
- No consumers in `webui/src`

**Assessment:** compatibility emissions for non-current clients.
**Confidence:** High

### H6) `controlGranted` / `lockdown` push events appear orphaned for first-party UI
**Evidence:**
- Emitted by:
  - `server/src/services/roverManager/socketHandlers.js` (`controlGranted`)
  - `server/src/services/lockdownGuard/index.js` (`lockdown`)
- No consumers in `webui/src`

**Assessment:** compatibility/legacy push surface for old clients.
**Confidence:** High

### H7) Pi/roverd `dummy` paths are not dead by default (intentional build target)
**Evidence:**
- Build-tag split (`//go:build dummy` vs `!dummy`) in serial/sensor/nightvision/camera_servo/brc modules
- `Makefile` has explicit `dummy` target: `go build -tags dummy ...`

**Assessment:** keep; this is an intentional alternate runtime, not dead code.
**Confidence:** High

### H8) `roomcam-service` appears operationally standalone (not wired by installers)
**Evidence:**
- Present as service + script under `roomcam-service/`
- Not installed by `server/install_server.sh` or `pi/install_roverd.sh`
- Server room camera feature consumes configured URLs and does not require this local service specifically

**Assessment:** likely optional/ops artifact; remove only if you do not deploy it manually.
**Confidence:** Medium

### H9) `dist/dummy{1,2,3}.yml` still has no runtime references
**Evidence:**
- No code paths consume these files
- Existing references are only in the files themselves

**Assessment:** hard dead artifacts in repo runtime context.
**Confidence:** High

### H10) `buttonbox/src/config example.h` is a template, not runtime code
**Evidence:**
- Firmware includes `<config.h>`; template file is named `config example.h`
- Typical manual-copy onboarding artifact

**Assessment:** optional docs/template artifact; not dead logic, but not build-consumed unless manually copied.
**Confidence:** High

## I) Final Confirmed-Only List (Static Proof)

These are the items I can confirm from source/wiring alone with high confidence.

### I1) Definitely uncalled functions/exports
- `server/src/services/eventBus/index.js` → `subscribeAll`
- `server/src/services/overseerControlService/runtimeHelpers.js` → `parseOverseerOutput`
- `server/src/services/overseerControlService/tools/index.js` → `getIdForSignature`

Proof: repo-wide usage search returns definition only (no call sites).

### I2) Definitely orphan server push events for first-party webui
Server emits, but `webui/src` has no listeners for these event names:
- `rovers`
- `auth:role`
- `mode`
- `controlGranted`
- `lockdown`

Proof: emitters exist in server files; repo-wide `webui/src` listener search returns none.

### I3) Definitely unused old client event names in first-party webui
Server listens for old aliases:
- `requestControl`, `releaseControl`, `lockRover`, `privateSafety:set`, `subscribeAll`, `role:set`

WebUI emits only namespaced forms:
- `session:requestControl`, `session:releaseControl`, `session:lockRover`, `session:privateSafety:set`, `session:subscribeAll`, `session:setRole`

Proof: listener and emitter searches across `server/src` + `webui/src`.

### I4) Definitely dead room branch in client video request helper (for first-party app)
- `webui/src/hooks/useVideoRequests.js` supports room entry shapes (`roomCameraId` / `type:'room'`).
- No first-party call site in `webui/src` constructs room entries.

Proof: `type:'room'` and `roomCameraId` appear only inside `useVideoRequests.js`.

### I5) Definitely dead file candidates (code/non-built artifacts)
- `server/src/services/overseerControlService/tools/chatSay.js` (not registered in tool definitions; no refs)
- `server/prompts/commentary_system_backup_small.txt` (no refs)
- `server/prompts/commentary_system_backup_pre_lobotomy.txt` (no refs)
- `webui/src/App.css` (not imported)
- `webui/src/assets/react.svg` (no refs)
- `server/assets/test-audio.mp3` (no refs)

---

## J) Not Provable Statically (requires runtime/env assertions)

- Legacy data path fallbacks (`server/src/helpers/dataPaths.js`) may be active depending on deployed filesystem and `SERVER_DATA_DIR`.
- `globalObjective` legacy filename fallback (`community-goal.json`) may still be used if old file exists and new file absent.
- `roomcam-service/*` may be manually used outside installer-managed workflows.
- Pi/roverd `dummy` build-tag code is intentional alternate target; not dead by default.


## K) Additional LLM-Style Flexibility Confirmed Unused/Dead

### K1) `pi/roverd` config knobs for `videoWidth/videoHeight/videoFps` are effectively dead in current pipeline
**Proof:**
- Config defines and validates `VideoWidth`, `VideoHeight`, `VideoFPS` in `pi/roverd/config.go`.
- `UpdatePublisherEnv` writes `VIDEO_WIDTH/VIDEO_HEIGHT/VIDEO_FPS` to env file in `pi/roverd/media_env.go`.
- `pi/bin/video-publisher.sh` does **not** read those env vars; it hardcodes:
  - `VIDEO_WIDTH="640"`
  - `VIDEO_HEIGHT="480"`
  - `VIDEO_FPS="30"`
- Therefore these config values cannot affect runtime behavior as wired.

**Assessment:** dead configurability / fake knob.
**Confidence:** High

### K2) Legacy/non-namespaced socket control API remains as compatibility baggage
(Already identified, reiterated here as LLM-flex class)
- Old listeners retained: `requestControl`, `releaseControl`, `lockRover`, `privateSafety:set`, `subscribeAll`, `role:set`
- First-party client emits only `session:*` names.

**Assessment:** removable compatibility layer for your single-program model.
**Confidence:** High

### K3) Server push-event fanout retained for non-current clients
(Already identified, reiterated here as LLM-flex class)
- Emits: `rovers`, `auth:role`, `mode`, `controlGranted`, `lockdown`
- No webui listeners for any of these.

**Assessment:** compatibility broadcast surface with no first-party consumer.
**Confidence:** High

### K4) Unused helper exports indicate speculative abstraction leftovers
- `eventBus.subscribeAll`
- `overseerControl.runtimeHelpers.parseOverseerOutput`
- `overseerControl.tools.getIdForSignature`

**Assessment:** abstraction/future-proofing residue; currently dead.
**Confidence:** High

## L) Cleanup Execution Checklist (Do This Order)

### Rules
- Remove only items in the current batch.
- Run smoke checks after each batch before moving on.
- If smoke fails, revert that batch only and split it smaller.

### Smoke Check (run after each batch)
- Open web UI and connect at least one client.
- Verify role switch (`user`/`spectator`) still works.
- Verify request control / release control still works.
- Verify rover lock + private safety toggle still works.
- Verify mode switch still works.
- Verify spectator view still receives expected session state.

### Bucket 1: Confirmed Safe (static-proof removal candidates)

#### Batch 1 (lowest risk, start here)
- Remove unused exports/helpers with no call sites:
  - `server/src/services/eventBus/index.js` → `subscribeAll`
  - `server/src/services/overseerControlService/runtimeHelpers.js` → `parseOverseerOutput`
  - `server/src/services/overseerControlService/tools/index.js` → `getIdForSignature`
- Remove dead file assets/prompts not referenced anywhere:
  - `server/src/services/overseerControlService/tools/chatSay.js`
  - `server/prompts/commentary_system_backup_small.txt`
  - `server/prompts/commentary_system_backup_pre_lobotomy.txt`
  - `webui/src/App.css`
  - `webui/src/assets/react.svg`
  - `server/assets/test-audio.mp3`

#### Batch 2
- Remove legacy non-namespaced socket alias listeners, keep namespaced/session contract:
  - In rover manager socket handlers, remove:
    - `requestControl`
    - `releaseControl`
    - `lockRover`
    - `privateSafety:set`
    - `subscribeAll`
  - In auth service, remove:
    - `role:set`
- Keep:
  - `session:requestControl`
  - `session:releaseControl`
  - `session:lockRover`
  - `session:privateSafety:set`
  - `session:subscribeAll`
  - `session:setRole`
  - `setMode`

#### Batch 3
- Remove orphan server push emissions not consumed by first-party web UI:
  - `rovers`
  - `auth:role`
  - `mode`
  - `controlGranted`
  - `lockdown`
- Keep `session:sync` flow intact.

#### Batch 4
- Remove dead room-shape branch in first-party client helper:
  - `webui/src/hooks/useVideoRequests.js` room entry normalization paths (`roomCameraId` / `type:'room'`)
- Keep rover request path only.

#### Batch 5
- Remove fake video configurability in `pi/roverd` (choose exactly one direction):
  - Option A: remove `videoWidth/videoHeight/videoFps` knobs and env writes entirely.
  - Option B: wire `pi/bin/video-publisher.sh` to consume `VIDEO_WIDTH/VIDEO_HEIGHT/VIDEO_FPS`.
- Preferred for cleanup goal: Option A.

### Bucket 2: Needs Runtime Check (env/deploy dependent)
- `server/src/helpers/dataPaths.js` legacy path fallback branches.
- `server/src/services/globalObjectiveService/index.js` legacy `community-goal.json` fallback.
- `roomcam-service/*` only if confirmed unused in your deployment.

### Gate Before Bucket 2
- Confirm live environment values and on-disk data:
  - `SERVER_DATA_DIR` usage status.
  - Whether any deployment still has only legacy files/paths.
  - Whether `roomcam-service` is started by any external supervisor.

### Done Criteria
- All Bucket 1 batches merged with smoke pass after each.
- Bucket 2 either removed with runtime proof, or explicitly kept with rationale.
- `rg` checks show no stale references to removed symbols/events/files.
