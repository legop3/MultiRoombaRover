# make all bandwidth saving options toggleable in one centralized server config
- external spectators are people outside of local network

- multitab protection mode
  - allowed
  - verified only
  - not allowed
- snapshots
  - non-turn video
    - snapshots (rover non-active turn holders and PTZ non-operators see snapshots)
    - live (rover non-active turn holders and PTZ non-operators can get full video)
  - external spectator video
    - snapshots (external spectators are only allowed snapshots)
    - live (external spectators can get full video)
- external spectator access (new)
  - off (no one can access the spectate page externally)
  - on (everyone can access the spectate page externally)
  - verifiedOnly (only verified identities can access the spectate page externally)
  - admin (external spectators need a saved spectatorAccess.external identity grant)
- anything else related to bandwidth savings should also get config

## implemented config shape
```yaml
bandwidthSavings:
  multiTabProtection: "verifiedOnly" # allowed | verifiedOnly | notAllowed
  nonTurnVideo: "snapshots" # snapshots | live
  externalSpectatorVideo: "snapshots" # snapshots | live
  externalSpectatorAccess: "on" # off | on | verifiedOnly | admin
```
