//go:build dummy

package roverd

import (
	"errors"
	"io"
	"log"
)

type dummyPort struct{}

func (dummyPort) Read(p []byte) (int, error)  { return 0, io.EOF }
func (dummyPort) Write(p []byte) (int, error) { return len(p), nil }
func (dummyPort) Close() error                { return nil }

func OpenSerial(cfg SerialConfig) (io.ReadWriteCloser, error) {
	return dummyPort{}, nil
}

type SerialAdapter struct {
	log *log.Logger
}

func NewSerialAdapter(_ io.ReadWriteCloser, logger *log.Logger) *SerialAdapter {
	return &SerialAdapter{log: logger}
}

func (s *SerialAdapter) DriveDirect(left, right int) error {
	s.log.Printf("[dummy] drive L=%d R=%d", left, right)
	return nil
}

func (s *SerialAdapter) MotorPWM(main, side, vacuum int) error {
	s.log.Printf("[dummy] motor main=%d side=%d vacuum=%d", main, side, vacuum)
	return nil
}

func (s *SerialAdapter) StartSensorStream(packets []byte) error {
	if len(packets) == 0 {
		return errors.New("sensor stream requires packets")
	}
	return nil
}

func (s *SerialAdapter) PauseSensorStream(pause bool) error {
	return nil
}

func (s *SerialAdapter) SendRaw(raw []byte) error {
	s.log.Printf("[dummy] raw %v", raw)
	return nil
}

func (s *SerialAdapter) SeekDock() error {
	s.log.Printf("[dummy] seek dock")
	return nil
}

func (s *SerialAdapter) PlaySong(slot int, notes []songNote) error {
	s.log.Printf("[dummy] play song slot=%d notes=%v", slot, notes)
	return nil
}
