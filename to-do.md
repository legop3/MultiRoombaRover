1. improve spectator page, options on what to see and what not to see
2. pagewide system for "why was i removed from a rover", instead of the link to spectator page thing
3. admin command for kicking people off of rovers. just a kick, nothing persistent
4. kick people off rover after 3 consecurtive bump-off attempts
5. make signaling more clear for idle skips and idle skip kicks
6. add a kick command that disconnects sockets with a message
7.  fix this:
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
