//go:build debian_laptop

package roverd

import (
	"fmt"
	"log"
)

type CameraServo struct{}

func NewCameraServo(_ CameraServoConfig, _ *log.Logger) (*CameraServo, error) {
	/*
		The Debian laptop profile starts with the laptop's built-in webcam and no
		Pi PWM servo. If a laptop rover eventually grows an external servo board,
		it should get its own implementation instead of reusing Raspberry Pi GPIO
		assumptions.
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
