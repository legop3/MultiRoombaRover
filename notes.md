# notes and ideas

## frontend

each frontend module will have a JSON state update over socket.io
each module will export a function to update it's state

use these functions to update all modules on connect, from a UI init state event.
this event will be sent all of the module data at once, in JSON

split each JSON element to the UI element functions

one single system for loading and saving user settings


## esp-server comms

the ESP will report to the server when it connects:

rover's name
enable / disable for each motor
camera IP address
battery info (for different battery behaviors):
- full number
- warn number
- urgent number