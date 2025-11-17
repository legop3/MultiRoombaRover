//go:build !dummy

package roverd

import (
	"context"
	"log"
	"time"

	gpiocdev "github.com/warthog618/go-gpiocdev"
)

type BRCPulser struct {
	cfg    BRCConfig
	logger *log.Logger
	line   *gpiocdev.Line
}

func NewBRCPulser(cfg BRCConfig, logger *log.Logger) (*BRCPulser, error) {
	chip := cfg.GPIOChip
	if chip == "" {
		chip = "gpiochip0"
	}

	line, err := gpiocdev.RequestLine(
		chip,
		cfg.GPIOPin,
		gpiocdev.AsOutput(1),
		gpiocdev.WithConsumer("roverd-brc"),
	)
	if err != nil {
		return nil, err
	}

	return &BRCPulser{cfg: cfg, logger: logger, line: line}, nil
}

func (b *BRCPulser) Close() {
	if b.line != nil {
		_ = b.line.SetValue(1)
		b.line.Close()
	}
}

func (b *BRCPulser) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(b.cfg.PulseEvery.Duration)
		defer ticker.Stop()

		for {
			b.pulseOnce()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (b *BRCPulser) pulseOnce() {
	if b.line == nil {
		return
	}
	if err := b.line.SetValue(0); err != nil {
		b.logger.Printf("brc pulse low: %v", err)
		return
	}
	time.Sleep(b.cfg.PulseWidth.Duration)
	if err := b.line.SetValue(1); err != nil {
		b.logger.Printf("brc pulse high: %v", err)
	}
}
