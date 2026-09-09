#include "RoverPeripheralFirmata.h"

namespace {
constexpr byte kPeripheralFeature = 0x01;
constexpr byte kDescribeOperation = 0x00;
constexpr byte kDescriptionOperation = 0x01;
constexpr byte kControlOperation = 0x02;

const char* buttonModeName(ButtonMode mode) {
  return mode == ButtonMode::Toggle ? "toggle" : "momentary";
}

const char* outputTypeName(uint8_t value) {
  switch (value) {
    case 0:
      return "servo";
    case 1:
      return "pwm";
    case 2:
      return "digital";
    default:
      return "custom";
  }
}
}  // namespace

RoverPeripheralFirmata* RoverPeripheralFirmata::instance_ = nullptr;

RoverPeripheralFirmata::RoverPeripheralFirmata(const String& name) : name_(name) {}

void RoverPeripheralFirmata::validateControlIdentity(const String& id, const String& name) const {
  if (id.length() == 0 || name.length() == 0) {
    // Registration errors are programmer errors discovered during setup. A
    // hard stop is preferable to advertising a partially usable device whose
    // behavior depends on which malformed control the driver touches first.
    abort();
  }
  for (const ControlRegistration& existing : controls_) {
    if (existing.id == id) {
      abort();
    }
  }
}

void RoverPeripheralFirmata::validateRange(const String& id, int minimum, int maximum) const {
  if (id.length() == 0 || minimum > maximum) {
    abort();
  }
}

