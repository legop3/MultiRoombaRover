package roverd

import (
	"errors"
	"fmt"
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
	PublishURL     string   `yaml:"publishUrl"`
	Manage         bool     `yaml:"manage"`
	Service        string   `yaml:"service"`
	HealthURL      string   `yaml:"healthUrl"`
	HealthInterval Duration `yaml:"healthInterval"`
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
			HealthInterval: Duration{Duration: 30 * time.Second},
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
	return &cfg, nil
}
