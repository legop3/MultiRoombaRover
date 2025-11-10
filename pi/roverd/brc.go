package roverd

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type BRCPulser struct {
	cfg    BRCConfig
	logger *log.Logger
}

func NewBRCPulser(cfg BRCConfig, logger *log.Logger) (*BRCPulser, error) {
	if err := exportGPIO(cfg.GPIOPin); err != nil {
		return nil, err
	}
	if err := writeGPIO(cfg.GPIOPin, "direction", []byte("out\n")); err != nil {
		return nil, err
	}
	if err := writeGPIO(cfg.GPIOPin, "value", []byte("1\n")); err != nil {
		return nil, err
	}

	return &BRCPulser{cfg: cfg, logger: logger}, nil
}

func (b *BRCPulser) Close() {
	_ = writeGPIO(b.cfg.GPIOPin, "value", []byte("1\n"))
	_ = unexportGPIO(b.cfg.GPIOPin)
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
	if err := writeGPIO(b.cfg.GPIOPin, "value", []byte("0\n")); err != nil {
		b.logger.Printf("brc pulse low: %v", err)
		return
	}
	time.Sleep(b.cfg.PulseWidth.Duration)
	if err := writeGPIO(b.cfg.GPIOPin, "value", []byte("1\n")); err != nil {
		b.logger.Printf("brc pulse high: %v", err)
	}
}

func exportGPIO(pin int) error {
	err := os.WriteFile("/sys/class/gpio/export", []byte(strconv.Itoa(pin)), 0o644)
	if err != nil && !os.IsExist(err) {
		return err
	}
	return nil
}

func unexportGPIO(pin int) error {
	err := os.WriteFile("/sys/class/gpio/unexport", []byte(strconv.Itoa(pin)), 0o644)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func writeGPIO(pin int, field string, data []byte) error {
	path := filepath.Join("/sys/class/gpio", fmt.Sprintf("gpio%d", pin), field)
	return os.WriteFile(path, data, 0o644)
}