void RoverPeripheralFirmata::addServoSlider(const SliderControlConfig& config, const FirmataServoOutput& output) {
  validateControlIdentity(config.id, config.name);
  validateRange(config.id, config.minimum, config.maximum);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Slider;
  control.output = OutputType::Servo;
  control.minimum = config.minimum;
  control.maximum = config.maximum;
  control.pin = output.pin;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addPwmSlider(const SliderControlConfig& config, const FirmataPwmOutput& output) {
  validateControlIdentity(config.id, config.name);
  validateRange(config.id, config.minimum, config.maximum);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Slider;
  control.output = OutputType::Pwm;
  control.minimum = config.minimum;
  control.maximum = config.maximum;
  control.pin = output.pin;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addDigitalButton(const ButtonControlConfig& config, const FirmataDigitalOutput& output) {
  validateControlIdentity(config.id, config.name);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Button;
  control.output = OutputType::Digital;
  control.buttonMode = config.mode;
  control.pin = output.pin;
  control.polarity = output.polarity;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addSlider(const SliderControlConfig& config, SliderCallback callback) {
  validateControlIdentity(config.id, config.name);
  validateRange(config.id, config.minimum, config.maximum);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Slider;
  control.output = OutputType::Custom;
  control.minimum = config.minimum;
  control.maximum = config.maximum;
  control.sliderCallback = callback;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addButton(const ButtonControlConfig& config, ButtonCallback callback) {
  validateControlIdentity(config.id, config.name);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Button;
  control.output = OutputType::Custom;
  control.buttonMode = config.mode;
  control.buttonCallback = callback;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addNumber(const NumberControlConfig& config, NumberCallback callback) {
  validateControlIdentity(config.id, config.name);
  validateRange(config.id, config.minimum, config.maximum);
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Number;
  control.output = OutputType::Custom;
  control.minimum = config.minimum;
  control.maximum = config.maximum;
  control.numberCallback = callback;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addText(const TextControlConfig& config, TextCallback callback) {
  validateControlIdentity(config.id, config.name);
  if (config.maximumLength == 0) {
    abort();
  }
  ControlRegistration control;
  control.id = config.id;
  control.name = config.name;
  control.type = ControlType::Text;
  control.output = OutputType::Custom;
  control.maximumLength = config.maximumLength;
  control.textCallback = callback;
  controls_.push_back(control);
}

void RoverPeripheralFirmata::addRoverCameraServo(const RoverCameraServoConfig& config) {
  cameraServo_ = config;
  hasCameraServo_ = true;
}

void RoverPeripheralFirmata::addRoverHeadlight(const RoverDigitalOutputConfig& config) {
  headlight_ = config;
  hasHeadlight_ = true;
}

void RoverPeripheralFirmata::addRoverLaser(const RoverDigitalOutputConfig& config) {
  laser_ = config;
  hasLaser_ = true;
}

void RoverPeripheralFirmata::begin(FirmataExt& extension) {
  if (instance_ != nullptr && instance_ != this) {
    abort();
  }
  instance_ = this;
  extension.addFeature(*this);

  // Discovery uses Firmata's standard REPORT_FIRMWARE query to distinguish a
  // rover peripheral from unrelated Firmata devices. The helper owns this
  // identity so every sketch gets it without repeating protocol boilerplate.
  Firmata.setFirmwareNameAndVersion("RoverPeripheralFirmata", 1, 0);

  // SET_DIGITAL_PIN_VALUE is a fixed Firmata command rather than SysEx, so it
  // cannot travel through FirmataFeature::handleSysex. Firmata exposes one
  // callback for it and this peripheral owns the standard output implementation.
  Firmata.attach(SET_DIGITAL_PIN_VALUE, digitalPinValueCallback);
  Firmata.attach(SYSTEM_RESET, systemResetCallback);
}

void RoverPeripheralFirmata::update() {
  // Custom callbacks execute synchronously from Firmata's parser for now. This
  // method intentionally remains available so future non-blocking peripheral
  // work can be serviced without changing the sketch's main loop shape.
}

void RoverPeripheralFirmata::handleCapability(byte pin) {
  if (!IS_PIN_DIGITAL(pin)) {
    return;
  }

  // The peripheral supports the output modes roverd may select. Capability
  // reporting stays standard Firmata, so the Linux probe can also inspect it
  // with any other conforming client.
  Firmata.write(PIN_MODE_OUTPUT);
  Firmata.write(1);
  if (IS_PIN_PWM(pin)) {
    Firmata.write(PIN_MODE_PWM);
    Firmata.write(DEFAULT_PWM_RESOLUTION);
  }
  Firmata.write(PIN_MODE_SERVO);
  Firmata.write(14);
}

boolean RoverPeripheralFirmata::handlePinMode(byte pin, int mode) {
  if (pin >= TOTAL_PINS || !IS_PIN_DIGITAL(pin)) {
    return false;
  }

  // A pin can only have one active hardware generator. Detaching a previous
  // servo before switching modes prevents it from continuing to pulse after a
  // later digital or PWM configuration takes ownership of the pin.
  if (mode != PIN_MODE_SERVO) {
    detachServo(pin);
  }

  switch (mode) {
    case PIN_MODE_OUTPUT:
      pinMode(PIN_TO_DIGITAL(pin), OUTPUT);
      digitalWrite(PIN_TO_DIGITAL(pin), LOW);
      Firmata.setPinState(pin, 0);
      return true;
    case PIN_MODE_PWM:
      if (!IS_PIN_PWM(pin)) {
        return false;
      }
      pinMode(PIN_TO_PWM(pin), OUTPUT);
      analogWrite(PIN_TO_PWM(pin), 0);
      Firmata.setPinState(pin, 0);
      return true;
    case PIN_MODE_SERVO:
      attachServo(pin);
      Firmata.setPinState(pin, 0);
      return true;
    default:
      return false;
  }
}

boolean RoverPeripheralFirmata::handleSysex(byte command, byte argc, byte* argv) {
  if (command == kPeripheralFeature) {
    if (argc == 0) {
      return true;
    }
    if (argv[0] == kDescribeOperation) {
      buildAndSendDescription();
    } else if (argv[0] == kControlOperation) {
      dispatchCustomControl(argc, argv);
    }
    return true;
  }

  if (command == SERVO_CONFIG && argc >= 5) {
    const byte pin = argv[0];
    const int minimumPulse = argv[1] | (argv[2] << 7);
    const int maximumPulse = argv[3] | (argv[4] << 7);
    if (pin < TOTAL_PINS && IS_PIN_DIGITAL(pin)) {
      Firmata.setPinMode(pin, PIN_MODE_SERVO);
      attachServo(pin, minimumPulse, maximumPulse);
    }
    return true;
  }

  if (command == EXTENDED_ANALOG && argc >= 2) {
    const byte pin = argv[0];
    if (pin >= TOTAL_PINS) {
      return true;
    }

    int value = 0;
    // Extended analog values contain a variable number of seven-bit chunks.
    // Reassembling every received chunk keeps servo angles and PWM values fully
    // compatible with normal Firmata clients rather than assuming eight bits.
    for (byte index = 1; index < argc && index <= 4; ++index) {
      value |= static_cast<int>(argv[index]) << (7 * (index - 1));
    }

    const byte mode = Firmata.getPinMode(pin);
    if (mode == PIN_MODE_PWM && IS_PIN_PWM(pin)) {
      analogWrite(PIN_TO_PWM(pin), value);
      Firmata.setPinState(pin, value);
    } else if (mode == PIN_MODE_SERVO && servos_[pin] != nullptr) {
      servos_[pin]->write(value);
      Firmata.setPinState(pin, value);
    }
    return true;
  }

  return false;
}

void RoverPeripheralFirmata::reset() {
  for (byte pin = 0; pin < TOTAL_PINS; ++pin) {
    detachServo(pin);
  }

  // Built-in role defaults are applied on Firmata reset as well as boot. This
  // makes reconnecting a client deterministic without creating a second state
  // model on the ESP32.
  if (hasHeadlight_) {
    pinMode(headlight_.pin, OUTPUT);
    const bool physicalHigh = headlight_.initiallyOn != (headlight_.polarity == OutputPolarity::ActiveLow);
    writeDigitalPin(headlight_.pin, physicalHigh);
  }
  if (hasLaser_) {
    pinMode(laser_.pin, OUTPUT);
    const bool physicalHigh = laser_.initiallyOn != (laser_.polarity == OutputPolarity::ActiveLow);
    writeDigitalPin(laser_.pin, physicalHigh);
  }
}

void RoverPeripheralFirmata::buildAndSendDescription() {
  JsonDocument document;
  document["name"] = name_;

  if (hasCameraServo_ || hasHeadlight_ || hasLaser_) {
    JsonObject roverControls = document["roverControls"].to<JsonObject>();
    if (hasCameraServo_) {
      JsonObject servo = roverControls["cameraServo"].to<JsonObject>();
      servo["pin"] = cameraServo_.pin;
      servo["minimumAngleDegrees"] = cameraServo_.minimumAngleDegrees;
      servo["maximumAngleDegrees"] = cameraServo_.maximumAngleDegrees;
      servo["homeAngleDegrees"] = cameraServo_.homeAngleDegrees;
      servo["nudgeDegrees"] = cameraServo_.nudgeDegrees;
      servo["minimumPulseMicroseconds"] = cameraServo_.minimumPulseMicroseconds;
      servo["maximumPulseMicroseconds"] = cameraServo_.maximumPulseMicroseconds;
      servo["allowRawPulse"] = cameraServo_.allowRawPulse;
      servo["inverted"] = cameraServo_.inverted;
    }

    auto addDigitalRole = [&roverControls](const char* key, const RoverDigitalOutputConfig& config) {
      JsonObject role = roverControls[key].to<JsonObject>();
      role["pin"] = config.pin;
      role["activeLow"] = config.polarity == OutputPolarity::ActiveLow;
      role["initiallyOn"] = config.initiallyOn;
    };
    if (hasHeadlight_) {
      addDigitalRole("headlight", headlight_);
    }
    if (hasLaser_) {
      addDigitalRole("laser", laser_);
    }
  }

  JsonArray controls = document["controls"].to<JsonArray>();
  for (const ControlRegistration& registration : controls_) {
    JsonObject control = controls.add<JsonObject>();
    control["id"] = registration.id;
    control["name"] = registration.name;

    switch (registration.type) {
      case ControlType::Slider:
        control["type"] = "slider";
        control["min"] = registration.minimum;
        control["max"] = registration.maximum;
        break;
      case ControlType::Button:
        control["type"] = "button";
        control["mode"] = buttonModeName(registration.buttonMode);
        break;
      case ControlType::Number:
        control["type"] = "number";
        control["min"] = registration.minimum;
        control["max"] = registration.maximum;
        break;
      case ControlType::Text:
        control["type"] = "text";
        control["maxLength"] = registration.maximumLength;
        break;
    }

    JsonObject output = control["output"].to<JsonObject>();
    output["type"] = outputTypeName(static_cast<uint8_t>(registration.output));
    if (registration.output != OutputType::Custom) {
      output["pin"] = registration.pin;
    }
    if (registration.output == OutputType::Digital && registration.polarity == OutputPolarity::ActiveLow) {
      output["activeLow"] = true;
    }
  }

  String payload;
  serializeJson(document, payload);

  // ConfigurableFirmata's convenience sendSysex takes a byte-sized raw length.
  // Descriptions can exceed that, so write the standard framing and each 7-bit
  // pair directly. This remains one ordinary Firmata SysEx message on the wire.
  Firmata.startSysex();
  Firmata.write(kPeripheralFeature);
  Firmata.write(kDescriptionOperation);
  for (size_t index = 0; index < payload.length(); ++index) {
    Firmata.sendValueAsTwo7bitBytes(static_cast<uint8_t>(payload[index]));
  }
  Firmata.endSysex();
}

void RoverPeripheralFirmata::dispatchCustomControl(byte argc, byte* argv) {
  if (argc < 3 || ((argc - 1) % 2) != 0) {
    Firmata.sendString(F("Invalid rover control payload"));
    return;
  }

  String decoded;
  decoded.reserve((argc - 1) / 2);
  for (byte index = 1; index + 1 < argc; index += 2) {
    if (argv[index + 1] > 1) {
      Firmata.sendString(F("Invalid rover control encoding"));
      return;
    }
    decoded += static_cast<char>(argv[index] | (argv[index + 1] << 7));
  }

  JsonDocument document;
  if (deserializeJson(document, decoded) != DeserializationError::Ok) {
    Firmata.sendString(F("Invalid rover control JSON"));
    return;
  }

  const String controlID = document["control"].as<String>();
  for (ControlRegistration& registration : controls_) {
    if (registration.id != controlID || registration.output != OutputType::Custom) {
      continue;
    }

    // The registration type is the source of truth for value conversion. This
    // prevents an unexpected JSON value from silently selecting a different
    // callback signature or invoking unrelated application behavior.
    switch (registration.type) {
      case ControlType::Slider:
        if (registration.sliderCallback) {
          registration.sliderCallback(document["value"].as<int>());
        }
        break;
      case ControlType::Button:
        if (registration.buttonCallback) {
          registration.buttonCallback(document["value"].as<bool>());
        }
        break;
      case ControlType::Number:
        if (registration.numberCallback) {
          registration.numberCallback(document["value"].as<int>());
        }
        break;
      case ControlType::Text:
        if (registration.textCallback) {
          String value = document["value"].as<String>();
          if (value.length() > registration.maximumLength) {
            value.remove(registration.maximumLength);
          }
          registration.textCallback(value);
        }
        break;
    }
    return;
  }

  Firmata.sendString(F("Unknown rover control"));
}

void RoverPeripheralFirmata::writeDigitalPin(byte pin, bool physicalHigh) {
  // Standard Firmata digital values represent the electrical pin level. roverd
  // applies the advertised activeLow mapping before sending a command, keeping
  // this firmware compatible with raw Firmata clients and avoiding inversion in
  // two different layers.
  digitalWrite(PIN_TO_DIGITAL(pin), physicalHigh ? HIGH : LOW);
  Firmata.setPinState(pin, physicalHigh ? 1 : 0);
}

void RoverPeripheralFirmata::attachServo(byte pin, int minimumPulseMicroseconds, int maximumPulseMicroseconds) {
  if (pin >= TOTAL_PINS || !IS_PIN_DIGITAL(pin)) {
    return;
  }
  if (servos_[pin] == nullptr) {
    servos_[pin] = new Servo();
  }
  if (servos_[pin]->attached()) {
    servos_[pin]->detach();
  }
  if (minimumPulseMicroseconds > 0 && maximumPulseMicroseconds > minimumPulseMicroseconds) {
    servos_[pin]->attach(PIN_TO_SERVO(pin), minimumPulseMicroseconds, maximumPulseMicroseconds);
  } else {
    servos_[pin]->attach(PIN_TO_SERVO(pin));
  }
}

void RoverPeripheralFirmata::detachServo(byte pin) {
  if (pin >= TOTAL_PINS || servos_[pin] == nullptr) {
    return;
  }
  if (servos_[pin]->attached()) {
    servos_[pin]->detach();
  }
  delete servos_[pin];
  servos_[pin] = nullptr;
}

void RoverPeripheralFirmata::digitalPinValueCallback(byte pin, int value) {
  if (instance_ == nullptr || pin >= TOTAL_PINS || Firmata.getPinMode(pin) != PIN_MODE_OUTPUT) {
    return;
  }

  // Polarity is advertised by the peripheral and applied by roverd before this
  // standard raw pin-level command reaches the ESP32.
  instance_->writeDigitalPin(pin, value != 0);
}

void RoverPeripheralFirmata::systemResetCallback() {
  if (instance_ != nullptr) {
    instance_->reset();
  }
}
