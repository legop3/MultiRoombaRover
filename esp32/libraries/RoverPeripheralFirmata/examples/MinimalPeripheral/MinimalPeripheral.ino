#include <RoverPeripheral.h>

void configureRoverPeripheral(RoverPeripheral& io) {
  io.name("Headlight controller");

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;
  io.addHeadlight(headlight);
}
