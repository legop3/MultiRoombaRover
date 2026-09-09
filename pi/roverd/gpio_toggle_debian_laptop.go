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
		A Debian laptop has no native Raspberry Pi GPIO contract. Returning an
		error here catches an invalid native configuration; the shared resolver
		selects an ESP32 Firmata toggle before this constructor when native GPIO
		is disabled.
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

func (g *GPIOToggle) Configuration() GPIOToggleConfig {
	return GPIOToggleConfig{}
}

func (g *GPIOToggle) BackendDescription() string {
	return "native GPIO"
}
