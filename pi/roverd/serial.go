package roverd

import (
	"encoding/base64"
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

func (s *SerialAdapter) StartSensorStream(group byte) error {
	payload := []byte{148, 1, group}
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
