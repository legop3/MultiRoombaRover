package roverd

import (
	"fmt"
	"log"
	"time"
)

// Both physical servo backends consume these exact motion constants. Keeping
// them in shared code prevents Pi PWM and ESP32 Firmata movement from drifting
// apart as either implementation evolves.
const (
	maxServoDegPerSec = 60.0
	servoStepInterval = 20 * time.Millisecond
	servoAngleEpsilon = 0.01
)

// CameraServoController is the hardware-neutral camera-tilt contract used by
// WSClient. Native Pi PWM and ESP32 Firmata implementations expose identical
// logical behavior, so command handling never branches on the rover host type.
type CameraServoController interface {
	SetAngle(angle float64) error
	Nudge(delta float64) error
	SetPulseWidth(micros int) error
	CurrentAngle() float64
	Configuration() CameraServoConfig
	Close()
}

// ToggleController keeps headlight and laser command/state behavior independent
// of whether the electrical write happens on native Pi GPIO or an ESP32 pin.
type ToggleController interface {
	HandleAction(action string) error
	On() bool
	Configuration() GPIOToggleConfig
	Close()
}

// RoverHardwareControllers is the result of the single startup-time backend
// decision. Its effective configurations are derived from whichever backend
// won, making the normal rover hello accurate on both Pi and laptop hosts.
type RoverHardwareControllers struct {
	CameraServo CameraServoController
	Headlight   ToggleController
	Laser       ToggleController
}

type nativeHardwareControllerFactories struct {
	newCameraServo func(CameraServoConfig, *log.Logger) (CameraServoController, error)
	newToggle      func(string, GPIOToggleConfig, *log.Logger) (ToggleController, error)
}

// ResolveRoverHardwareControllers applies one rule on every real rover build:
// enabled native GPIO wins, otherwise one discovered ESP32 may fill the role.
// The rule is intentionally not selected by GOARCH or the debian_laptop tag.
func ResolveRoverHardwareControllers(cfg *Config, peripherals *PeripheralManager, logger *log.Logger) (RoverHardwareControllers, error) {
	factories := nativeHardwareControllerFactories{
		newCameraServo: func(config CameraServoConfig, logger *log.Logger) (CameraServoController, error) {
			return NewCameraServo(config, logger)
		},
		newToggle: func(name string, config GPIOToggleConfig, logger *log.Logger) (ToggleController, error) {
			return NewGPIOToggle(name, config, logger)
		},
	}
	return resolveRoverHardwareControllers(cfg, peripherals, logger, factories)
}

func resolveRoverHardwareControllers(cfg *Config, peripherals *PeripheralManager, logger *log.Logger, factories nativeHardwareControllerFactories) (RoverHardwareControllers, error) {
	var controllers RoverHardwareControllers
	var err error

	controllers.CameraServo, err = resolveCameraServoController(cfg.CameraServo, peripherals, logger, factories.newCameraServo)
	if err != nil {
		return RoverHardwareControllers{}, fmt.Errorf("init camera servo: %w", err)
	}
	controllers.Headlight, err = resolveToggleController("headlight", cfg.Headlight, peripherals, logger, factories.newToggle)
	if err != nil {
		controllers.Close()
		return RoverHardwareControllers{}, fmt.Errorf("init headlight: %w", err)
	}
	controllers.Laser, err = resolveToggleController("laser", cfg.Laser, peripherals, logger, factories.newToggle)
	if err != nil {
		controllers.Close()
		return RoverHardwareControllers{}, fmt.Errorf("init laser: %w", err)
	}
	return controllers, nil
}

func resolveCameraServoController(nativeConfig CameraServoConfig, peripherals *PeripheralManager, logger *log.Logger, newNative func(CameraServoConfig, *log.Logger) (CameraServoController, error)) (CameraServoController, error) {
	if nativeConfig.Enabled {
		if peripherals.HasRoverRole("cameraServo") {
			logger.Printf("ignoring ESP32 cameraServo because native camera servo is enabled")
		}
		return newNative(nativeConfig, logger)
	}
	return peripherals.NewFirmataCameraServo(logger)
}

func resolveToggleController(name string, nativeConfig GPIOToggleConfig, peripherals *PeripheralManager, logger *log.Logger, newNative func(string, GPIOToggleConfig, *log.Logger) (ToggleController, error)) (ToggleController, error) {
	if nativeConfig.Enabled {
		if peripherals.HasRoverRole(name) {
			logger.Printf("ignoring ESP32 %s because native %s is enabled", name, name)
		}
		return newNative(name, nativeConfig, logger)
	}
	return peripherals.NewFirmataToggle(name, logger)
}

// Close releases selected controller resources in reverse dependency order.
// Firmata controllers do not close the shared serial connection; that remains
// owned by PeripheralManager and is released by its separate shutdown defer.
func (controllers *RoverHardwareControllers) Close() {
	if controllers.Laser != nil {
		controllers.Laser.Close()
	}
	if controllers.Headlight != nil {
		controllers.Headlight.Close()
	}
	if controllers.CameraServo != nil {
		controllers.CameraServo.Close()
	}
}
