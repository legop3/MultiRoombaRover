//go:build dummy

package roverd

import (
	"fmt"
	"log"
)

type NightVisionLight struct{}

func NewNightVisionLight(cfg NightVisionConfig, logger *log.Logger) (*NightVisionLight, error) {
	return nil, fmt.Errorf("night vision not supported in dummy build")
}

func (n *NightVisionLight) Close() {}

func (n *NightVisionLight) HandleAction(action string) error {
	return fmt.Errorf("night vision not supported in dummy build")
}
