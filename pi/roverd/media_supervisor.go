package roverd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"time"
)

type MediaSupervisor struct {
	cfg           MediaConfig
	logger        *log.Logger
	client        *http.Client
	checkInterval time.Duration
}

func NewMediaSupervisor(cfg MediaConfig, logger *log.Logger) *MediaSupervisor {
	if err := UpdatePublisherEnv(cfg); err != nil {
		logger.Printf("media supervisor: update env failed: %v", err)
	}
	if !cfg.Manage {
		return nil
	}
	interval := cfg.HealthInterval.Duration
	if interval <= 0 {
		interval = 30 * time.Second
	}
	var client *http.Client
	if cfg.HealthURL != "" {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &MediaSupervisor{
		cfg:           cfg,
		logger:        logger,
		client:        client,
		checkInterval: interval,
	}
}

func (m *MediaSupervisor) Start(ctx context.Context) {
	if m == nil {
		return
	}
	if err := UpdatePublisherEnv(m.cfg); err != nil {
		m.logger.Printf("media supervisor: update env failed: %v", err)
	}
	if m.cfg.HealthURL == "" || m.client == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(m.checkInterval)
		defer ticker.Stop()

		if err := m.checkAndRepair(); err != nil {
			m.logger.Printf("media supervisor: %v", err)
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := m.checkAndRepair(); err != nil {
					m.logger.Printf("media supervisor: %v", err)
				}
			}
		}
	}()
}

func (m *MediaSupervisor) HandleAction(ctx context.Context, action string) error {
	if m == nil {
		return errors.New("media supervisor disabled")
	}
	if err := UpdatePublisherEnv(m.cfg); err != nil {
		return err
	}
	switch action {
	case "start", "stop", "restart", "reload", "status":
		return m.runSystemctl(ctx, action)
	default:
		return fmt.Errorf("unknown media action: %s", action)
	}
}

func (m *MediaSupervisor) checkAndRepair() error {
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	if m.checkHealth(ctx) {
		return nil
	}
	m.logger.Printf("media supervisor: health check failed, restarting configured media services")
	if err := m.runSystemctl(ctx, "restart"); err != nil {
		return fmt.Errorf("restart media services: %w", err)
	}
	return nil
}

func (m *MediaSupervisor) checkHealth(ctx context.Context) bool {
	if m.client == nil || m.cfg.HealthURL == "" {
		return true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.cfg.HealthURL, nil)
	if err != nil {
		m.logger.Printf("media supervisor: health request: %v", err)
		return false
	}
	resp, err := m.client.Do(req)
	if err != nil {
		m.logger.Printf("media supervisor: health request failed: %v", err)
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true
	}
	m.logger.Printf("media supervisor: unexpected health status %d", resp.StatusCode)
	return false
}

func (m *MediaSupervisor) runSystemctl(ctx context.Context, action string) error {
	services := m.managedServices()
	if len(services) == 0 {
		return errors.New("no media services configured")
	}
	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	for _, service := range services {
		cmd := exec.CommandContext(runCtx, "systemctl", action, service)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl %s %s: %w (%s)", action, service, err, string(output))
		}
	}
	return nil
}

func (m *MediaSupervisor) managedServices() []string {
	/*
		Only enabled streams are service-managed. This matters for audio capture:
		the service may be installed everywhere, but a rover with capture disabled
		should not have remote media commands starting a publisher that the config
		says should stay off.
	*/
	services := []string{}
	if m.cfg.Video.Enabled && m.cfg.Video.Service != "" {
		services = append(services, m.cfg.Video.Service)
	}
	if m.cfg.AudioCapture.Enabled && m.cfg.AudioCapture.Service != "" {
		services = append(services, m.cfg.AudioCapture.Service)
	}
	if m.cfg.AudioPlayback.Enabled && m.cfg.AudioPlayback.Service != "" {
		services = append(services, m.cfg.AudioPlayback.Service)
	}
	return services
}
