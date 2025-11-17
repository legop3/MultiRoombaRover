## multi roomba rover

a website where people can control multiple irobot create 2 robots in real time 100% responsively
with a raspberry pi zero 2 W on each roomba, along with a raspberry pi camera
a central nodejs control server will tell the raspberry pis what to do with the roomba

## the pi side (roomba side)
- pi's onboard UART is hooked up to the roomba's serial port
- another GPIO pin connected to the roomba's BRC pin
  - pull it low for one second every minute to keep the roomba awake
- streams the rpi camera over webRTC with mediamtx
- streams roomba sensor group 100 to the server
  - sensor streaming is required and important, but is allowed to falter sometimes
- listens for roomba commands from the server
  - commands NEED to happen
- roomba control program needs to be simple, lightweight, and 100% responsive

## pi -> server communication
- stateless
- streaming based
- on connection, the pi will send the following info:
  - rover's name
  - motor enable / disable
    - vacuum
    - main brush
    - side brush
  - battery full number
  - battery warning number
  - battery urgent number

## nodejs server
- KISS
- decode the sensor data from each roomba
- can support multiple roombas connected from the ground up
- keep it simple, worry about getting the pi comms right.
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