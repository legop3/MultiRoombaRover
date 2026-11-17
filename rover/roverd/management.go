package roverd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

type ManagementClient struct {
	cfg        *Config
	repo       string
	configPath string
	events     chan RoverEvent
	log        *log.Logger
	restart    func()
	mu         sync.Mutex
	runtime    *WSClient
	media      *MediaSupervisor
	stopping   bool
}

type managementCommand struct {
	Type     string          `json:"type"`
	ID       string          `json:"id"`
	Config   json.RawMessage `json:"config"`
	Reboot   *rebootPayload  `json:"reboot"`
	Category string          `json:"category"`
	Profile  *MediaProfile   `json:"profile"`
	Media    *mediaCommand   `json:"media"`
}

func NewManagementClient(cfg *Config, path string, events chan RoverEvent, logger *log.Logger, restart func()) *ManagementClient {
	return &ManagementClient{cfg: cfg, configPath: path, events: events, log: logger, restart: restart}
}

// Startup can finish while a management action is being accepted. Do not attach
// a new command source once shutdown has begun.
func (m *ManagementClient) SetRuntime(client *WSClient, media *MediaSupervisor) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		client.PrepareShutdown()
		return false
	}
	m.runtime, m.media = client, media
	return true
}

func (m *ManagementClient) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := m.connect(ctx); err != nil && ctx.Err() == nil {
			m.log.Printf("management connection: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (m *ManagementClient) connect(parent context.Context) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	endpoint, _ := url.Parse(m.cfg.ServerURL)
	endpoint.Path = "/rover/management"
	dialCtx, dialCancel := context.WithTimeout(ctx, dialTimeout)
	conn, _, err := websocket.Dial(dialCtx, endpoint.String(), nil)
	dialCancel()
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1024 * 1024)
	if err := writeJSON(ctx, conn, map[string]any{
		"type": "hello", "name": m.cfg.Name, "config": m.cfg,
		"schema": ConfigurationSchema(), "profiles": m.profileCatalog(), "mediaStatus": m.mediaStatus(), "updateStatus": readUpdateStatus(),
	}); err != nil {
		return err
	}
	errors := make(chan error, 3)
	go func() { errors <- keepalive(ctx, conn) }()
	go func() { errors <- m.read(ctx, conn) }()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case event := <-m.events:
				if err := writeJSON(ctx, conn, event); err != nil {
					errors <- err
					return
				}
			}
		}
	}()
	go m.forwardHostStats(ctx, conn)
	go m.forwardUpdateStatus(ctx, conn)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errors:
		return err
	}
}

func (m *ManagementClient) read(ctx context.Context, conn *websocket.Conn) error {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var command managementCommand
		if err := json.Unmarshal(data, &command); err != nil {
			return err
		}
		if command.ID == "" {
			continue
		}
		after, commandErr := m.execute(ctx, command)
		ack := ackMessage{Type: "ack", ID: command.ID, Status: "ok"}
		if commandErr != nil {
			ack.Status = "error"
			ack.Error = commandErr.Error()
		}
		err = writeJSON(ctx, conn, ack)
		// Once configuration is committed, restart even if the acknowledgement
		// cannot reach the server. Reconnection reports the actual saved object.
		if after != nil {
			after()
		}
		if err != nil {
			return err
		}
	}
}

