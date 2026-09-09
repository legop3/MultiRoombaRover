#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ConfigurableFirmata.h>
#include <ESP32Servo.h>
#include <FirmataExt.h>

#include <functional>
#include <vector>

enum class OutputPolarity {
  ActiveHigh,
  ActiveLow,
};

enum class ButtonMode {
  Toggle,
  Momentary,
};

struct FirmataServoOutput {
  uint8_t pin = 0;
};

struct FirmataPwmOutput {
  uint8_t pin = 0;
};

struct FirmataDigitalOutput {
  uint8_t pin = 0;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
};

struct RoverCameraServoConfig {
  uint8_t pin = 0;
  float minimumAngleDegrees = -15;
  float maximumAngleDegrees = 30;
  float homeAngleDegrees = 0;
  float nudgeDegrees = 2;
  uint16_t minimumPulseMicroseconds = 900;
  uint16_t maximumPulseMicroseconds = 2100;
  bool allowRawPulse = false;
  bool inverted = false;
};

struct RoverDigitalOutputConfig {
  uint8_t pin = 0;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
  bool initiallyOn = false;
};

struct SliderControlConfig {
  String id;
  String name;
  int minimum = 0;
  int maximum = 100;
};

struct ButtonControlConfig {
  String id;
  String name;
  ButtonMode mode = ButtonMode::Momentary;
};

struct NumberControlConfig {
  String id;
  String name;
  int minimum = 0;
  int maximum = 100;
};

struct TextControlConfig {
  String id;
  String name;
  size_t maximumLength = 32;
};

using SliderCallback = std::function<void(int)>;
using ButtonCallback = std::function<void(bool)>;
using NumberCallback = std::function<void(int)>;
using TextCallback = std::function<void(const String&)>;

/*
 * RoverPeripheralFirmata is both the sketch-facing registration API and one
 * ConfigurableFirmata feature. Keeping those responsibilities together gives a
 * peripheral author one object to configure while still allowing ordinary
 * Firmata tooling to use digital, PWM, and servo commands on the same stream.
 */
class RoverPeripheralFirmata : public FirmataFeature {
 public:
  explicit RoverPeripheralFirmata(const String& name);

  void addServoSlider(const SliderControlConfig& config, const FirmataServoOutput& output);
  void addPwmSlider(const SliderControlConfig& config, const FirmataPwmOutput& output);
  void addDigitalButton(const ButtonControlConfig& config, const FirmataDigitalOutput& output);
  void addSlider(const SliderControlConfig& config, SliderCallback callback);
  void addButton(const ButtonControlConfig& config, ButtonCallback callback);
  void addNumber(const NumberControlConfig& config, NumberCallback callback);
  void addText(const TextControlConfig& config, TextCallback callback);

  void addRoverCameraServo(const RoverCameraServoConfig& config);
  void addRoverHeadlight(const RoverDigitalOutputConfig& config);
  void addRoverLaser(const RoverDigitalOutputConfig& config);

  void begin(FirmataExt& extension);
  void update();

  // FirmataFeature methods let FirmataExt route standard and custom SysEx
  // operations through the same parser that owns the serial connection.
  void handleCapability(byte pin) override;
  boolean handlePinMode(byte pin, int mode) override;
  boolean handleSysex(byte command, byte argc, byte* argv) override;
  void reset() override;

 private:
  enum class ControlType {
    Slider,
    Button,
    Number,
    Text,
  };

  enum class OutputType {
    Servo,
    Pwm,
    Digital,
    Custom,
  };

  struct ControlRegistration {
    String id;
    String name;
    ControlType type;
    OutputType output;
    int minimum = 0;
    int maximum = 0;
    size_t maximumLength = 0;
    ButtonMode buttonMode = ButtonMode::Momentary;
    uint8_t pin = 0;
    OutputPolarity polarity = OutputPolarity::ActiveHigh;
    SliderCallback sliderCallback;
    ButtonCallback buttonCallback;
    NumberCallback numberCallback;
    TextCallback textCallback;
  };

  String name_;
  std::vector<ControlRegistration> controls_;
  bool hasCameraServo_ = false;
  bool hasHeadlight_ = false;
  bool hasLaser_ = false;
  RoverCameraServoConfig cameraServo_;
  RoverDigitalOutputConfig headlight_;
  RoverDigitalOutputConfig laser_;
  Servo* servos_[TOTAL_PINS] = {};

  void validateControlIdentity(const String& id, const String& name) const;
  void validateRange(const String& id, int minimum, int maximum) const;
  void buildAndSendDescription();
  void dispatchCustomControl(byte argc, byte* argv);
  void writeDigitalPin(byte pin, bool enabled);
  void attachServo(byte pin, int minimumPulseMicroseconds = -1, int maximumPulseMicroseconds = -1);
  void detachServo(byte pin);

  static RoverPeripheralFirmata* instance_;
  static void digitalPinValueCallback(byte pin, int value);
  static void systemResetCallback();
};

