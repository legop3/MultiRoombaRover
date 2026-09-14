1. improve midi player
```
research how midis can be played easier with drag and drop, auto selection based on which playback mode would fit, more useful and clear toggles, sample midi files to analyze how they would play on a single tone system, better live playback to see what notes are actually playing from each source and what simply wont play on the speaker
and make sure each toggle and counter actually has a purpose besides debugging or something more useful to the user, note skipped is just for debugging
```
1. add new discord channel: live status
   1. one concise message which contains the status of all the rovers
   2. bot clears the channel, then sends a new message
   3. has a fancy big embed that shows way more stuff
   4. also has a small text copy at the top (readable on smartwatch lol)
      1. ```freaky: docked
            wall-e: user1 driving
            bweeble: NEEDS HELP```
2. setting to disable replay popups in spectator settings menu
3. add admin ui for VIP and private requests instead of only through discord
4. make roverd self update checkout to main branch
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
