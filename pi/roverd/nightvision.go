//go:build !dummy

package roverd

import (
	"fmt"
	"log"
	"strings"
	"sync"

	gpiocdev "github.com/warthog618/go-gpiocdev"
)

type NightVisionLight struct {
	cfg    NightVisionConfig
	logger *log.Logger
	line   *gpiocdev.Line
	mu     sync.Mutex
	on     bool
	closed bool
}

func NewNightVisionLight(cfg NightVisionConfig, logger *log.Logger) (*NightVisionLight, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("night vision disabled")
	}
	chip := cfg.GPIOChip
	if chip == "" {
		chip = "gpiochip0"
	}
	initial := 0
	if cfg.InitialOn {
		initial = 1
	}
	line, err := gpiocdev.RequestLine(
		chip,
		cfg.GPIOPin,
		gpiocdev.AsOutput(initial),
		gpiocdev.WithConsumer("roverd-nightvision"),
	)
	if err != nil {
		return nil, fmt.Errorf("gpio request: %w", err)
	}
	nv := &NightVisionLight{
		cfg:    cfg,
		logger: logger,
		line:   line,
		on:     cfg.InitialOn,
	}
	logger.Printf("night vision LED on GPIO %d (initial=%v)", cfg.GPIOPin, cfg.InitialOn)
	return nv, nil
}

func (n *NightVisionLight) Close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return
	}
	_ = n.line.SetValue(boolToGPIO(n.on))
	n.line.Close()
	n.closed = true
}

func (n *NightVisionLight) HandleAction(action string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return fmt.Errorf("night vision controller closed")
	}
	act := strings.ToLower(strings.TrimSpace(action))
	switch act {
	case "", "toggle":
		return n.setLocked(!n.on)
	case "on":
		return n.setLocked(true)
	case "off":
		return n.setLocked(false)
	default:
		return fmt.Errorf("unknown action %q", action)
	}
}

func (n *NightVisionLight) setLocked(on bool) error {
	if err := n.line.SetValue(boolToGPIO(on)); err != nil {
		return err
	}
	n.on = on
	return nil
}

func boolToGPIO(value bool) int {
	if value {
		return 1
	}
	return 0
}
