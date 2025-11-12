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
	sensorHeader      = 19
	sensorReadTimeout = 150 * time.Millisecond
)

type SensorStreamer struct {
	r       io.Reader
	rawOut  chan<- []byte
	parsed  chan<- SensorSample
	logger  *log.Logger
}

func NewSensorStreamer(r io.Reader, rawOut chan<- []byte, parsed chan<- SensorSample, logger *log.Logger) *SensorStreamer {
	return &SensorStreamer{r: r, rawOut: rawOut, parsed: parsed, logger: logger}
}

func (s *SensorStreamer) Run(ctx context.Context) {
	reader := bufio.NewReader(s.r)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		header, err := reader.ReadByte()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			continue
		}
		if header != sensorHeader {
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
		case s.rawOut <- frame:
		default:
		}

		if s.parsed != nil {
			if sample, ok := decodeSensorSample(frame); ok {
				select {
				case s.parsed <- sample:
				default:
				}
			}
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

func decodeSensorSample(frame []byte) (SensorSample, bool) {
	if len(frame) < 3 {
		return SensorSample{}, false
	}
	nBytes := int(frame[1])
	if nBytes+3 != len(frame) {
		return SensorSample{}, false
	}
	payload := frame[2 : 2+nBytes]
	if len(payload) != expectedPayloadLength {
		return SensorSample{}, false
	}

	idx := 0
	var sample SensorSample
	var seen byte
	for idx < len(payload) {
		id := payload[idx]
		idx++
		size, ok := packetSizes[id]
		if !ok {
			return SensorSample{}, false
		}
		if idx+size > len(payload) {
			return SensorSample{}, false
		}
		segment := payload[idx : idx+size]
		switch id {
		case 21:
			sample.ChargingState = segment[0]
			seen |= 1
		case 34:
			sample.ChargeSources = segment[0]
			seen |= 2
		}
		idx += size
	}
	sample.Timestamp = time.Now().UnixMilli()
	return sample, seen&3 == 3
}
