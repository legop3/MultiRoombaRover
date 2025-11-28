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

type AudioConfig struct {
	CaptureEnabled bool   `yaml:"captureEnabled" json:"captureEnabled"`
	CaptureDevice  string `yaml:"captureDevice" json:"captureDevice,omitempty"`
	SampleRate     int    `yaml:"sampleRate" json:"sampleRate,omitempty"`
	Channels       int    `yaml:"channels" json:"channels,omitempty"`
	Bitrate        int    `yaml:"bitrate" json:"bitrate,omitempty"`
	TTSEnabled     bool   `yaml:"ttsEnabled" json:"ttsEnabled"`
	DefaultEngine  string `yaml:"defaultEngine" json:"defaultEngine,omitempty"`
	DefaultVoice   string `yaml:"defaultVoice" json:"defaultVoice,omitempty"`
	DefaultPitch   int    `yaml:"defaultPitch" json:"defaultPitch,omitempty"`
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

type CameraServoConfig struct {
	Enabled       bool    `yaml:"enabled" json:"enabled"`
	Pin           int     `yaml:"pin" json:"pin"`
	FreqHz        int     `yaml:"freqHz" json:"freqHz"`
	CycleLen      int     `yaml:"cycleLen" json:"cycleLen"`
	MinPulseUs    int     `yaml:"minPulseUs" json:"minPulseUs"`
	MaxPulseUs    int     `yaml:"maxPulseUs" json:"maxPulseUs"`
	MinAngle      float64 `yaml:"minAngle" json:"minAngle"`
	MaxAngle      float64 `yaml:"maxAngle" json:"maxAngle"`
	HomeAngle     float64 `yaml:"homeAngle" json:"homeAngle"`
	NudgeDegrees  float64 `yaml:"nudgeDegrees" json:"nudgeDegrees"`
	AllowRawPulse bool    `yaml:"allowRawPulse" json:"allowRawPulse"`
}

type Config struct {
	Name        string            `yaml:"name"`
	ServerURL   string            `yaml:"serverUrl"`
	Serial      SerialConfig      `yaml:"serial"`
	BRC         BRCConfig         `yaml:"brc"`
	Battery     BatteryConfig     `yaml:"battery"`
	MaxWheelMMs int               `yaml:"maxWheelSpeed"`
	Media       MediaConfig       `yaml:"media"`
	CameraServo CameraServoConfig `yaml:"cameraServo"`
	Audio       AudioConfig       `yaml:"audio"`
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
			VideoBitrate:   2000000,
		},
		CameraServo: CameraServoConfig{
			Pin:          12,
			FreqHz:       50,
			CycleLen:     20000,
			MinPulseUs:   900,
			MaxPulseUs:   2100,
			MinAngle:     -15,
			MaxAngle:     30,
			HomeAngle:    0,
			NudgeDegrees: 2,
		},
		Audio: AudioConfig{
			CaptureEnabled: false,
			CaptureDevice:  "hw:0,0",
			SampleRate:     48000,
			Channels:       1,
			Bitrate:        24000,
			TTSEnabled:     false,
			DefaultEngine:  "flite",
			DefaultVoice:   "rms",
			DefaultPitch:   50,
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
	if err := validateServoConfig(&cfg.CameraServo); err != nil {
		return nil, fmt.Errorf("cameraServo: %w", err)
	}
	validateAudioConfig(&cfg.Audio)
	return &cfg, nil
}

func validateServoConfig(cfg *CameraServoConfig) error {
	if !cfg.Enabled {
		return nil
	}
	if cfg.Pin <= 0 {
		return errors.New("pin must be > 0")
	}
	if cfg.FreqHz <= 0 {
		return errors.New("freqHz must be > 0")
	}
	if cfg.CycleLen <= 0 {
		return errors.New("cycleLen must be > 0")
	}
	if cfg.MinPulseUs <= 0 || cfg.MaxPulseUs <= 0 || cfg.MinPulseUs >= cfg.MaxPulseUs {
		return errors.New("minPulseUs/maxPulseUs invalid")
	}
	if cfg.MinAngle >= cfg.MaxAngle {
		return errors.New("minAngle must be less than maxAngle")
	}
	cfg.HomeAngle = clampFloat(cfg.HomeAngle, cfg.MinAngle, cfg.MaxAngle)
	if cfg.NudgeDegrees <= 0 {
		cfg.NudgeDegrees = 2
	}
	return nil
}

func clampFloat(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func validateAudioConfig(cfg *AudioConfig) {
	if cfg.CaptureEnabled && cfg.CaptureDevice == "" {
		cfg.CaptureDevice = "hw:0,0"
	}
	if cfg.SampleRate <= 0 {
		cfg.SampleRate = 48000
	}
	if cfg.Channels <= 0 {
		cfg.Channels = 1
	}
	if cfg.Bitrate <= 0 {
		cfg.Bitrate = 64000
	}
	if cfg.DefaultEngine == "" {
		cfg.DefaultEngine = "flite"
	}
	if cfg.DefaultVoice == "" {
		cfg.DefaultVoice = "rms"
	}
	if cfg.DefaultPitch <= 0 {
		cfg.DefaultPitch = 50
	}
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
