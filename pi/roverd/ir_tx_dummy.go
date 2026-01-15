//go:build dummy

package roverd

import "log"

type IRTransmitter struct{}

func NewIRTransmitter(cfg IRConfig, logger *log.Logger) (*IRTransmitter, error) {
	if cfg.Enabled {
		logger.Printf("[dummy] IR TX enabled on pin %d", cfg.Pin)
	}
	return &IRTransmitter{}, nil
}

func (t *IRTransmitter) Close() {}

func (t *IRTransmitter) Send(code byte, repeat int) error {
	return nil
}
