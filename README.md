# Multi Roomba Rover

a remake of my RoombaRover project with a decentralized and embedded approach

on each roomba:
- an esp32
  - a level shifter
  - DONT FORGET THE BRC PIN PULSE
- a power supply
- an openIPC camera
  - USB wifi card
  - microphone
  - speaker
- MAYBE a master relay which can be turned off programatically to save the roomba from discharging. based on battery voltage plus urgent battery #?

UDP:
one control stream out to the esp32
one raw data sensor stream in form the esp32