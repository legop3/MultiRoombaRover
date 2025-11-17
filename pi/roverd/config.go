package roverd

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type SerialConfig struct {
	Device string `yaml:"device"`
	Baud   int    `yaml:"baud"`
}

type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalYAML(value *yaml.Node) error {
	var raw string
	if err := value.Decode(&raw); err != nil {
		return err
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return err
	}
	d.Duration = parsed
	return nil
}

func (d Duration) MarshalYAML() (interface{}, error) {
	return d.Duration.String(), nil
}

type BRCConfig struct {
	GPIOPin    int      `yaml:"gpioPin"`
	GPIOChip   string   `yaml:"gpioChip"`
	PulseEvery Duration `yaml:"pulseEvery"`
	PulseWidth Duration `yaml:"pulseWidth"`
}

func (b BRCConfig) Enabled() bool {
	return b.GPIOPin >= 0
}

type BatteryConfig struct {
	Full   int `yaml:"full"`
	Warn   int `yaml:"warn"`
	Urgent int `yaml:"urgent"`
}

type MediaConfig struct {
	PublishURL     string   `yaml:"publishUrl" json:"publishUrl,omitempty"`
	PublishPort    int      `yaml:"publishPort" json:"-"`
	Manage         bool     `yaml:"manage"`
	Service        string   `yaml:"service"`
	HealthURL      string   `yaml:"healthUrl"`
	HealthInterval Duration `yaml:"healthInterval"`
	VideoWidth     int      `yaml:"videoWidth" json:"-"`
	VideoHeight    int      `yaml:"videoHeight" json:"-"`
	VideoFPS       int      `yaml:"videoFps" json:"-"`
	VideoBitrate   int      `yaml:"videoBitrate" json:"-"`
}

type Config struct {
	Name        string        `yaml:"name"`
	ServerURL   string        `yaml:"serverUrl"`
	Serial      SerialConfig  `yaml:"serial"`
	BRC         BRCConfig     `yaml:"brc"`
	Battery     BatteryConfig `yaml:"battery"`
	MaxWheelMMs int           `yaml:"maxWheelSpeed"`
	Media       MediaConfig   `yaml:"media"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := Config{
		MaxWheelMMs: 500,
		BRC: BRCConfig{
			GPIOPin:  -1,
			GPIOChip: "gpiochip0",
			PulseEvery: Duration{
				Duration: time.Minute,
			},
			PulseWidth: Duration{
				Duration: time.Second,
			},
		},
		Media: MediaConfig{
			PublishPort:    9000,
			HealthInterval: Duration{Duration: 30 * time.Second},
			VideoWidth:     1280,
			VideoHeight:    720,
			VideoFPS:       30,
			VideoBitrate:   3000000,
		},
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Name == "" {
		return nil, errors.New("missing name")
	}
	if cfg.ServerURL == "" {
		return nil, errors.New("missing serverUrl")
	}
	if cfg.Serial.Device == "" || cfg.Serial.Baud == 0 {
		return nil, errors.New("serial device/baud required")
	}
	if cfg.Battery.Full == 0 {
		return nil, errors.New("battery thresholds required")
	}
	if cfg.MaxWheelMMs <= 0 || cfg.MaxWheelMMs > 500 {
		return nil, fmt.Errorf("maxWheelSpeed must be 1-500, got %d", cfg.MaxWheelMMs)
	}
	if cfg.BRC.GPIOChip == "" {
		cfg.BRC.GPIOChip = "gpiochip0"
	}
	if cfg.Media.Manage && cfg.Media.Service == "" {
		return nil, errors.New("media.manage requires media.service")
	}
	if cfg.Media.Manage && cfg.Media.HealthInterval.Duration <= 0 {
		cfg.Media.HealthInterval = Duration{Duration: 30 * time.Second}
	}
	if cfg.Media.VideoWidth <= 0 {
		cfg.Media.VideoWidth = 1280
	}
	if cfg.Media.VideoHeight <= 0 {
		cfg.Media.VideoHeight = 720
	}
	if cfg.Media.VideoFPS <= 0 {
		cfg.Media.VideoFPS = 30
	}
	if cfg.Media.VideoBitrate <= 0 {
		cfg.Media.VideoBitrate = 3000000
	}
	if cfg.Media.PublishPort <= 0 {
		cfg.Media.PublishPort = 9000
	}
	if cfg.Media.PublishURL == "" {
		derived, err := derivePublishURL(cfg.ServerURL, cfg.Name, cfg.Media.PublishPort)
		if err != nil {
			return nil, fmt.Errorf("derive publishUrl: %w", err)
		}
		cfg.Media.PublishURL = derived
	}
	return &cfg, nil
}

func derivePublishURL(serverURL, roverName string, port int) (string, error) {
	if roverName == "" {
		return "", errors.New("missing rover name for publishUrl")
	}
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}
	host := parsed.Hostname()
	if host == "" {
		return "", errors.New("serverUrl missing host")
	}
	if port <= 0 {
		port = 9000
	}
	streamName := url.PathEscape(roverName)
	return fmt.Sprintf("srt://%s:%d?streamid=#!::r=%s,m=publish&latency=20&mode=caller&transtype=live&pkt_size=1316", host, port, streamName), nil
}
