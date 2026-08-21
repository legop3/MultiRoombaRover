package roverd

import (
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

const roverConsolePath = "/dev/tty1"

// ConsoleNotifier writes the small set of rover lifecycle events that must be
// visible even when nobody is logged in. This intentionally targets tty1
// directly instead of using wall: wall discovers recipients through utmp, so
// it does not reliably reach a virtual console that is only showing a login
// prompt.
type ConsoleNotifier struct {
	path   string
	logger *log.Logger
	mu     sync.Mutex
}

// NewConsoleNotifier returns the production notifier for the rover's primary
// local virtual console. Keeping the path inside the notifier also gives tests
// a way to substitute a regular temporary file without touching a real TTY.
func NewConsoleNotifier(logger *log.Logger) *ConsoleNotifier {
	return newConsoleNotifier(roverConsolePath, logger)
}

func newConsoleNotifier(path string, logger *log.Logger) *ConsoleNotifier {
	return &ConsoleNotifier{path: path, logger: logger}
}

// Notify appends one self-contained alert to the console. Console output is a
// diagnostic convenience rather than part of rover control, so an unavailable
// tty is logged but never allowed to stop startup, reconnection, docking, or
// reboot behavior.
func (n *ConsoleNotifier) Notify(message string) {
	if n == nil {
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	console, err := os.OpenFile(n.path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		n.logFailure("open", err)
		return
	}
	defer console.Close()

	// Leading and trailing CRLFs keep the alert separate from an agetty login
	// prompt, while plain text avoids leaving an unknown terminal in a modified
	// color or cursor state.
	timestamp := time.Now().UTC().Format("2006-01-02 15:04:05 UTC")
	if _, err := fmt.Fprintf(console, "\r\n*** rover alert - %s ***\r\n%s\r\n", timestamp, message); err != nil {
		n.logFailure("write", err)
	}
}

func (n *ConsoleNotifier) logFailure(operation string, err error) {
	if n.logger != nil {
		n.logger.Printf("console notification %s failed for %s: %v", operation, n.path, err)
	}
}
