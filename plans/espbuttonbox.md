# esp32 button box
- 4 buttons each has a light
- also a beeper
- maybe some other indicator lights
- each button has its own tone that plays when pressed
- each button has it's own counter 

## api stuff
- each button press sends a web request to the server's IP containing:
  - the button number (1 - 4)
- when the server gets this request, it adds 1 to that button's counter
