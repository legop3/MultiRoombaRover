5. barcode wiki links
6. implement multitabbing prevention using the identity system
7. overseer improvements
   1. make it able to see more stuff
      1. mark a stat as CHANGED FROM (oldstata) if it changed since the last cycle
      2. when rovers are docked / undocked
      3. whos driving rovers
      4. rover battery levels / low
      5. the button box rewards and counts
      6. barcode whatever stuff
      7. odometers
      8. basically every stat possible
   2. make the overseer panel better
      1. show status of generation if possible, tokens or percentage. possibly stream from ollama unless i cant with tools
8. roomba odometer
   1. in activities tab
   2. use wheel encoders
   3. run averages, like 2 meters and how many encoder counts, 20 times
   4. have global odometers for each rover, tagged based on name
9.  make google tts the default everywhere but roverd
10. fix rover request spam queue cheat
11. fix up ALL discord admin commands
   1. make sure all permissions are correct
   2. fuzzy search all the things
   3. dont break on multi word nicknames
   4. make all rs commands work form both the site chat and discord
      1. make sure all the permissions are correct
12. make alert feed.jsx show more alerts at once
13. unify typing row and chat row, should be simple
14. fix google TTS speeds
15. fix this:
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
2. overseer LED tesseract
3. RF based positional tracking / room map tab
4. chromecast monitor youtube search and speakers