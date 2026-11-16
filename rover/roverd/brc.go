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
	done   chan struct{}
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

	return &BRCPulser{cfg: cfg, logger: logger, line: line, done: make(chan struct{})}, nil
}

func (b *BRCPulser) Close() {
	// The owner cancels the pulse loop before closing its GPIO line.
	<-b.done
	if b.line != nil {
		_ = b.line.SetValue(1)
		b.line.Close()
	}
}

func (b *BRCPulser) Start(ctx context.Context) {
	go func() {
		defer close(b.done)
		ticker := time.NewTicker(b.cfg.PulseEvery.Duration)
		defer ticker.Stop()

		for {
			if ctx.Err() != nil {
				return
			}
			b.pulseOnce(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (b *BRCPulser) pulseOnce(ctx context.Context) {
	if b.line == nil {
		return
	}
	if err := b.line.SetValue(0); err != nil {
		b.logger.Printf("brc pulse low: %v", err)
		return
	}
	// Cancellation ends a pulse promptly before peripheral shutdown releases
	// the line, even when a long pulse width was configured.
	timer := time.NewTimer(b.cfg.PulseWidth.Duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
	if err := b.line.SetValue(1); err != nil {
		b.logger.Printf("brc pulse high: %v", err)
	}
}
