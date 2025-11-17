//go:build dummy

package roverd

import (
	"fmt"
	"log"
)

type CameraServo struct{}

func NewCameraServo(cfg CameraServoConfig, logger *log.Logger) (*CameraServo, error) {
	return nil, fmt.Errorf("camera servo not supported in dummy build")
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
