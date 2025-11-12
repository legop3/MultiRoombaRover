//go:build dummy

package roverd

import (
	"context"
	"log"
)

type BRCPulser struct{}

func NewBRCPulser(cfg BRCConfig, logger *log.Logger) (*BRCPulser, error) {
	logger.Printf("[dummy] BRC configured on pin %d", cfg.GPIOPin)
	return &BRCPulser{}, nil
}

func (b *BRCPulser) Close() {}

func (b *BRCPulser) Start(ctx context.Context) {}
