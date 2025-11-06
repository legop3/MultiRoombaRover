# notes and ideas

the multi-roombarover. 
control multiple roombas through a web UI. On each roomba is an esp32 and an IP camera.

## esp32 firmware

defined in platformio.ini:
rover's name
server's IP address
wifi connection info
enable / disable for each motor
- main brush
- side brush
- vacuum
camera IP address
battery info (for different battery behaviors):
- full number (2068)
- warn number (1700)
- urgent number (1650)


esp32-s3 firmware, platformio
UART hooked up to the roomba's OI port
one more GPIO on the roomba's BRC pin
- pulsing low for one second every minute to keep the roomba awake



## esp-server comms

the ESP will report to the server when it connects:

rover's name
enable / disable for each motor
- main brush
- side brush
- vacuum
camera IP address
battery info (for different battery behaviors):
- full number (2068)
- warn number (1700)
- urgent number (1650)


the ESP will poll the roomba for ALL sensors, decode them, and send them to the server, which will forward it to clients over socket.io

## server

nodejs server, ES6 imports and exports

one entrypoint file, the only thing in this file should be a bunch of imports for our "modules", imported in the right order
modules should NOT be intertwined within the entrypoint file
all of the modules will import what they need from the other modules
all of the modules will export what they need other modules to know

create global express, websocket, and socket.io instances for all of the modules to share. modules will add their own listeners / senders

## frontend

javascript is ES6, same module style as the server.

UI is made in HTML with CDN tailwind. NO BUNDLERS.

each frontend module will have a JSON state update over socket.io
each module will export a function to update it's state

use these functions to update all modules on connect, from a UI init state event.
this event will be sent all of the module data at once, in JSON

split each JSON element to the UI element functions

one single system for loading and saving user settings to cookies / browser storage

the UI:
- WASD rover movement controls
- buttons to enable OI, enter safe mode, full mode, and seek dock