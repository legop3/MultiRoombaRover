//go:build debian_laptop

package roverd

import (
	"fmt"
	"log"
)

type GPIOToggle struct {
	name string
}

func NewGPIOToggle(name string, _ GPIOToggleConfig, _ *log.Logger) (*GPIOToggle, error) {
	/*
		A Debian laptop has no Raspberry Pi GPIO character-device contract for
		headlights or lasers. Returning an error when enabled makes bad laptop
		configs fail during startup instead of advertising controls that cannot
		change any hardware.
	*/
	return nil, fmt.Errorf("%s not supported in the debian-laptop build", name)
}

func (g *GPIOToggle) Close() {}

func (g *GPIOToggle) HandleAction(action string) error {
	return fmt.Errorf("%s not supported in the debian-laptop build", g.name)
}

func (g *GPIOToggle) On() bool {
	return false
}
