//go:build debian_laptop

package roverd

import (
	"context"
	"fmt"
	"log"
)

type BRCPulser struct{}

func NewBRCPulser(_ BRCConfig, _ *log.Logger) (*BRCPulser, error) {
	/*
		The first Debian laptop profile keeps BRC disabled instead of pretending a
		USB serial modem-control line has already been selected and tested. The
		config can set brc.gpioPin: -1 to skip construction entirely; if someone
		enables it, fail loudly so the rover does not silently miss wake pulses.
	*/
	return nil, fmt.Errorf("brc is not supported in the debian-laptop build yet")
}

func (b *BRCPulser) Close() {}

func (b *BRCPulser) Start(ctx context.Context) {}
