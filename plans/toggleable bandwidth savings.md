# make all bandwidth saving options toggleable in one centralized server config
- external spectators are people outside of local network

- multitab protection mode
  - allowed
  - verified only
  - not allowed
- snapshots
  - non-turn snapshots
    - on (you see snapshots when its not your turn)
    - off (everyone gets full video all the time)
  - non-local spectator snapshots
    - on (external spectators are only allowed snapshots)
    - off (all spectators get full video)
- external spectator access (new)
  - off (no one can access the spectate page externally)
  - on (everyone can access the spectate page externally)
  - admin (external spectators get mode gate overlay, when logged in once that identity gets spectator access forever. use database.)
- anything else related to bandwidth savings should also get config