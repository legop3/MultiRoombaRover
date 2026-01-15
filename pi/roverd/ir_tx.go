//go:build !dummy

package roverd

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"sync"
	"time"
)

type gpioPulse struct {
	GpioOn  uint32
	GpioOff uint32
	DelayUs uint32
}

type IRTransmitter struct {
	cfg       IRConfig
	logger    *log.Logger
	gpioMask  uint32
	pigpio    *pigpioClient
	mu        sync.Mutex
	closed    bool
	activeLow bool
}

func NewIRTransmitter(cfg IRConfig, logger *log.Logger) (*IRTransmitter, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("ir disabled")
	}

	addr := ensurePigpioAddr(cfg.PigpioAddr)
	client, err := connectPigpioWithRetry(addr, logger)
	if err != nil {
		return nil, fmt.Errorf("connect pigpio: %w", err)
	}
	mask := uint32(1) << cfg.Pin
	tx := &IRTransmitter{
		cfg:       cfg,
		logger:    logger,
		gpioMask:  mask,
		pigpio:    client,
		activeLow: cfg.ActiveLow,
	}

	if err := tx.configureLine(); err != nil {
		_ = client.Close()
		return nil, err
	}

	logger.Printf("ir tx initialized on GPIO %d (%d Hz carrier, activeLow=%v)", cfg.Pin, cfg.CarrierHz, tx.activeLow)
	return tx, nil
}

func (t *IRTransmitter) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	_ = t.setInactive()
	_ = t.pigpio.Close()
	t.closed = true
}

func (t *IRTransmitter) Send(code byte, repeat int) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return fmt.Errorf("ir transmitter closed")
	}
	if repeat <= 0 {
		repeat = t.cfg.Repeat
	}
	pulses, totalUs := t.buildWaveform(code, repeat)
	if len(pulses) == 0 {
		return nil
	}
	return t.writeWave(pulses, time.Duration(totalUs)*time.Microsecond)
}

func (t *IRTransmitter) configureLine() error {
	if err := setPigpioMode(t.pigpio, t.cfg.Pin, piOutput); err != nil {
		return err
	}
	return t.setInactive()
}

func (t *IRTransmitter) setInactive() error {
	level := uint32(0)
	if t.activeLow {
		level = 1
	}
	return writePigpio(t.pigpio, t.cfg.Pin, level)
}

func (t *IRTransmitter) buildWaveform(code byte, repeat int) ([]gpioPulse, int) {
	if repeat <= 0 {
		return nil, 0
	}
	periodUs := int(1_000_000 / t.cfg.CarrierHz)
	if periodUs <= 0 {
		periodUs = 1
	}
	onDuty := int(float64(periodUs) * (float64(t.cfg.DutyPercent) / 100.0))
	if onDuty <= 0 {
		onDuty = 1
	}
	if onDuty >= periodUs {
		onDuty = periodUs - 1
	}
	offDuty := periodUs - onDuty
	if offDuty <= 0 {
		offDuty = 1
	}

	var pulses []gpioPulse
	totalUs := 0
	onPulse := func(duration int) {
		if duration <= 0 {
			return
		}
		pulses = append(pulses, t.pulseOn(duration))
		totalUs += duration
	}
	offPulse := func(duration int) {
		if duration <= 0 {
			return
		}
		pulses = append(pulses, t.pulseOff(duration))
		totalUs += duration
	}
	addCarrier := func(onUs int) {
		if onUs <= 0 {
			return
		}
		cycles := onUs / periodUs
		if onUs%periodUs != 0 {
			cycles++
		}
		for i := 0; i < cycles; i++ {
			onPulse(onDuty)
			offPulse(offDuty)
		}
	}

	for i := 0; i < repeat; i++ {
		for mask := byte(0x80); mask > 0; mask >>= 1 {
			onMs := t.cfg.Bit0OnMs
			if code&mask != 0 {
				onMs = t.cfg.Bit1OnMs
			}
			onUs := onMs * 1000
			offUs := (t.cfg.BitTotalMs - onMs) * 1000
			addCarrier(onUs)
			offPulse(offUs)
		}
		if i < repeat-1 && t.cfg.GapMs > 0 {
			offPulse(t.cfg.GapMs * 1000)
		}
	}
	if totalUs > 0 {
		pulses = append(pulses, t.pulseOff(1))
		totalUs++
	}
	return pulses, totalUs
}

func (t *IRTransmitter) pulseOn(durationUs int) gpioPulse {
	if t.activeLow {
		return gpioPulse{GpioOn: 0, GpioOff: t.gpioMask, DelayUs: uint32(durationUs)}
	}
	return gpioPulse{GpioOn: t.gpioMask, GpioOff: 0, DelayUs: uint32(durationUs)}
}

func (t *IRTransmitter) pulseOff(durationUs int) gpioPulse {
	if t.activeLow {
		return gpioPulse{GpioOn: t.gpioMask, GpioOff: 0, DelayUs: uint32(durationUs)}
	}
	return gpioPulse{GpioOn: 0, GpioOff: t.gpioMask, DelayUs: uint32(durationUs)}
}

func (t *IRTransmitter) writeWave(pulses []gpioPulse, duration time.Duration) error {
	if len(pulses) == 0 {
		return nil
	}
	if res, err := t.pigpio.command(piCmdWaveClear, 0, 0, 0, nil); err != nil {
		return fmt.Errorf("pigpio wave clear: %w", err)
	} else if res < 0 {
		return fmt.Errorf("pigpio wave clear: %d", res)
	}

	payload := make([]byte, 0, len(pulses)*12)
	buf := bytes.NewBuffer(payload)
	for _, pulse := range pulses {
		_ = binary.Write(buf, binary.LittleEndian, pulse.GpioOn)
		_ = binary.Write(buf, binary.LittleEndian, pulse.GpioOff)
		_ = binary.Write(buf, binary.LittleEndian, pulse.DelayUs)
	}
	data := buf.Bytes()
	if res, err := t.pigpio.command(piCmdWaveAdd, 0, 0, uint32(len(data)), data); err != nil {
		return fmt.Errorf("pigpio wave add: %w", err)
	} else if res < 0 {
		return fmt.Errorf("pigpio wave add: %d", res)
	}

	waveID, err := t.pigpio.command(piCmdWaveCreate, 0, 0, 0, nil)
	if err != nil {
		return fmt.Errorf("pigpio wave create: %w", err)
	}
	if waveID < 0 {
		return fmt.Errorf("pigpio wave create: %d", waveID)
	}
	defer func() {
		_, _ = t.pigpio.command(piCmdWaveDelete, uint32(waveID), 0, 0, nil)
	}()

	if res, err := t.pigpio.command(piCmdWaveTxSend, uint32(waveID), 0, 0, nil); err != nil {
		return fmt.Errorf("pigpio wave tx: %w", err)
	} else if res < 0 {
		return fmt.Errorf("pigpio wave tx: %d", res)
	}

	if duration <= 0 {
		return nil
	}
	timeout := duration + 250*time.Millisecond
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		busy, err := t.pigpio.command(piCmdWaveTxBusy, 0, 0, 0, nil)
		if err != nil {
			return fmt.Errorf("pigpio wave busy: %w", err)
		}
		if busy < 0 {
			return fmt.Errorf("pigpio wave busy: %d", busy)
		}
		if busy == 0 {
			return nil
		}
		time.Sleep(2 * time.Millisecond)
	}
	return fmt.Errorf("pigpio wave timeout after %s", timeout)
}
