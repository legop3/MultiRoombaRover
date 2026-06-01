package roverd

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
)

const chromeTTSDaemonPath = "/usr/local/bin/chromegtts-daemon"

type chromeTTSDaemon struct {
	log     *log.Logger
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	scanner *bufio.Scanner
}

func NewChromeTTSDaemon(logger *log.Logger) *chromeTTSDaemon {
	return &chromeTTSDaemon{log: logger}
}

func (d *chromeTTSDaemon) Start(ctx context.Context) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.startLocked(ctx)
}

func (d *chromeTTSDaemon) Speak(ctx context.Context, text, voice string, pitch, speed float64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if err := d.startLocked(ctx); err != nil {
		return err
	}

	payload := map[string]any{
		"text":  text,
		"voice": voice,
		"pitch": pitch,
		"speed": speed,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := d.stdin.Write(append(encoded, '\n')); err != nil {
		d.stopLocked()
		return fmt.Errorf("write chromegtts request: %w", err)
	}

	type result struct {
		response chromeTTSResponse
		err      error
	}
	done := make(chan result, 1)
	go func(scanner *bufio.Scanner) {
		var response chromeTTSResponse
		if !scanner.Scan() {
			done <- result{err: fmt.Errorf("chromegtts daemon stopped")}
			return
		}
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			done <- result{err: fmt.Errorf("decode chromegtts response: %w", err)}
			return
		}
		done <- result{response: response}
	}(d.scanner)

	select {
	case <-ctx.Done():
		d.stopLocked()
		return ctx.Err()
	case res := <-done:
		if res.err != nil {
			d.stopLocked()
			return res.err
		}
		if !res.response.OK {
			return fmt.Errorf("chromegtts failed: %s", res.response.Error)
		}
		return nil
	}
}

func (d *chromeTTSDaemon) Shutdown() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopLocked()
}

type chromeTTSResponse struct {
	OK    bool   `json:"ok"`
	Ready bool   `json:"ready,omitempty"`
	Error string `json:"error,omitempty"`
}

func (d *chromeTTSDaemon) startLocked(ctx context.Context) error {
	if d.cmd != nil && d.cmd.ProcessState == nil {
		return nil
	}

	cmd := exec.Command(chromeTTSDaemonPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start chromegtts daemon: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	var ready chromeTTSResponse
	if !scanner.Scan() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("chromegtts daemon exited before ready")
	}
	if err := json.Unmarshal(scanner.Bytes(), &ready); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("decode chromegtts ready: %w", err)
	}
	if !ready.OK {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("chromegtts daemon not ready: %s", ready.Error)
	}

	d.cmd = cmd
	d.stdin = stdin
	d.scanner = scanner
	if d.log != nil {
		d.log.Printf("chromegtts daemon started")
	}
	return nil
}

func (d *chromeTTSDaemon) stopLocked() {
	if d.stdin != nil {
		_ = d.stdin.Close()
		d.stdin = nil
	}
	if d.cmd != nil && d.cmd.ProcessState == nil && d.cmd.Process != nil {
		_ = d.cmd.Process.Kill()
		_ = d.cmd.Wait()
	}
	d.cmd = nil
	d.scanner = nil
}
