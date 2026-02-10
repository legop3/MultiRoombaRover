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

type HornConfig struct {
	Enabled     bool     `yaml:"enabled" json:"enabled"`
	Volume      float64  `yaml:"volume" json:"-"`
	SampleRate  int      `yaml:"sampleRate" json:"-"`
	Channels    int      `yaml:"channels" json:"-"`
	Device      string   `yaml:"device" json:"-"`
	SineGain    float64  `yaml:"sineGain" json:"-"`
	SawGain     float64  `yaml:"sawGain" json:"-"`
	MaxDuration Duration `yaml:"maxDuration" json:"-"`
}

type MediaConfig struct {
	PublishURL      string   `yaml:"publishUrl" json:"publishUrl,omitempty"`
	AudioPublishURL string   `yaml:"audioPublishUrl" json:"audioPublishUrl,omitempty"`
	PublishPort     int      `yaml:"publishPort" json:"-"`
	Manage          bool     `yaml:"manage"`
	ManageAudio     bool     `yaml:"manageAudio"`
	Service         string   `yaml:"service"`
	AudioService    string   `yaml:"audioService"`
	HealthURL       string   `yaml:"healthUrl"`
	HealthInterval  Duration `yaml:"healthInterval"`
	VideoWidth      int      `yaml:"videoWidth" json:"-"`
	VideoHeight     int      `yaml:"videoHeight" json:"-"`
	VideoFPS        int      `yaml:"videoFps" json:"-"`
	VideoBitrate    int      `yaml:"videoBitrate" json:"-"`
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
	Invert        bool    `yaml:"invert" json:"invert"`
}

type NightVisionConfig struct {
	Enabled   bool   `yaml:"enabled" json:"enabled"`
	GPIOPin   int    `yaml:"gpioPin" json:"gpioPin"`
	GPIOChip  string `yaml:"gpioChip" json:"gpioChip"`
	InitialOn bool   `yaml:"initialOn" json:"initialOn"`
}

type AutoSideBrushConfig struct {
	Enabled bool `yaml:"enabled"`
	Speed   int  `yaml:"speed"`
}

type Config struct {
	Name          string              `yaml:"name"`
	ServerURL     string              `yaml:"serverUrl"`
	Serial        SerialConfig        `yaml:"serial"`
	BRC           BRCConfig           `yaml:"brc"`
	Battery       BatteryConfig       `yaml:"battery"`
	MaxWheelMMs   int                 `yaml:"maxWheelSpeed"`
	Media         MediaConfig         `yaml:"media"`
	CameraServo   CameraServoConfig   `yaml:"cameraServo"`
	Audio         AudioConfig         `yaml:"audio"`
	Horn          HornConfig          `yaml:"horn"`
	NightVision   NightVisionConfig   `yaml:"nightVision" json:"nightVision"`
	AutoSideBrush AutoSideBrushConfig `yaml:"autoSideBrush"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := Config{
		MaxWheelMMs: 500,
		BRC: BRCConfig{
			GPIOPin:  4,
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
			CaptureDevice:  "rovermic",
			SampleRate:     48000,
			Channels:       2,
			Bitrate:        24000,
			TTSEnabled:     false,
			DefaultEngine:  "flite",
			DefaultVoice:   "rms",
			DefaultPitch:   50,
		},
		Horn: HornConfig{
			Enabled:     false,
			Volume:      0.25,
			SampleRate:  48000,
			Channels:    1,
			SineGain:    1.0,
			SawGain:     0.7,
			MaxDuration: Duration{Duration: 10000 * time.Millisecond},
		},
		NightVision: NightVisionConfig{
			Enabled:   true,
			GPIOPin:   22,
			GPIOChip:  "gpiochip0",
			InitialOn: true,
		},
		AutoSideBrush: AutoSideBrushConfig{
			Enabled: true,
			Speed:   20,
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
	if cfg.Media.AudioPublishURL == "" {
		derived, err := derivePublishURL(cfg.ServerURL, cfg.Name+"-audio", cfg.Media.PublishPort)
		if err != nil {
			return nil, fmt.Errorf("derive audioPublishUrl: %w", err)
		}
		cfg.Media.AudioPublishURL = derived
	}
	if err := validateServoConfig(&cfg.CameraServo); err != nil {
		return nil, fmt.Errorf("cameraServo: %w", err)
	}
	if err := validateNightVisionConfig(&cfg.NightVision); err != nil {
		return nil, fmt.Errorf("nightVision: %w", err)
	}
	validateAudioConfig(&cfg.Audio)
	validateHornConfig(&cfg.Horn)
	validateAutoSideBrushConfig(&cfg.AutoSideBrush)
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
	if cfg.MinPulseUs <= 0 || cfg.MaxPulseUs <= 0 {
		return errors.New("minPulseUs/maxPulseUs invalid")
	}
	if cfg.MinPulseUs == cfg.MaxPulseUs {
		return errors.New("minPulseUs/maxPulseUs cannot be equal")
	}
	if cfg.MinPulseUs > cfg.MaxPulseUs {
		cfg.MinPulseUs, cfg.MaxPulseUs = cfg.MaxPulseUs, cfg.MinPulseUs
		cfg.Invert = !cfg.Invert
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
		cfg.Channels = 2
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

func validateHornConfig(cfg *HornConfig) {
	if cfg.Volume <= 0 {
		cfg.Volume = 0.25
	}
	if cfg.Volume > 1 {
		cfg.Volume = 1
	}
	if cfg.SampleRate <= 0 {
		cfg.SampleRate = 48000
	}
	if cfg.Channels <= 0 {
		cfg.Channels = 1
	}
	if cfg.SineGain <= 0 {
		cfg.SineGain = 1.0
	}
	if cfg.SawGain <= 0 {
		cfg.SawGain = 0.7
	}
	if cfg.MaxDuration.Duration <= 0 {
		cfg.MaxDuration = Duration{Duration: 1200 * time.Millisecond}
	}
}

func validateNightVisionConfig(cfg *NightVisionConfig) error {
	if !cfg.Enabled {
		return nil
	}
	if cfg.GPIOPin <= 0 {
		return errors.New("gpioPin must be > 0")
	}
	if cfg.GPIOChip == "" {
		cfg.GPIOChip = "gpiochip0"
	}
	return nil
}

func validateAutoSideBrushConfig(cfg *AutoSideBrushConfig) {
	if cfg.Speed == 0 {
		return
	}
	cfg.Speed = clampInt(cfg.Speed, -127, 127)
}

func derivePublishURL(serverURL, streamName string, port int) (string, error) {
	if streamName == "" {
		return "", errors.New("missing stream name for publishUrl")
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
	escaped := url.PathEscape(streamName)
	return fmt.Sprintf("srt://%s:%d?streamid=#!::r=%s,m=publish&latency=10&mode=caller&transtype=live&pkt_size=1316", host, port, escaped), nil
}
