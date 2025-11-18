# general idea
- a modular control system
  - every piece of the UI that uses rover controls will go through this, including onscreen click buttons
  - allows for dynamic control labels based on saved settings
  - allow a place to assign OI command macros
    - like the one that the drive button uses now
- allows realtime responsive control of the rover that you are driving

## some sort of system for the site to save settings per browser
- needs to be extensible
  - future things will use it
- expose functions like saveSettings and loadSettings
- other parts of the UI will need to save and load settings using this function
- use cookies

## keyboard controls:
- remappable by new component in settings tab
  - key mappings will save
- controls for the keyboard
  - driving
    - WASD blended for tank steering
    - hold backslash to move faster
    - hold right shift to move slower
  - aux motors
    - main brush
      - hold O to move it forward at speed 127
      - hold L to move it backward at speed -127
    - side brush
      - hold P to move it forward at speed 127
      - hold ; to move it backward at speed -70
    - vacuum motor
      - hold [ to move it at speed 127
      - hold ' to move it at speed 50
    - ALL AUX MOTORS
      - hold . to move at full speed forward (127)
  - camera movement
    - hold I to look up
    - hold K to look down
  - dock and drive hotkeys
    - G for drive (use same 3 part macro as the drive button)
    - H for dock (seek dock command)

## Mobile controls
- 2 different layouts, already implemented just needs improved.
### mobile landscape
- a video game style layout
- on the left, buttons that you hold to operate the aux motors
- in the middle, is the rover video component. 
- on the right, an area for a floating joystick and above is a unified control to see and change the rover's mode (drive or dock)
### mobile portrait
- designed to be driven vertically with 2 hands
- mostly fine already
- rover video at the top
- then below it, is a section with the aux motor buttons on the left, and the floating joystick are on the right.


## Gamepad controls:
- use some sort of react thing that makes it easy to use the web gamepad stuff
- left joystick for movement, right joystick for moving camera up / down
  - both fully analog
- right trigger for the main brush motor
  - fully analog
  - press right bumper to switch it to reverse
- left trigger for the side brush motor
  - fully analog
  - press left bumper to switch it to reverse
- hold the right face button to run the vacuum motor
- hold the lower face button to run all aux motors forward
- left and right on the Dpad switch between drive and dock modes