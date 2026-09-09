#include <RoverPeripheral.h>

namespace {
// Every example pin is present on both the classic ESP32 DevKitC and the
// ESP32-S3 DevKitC. GPIO 19 and 20 are deliberately avoided because native-USB
// S3 boards use them for USB D- and D+.
constexpr uint8_t kSpecialActionPin = 21;

int repeatCount = 1;
String displayMessage;

void runSpecialAction(bool pressed) {
  // Receiving both button edges lets application hardware remain active only
  // while the driver holds the momentary control.
  digitalWrite(kSpecialActionPin, pressed ? HIGH : LOW);
}

void setRepeatCount(int value) {
  // A real device can use this value when it starts its next animation or
  // actuator sequence. Storing it keeps this reference callback non-blocking.
  repeatCount = value;
}

void setDisplayMessage(const String& value) {
  // Display hardware can render the stored value from updateRoverPeripheral().
  // Avoiding Serial output is important because Serial belongs to Firmata.
  displayMessage = value;
}
}  // namespace

void configureRoverPeripheral(RoverPeripheral& io) {
  io.name("Rover GPIO");

  // Standard roles retain the rover's existing HUD controls while moving the
  // electrical outputs to this ESP32 on either a Pi or laptop rover host.
  RoverCameraServoConfig cameraServo;
  cameraServo.pin = 14;
  cameraServo.minimumAngleDegrees = -15;
  cameraServo.maximumAngleDegrees = 30;
  cameraServo.homeAngleDegrees = 0;
  cameraServo.nudgeDegrees = 2;
  cameraServo.minimumPulseMicroseconds = 900;
  cameraServo.maximumPulseMicroseconds = 2100;
  cameraServo.allowRawPulse = false;
  cameraServo.inverted = false;
  io.addCameraServo(cameraServo);

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;
  io.addHeadlight(headlight);

  RoverDigitalOutputConfig laser;
  laser.pin = 16;
  laser.polarity = OutputPolarity::ActiveHigh;
  laser.initiallyOn = false;
  io.addLaser(laser);

  pinMode(kSpecialActionPin, OUTPUT);
  digitalWrite(kSpecialActionPin, LOW);

  // Accessory controls render in precisely this registration order.
  SliderControlConfig servoPosition;
  servoPosition.name = "Servo position";
  servoPosition.minimum = 0;
  servoPosition.maximum = 180;

  ServoOutput servoOutput;
  servoOutput.pin = 13;
  io.addSlider(servoPosition, servoOutput);

  SliderControlConfig lightBrightness;
  lightBrightness.name = "Light brightness";
  lightBrightness.minimum = 0;
  lightBrightness.maximum = 255;

  PwmOutput lightOutput;
  lightOutput.pin = 17;
  io.addSlider(lightBrightness, lightOutput);

  ButtonControlConfig specialAction;
  specialAction.name = "Special action";
  specialAction.mode = ButtonMode::Momentary;
  io.addButton(specialAction, runSpecialAction);

  NumberControlConfig repeats;
  repeats.name = "Repeat count";
  repeats.minimum = 1;
  repeats.maximum = 20;
  io.addNumber(repeats, setRepeatCount);

  TextControlConfig message;
  message.name = "Display message";
  message.maximumLength = 64;
  io.addText(message, setDisplayMessage);
}
