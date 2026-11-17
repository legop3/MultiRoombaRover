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
	BackendDescription() string
	Close()
}

// ToggleController keeps headlight and laser command/state behavior independent
// of whether the electrical write happens on native Pi GPIO or an ESP32 pin.
type ToggleController interface {
	HandleAction(action string) error
	On() bool
	Configuration() GPIOToggleConfig
	BackendDescription() string
	Close()
}

// RoverHardwareControllers is the result of the single startup-time backend
// decision. Effective configurations describe the selected role providers.
type RoverHardwareControllers struct {
	CameraServo CameraServoController
	Headlight   ToggleController
	Laser       ToggleController
	issues      []string
}

// StartupBroadcasts returns short operator-facing messages. Detailed pin and
// protocol information remains in the journal; tty1 reports selected providers
// and unavailable roles.
func (controllers RoverHardwareControllers) StartupBroadcasts() []string {
	var messages []string
	messages = append(messages, controllers.issues...)
	messages = append(messages, fmt.Sprintf(
		"Rover hardware ready: camera servo via %s, headlight via %s, laser via %s.",
		controllerBackend(controllers.CameraServo),
		controllerBackend(controllers.Headlight),
		controllerBackend(controllers.Laser),
	))
	return messages
}

func controllerBackend(controller interface{ BackendDescription() string }) string {
	if controller == nil {
		return "disabled"
	}
	return controller.BackendDescription()
}

type nativeHardwareControllerFactories struct {
	newCameraServo func(CameraServoConfig, *log.Logger) (CameraServoController, error)
	newToggle      func(string, GPIOToggleConfig, *log.Logger) (ToggleController, error)
}

// ResolveRoverHardwareControllers selects one provider per role, independent of
// transport. Conflicts disable only the affected role and are reported locally.
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
	if cfg.PiGPIO.Enabled {
		peripherals.piGPIO = &piGPIOPeripheral{cfg: cfg.PiGPIO, factories: factories}
	}
	// Resolving each role separately leaves unrelated hardware usable when a
	// declaration conflicts or an individual device cannot initialize.
	var err error
	report := func(role string, err error) {
		if err != nil {
			message := fmt.Sprintf("%s unavailable: %v", role, err)
			controllers.issues = append(controllers.issues, message)
			logger.Print(message)
		}
	}
	controllers.CameraServo, err = peripherals.NewCameraServo(logger)
	if err != nil {
		controllers.CameraServo = nil
	}
	report("camera servo", err)
	controllers.Headlight, err = peripherals.NewToggle("headlight", logger)
	if err != nil {
		controllers.Headlight = nil
	}
	report("headlight", err)
	controllers.Laser, err = peripherals.NewToggle("laser", logger)
	if err != nil {
		controllers.Laser = nil
	}
	report("laser", err)
	return controllers, nil
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
