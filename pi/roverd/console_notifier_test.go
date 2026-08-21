package roverd

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConsoleNotifierWritesVisibleAlert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tty1")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("create fake console: %v", err)
	}

	notifier := newConsoleNotifier(path, log.New(io.Discard, "", 0))
	notifier.Notify("control server connection lost")

	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fake console: %v", err)
	}
	output := string(contents)
	if !strings.Contains(output, "*** rover alert - ") {
		t.Fatalf("alert header missing from %q", output)
	}
	if !strings.Contains(output, "control server connection lost") {
		t.Fatalf("alert message missing from %q", output)
	}
}

func TestConsoleNotifierTreatsMissingConsoleAsNonfatal(t *testing.T) {
	// A missing TTY is normal on some headless or containerized hosts. The
	// contract is therefore simply that Notify returns instead of escalating a
	// display failure into a rover-process failure.
	notifier := newConsoleNotifier(filepath.Join(t.TempDir(), "missing"), log.New(io.Discard, "", 0))
	notifier.Notify("roverd started")
}
