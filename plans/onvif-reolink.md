# ONVIF first, reolink specifics second PTZ camera integration

## what where who how
- adding support for a reolink PTZ camera
- ideally control everything over ONVIF
  - if needed for some of the special features, use https://github.com/verheesj/reolink-api
- VIP (verified user) feature only
- due to upload bandwidth limitations (ONLY UPLOAD TO USERS MATTERS HERE NOT INTERNAl NETWORK STUFF), only one person should be on the camera at a time. only one person at a time should view 
  - the ptz camera should have a queue and turns that are like 5 mintues long or so, so no one can hog it
  - if you are the camera operator, you are not on a rover. ever.
  - if you are a spectator, you can see the snapshots for it
    - local spectators should get full video like they already do now though
- the camera needs to be a replay source
- camera video needs to go through the same pipeline as rover video does and get to the client over webRTC

## camera learnings
- scan for all onvif features that the camera has

## UI flow:
- whole UI should be very technical and utilitarian
  - use cardframe for everything
  - match global styling
- new card in VIP tab
  - shows whoevers on the camera
  - a very slow snapshot of the camera view
  - maybe some other stats
  - a big button to open the camera controller
- the fullscreen camera interface
  - the rest of the site needs to go away when this is open
  - when its open, it takes over your rover controls. whatever they are
    - easy route for this could be to intercept it right before the control goes to the server, so any control gets converted to a ptz control
  - desktop
    - movement controls pan and tilt
    - camera up / down controls zoom
    - headlight and laser buttons hopefully control spotlight and IR light or something
    - fullscreen inteface
    - right sidebar with info and controls info
  - mobile
    - uhhh idk
    - obviously, camera on the screen
    - probably add a variant of the mobile controls just to retitle the things from the rover controls to the camera controls
    - and just use the same control columns

-- slop generated below --

## clarified implementation direction

This is not intended to become a generic ONVIF camera framework. The camera integration is for one specific Reolink PTZ camera. Once the camera arrives, we will run a one-time ONVIF capability discovery against that exact camera, record what it exposes, and then build the integration around those known capabilities.

The one-time discovery should capture:
- ONVIF services exposed by the camera
- media profiles and stream URIs
- snapshot URI support
- PTZ support and movement modes
- pan/tilt/zoom ranges and speed ranges
- preset/home support
- imaging controls
- any ONVIF-exposed spotlight, IR, or night-vision controls
- whether PTZ status reporting is reliable

After that, runtime code should assume this known camera profile instead of trying to dynamically support every possible ONVIF camera.

## claiming and operator rules

The PTZ camera is a single scarce controllable resource.

Only verified/VIP users can claim it during normal operation. Only one user can operate it at a time. The active operator gets live WebRTC video and PTZ control for a limited turn, probably around five minutes. Other remote users should only receive slow snapshots. Local spectators may be allowed live video because LAN traffic is not the bandwidth problem.

A user operating the PTZ camera must not also be operating a rover. When a user tries to move from a rover to PTZ, the existing rover-switch safety rule should be reused: switching is allowed if another driver remains on that rover, or if the current rover is docked and charging. Otherwise, the server should block the PTZ handoff and tell the user to dock and charge their rover first.

This should be implemented by refactoring the existing rover switching check into a shared helper, such as `canLeaveCurrentRover(socket)`, then using that helper from both rover switching and PTZ claiming.

## streaming model

Camera video should come from the Reolink camera over the local network, likely RTSP into MediaMTX. Browser playback should use the existing MediaMTX WHEP/WebRTC pipeline.

The existing video session and MediaMTX auth system should be extended with a `ptz` source type. Remote live WHEP access should be allowed for the current PTZ operator, local spectators, and authorized admins according to normal server rules. Remote non-operators should not get live video.

Slow snapshots should use a PTZ-specific snapshot path or socket gateway, modeled after the existing room camera snapshot system, but with PTZ-specific authorization rules.

