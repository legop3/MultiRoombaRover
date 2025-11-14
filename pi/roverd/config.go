package roverd

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
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
	WhepURL        string   `yaml:"whepUrl" json:"whepUrl,omitempty"`
	WhepPort       int      `yaml:"whepPort" json:"-"`
	WhepPath       string   `yaml:"whepPath" json:"-"`
	LegacyPublish  string   `yaml:"publishUrl,omitempty" json:"-"`
	BridgeWhepURL  string   `yaml:"-" json:"bridgeWhepUrl,omitempty"`
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
			WhepPort:       8889,
			WhepPath:       "/whep/rovercam",
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
	if cfg.Media.WhepURL == "" {
		cfg.Media.WhepURL = cfg.Media.LegacyPublish
	}
	if cfg.Media.WhepURL == "" {
		ip, err := detectPrimaryIPv4()
		if err != nil {
			return nil, fmt.Errorf("derive whepUrl: %w", err)
		}
		path := cfg.Media.WhepPath
		if path == "" {
			path = "/whep/rovercam"
		}
		path = ensureLeadingSlash(path)
		scheme := "http"
		cfg.Media.WhepURL = fmt.Sprintf("%s://%s:%d%s", scheme, ip, effectivePort(cfg.Media.WhepPort), path)
	}
	if bridge, err := buildBridgeURL(cfg.Media.WhepURL); err == nil {
		cfg.Media.BridgeWhepURL = bridge
	}
	return &cfg, nil
}

func buildBridgeURL(src string) (string, error) {
	if src == "" {
		return "", errors.New("empty whep url")
	}
	parsed, err := url.Parse(src)
	if err != nil {
		return "", err
	}
	if parsed.Host == "" {
		return "", errors.New("missing host")
	}
	proto := "whep"
	if parsed.Scheme == "https" {
		proto = "wheps"
	}
	path := strings.Trim(parsed.Path, "/")
	if strings.HasPrefix(path, "whep/") {
		path = strings.TrimPrefix(path, "whep/")
	}
	path = strings.Trim(path, "/")
	if path == "" {
		path = "rovercam"
	}
	return fmt.Sprintf("%s://%s/%s/whep", proto, parsed.Host, path), nil
}

func ensureLeadingSlash(path string) string {
	if !strings.HasPrefix(path, "/") {
		return "/" + path
	}
	return path
}

func effectivePort(port int) int {
	if port <= 0 {
		return 8889
	}
	return port
}

func detectPrimaryIPv4() (string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip = ip.To4()
			if ip == nil {
				continue
			}
			return ip.String(), nil
		}
	}
	return "", errors.New("no non-loopback IPv4 address found")
}
