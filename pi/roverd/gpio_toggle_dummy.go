//go:build dummy

package roverd

import (
	"fmt"
	"log"
)

type GPIOToggle struct {
	name string
}

func NewGPIOToggle(name string, cfg GPIOToggleConfig, logger *log.Logger) (*GPIOToggle, error) {
	return nil, fmt.Errorf("%s not supported in dummy build", name)
}

func (g *GPIOToggle) Close() {}

func (g *GPIOToggle) HandleAction(action string) error {
	return fmt.Errorf("%s not supported in dummy build", g.name)
}

func (g *GPIOToggle) On() bool {
	return false
}
