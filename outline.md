## esp32 firmware
- hooked up to the roomba's UART on pins 16 and 17
- pin 5 is connected to the roomba's BRC pin
  - pulse the BRC pin low for 1 second every minute to keep the roomba awake
- connect to wifi
- connect to the server
- get a full frame of sensor group 100 from the roomba every 500ms
  - send it to the server over the sensor UDP stream
- listen to the server's control UDP stream (per roomba) and do the following accordingly:
  - set wheel speeds
  - seek dock
  - enable OI
  - safe mode
  - full mode
  - play song
  - load song

## esp32 -> server communication
- one UDP stream to the esp32 for controlling the roomba
  - might look like this:
    - left wheel speed
    - right wheel speed
    - OI mode
    - seek dock?
  - blasts out at a constant rate from the server for each roomba
  - the esp32 will listen, and follow the latest command that it sees
- one UDP stream from the esp32 to the server for sending sensor data frames and other telemetry
  - one full frame of sensor data per datagram
  - send raw sensor data, the server will decode it
  - add other telemetry from the esp32, like signal strength, etc. 
  - maybe use this stream as a sign that the esp32 is still running healthily?

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

### general javascript programming guidelines (applies to the web UI too)
- everything ES6
  - one entrypoint file in the web UI
- everything modular
- everything easy to read, understand, and work on
- comment where you think is best to describe whats going on

## closing notes
- keep the user input path (web UI -> server -> roomba) as light and responsive as possible. responsiveness is key for this.
- responsiveness is the name of the game. The future of this program is teleoperation over the internet, with a camera on each roomba. keyboard inputs from the user must be near instant.
- on the esp32 firmware side of things, sensor data is second priority to having a responsive control system
  - but sensor data DOES have to exist.
- the future of this project will involve assigning one roomba to a user, make the server able to do that from the ground up.