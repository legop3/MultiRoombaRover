# general idea
- uses the rover's reported battery full, warn, and urgent values
- will apply to all rovers
- uses the rover locking system
- completely server side
- always use the battery warn value as 0% battery and the full value as 100%

## first: the server-side server-wide event bus
- global server event bus
- used for realtime alerts between modules
- includes a way to tell where the event is coming from

## what will the battery manager do?
- watch each rover's battery charge number (reported in sensors)
- if the number reaches warn, fire an event on the event bus
- the UI will show a warning to users, independently based on sensor data
- once the rover is docked and charging, lock it.
- when the battery is fully charged, unlock it.

## while we're at it...
- add a lock reason to the rover locking system
- add the following to the rover roster in the UI state message:
  - battery full #
  - battery warn #
  - battery urgent #
- in the rover roster UI component, add a display for battery percentage and lock reason.
  - make the rover's background red when locked