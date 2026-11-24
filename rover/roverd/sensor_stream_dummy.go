//go:build dummy

package roverd

import (
	"context"
	"log"
	"math/rand"
	"time"
)

const sensorHeader = 19

type SensorStreamer struct {
	rawOut chan<- []byte
	parsed chan<- SensorSample
	logger *log.Logger
}

func NewSensorStreamer(_ interface{}, rawOut chan<- []byte, parsed chan<- SensorSample, logger *log.Logger) *SensorStreamer {
	return &SensorStreamer{rawOut: rawOut, parsed: parsed, logger: logger}
}

func (s *SensorStreamer) Run(ctx context.Context) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			frame := buildDummyFrame()
			select {
			case s.rawOut <- frame:
			default:
			}
			sample := SensorSample{
				Timestamp:     time.Now().UnixMilli(),
				ChargingState: 3,    // trickle charging
				ChargeSources: 0b10, // home base present
			}
			select {
			case s.parsed <- sample:
			default:
			}
		}
	}
}

func buildDummyFrame() []byte {
	payload := make([]byte, 0, expectedPayloadLength)
	payload = append(payload, 100)
	group := make([]byte, packetSizes[100])
	group[0] = byte(rand.Intn(16)) // bumps
	group[16] = 3                  // charging state
	group[39] = 0b10               // Home Base contact
	payload = append(payload, group...)

	buf := make([]byte, 0, len(payload)+3)
	buf = append(buf, sensorHeader, byte(len(payload)))
	buf = append(buf, payload...)
	checksum := calcChecksum(buf)
	buf = append(buf, checksum)
	return buf
}

func calcChecksum(buf []byte) byte {
	sum := 0
	for _, b := range buf {
		sum += int(b)
	}
	return byte((-sum) & 0xFF)
}
