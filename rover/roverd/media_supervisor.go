package roverd

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

type MediaSupervisor struct {
	statusMu sync.Mutex
	statuses map[string]string
	cfg      *Config
	repo     string
	profiles map[string][]MediaProfile
	events   chan RoverEvent
	logger   *log.Logger
	mu       sync.Mutex
	setupMu  sync.Mutex
	cancel   context.CancelFunc
	done     chan struct{}
}

func NewMediaSupervisor(cfg *Config, repo string, events chan RoverEvent, logger *log.Logger) (*MediaSupervisor, error) {
	profiles, err := LoadMediaProfiles(repo)
	if err != nil {
		return nil, err
	}
	return &MediaSupervisor{cfg: cfg, repo: repo, profiles: profiles, events: events, logger: logger, statuses: make(map[string]string)}, nil
}
func (m *MediaSupervisor) Profiles() map[string][]MediaProfile { return m.profiles }
func (m *MediaSupervisor) emit(kind, category, message string) {
	if kind == "media.status" {
		m.statusMu.Lock()
		m.statuses[category] = message
		m.statusMu.Unlock()
	}
	event := RoverEvent{Type: "event", Event: kind, Ts: time.Now().UnixMilli(), Data: map[string]any{"category": category, "message": message}}
	select {
	case m.events <- event:
	default:
	} // Never block a child on a slow/disconnected server.
}
func (m *MediaSupervisor) Start(ctx context.Context) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel != nil {
		return
	}
	ctx, m.cancel = context.WithCancel(ctx)
	m.done = make(chan struct{})
	go func() {
		defer close(m.done)
		var workers sync.WaitGroup
		for _, category := range mediaCategories {
			enabled, id := m.selection(category)
			if !enabled {
				m.emit("media.status", category, "disabled")
				continue
			}
			workers.Add(1)
			go func(category, id string) { defer workers.Done(); m.supervise(ctx, category, id) }(category, id)
		}
		workers.Wait()
	}()
}
func (m *MediaSupervisor) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cancel == nil {
		return
	}
	m.cancel()
	<-m.done
	m.cancel = nil
}
func (m *MediaSupervisor) selection(category string) (bool, string) {
	switch category {
	case "video":
		return m.cfg.Media.Video.Enabled, m.cfg.Media.Video.Profile
	case "audioCapture":
		return m.cfg.Media.AudioCapture.Enabled, m.cfg.Media.AudioCapture.Profile
	default:
		return m.cfg.Media.AudioPlayback.Enabled, m.cfg.Media.AudioPlayback.Profile
	}
}
func (m *MediaSupervisor) supervise(ctx context.Context, category, id string) {
	var profile *MediaProfile
	for _, p := range m.profiles[category] {
		if p.ID == id {
			copy := p
			profile = &copy
			break
		}
	}
	if profile == nil {
		m.emit("media.status", category, "unknown profile: "+id)
		return
	}
	dir := filepath.Join("/var/lib/roverd/profiles", category, id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		m.emit("media.status", category, err.Error())
		return
	}
	env := m.environment(dir)
	if profile.Setup != "" {
		m.emit("media.status", category, "setup")
		m.setupMu.Lock()
		err := m.command(ctx, category, dir, env, profile.Setup)
		m.setupMu.Unlock()
		if err != nil {
			m.emit("media.status", category, "setup failed: "+err.Error())
			return
		}
	}
	for ctx.Err() == nil {
		m.emit("media.status", category, "running")
		err := m.command(ctx, category, dir, env, profile.Run)
		if ctx.Err() != nil {
			break
		}
		m.emit("media.status", category, fmt.Sprintf("exited (%v); retrying in 2s", err))
		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Second):
		}
	}
	m.emit("media.status", category, "stopped")
}

type mediaOutput struct {
	supervisor *MediaSupervisor
	category   string
}

func (w mediaOutput) Write(data []byte) (int, error) {
	// Split even output without newlines into bounded messages.
	count := len(data)
	for len(data) > 0 {
		n := len(data)
		if n > 4096 {
			n = 4096
		}
		w.supervisor.emit("media.output", w.category, string(data[:n]))
		data = data[n:]
	}
	return count, nil
}
func (m *MediaSupervisor) command(ctx context.Context, category, dir string, env []string, command string) error {
	cmd := exec.CommandContext(ctx, "/bin/bash", "-e", "-o", "pipefail", "-c", command)
	cmd.Dir = dir
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = mediaOutput{m, category}
	cmd.Stderr = mediaOutput{m, category}
	// Kill the entire group: shell pipelines must not survive cancellation or
	// retain stdout pipes after their parent shell exits.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Start(); err != nil {
		return err
	}
	err := cmd.Wait()
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	return err
}
func (m *MediaSupervisor) environment(dir string) []string {
	cfg := m.cfg
	host, _ := url.Parse(cfg.ServerURL)
	values := map[string]string{
		"ROVER_NAME": cfg.Name, "ROVER_SERVER_HOST": host.Hostname(), "ROVER_PROFILE_DIR": dir, "ROVER_REPO_DIR": m.repo,
		"ROVER_VIDEO_DEVICE": cfg.Media.Video.Device, "ROVER_VIDEO_INPUT_FORMAT": cfg.Media.Video.InputFormat,
		"ROVER_VIDEO_WIDTH": strconv.Itoa(cfg.Media.Video.Width), "ROVER_VIDEO_HEIGHT": strconv.Itoa(cfg.Media.Video.Height),
		"ROVER_VIDEO_FPS": strconv.Itoa(cfg.Media.Video.FPS), "ROVER_VIDEO_BITRATE": strconv.Itoa(cfg.Media.Video.Bitrate),
		"ROVER_VIDEO_INVERTED": strconv.FormatBool(cfg.Media.Video.Inverted), "ROVER_VIDEO_SENSOR_MODE": cfg.Media.Video.SensorMode,
		"ROVER_VIDEO_PUBLISH_URL": cfg.Media.Video.PublishURL, "ROVER_AUDIO_PUBLISH_URL": cfg.Media.AudioCapture.PublishURL,
		"ROVER_AUDIO_PLAYBACK_URL": cfg.Media.AudioPlayback.ForwardURL, "ROVER_AUDIO_INPUT_DEVICE": "rover_capture", "ROVER_AUDIO_OUTPUT_DEVICE": "rover_forward",
		"ROVER_AUDIO_SAMPLE_RATE": strconv.Itoa(cfg.Media.AudioCapture.SampleRate), "ROVER_AUDIO_CHANNELS": strconv.Itoa(cfg.Media.AudioCapture.Channels),
		"ROVER_AUDIO_BITRATE": strconv.Itoa(cfg.Media.AudioCapture.Bitrate), "ROVER_AUDIO_NORMALIZE": strconv.FormatBool(cfg.Media.AudioPlayback.Normalize),
		"ROVER_AUDIO_NORMALIZE_FILTER": cfg.Media.AudioPlayback.NormalizeFilter,
	}
	env := os.Environ()
	for key, value := range values {
		env = append(env, key+"="+value)
	}
	return env
}

func (m *MediaSupervisor) Status() map[string]string {
	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	result := make(map[string]string)
	for key, value := range m.statuses {
		result[key] = value
	}
	return result
}
