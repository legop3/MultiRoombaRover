#include <Arduino.h>
#include <ConfigurableFirmata.h>
#include <FirmataExt.h>
#include <RoverPeripheralFirmata.h>

FirmataExt firmataExtension;
RoverPeripheralFirmata peripheral("Rover GPIO");

namespace {
// Every example pin is present on both the classic ESP32 DevKitC and the
// ESP32-S3 DevKitC. GPIO 19 and 20 are deliberately avoided because native-USB
// S3 boards use them for USB D- and D+.
constexpr uint8_t kSpecialActionPin = 21;

void runSpecialAction() {
  // This intentionally represents arbitrary device behavior rather than a raw
  // pin mapping. Replace it with a motor sequence, LED animation, actuator
  // routine, or any other application-specific function the accessory needs.
  digitalWrite(kSpecialActionPin, HIGH);
  delay(80);
  digitalWrite(kSpecialActionPin, LOW);
}

void registerBuiltInRoverControls() {
  // These three roles replace physical GPIO backends while preserving the
  // existing camera, headlight, and laser commands and HUD controls.
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
  peripheral.addRoverCameraServo(cameraServo);

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;
  peripheral.addRoverHeadlight(headlight);

  RoverDigitalOutputConfig laser;
  laser.pin = 16;
  laser.polarity = OutputPolarity::ActiveHigh;
  laser.initiallyOn = false;
  peripheral.addRoverLaser(laser);
}

void registerGenericControls() {
  // Registration order is UI order. This servo slider is handled entirely by
  // standard Firmata SET_PIN_MODE and EXTENDED_ANALOG messages from roverd.
  SliderControlConfig servoPosition;
  servoPosition.id = "servoPosition";
  servoPosition.name = "Servo position";
  servoPosition.minimum = 0;
  servoPosition.maximum = 180;

  FirmataServoOutput servoOutput;
  servoOutput.pin = 13;
  peripheral.addServoSlider(servoPosition, servoOutput);

  // PWM brightness is another standard Firmata output. No sketch callback is
  // involved when the driver moves this slider.
  SliderControlConfig lightBrightness;
  lightBrightness.id = "lightBrightness";
  lightBrightness.name = "Light brightness";
  lightBrightness.minimum = 0;
  lightBrightness.maximum = 255;

  FirmataPwmOutput lightOutput;
  lightOutput.pin = 17;
  peripheral.addPwmSlider(lightBrightness, lightOutput);

  // A custom momentary control receives both press and release. This example
  // runs a one-shot action only on press, but a motor could use both values to
  // start while held and stop on release.
  ButtonControlConfig specialAction;
  specialAction.id = "specialAction";
  specialAction.name = "Run special action";
  specialAction.mode = ButtonMode::Momentary;
  peripheral.addButton(specialAction, [](bool pressed) {
    if (pressed) {
      runSpecialAction();
    }
  });
}
}  // namespace

void setup() {
  pinMode(kSpecialActionPin, OUTPUT);
  digitalWrite(kSpecialActionPin, LOW);

  registerBuiltInRoverControls();
  registerGenericControls();

  // Supplying Serial as a Stream keeps all protocol code identical between a
  // CH340/CP210x UART bridge and native ESP32-S3 USB CDC. Only PlatformIO's S3
  // build flags differ.
  Serial.begin(115200);
  Firmata.begin(Serial);
  peripheral.begin(firmataExtension);

  // A Firmata system reset establishes declared initial output states and also
  // proves that all callbacks were installed before normal traffic begins.
  Firmata.parse(SYSTEM_RESET);
}

void loop() {
  // Processing one complete parser unit at a time prevents a long serial burst
  // from starving application work while still draining ordinary USB traffic
  // quickly on both supported transports.
  while (Firmata.available()) {
    Firmata.processInput();
    if (!Firmata.isParsingMessage()) {
      break;
    }
  }
  peripheral.update();
}
