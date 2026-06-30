addition to / variant of roverd to make it possible to use a normal linux laptop + usb serial adapter as a rover, instead of a raspberry pi


- USE THIS AS AN OPPURTINITY TO:
  - build out the roverd config -> media plublisher settings pipeline
  - improve its effectiveness and overconfigurability from roverd
  - for BOTH THE normal pi version and the laptop version
- uses speaker, mic, and webcam of laptop
  - will need to send autio and video to the same places in the server, however needed. h264 video is requited to be published to the server.
- runs roverd like normal, pointed to usb serial adapter
- uses one of the aux pins on the usb serial adapter for BRC
- no pi GPIO stuff, obviously, since its not a pi
- should be presented as a roverd installer option, --laptop
- should not be dependent on linux distro, needs to work on small simple or old ones
  - goal is to make it run on a chromebook booted into linux, daily driver thinkpads, old dell latitudes, etc.