#include <RoverPeripheral.h>

namespace {
constexpr uint8_t kActionPin = 21;

int repeatCount = 1;
String displayMessage;

void setActionActive(bool pressed) {
  digitalWrite(kActionPin, pressed ? HIGH : LOW);
}

void setRepeatCount(int value) {
  repeatCount = value;
}

void setDisplayMessage(const String& value) {
  displayMessage = value;
}
}  // namespace

void configureRoverPeripheral(RoverPeripheral& io) {
  io.name("Complete rover peripheral");

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

  pinMode(kActionPin, OUTPUT);
  digitalWrite(kActionPin, LOW);

  SliderControlConfig brightness;
  brightness.name = "Light brightness";
  brightness.minimum = 0;
  brightness.maximum = 255;

  PwmOutput brightnessOutput;
  brightnessOutput.pin = 17;
  io.addSlider(brightness, brightnessOutput);

  ButtonControlConfig action;
  action.name = "Special action";
  action.mode = ButtonMode::Momentary;
  io.addButton(action, setActionActive);

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
