#include "RoverPeripheral.h"

#include <ConfigurableFirmata.h>
#include <FirmataExt.h>

namespace {
FirmataExt firmataExtension;
RoverPeripheral peripheral;
}  // namespace

// A weak no-op preserves the zero-boilerplate case while allowing a sketch to
// define the same function when animations or state machines need regular work.
void __attribute__((weak)) updateRoverPeripheral() {}

void setup() {
  // The public configuration hook runs after Arduino initialization, allowing
  // peripheral code to safely use pinMode() and initialize third-party devices.
  Serial.begin(115200);
  configureRoverPeripheral(peripheral);

  // ConfigurableFirmata batches reads on ESP32-class boards. Arduino's default
  // one-second Stream timeout would delay short commands while waiting for the
  // batch buffer to fill, so consume only bytes that have already arrived.
  Serial.setTimeout(0);
  Firmata.begin(Serial);
  peripheral.begin(firmataExtension);

  // Applying a normal Firmata reset after registration establishes every
  // declared initial output and makes the first host connection deterministic.
  Firmata.parse(SYSTEM_RESET);
}

void loop() {
  // ConfigurableFirmata retains partial parser state between iterations. Stop
  // after each complete message so user update work cannot be starved by a
  // sustained burst, while ordinary short commands are still drained at once.
  while (Firmata.available()) {
    Firmata.processInput();
    if (!Firmata.isParsingMessage()) {
      break;
    }
  }

  peripheral.update();
  updateRoverPeripheral();
}
