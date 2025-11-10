package roverd

import (
	"bufio"
	"context"
	"encoding/hex"
	"io"
	"log"
	"time"
)

const (
	sensorHeader       = 19
	sensorReadTimeout  = 150 * time.Millisecond
	streamGroupDefault = 100
)

type SensorStreamer struct {
	r      io.Reader
	out    chan<- []byte
	logger *log.Logger
}

func NewSensorStreamer(r io.Reader, out chan<- []byte, logger *log.Logger) *SensorStreamer {
	return &SensorStreamer{r: r, out: out, logger: logger}
}

func (s *SensorStreamer) Run(ctx context.Context) {
	reader := bufio.NewReader(s.r)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		b, err := reader.ReadByte()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			continue
		}
		if b != sensorHeader {
			continue
		}
		nBytes, err := reader.ReadByte()
		if err != nil {
			continue
		}
		frame := make([]byte, int(nBytes)+3)
		frame[0] = sensorHeader
		frame[1] = nBytes
		if _, err := io.ReadFull(reader, frame[2:]); err != nil {
			continue
		}

		if !validateChecksum(frame) {
			s.logger.Printf("sensor checksum failed: %s", hex.EncodeToString(frame))
			continue
		}

		select {
		case s.out <- frame:
		default:
		}
	}
}

func validateChecksum(buf []byte) bool {
	var sum int
	for _, b := range buf {
		sum += int(b)
	}
	return byte(sum&0xFF) == 0
}
