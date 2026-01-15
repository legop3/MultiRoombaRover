//go:build !dummy

package roverd

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

const (
	pigpioAddr           = "127.0.0.1:8888"
	piCmdSetMode         = 0
	piCmdWrite           = 4
	piCmdWaveClear       = 27
	piCmdWaveAddGeneric  = 28
	piCmdWaveTxBusy      = 32
	piCmdWaveCreate      = 49
	piCmdWaveDelete      = 50
	piCmdWaveTxSend      = 51
	piOutput             = 1
	pigpioConnectRetries = 20
	pigpioConnectDelay   = 250 * time.Millisecond
)

type pigpioCmd struct {
	Cmd uint32
	P1  uint32
	P2  uint32
	P3  uint32
}

type gpioPulse struct {
	GpioOn  uint32
	GpioOff uint32
	DelayUs uint32
}

type pigpioClient struct {
	conn net.Conn
	mu   sync.Mutex
}

func newPigpioClient(addr string) (*pigpioClient, error) {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	return &pigpioClient{conn: conn}, nil
}

func (c *pigpioClient) Close() error {
	if c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

func (c *pigpioClient) command(cmd, p1, p2, p3 uint32, ext []byte) (int32, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var buf [16]byte
	binary.LittleEndian.PutUint32(buf[0:], cmd)
	binary.LittleEndian.PutUint32(buf[4:], p1)
	binary.LittleEndian.PutUint32(buf[8:], p2)
	binary.LittleEndian.PutUint32(buf[12:], p3)

	if _, err := c.conn.Write(buf[:]); err != nil {
		return -1, err
	}
	if len(ext) > 0 {
		if _, err := c.conn.Write(ext); err != nil {
			return -1, err
		}
	}
	if _, err := io.ReadFull(c.conn, buf[:]); err != nil {
		return -1, err
	}
	res := int32(binary.LittleEndian.Uint32(buf[12:]))
	return res, nil
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

	client, err := connectPigpioWithRetry(pigpioAddr, logger)
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

func connectPigpioWithRetry(addr string, logger *log.Logger) (*pigpioClient, error) {
	var lastErr error
	for attempt := 1; attempt <= pigpioConnectRetries; attempt++ {
		client, err := newPigpioClient(addr)
		if err == nil {
			return client, nil
		}
		lastErr = err
		if attempt == 1 || attempt%4 == 0 {
			logger.Printf("pigpio connect attempt %d/%d failed: %v", attempt, pigpioConnectRetries, err)
		}
		time.Sleep(pigpioConnectDelay)
	}
	return nil, lastErr
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
	if err := t.writeWave(pulses, time.Duration(totalUs)*time.Microsecond); err != nil {
		return err
	}
	return nil
}

func (t *IRTransmitter) configureLine() error {
	if res, err := t.pigpio.command(piCmdSetMode, uint32(t.cfg.Pin), piOutput, 0, nil); err != nil {
		return fmt.Errorf("pigpio set mode: %w", err)
	} else if res < 0 {
		return fmt.Errorf("pigpio set mode: %d", res)
	}
	return t.setInactive()
}

func (t *IRTransmitter) setInactive() error {
	level := uint32(0)
	if t.activeLow {
		level = 1
	}
	res, err := t.pigpio.command(piCmdWrite, uint32(t.cfg.Pin), level, 0, nil)
	if err != nil {
		return fmt.Errorf("pigpio write: %w", err)
	}
	if res < 0 {
		return fmt.Errorf("pigpio write: %d", res)
	}
	return nil
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
	if res, err := t.pigpio.command(piCmdWaveAddGeneric, 0, 0, uint32(len(data)), data); err != nil {
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
