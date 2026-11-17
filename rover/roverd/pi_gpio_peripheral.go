package roverd

import (
	"context"
	"log"
)

// piGPIOPeripheral is an in-process provider. It exists only when the parent
// switch is enabled; merely loading saved GPIO settings never opens hardware.
type piGPIOPeripheral struct {
	cfg       PiGPIOConfig
	factories nativeHardwareControllerFactories
	pulser    *BRCPulser
	cancel    context.CancelFunc
}

func (p *piGPIOPeripheral) roleID() string { return "pi-gpio" }

func (p *piGPIOPeripheral) hasRole(role string) bool {
	switch role {
	case "cameraServo":
		return p.cfg.CameraServo.Enabled
	case "headlight":
		return p.cfg.Headlight.Enabled
	case "laser":
		return p.cfg.Laser.Enabled
	}
	return false
}

func (p *piGPIOPeripheral) cameraServo(logger *log.Logger) (CameraServoController, error) {
	return p.factories.newCameraServo(p.cfg.CameraServo, logger)
}

func (p *piGPIOPeripheral) toggle(role string, logger *log.Logger) (ToggleController, error) {
	cfg := p.cfg.Headlight
	if role == "laser" {
		cfg = p.cfg.Laser
	}
	return p.factories.newToggle(role, cfg, logger)
}

func (p *piGPIOPeripheral) start(ctx context.Context, logger *log.Logger) error {
	if !p.cfg.BRC.Enabled {
		return nil
	}
	pulser, err := NewBRCPulser(p.cfg.BRC, logger)
	if err != nil {
		return err
	}
	p.pulser = pulser
	ctx, p.cancel = context.WithCancel(ctx)
	p.pulser.Start(ctx)
	return nil
}

func (p *piGPIOPeripheral) close() {
	if p.cancel != nil {
		p.cancel()
	}
	if p.pulser != nil {
		p.pulser.Close()
	}
}
