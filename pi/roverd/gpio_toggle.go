//go:build !dummy && !debian_laptop

package roverd

import (
	"fmt"
	"log"
	"strings"
	"sync"

	gpiocdev "github.com/warthog618/go-gpiocdev"
)

type GPIOToggle struct {
	cfg    GPIOToggleConfig
	name   string
	logger *log.Logger
	line   *gpiocdev.Line
	mu     sync.Mutex
	on     bool
	closed bool
}

func NewGPIOToggle(name string, cfg GPIOToggleConfig, logger *log.Logger) (*GPIOToggle, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("%s disabled", name)
	}
	chip := cfg.GPIOChip
	if chip == "" {
		chip = "gpiochip0"
	}
	line, err := gpiocdev.RequestLine(
		chip,
		cfg.GPIOPin,
		gpiocdev.AsOutput(cfg.LogicalToGPIO(cfg.InitialOn)),
		gpiocdev.WithConsumer(fmt.Sprintf("roverd-%s", name)),
	)
	if err != nil {
		return nil, fmt.Errorf("gpio request: %w", err)
	}
	toggle := &GPIOToggle{
		cfg:    cfg,
		name:   name,
		logger: logger,
		line:   line,
		on:     cfg.InitialOn,
	}
	logger.Printf("%s on GPIO %d (initial=%v activeLow=%v)", name, cfg.GPIOPin, cfg.InitialOn, cfg.ActiveLow)
	return toggle, nil
}

func (g *GPIOToggle) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return
	}
	// Preserve the last logical state while closing the line. The daemon is not
	// trying to force a safety state here; it is only releasing the GPIO handle.
	_ = g.line.SetValue(g.cfg.LogicalToGPIO(g.on))
	g.line.Close()
	g.closed = true
}

func (g *GPIOToggle) HandleAction(action string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return fmt.Errorf("%s controller closed", g.name)
	}
	act := strings.ToLower(strings.TrimSpace(action))
	switch act {
	case "", "toggle":
		return g.setLocked(!g.on)
	case "on":
		return g.setLocked(true)
	case "off":
		return g.setLocked(false)
	default:
		return fmt.Errorf("unknown action %q", action)
	}
}

func (g *GPIOToggle) On() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.on
}

func (g *GPIOToggle) setLocked(on bool) error {
	// This is the only place a logical device state becomes an electrical GPIO
	// value. Hardware that turns on when pulled low sets activeLow in roverd
	// config; every caller above this layer still uses plain on/off semantics.
	if err := g.line.SetValue(g.cfg.LogicalToGPIO(on)); err != nil {
		return err
	}
	g.on = on
	return nil
}
