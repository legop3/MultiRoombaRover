//go:build dummy

package roverd

import (
	"context"
	"io"
	"log"
	"time"
)

// DiscoverPeripheralManager remains inert in a dummy build. The dummy daemon is
// specifically used without rover hardware and must not probe or reset serial
// devices that happen to be attached to a developer's machine.
func DiscoverPeripheralManager(ctx context.Context, excludedDevice string, logger *log.Logger) (*PeripheralManager, error) {
	dependencies := peripheralDiscoveryDependencies{
		listCandidates: func(string) ([]string, error) { return nil, nil },
		open:           func(string) (io.ReadWriteCloser, error) { return nil, nil },
		sleep:          func(time.Duration) {},
		startupWait:    0,
		handshakeWait:  0,
	}
	return discoverPeripheralManager(ctx, excludedDevice, logger, dependencies)
}
