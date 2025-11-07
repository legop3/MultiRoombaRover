## esp32 firmware
- platform.io
- pull the roomba's BRC pin low (ground it) for 1 second every minute to keep it awake (pin 5)
- connect to wifi
  - disable wifi power saving
  - reconnect if needed
- connect to server
  - reconnect if needed
- hooked up to the roomba's UART on pins 16 and 17
- send raw roomba sensor data to the server, requesting ALL of the sensors from the roomba. data will be decoded on the server.
- listen to commands from the server for wheel motor speeds, aux. motor speeds, OI mode, seek dock, and song commands
- input from user to roomba MUST be prioritized. sensor data needs to be accurate, and constant, but is allowed to have blips where it slows down or whatever

## esp32 -> server communication
- needs to be something stateless, that doesn't care if the wifi hiccups on the esp32 side, because it can and will
  - communication to and from the server needs to be "stream style"
- needs to be light and fast
- connection inconsistencies CANNOT create queued up events in either direction
- the server needs to know and track which roombas are connected at any given time

## nodejs server
- KISS
- decode the sensor data from each roomba
- can support multiple roombas connected from the ground up
- keep it simple, worry about getting the esp32 firmware right.
  - but the server DOES have to exist for testing
- IS the web server, hosts an entire static folder for the web UI

## server -> web UI communication
- socket.io
- don't do anything fancy with the socket.io setup
  - it works fine out of the box, we will optimize it later

## the web UI
- KISS
- plain old html. no styling even. just bare minimum for testing
- what it needs to do:
  - allow user to select the roomba from a list
  - make the selected roomba drive with WASD
  - have buttons to set the OI mode, and tell the roomba to dock
  - show a plain list of the sensor data from the selected roomba

## closing notes
- keep the user input path (web UI -> server -> roomba) as light and responsive as possible. responsiveness is key for this.