func (m *ManagementClient) execute(ctx context.Context, command managementCommand) (func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		return nil, fmt.Errorf("management action already pending")
	}
	if command.Type == "profile.set" {
		if command.Profile == nil {
			return nil, fmt.Errorf("profile required")
		}
		if err := SaveCustomProfile(command.Category, *command.Profile); err != nil {
			return nil, err
		}
		m.stopping = true
		if m.runtime != nil {
			_ = m.runtime.PrepareShutdown()
		}
		return m.restart, nil
	}
	if command.Type == "media" {
		if m.media == nil || command.Media == nil {
			return nil, fmt.Errorf("media supervisor unavailable")
		}
		return nil, m.media.HandleAction(ctx, command.Media.Action)
	}
	var config *Config
	var err error
	switch command.Type {
	case "config.set":
		config, err = DecodeConfig(command.Config)
		if err != nil {
			return nil, err
		}
	case "reboot", "update":
	default:
		return nil, fmt.Errorf("unsupported management command: %s", command.Type)
	}
	if m.runtime != nil {
		if err := m.runtime.PrepareShutdown(); err != nil {
			m.runtime.ResumeControl()
			return nil, err
		}
	}
	resume := func() {
		if m.runtime != nil {
			m.runtime.ResumeControl()
		}
	}
	if command.Type == "config.set" {
		if err := SaveConfig(m.configPath, config); err != nil {
			resume()
			return nil, err
		}
		m.stopping = true
		return m.restart, nil
	}
	// The updater remains a fixed-purpose helper; browser input cannot select
	// executable paths or shell arguments. The separate systemd job survives restart.
	path, args := "systemctl", []string{"reboot"}
	if command.Type == "update" {
		path, args = "/usr/local/sbin/roverd-self-update", nil
	}
	if _, err := exec.LookPath(path); err != nil {
		resume()
		return nil, err
	}
	m.stopping = true
	delay := 300 * time.Millisecond
	if command.Reboot != nil && command.Reboot.DelayMs > 0 {
		delay = time.Duration(clampInt(command.Reboot.DelayMs, 50, 5000)) * time.Millisecond
	}
	return func() {
		go func() {
			select {
			case <-ctx.Done():
			case <-time.After(delay):
			}
			m.emit("system."+command.Type+"Starting", nil)
			cmd := exec.Command(path, args...)
			if err := cmd.Run(); err != nil {
				m.log.Printf("management %s failed: %v", command.Type, err)
				m.emit("system."+command.Type+"Failed", map[string]any{"error": err.Error()})
				m.mu.Lock()
				m.stopping = false
				resume()
				m.mu.Unlock()
			}
		}()
	}, nil
}
func (c *ManagementClient) forwardHostStats(ctx context.Context, conn *websocket.Conn) {
	var previousNetworkSample *networkRateSample

	send := func() bool {
		// Host stats are collected on demand so each outbound message describes
		// the current Pi state. Collection failures are encoded into the stats
		// payload, which keeps this telemetry path from closing the rover socket.
		stats := CollectHostStats(ctx)
		// Throughput is derived here because this loop owns the ordered, periodic
		// samples for one connection. CollectHostStats stays independent, while a
		// reconnect automatically receives a clean counter baseline.
		previousNetworkSample = applyNetworkThroughput(stats.WiFi, previousNetworkSample)
		msg := hostStatsMessage{
			Type:      "hostStats",
			Timestamp: time.Now().UnixMilli(),
			Stats:     stats,
		}
		if err := writeJSON(ctx, conn, msg); err != nil {
			c.log.Printf("host stats send failed: %v", err)
			return false
		}
		return true
	}

	// Send once immediately so a newly connected rover can populate the UI
	// without waiting for the first ticker interval.
	if !send() {
		return
	}

	ticker := time.NewTicker(hostStatsInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !send() {
				return
			}
		}
	}
}

func (m *ManagementClient) SetMedia(media *MediaSupervisor) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.media = media
}

func (m *ManagementClient) emit(event string, data map[string]any) {
	select {
	case m.events <- RoverEvent{Type: "event", Event: event, Ts: time.Now().UnixMilli(), Data: data}:
	default:
	}
}

func (m *ManagementClient) SetRepository(repo string) { m.repo = repo }
func (m *ManagementClient) profileCatalog() map[string][]MediaProfile {
	profiles, err := LoadMediaProfiles(m.repo)
	if err != nil {
		m.log.Printf("profile catalog: %v", err)
		return map[string][]MediaProfile{}
	}
	return profiles
}

func (m *ManagementClient) mediaStatus() map[string]string {
	if m.media == nil {
		return nil
	}
	return m.media.Status()
}

// Persist only the latest update result, so reconnects do not depend on an
// in-memory event surviving the service restart.
func readUpdateStatus() json.RawMessage {
	data, err := os.ReadFile("/var/lib/roverd/update-status.json")
	if err != nil || !json.Valid(data) {
		return nil
	}
	return data
}

func (m *ManagementClient) forwardUpdateStatus(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var previous json.RawMessage
	for {
		current := readUpdateStatus()
		if current != nil && !bytes.Equal(current, previous) {
			if err := writeJSON(ctx, conn, map[string]any{"type": "updateStatus", "status": current}); err != nil {
				return
			}
			previous = current
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
