# private rovers
## basic concept:
private rovers will be mostly just for lockdown admins to drive and use, but they can be temporarily unlocked manually by lockdown admins for use by verified users.

- cannot be spectated by spectators, ever
- cannot be replayed, ever
- private status is defined in the roverd config
- needs to never leak through access to anyone while locked
- unlocking a private rover is a big deal for verified users

## locking / unlocking:
- private rovers start locked
- when locked, only lockdown admins can drive them
- when unlocked, only verified users can drive them
- if left unlocked with no one online for 1 hour, the server will automatically lock them

## cliff rules / speed limit / overcurrent limit
### private rovers will be in a sensitive area, so their physical capabilities will be limited by the server
- if the cliff sensors get triggered, stop the rover and back it up
- speed limit is already kind of a thing but has never been tested, need to make sure it works all the way through the control pipeline
- hard overcurrent limits done server-side. completely seperate from the current client only ones. 
  - almost zero tolerance for wheel and side brush overcurrents
  - come up with a way to do this without making it feel too punishing. overcurrents often happen by accident
  - ignore the main brush, private rovers wont have one so it may read wrong

## UI specifics
- private rovers don't show in the list for normal users unless they are unlocked
  - they will only show for lockdown admins
  - when unlocked, they show for everyone
    - with a different color in the rover list