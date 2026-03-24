# private rovers
## basic concept:
private rovers will be mostly just for lockdown admins to drive and use, but they can be temporarily unlocked manually by lockdown admins for use by verified users.
This means that locking / unlocking will act a little different than standard rovers.

- cannot be spectated by spectators, unless they are unlocked
- cannot be replayed, unless they are unlocked
- private status is defined in the roverd config
- needs to never leak through access to anyone while locked
- unlocking a private rover is a big deal for verified users (opening up a rover in the main living space for a special event)
- not included in LLM events system
- basically needs to be online but completely hidden when its not open

## locking / unlocking:
- private rovers start locked
- when locked, only lockdown admins can drive them
- when unlocked, only verified users (and lockdown admins of course) can drive them
- if left unlocked with no one online for 30 mins, the server will automatically lock them
- ## private rovers can be locked / unlocked by holding all 3 buttons on the top of the roomba for 3 seconds
  - hold spot / clean / dock buttons for 3 seconds to toggle opened / closed on that private rover
  - the server sends a TTS command to the rover to indicate when its toggled

## cliff rules / speed limit / overcurrent limit
### private rovers will be in a sensitive area, their physical capabilities will be optionally limited by the server, controllable by lockdown admins.
- optional toggleable limits:
  - speed limit
  - hard overcurrent limiting (stop motor for a bit the instant it overcurrents for maybe 0.3s)
  - hard bump limits, stop and back up slightly on physical bumps of a certain short duration
  - cliff drops. back up and pause when any cliff sensor triggers, use their binary outputs for this as they are tuned well from factory.

## UI specifics
- private rovers don't show in the spectator pages unless they are unlocked
- private rovers don't show in the list for normal users unless they are unlocked
  - they will only show for lockdown admins
  - when unlocked, they show for everyone
    - with a different color in the rover list

## . . .
this will be kind of invasive, touching a lot of systems server-side, long story short:
- private rovers are set as private in the roverd config
- by default:
  - locked to only lockdown admins
  - cant be spectated by anyone
  - any user who isnt a lockdown admin cannot know that it exists in any way at all
  - not included by most automated systems like LLM integration, discord alerts, etc
    - still included in safties like auto docking
  - limitations dont apply because its lockdown admin only anyway
  - chat messages from them dont get seen by anyone else at all, only sent to the rover for tts
- when opened up (can only be opened by lockdown admins):
  - only verified users can drive them
  - anyone can spectate them
  - limits apply
  - included in all automated systems just like a normal rover