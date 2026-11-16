//go:build !dummy

package roverd

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"sync"

	"github.com/tarm/serial"
)

type SerialAdapter struct {
	port    io.ReadWriteCloser
	encoder *base64.Encoding
	mu      sync.Mutex
	log     *log.Logger
}

func OpenSerial(cfg SerialConfig) (*serial.Port, error) {
	return serial.OpenPort(&serial.Config{
		Name:        cfg.Device,
		Baud:        cfg.Baud,
		ReadTimeout: sensorReadTimeout,
	})
}

func NewSerialAdapter(port io.ReadWriteCloser, logger *log.Logger) *SerialAdapter {
	return &SerialAdapter{
		port:    port,
		encoder: base64.StdEncoding,
		log:     logger,
	}
}

func (s *SerialAdapter) write(buf []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	n, err := s.port.Write(buf)
	if err != nil {
		return err
	}
	if n != len(buf) {
		return fmt.Errorf("short write %d/%d", n, len(buf))
	}
	return nil
}

func (s *SerialAdapter) DriveDirect(left, right int) error {
	payload := []byte{
		145,
		byte((right >> 8) & 0xFF),
		byte(right & 0xFF),
		byte((left >> 8) & 0xFF),
		byte(left & 0xFF),
	}
	return s.write(payload)
}

func (s *SerialAdapter) MotorPWM(main, side, vacuum int) error {
	payload := []byte{
		144,
		byte(main & 0xFF),
		byte(side & 0xFF),
		byte(vacuum & 0xFF),
	}
	return s.write(payload)
}

func (s *SerialAdapter) StartSensorStream(packets []byte) error {
	if len(packets) == 0 {
		return errors.New("sensor stream requires packets")
	}
	payload := []byte{148, byte(len(packets))}
	payload = append(payload, packets...)
	return s.write(payload)
}

func (s *SerialAdapter) PauseSensorStream(pause bool) error {
	state := byte(1)
	if pause {
		state = 0
	}
	return s.write([]byte{150, state})
}

func (s *SerialAdapter) SendRaw(raw []byte) error {
	return s.write(raw)
}

func (s *SerialAdapter) StartOI() error {
	return s.write([]byte{128})
}

func (s *SerialAdapter) SeekDock() error {
	return s.write([]byte{143})
}

func (s *SerialAdapter) PlaySong(slot int, notes []songNote) error {
	if len(notes) == 0 {
		return fmt.Errorf("song requires at least one note")
	}
	if len(notes) > 16 {
		return fmt.Errorf("song supports up to 16 notes, got %d", len(notes))
	}
	if slot < 0 || slot > 4 {
		return fmt.Errorf("song slot must be 0-4")
	}

	payload := []byte{140, byte(slot), byte(len(notes))}
	for _, n := range notes {
		note := clampInt(n.Note, 31, 127)
		duration := clampInt(n.Duration, 1, 255)
		payload = append(payload, byte(note), byte(duration))
	}
	if err := s.write(payload); err != nil {
		return err
	}
	return s.write([]byte{141, byte(slot)})
}