## lockdown behavior

No extra UI work is needed for lockdown because the app already visually blocks things in lockdown mode.

Server-side lockdown enforcement is still required everywhere. In lockdown mode, only lockdown admins/users may claim, queue, operate, subscribe to snapshots, request live PTZ video, or use PTZ replay sources. If lockdown starts while a normal user is operating PTZ, the server should immediately revoke their operator state, remove them from the PTZ queue if needed, revoke PTZ video sessions, and stop accepting PTZ commands from them.

## reusable existing systems

Strong reuse targets:
- rover switch safety logic from `roverManager/roverLifecycle.js`
- `videoSessions`
- `videoSocketService`
- `videoAuthService`
- `WhepPlayer`
- `sessionService` session sync
- VIP panel/card structure
- alert system
- replay source validation and replay worker architecture

Adapted reuse targets:
- turn queue/timer structure from `turnService`
- turn alert listener behavior
- room camera snapshot socket/feed pattern
- `RoomCameraFeed` for slow preview display
- replay source catalog and ffmpeg workers
- existing control input concepts, but with a PTZ-specific command pipeline

Do not directly merge PTZ into `roomCameraService` or `commandService`. PTZ should have its own service boundary because it has ownership, queueing, ONVIF control, video authorization, and camera-specific state.

## operator UI and controls

The VIP tab should get a PTZ camera card. The card should be technical/utilitarian and match the existing site style. It should show:
- current camera operator
- queue/turn state
- turn time remaining when relevant
- whether the current user can claim or must wait
- whether the current user must dock and charge before switching
- a slow snapshot preview
- a button to open the fullscreen PTZ controller when the user is the active operator

The fullscreen PTZ controller should take over the whole app surface while open. It should not feel like a normal side panel. When active, the user is in camera-operation mode, not rover-driving mode.

Desktop controls:
- movement input pans and tilts the camera
- camera up/down or equivalent camera tilt controls zoom in/out
- available special controls expose only what the one-time ONVIF probe proved exists
- if ONVIF exposes presets/home, provide those controls
- if ONVIF exposes spotlight, IR, or night mode, provide those controls
- if those features are not exposed through ONVIF, leave them out until a Reolink-specific fallback is intentionally added
- include a compact right-side status/control panel with operator, queue, camera state, and available controls

Mobile controls:
- reuse the existing mobile control layout concept where practical
- relabel/re-map rover movement controls for PTZ movement
- keep the camera view as the main screen
- use the existing mobile control columns/pads as inspiration, but send PTZ commands instead of rover commands

Input/control implementation:
- do not send PTZ through the existing rover `commandService`
- create PTZ-specific socket events/handlers owned by the PTZ camera service
- use a PTZ-specific client command pipeline that maps existing input intent into PTZ commands
- server must enforce that only the active PTZ operator can send movement/zoom/control commands
- client-side input interception is only for UX; server-side operator checks are the real authority
- all movement controls should send stop commands on key/button release, blur, disconnect, controller close, or turn loss

## NEW UI STUFF
- desktop:
  - sidebar like there is now
  - replay panel in sidebar
  - better indicators of light and OR modes
  - list of controls using keybind things
- mobile:
  - one sidebar on the right
  - reuse rover drive control panel for camera movement
  - reuse gpio toggle buttons for spotlight and IR
  - reuse camera tilt slider for zoom
  - relabeled variants where needed for reused mobile controls
  - scroll sidebar down to see replay panel
- both:
  - the VIP panel
    - sucks. 
    - wasted space
      - put snapshot and everything else side by side
    - add a display of ptz's turn queue
    - camera should open when you request control over it. no need to have it be another button to press
    - should show state of camera
  - the fullscreen interface
    - should be inside a cardframe, with no title bar
    - reuse anything whereever possible
    - needs to be ACTUALLY FULLSCREEN, not with space around the edges anywhere
    - needs to match the global styling, and use cardframes internally for stuff.