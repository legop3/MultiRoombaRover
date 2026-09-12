# RoverPeripheral

RoverPeripheral is an ESP32 Arduino library for MultiRoombaRover peripherals.
The ESP32 reports its built-in rover roles and accessory controls to `roverd`
over USB serial.

## PlatformIO installation

Classic ESP32 DevKitC-style board:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino

lib_deps =
  legop3/RoverPeripheral @ ^2.0.0
```

Native-USB ESP32-S3 DevKitC:

```ini
[env:esp32-s3-devkitc-1]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
build_flags =
  -D ARDUINO_USB_MODE=1
  -D ARDUINO_USB_CDC_ON_BOOT=1

lib_deps =
  legop3/RoverPeripheral @ ^2.0.0
```

## Program structure

Include `RoverPeripheral.h` and define `configureRoverPeripheral()`:

```cpp
#include <RoverPeripheral.h>

void configureRoverPeripheral(RoverPeripheral& peripheral) {
  peripheral.name("Headlight controller");

  RoverDigitalOutputConfig headlight;
  headlight.pin = 18;
  headlight.polarity = OutputPolarity::ActiveHigh;
  headlight.initiallyOn = false;
  peripheral.addHeadlight(headlight);
}
```

The library provides `setup()` and `loop()`. Do not define them in the
peripheral program.

## Built-in rover roles

Camera tilt:

```cpp
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
peripheral.addCameraServo(cameraServo);
```

Headlight or laser:

```cpp
RoverDigitalOutputConfig headlight;
headlight.pin = 18;
headlight.polarity = OutputPolarity::ActiveHigh;
headlight.initiallyOn = false;
peripheral.addHeadlight(headlight);

RoverDigitalOutputConfig laser;
laser.pin = 16;
laser.polarity = OutputPolarity::ActiveHigh;
laser.initiallyOn = false;
peripheral.addLaser(laser);
```

These registrations use the existing camera, headlight, and laser controls in
the rover UI. They do not create accessory controls.

## Accessory controls

Controls appear in registration order. Each control name must be unique within
the peripheral. The name is also used as the control identifier.

### Servo slider

```cpp
SliderControlConfig position;
position.name = "Arm position";
position.minimum = 0;
position.maximum = 180;

ServoOutput servo;
servo.pin = 13;

peripheral.addSlider(position, servo);
```

### PWM slider

```cpp
SliderControlConfig brightness;
brightness.name = "Light brightness";
brightness.minimum = 0;
brightness.maximum = 255;

PwmOutput light;
light.pin = 17;

peripheral.addSlider(brightness, light);
```

### Digital button

```cpp
ButtonControlConfig workLight;
workLight.name = "Work light";
workLight.mode = ButtonMode::Toggle;

DigitalOutput light;
light.pin = 21;
light.polarity = OutputPolarity::ActiveHigh;

peripheral.addButton(workLight, light);
```

### Custom slider

```cpp
void setMotorSpeed(int value) {
  // Apply value to the device.
}

SliderControlConfig speed;
speed.name = "Motor speed";
speed.minimum = 0;
speed.maximum = 100;

peripheral.addSlider(speed, setMotorSpeed);
```

### Custom button

```cpp
void setMotorRunning(bool running) {
  // Start or stop the device.
}

ButtonControlConfig motor;
motor.name = "Motor";
motor.mode = ButtonMode::Momentary;

peripheral.addButton(motor, setMotorRunning);
```

A momentary bool callback receives `true` on press and `false` on release. A
zero-argument callback can be used for a one-shot momentary action.

### Number input

```cpp
void setRepeatCount(int value) {
  // Store or apply value.
}

NumberControlConfig repeats;
repeats.name = "Repeat count";
repeats.minimum = 1;
repeats.maximum = 20;

peripheral.addNumber(repeats, setRepeatCount);
```

### Text input

```cpp
void setDisplayMessage(const String& value) {
  // Store or display value.
}

TextControlConfig message;
message.name = "Display message";
message.maximumLength = 64;

peripheral.addText(message, setDisplayMessage);
```

## Recurring work

Define `updateRoverPeripheral()` when the program needs recurring non-blocking
work:

```cpp
void updateRoverPeripheral() {
  // Update a state machine or device.
}
```

Callbacks and `updateRoverPeripheral()` must not block serial processing.
`Serial` is reserved for Firmata and must not be used for debug output.

## License

MIT
