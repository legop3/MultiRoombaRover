//go:build !dummy

package roverd

import (
	"context"
	"io"
	"log"
	"time"

	"github.com/tarm/serial"
)

const (
	peripheralBaud        = 115200
	peripheralReadTimeout = 100 * time.Millisecond
)

// DiscoverPeripheralManager performs the one and only peripheral scan for this
// roverd process. The Roomba Open Interface serial device is explicitly
// excluded because it belongs to SerialAdapter and must never be probed as an
// ESP32 peripheral.
func DiscoverPeripheralManager(ctx context.Context, excludedDevice string, logger *log.Logger) (*PeripheralManager, error) {
	dependencies := peripheralDiscoveryDependencies{
		listCandidates: listPeripheralCandidates,
		open: func(devicePath string) (io.ReadWriteCloser, error) {
			return serial.OpenPort(&serial.Config{
				Name:        devicePath,
				Baud:        peripheralBaud,
				ReadTimeout: peripheralReadTimeout,
			})
		},
		sleep:         time.Sleep,
		startupWait:   peripheralStartupWait,
		handshakeWait: peripheralHandshakeTimeout,
	}
	return discoverPeripheralManager(ctx, excludedDevice, logger, dependencies)
}
