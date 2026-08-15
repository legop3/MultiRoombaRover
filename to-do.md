1. improve midi player
```
research how midis can be played easier with drag and drop, auto selection based on which playback mode would fit, more useful and clear toggles, sample midi files to analyze how they would play on a single tone system, better live playback to see what notes are actually playing from each source and what simply wont play on the speaker
and make sure each toggle and counter actually has a purpose besides debugging or something more useful to the user, note skipped is just for debugging
```
1. assign rovers based on battery percentage, give people highest one
2. setting to disable replay popups in spectator settings menu
3. add admin ui for VIP and private requests instead of only through discord
4. add flag in roverd for video aspect ratio
   1. maybe dont? whats the point anyway? why do we exist at all? is there purpose to life?
      1. just removing the black bars, doesnt do anything practical for the driver page
      2. would only actually help for keeping spectate page compact
         1. maybe just make the spectate videos be fixed width and match the height of the media
   2. either 4:3 or 16:9
   3. default is 4:3
   4. all it does is tell the web UI to make the rover video 16:9 or 4:3 shaped
      1. web UI should default to 4:3 if that rover doesnt yet have that config yet
5.  fix this:
`Jun 18 15:14:18 roombaserver.local node[216731]: /home/daniel/MultiRoombaRover/server/src/services/roverManager/socketHandlers.js:92
Jun 18 15:14:18 roombaserver.local node[216731]:         cb({ error: err.message });
Jun 18 15:14:18 roombaserver.local node[216731]:         ^
Jun 18 15:14:18 roombaserver.local node[216731]: TypeError: cb is not a function
Jun 18 15:14:18 roombaserver.local node[216731]:     at Socket.handleRequestControl (/home/daniel/MultiRoombaRover/server/src/services/roverManager/socketHandlers.js:92:9)
Jun 18 15:14:18 roombaserver.local node[216731]:     at Socket.emit (node:events:519:28)
Jun 18 15:14:18 roombaserver.local node[216731]:     at Socket.emitUntyped (/home/daniel/MultiRoombaRover/server/node_modules/socket.io/dist/typed-events.js:69:22)
Jun 18 15:14:18 roombaserver.local node[216731]:     at /home/daniel/MultiRoombaRover/server/node_modules/socket.io/dist/socket.js:697:39
Jun 18 15:14:18 roombaserver.local node[216731]:     at process.processTicksAndRejections (node:internal/process/task_queues:85:11)
Jun 18 15:14:18 roombaserver.local node[216731]: Node.js v22.20.0
Jun 18 15:14:18 roombaserver.local systemd[1]: multirover.service: Main process exited, code=exited, status=1/FAILURE
Jun 18 15:14:18 roombaserver.local systemd[1]: multirover.service: Failed with result 'exit-code'.
Jun 18 15:14:18 roombaserver.local systemd[1]: multirover.service: Consumed 55min 11.511s CPU time, 711M memory peak.`

# relative pipe dreams:
1. VPS video forwarding
   1. get forwarding working with the VPS for in-queue users and spectators
   2. bandwidth testing
   3. maybe switch room cams back to real video, with audio?
2. RF based positional tracking / room map tab
3. chromecast monitor youtube search and speakers
