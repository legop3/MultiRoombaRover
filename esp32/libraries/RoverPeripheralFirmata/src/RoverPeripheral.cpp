#include "RoverPeripheral.h"

#include "internal/RoverPeripheralFirmata.h"

RoverPeripheral::RoverPeripheral()
  : implementation_(new RoverPeripheralFirmata("Rover peripheral")) {}

RoverPeripheral::~RoverPeripheral() {
  delete implementation_;
}

void RoverPeripheral::name(const String& peripheralName) {
  implementation_->setName(peripheralName);
}

void RoverPeripheral::addCameraServo(const RoverCameraServoConfig& config) {
  implementation_->addRoverCameraServo(config);
}

void RoverPeripheral::addHeadlight(const RoverDigitalOutputConfig& config) {
  implementation_->addRoverHeadlight(config);
}

void RoverPeripheral::addLaser(const RoverDigitalOutputConfig& config) {
  implementation_->addRoverLaser(config);
}

void RoverPeripheral::addSlider(const SliderControlConfig& config, const ServoOutput& output) {
  implementation_->addServoSlider(config, output);
}

void RoverPeripheral::addSlider(const SliderControlConfig& config, const PwmOutput& output) {
  implementation_->addPwmSlider(config, output);
}

void RoverPeripheral::addButton(const ButtonControlConfig& config, const DigitalOutput& output) {
  implementation_->addDigitalButton(config, output);
}

void RoverPeripheral::addSlider(const SliderControlConfig& config, SliderCallback callback) {
  implementation_->addSlider(config, callback);
}

void RoverPeripheral::addButton(const ButtonControlConfig& config, ButtonCallback callback) {
  implementation_->addButton(config, callback);
}

void RoverPeripheral::addButton(const ButtonControlConfig& config, ActionCallback callback) {
  // One-shot callbacks apply only to momentary buttons. A toggle requires the
  // bool callback overload because application code must receive its new state.
  if (config.mode != ButtonMode::Momentary) {
    abort();
  }
  implementation_->addButton(
    config,
    [callback](bool pressed) {
      if (pressed && callback) {
        callback();
      }
    }
  );
}

void RoverPeripheral::addNumber(const NumberControlConfig& config, NumberCallback callback) {
  implementation_->addNumber(config, callback);
}

void RoverPeripheral::addText(const TextControlConfig& config, TextCallback callback) {
  implementation_->addText(config, callback);
}

void RoverPeripheral::begin(FirmataExt& extension) {
  implementation_->begin(extension);
}

void RoverPeripheral::update() {
  implementation_->update();
}
