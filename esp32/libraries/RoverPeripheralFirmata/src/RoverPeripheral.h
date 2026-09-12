#pragma once

#include <Arduino.h>

#include <functional>

/** Describes whether a logical on value drives an output pin high or low. */
enum class OutputPolarity {
  ActiveHigh,
  ActiveLow,
};

/** Selects whether a button retains its state or is active only while held. */
enum class ButtonMode {
  Toggle,
  Momentary,
};

/** Configuration for the rover's existing camera-tilt control. */
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

/** Configuration for the rover's existing headlight or laser control. */
struct RoverDigitalOutputConfig {
  uint8_t pin = 0;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
  bool initiallyOn = false;
};

/** Shared display and range settings for a slider control. */
struct SliderControlConfig {
  String name;
  int minimum = 0;
  int maximum = 100;
};

/** Shared display and interaction settings for a button control. */
struct ButtonControlConfig {
  String name;
  ButtonMode mode = ButtonMode::Momentary;
};

/** Shared display and range settings for a number input. */
struct NumberControlConfig {
  String name;
  int minimum = 0;
  int maximum = 100;
};

/** Shared display and length settings for a text input. */
struct TextControlConfig {
  String name;
  size_t maximumLength = 32;
};

/** Selects a standard Firmata servo as the destination for a slider. */
struct ServoOutput {
  uint8_t pin = 0;
};

/** Selects an ESP32 PWM pin as the destination for a slider. */
struct PwmOutput {
  uint8_t pin = 0;
};

/** Selects an ESP32 digital pin as the destination for a button. */
struct DigitalOutput {
  uint8_t pin = 0;
  OutputPolarity polarity = OutputPolarity::ActiveHigh;
};

using SliderCallback = std::function<void(int)>;
using ButtonCallback = std::function<void(bool)>;
using ActionCallback = std::function<void()>;
using NumberCallback = std::function<void(int)>;
using TextCallback = std::function<void(const String&)>;

class FirmataExt;
class RoverPeripheralFirmata;

/**
 * Registration API for a self-describing rover peripheral.
 *
 * A sketch constructs each configuration one field at a time and registers it
 * in configureRoverPeripheral(). Serial and protocol setup stay in the library.
 */
class RoverPeripheral {
 public:
  RoverPeripheral();
  ~RoverPeripheral();

  RoverPeripheral(const RoverPeripheral&) = delete;
  RoverPeripheral& operator=(const RoverPeripheral&) = delete;

  /** Sets the peripheral name shown above its accessory controls. */
  void name(const String& peripheralName);

  /** Registers the rover's existing camera-tilt control. */
  void addCameraServo(const RoverCameraServoConfig& config);

  /** Registers the rover's existing headlight control. */
  void addHeadlight(const RoverDigitalOutputConfig& config);

  /** Registers the rover's existing laser control. */
  void addLaser(const RoverDigitalOutputConfig& config);

  /** Registers a slider backed by a standard Firmata servo output. */
  void addSlider(const SliderControlConfig& config, const ServoOutput& output);

  /** Registers a slider backed by an ESP32 PWM output. */
  void addSlider(const SliderControlConfig& config, const PwmOutput& output);

  /** Registers a button backed by an ESP32 digital output. */
  void addButton(const ButtonControlConfig& config, const DigitalOutput& output);

  /** Registers a slider handled by application code. */
  void addSlider(const SliderControlConfig& config, SliderCallback callback);

  /** Registers a button whose callback receives its logical state. */
  void addButton(const ButtonControlConfig& config, ButtonCallback callback);

  /** Registers a momentary button whose callback runs only on press. */
  void addButton(const ButtonControlConfig& config, ActionCallback callback);

  /** Registers a number input handled by application code. */
  void addNumber(const NumberControlConfig& config, NumberCallback callback);

  /** Registers a text input handled by application code. */
  void addText(const TextControlConfig& config, TextCallback callback);

 private:
  // The implementation is opaque so importing this header does not expose any
  // Firmata types or require firmware authors to understand the wire protocol.
  RoverPeripheralFirmata* implementation_;

  void begin(FirmataExt& extension);
  void update();

  friend void setup();
  friend void loop();
};

/** Called once by the library after Arduino and Serial initialization. */
void configureRoverPeripheral(RoverPeripheral& peripheral);

/** Optional non-blocking hook for recurring application work. */
void updateRoverPeripheral();
