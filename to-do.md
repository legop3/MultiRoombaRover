1.  fix rover request spam queue cheat
2. add lockdown admin only page for managing the user db
3. put rover power stats / bars / graph in corners of top-down view
4.  fix this:
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