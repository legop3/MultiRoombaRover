# general idea
- The idea of this feature is to toggle night vision on the camera by turning on an LED from GPIO on the pi which will me mounted in front of the camera's light sensor
- with this, the camera will disable night vision when the LED is ON, and enable night vision when the LED is OFF.
- this will only really involve pi and webui programming. the server passes commands straight through.
- do not track the state of night vision, it is not needed.

## pi side
- new GPIO on/off control on GPIO 17, 27, or 22. any of these will work.
  
## web UI
- a new keyboard shortcut to toggle night vision
- a new button in the mobile UI to toggle night vision
  - put it above the mobile horizontal servo slider