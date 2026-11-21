package roverd

var (
	defaultStreamPackets = []byte{100, 21, 34}
	packetSizes          = map[byte]int{
		100: 80,
		21:  1,
		34:  1,
	}
	expectedPayloadLength = func() int {
		sum := 0
		for _, id := range defaultStreamPackets {
			sum += 1 + packetSizes[id]
		}
		return sum
	}()
)

type SensorSample struct {
	Timestamp     int64
	ChargingState byte
	ChargeSources byte
	Mode          byte
	Charge        uint16
	Capacity      uint16
	LeftEncoder   uint16
	RightEncoder  uint16
}
