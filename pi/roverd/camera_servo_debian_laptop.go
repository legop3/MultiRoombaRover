//go:build debian_laptop

package roverd

import (
	"fmt"
	"log"
)

type CameraServo struct{}

func NewCameraServo(_ CameraServoConfig, _ *log.Logger) (*CameraServo, error) {
	/*
		This constructor represents only native host GPIO. The shared startup
		resolver selects the normal Firmata implementation when an ESP32 provides
		the role, so external hardware is not laptop-specific code.
	*/
	return nil, fmt.Errorf("camera servo not supported in the debian-laptop build")
}

func (c *CameraServo) Close() {}

func (c *CameraServo) SetAngle(angle float64) error {
	return fmt.Errorf("camera servo disabled")
}

func (c *CameraServo) Nudge(delta float64) error {
	return fmt.Errorf("camera servo disabled")
}

func (c *CameraServo) SetPulseWidth(micros int) error {
	return fmt.Errorf("camera servo disabled")
}

func (c *CameraServo) CurrentAngle() float64 {
	return 0
}

func (c *CameraServo) Configuration() CameraServoConfig {
	return CameraServoConfig{}
}
