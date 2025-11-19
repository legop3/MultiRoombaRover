# general idea
- servo connected to pin 19 on the pi
  - it will allow the camera to look up and down
- use go-rpio
  - it has a hardware PWM implementation
- mechanical design will have limits
  - set the limits in roverd config
- control the servo from the web browser
  - expose both a slider and buttons for "nudging" it up and down

## verification of functionality before full implementation
- make sure that the go program can properly use the GPIO correctly before full implementation
- modify the roverd installer to add the needed stuff to enable PWM access