package roverd

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bytes"
	"encoding/json"
	"io"
)

type SerialConfig struct {
	Device string `json:"device"`
	Baud   int    `json:"baud" jsonschema:"minimum=1"`
}

type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return err
	}
	d.Duration = parsed
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) { return json.Marshal(d.Duration.String()) }

type BRCConfig struct {
	Enabled    bool     `json:"enabled"`
	GPIOPin    int      `json:"gpioPin"`
	GPIOChip   string   `json:"gpioChip"`
	PulseEvery Duration `json:"pulseEvery"`
	PulseWidth Duration `json:"pulseWidth"`
}

type BatteryConfig struct {
	Full   int `json:"full"`
	Warn   int `json:"warn"`
	Urgent int `json:"urgent"`
}

type AudioConfig struct {
	InputDevice      string `json:"inputDevice" jsonschema:"minLength=1"`
	OutputDevice     string `json:"outputDevice" jsonschema:"minLength=1"`
	MixerCard        string `json:"mixerCard" jsonschema:"minLength=1"`
	OutputSampleRate int    `json:"outputSampleRate" jsonschema:"minimum=8000,maximum=192000"`
	OutputChannels   int    `json:"outputChannels" jsonschema:"minimum=1,maximum=8"`
	TTSEnabled       bool   `json:"ttsEnabled"`
	DefaultEngine    string `json:"defaultEngine"`
	DefaultVoice     string `json:"defaultVoice"`
	DefaultPitch     int    `json:"defaultPitch"`
}

type HornConfig struct {
	Enabled     bool     `json:"enabled"`
	Volume      float64  `json:"volume"`
	SampleRate  int      `json:"sampleRate"`
	Channels    int      `json:"channels"`
	SineGain    float64  `json:"sineGain"`
	SawGain     float64  `json:"sawGain"`
	MaxDuration Duration `json:"maxDuration"`
}

type MediaConfig struct {
	// RTSPPort is shared by the derived video, microphone, and forwarded-audio
	// RTSP URLs. Keeping it at this level prevents each nested block from needing
	// to repeat the same server port when the common MediaMTX listener is used.
	RTSPPort      int                 `json:"rtspPort" jsonschema:"minimum=1,maximum=65535"`
	Video         VideoMediaConfig    `json:"video"`
	AudioCapture  AudioCaptureConfig  `json:"audioCapture"`
	AudioPlayback AudioPlaybackConfig `json:"audioPlayback"`
}

type VideoMediaConfig struct {
	Profile string `json:"profile" jsonschema:"minLength=1"`
	Enabled bool   `json:"enabled"`
	// PublishURL is derived during validation. It remains in rover metadata for server-side
	// consumers through MediaMetadata, but is never persisted in configuration.
	PublishURL string `json:"-"`
}

type AudioCaptureConfig struct {
	Profile string `json:"profile" jsonschema:"minLength=1"`
	// AudioCapture describes the rover microphone stream that browsers can
	// subscribe to as "<rover>-audio". A disabled capture block still has
	// normalized defaults so enabling it only requires flipping enabled: true.
	Enabled bool `json:"enabled"`
	// PublishURL follows the same derived-only contract as the video path.
	PublishURL string `json:"-"`
}

type AudioPlaybackConfig struct {
	Profile string `json:"profile" jsonschema:"minLength=1"`
	// AudioPlayback describes the reverse stream that VIP users publish into
	// MediaMTX for playback on the rover speaker. The URL is a request/read URL
	// for the rover listener, while the server converts it to publish mode when
	// it needs to inject audio.
	Enabled bool `json:"enabled"`
	// ForwardURL is derived because the server and rover must agree on the exact -fwd path.
	ForwardURL string `json:"-"`
}

type CameraServoConfig struct {
	Enabled       bool    `json:"enabled"`
	Pin           int     `json:"pin"`
	FreqHz        int     `json:"freqHz"`
	CycleLen      int     `json:"cycleLen"`
	MinPulseUs    int     `json:"minPulseUs"`
	MaxPulseUs    int     `json:"maxPulseUs"`
	MinAngle      float64 `json:"minAngle"`
	MaxAngle      float64 `json:"maxAngle"`
	HomeAngle     float64 `json:"homeAngle"`
	NudgeDegrees  float64 `json:"nudgeDegrees"`
	AllowRawPulse bool    `json:"allowRawPulse"`
	Invert        bool    `json:"invert"`
}

type GPIOToggleConfig struct {
	Enabled   bool   `json:"enabled"`
	GPIOPin   int    `json:"gpioPin"`
	GPIOChip  string `json:"gpioChip"`
	InitialOn bool   `json:"initialOn"`
	ActiveLow bool   `json:"activeLow"`
}

func (g GPIOToggleConfig) LogicalToGPIO(on bool) int {
	// activeLow is the single hardware-inversion point for GPIO toggles. The
	// rest of the daemon, server, and web UI can use normal logical on/off
	// semantics without knowing whether the driver is active-high or active-low.
	if on == g.ActiveLow {
		return 0
	}
	return 1
}

type AutoSideBrushConfig struct {
	Enabled bool `json:"enabled"`
	Speed   int  `json:"speed"`
}

type PrivateConfig struct {
	Enabled bool                `json:"enabled"`
	Safety  PrivateSafetyConfig `json:"safety"`
}

type PrivateSafetyConfig struct {
	SpeedLimitEnabled       bool `json:"speedLimitEnabled"`
	SpeedLimitMaxWheelMMs   int  `json:"speedLimitMaxWheelSpeed"`
	HardOvercurrentEnabled  bool `json:"hardOvercurrentEnabled"`
	OvercurrentStopMs       int  `json:"overcurrentStopMs"`
	HardBumpEnabled         bool `json:"hardBumpEnabled"`
	BumpBackoffSpeed        int  `json:"bumpBackoffSpeed"`
	BumpBackoffMs           int  `json:"bumpBackoffMs"`
	CliffEnabled            bool `json:"cliffEnabled"`
	CliffBackoffSpeed       int  `json:"cliffBackoffSpeed"`
	CliffBackoffMs          int  `json:"cliffBackoffMs"`
	VirtualWallEnabled      bool `json:"virtualWallEnabled"`
	VirtualWallBackoffSpeed int  `json:"virtualWallBackoffSpeed"`
	VirtualWallBackoffMs    int  `json:"virtualWallBackoffMs"`
	TriggerCooldownMs       int  `json:"triggerCooldownMs"`
}

type PiGPIOConfig struct {
	Enabled     bool              `json:"enabled"`
	BRC         BRCConfig         `json:"brc"`
	CameraServo CameraServoConfig `json:"cameraServo"`
	Headlight   GPIOToggleConfig  `json:"headlight"`
	Laser       GPIOToggleConfig  `json:"laser"`
}

type Config struct {
	PiGPIO        PiGPIOConfig        `json:"piGpio"`
	Name          string              `json:"name" jsonschema:"minLength=1"`
	Description   string              `json:"description"`
	Color         string              `json:"color"`
	ServerURL     string              `json:"serverUrl" jsonschema:"minLength=1"`
	Serial        SerialConfig        `json:"serial"`
	Battery       BatteryConfig       `json:"battery"`
	MaxWheelMMs   int                 `json:"maxWheelSpeed" jsonschema:"minimum=1,maximum=500"`
	Media         MediaConfig         `json:"media"`
	Audio         AudioConfig         `json:"audio"`
	Horn          HornConfig          `json:"horn"`
	AutoSideBrush AutoSideBrushConfig `json:"autoSideBrush"`
	Private       PrivateConfig       `json:"private"`
}

// DefaultConfig supplies initial settings; persisted and remotely submitted
// configuration is always a complete object.
func DefaultConfig() Config {
	cfg := Config{
		Name: "rover", ServerURL: "ws://localhost:8080/rover",
		Serial:  SerialConfig{Device: "/dev/ttyUSB0", Baud: 115200},
		Battery: BatteryConfig{Full: 2068, Warn: 1700, Urgent: 1650},
		PiGPIO: PiGPIOConfig{
			BRC: BRCConfig{
				Enabled:  true,
				GPIOPin:  4,
				GPIOChip: "gpiochip0",
				PulseEvery: Duration{
					Duration: time.Minute,
				},
				PulseWidth: Duration{
					Duration: time.Second,
				},
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
			Headlight: GPIOToggleConfig{
				Enabled:   true,
				GPIOPin:   22,
				GPIOChip:  "gpiochip0",
				InitialOn: false,
				ActiveLow: true,
			},
			Laser: GPIOToggleConfig{
				Enabled:   false,
				GPIOPin:   27,
				GPIOChip:  "gpiochip0",
				InitialOn: false,
				ActiveLow: false,
			},
		},
		MaxWheelMMs: 500,
		Media: MediaConfig{
			RTSPPort:      8554,
			Video:         VideoMediaConfig{Profile: "v4l2", Enabled: true},
			AudioCapture:  AudioCaptureConfig{Profile: "alsa", Enabled: true},
			AudioPlayback: AudioPlaybackConfig{Profile: "alsa", Enabled: true},
		},
		Audio: AudioConfig{
			InputDevice: "hw:0,0", OutputDevice: "hw:0,0", MixerCard: "0", OutputSampleRate: 48000, OutputChannels: 2,
			TTSEnabled:    true,
			DefaultEngine: "google",
			DefaultVoice:  "rms",
			DefaultPitch:  50,
		},
		Horn: HornConfig{
			Enabled:     true,
			Volume:      0.25,
			SampleRate:  48000,
			Channels:    1,
			SineGain:    1.0,
			SawGain:     0.7,
			MaxDuration: Duration{Duration: 10000 * time.Millisecond},
		},
		AutoSideBrush: AutoSideBrushConfig{
			Enabled: true,
			Speed:   20,
		},
		Private: PrivateConfig{
			Enabled: false,
			Safety: PrivateSafetyConfig{
				SpeedLimitEnabled:       false,
				SpeedLimitMaxWheelMMs:   250,
				HardOvercurrentEnabled:  false,
				OvercurrentStopMs:       300,
				HardBumpEnabled:         false,
				BumpBackoffSpeed:        250,
				BumpBackoffMs:           350,
				CliffEnabled:            false,
				CliffBackoffSpeed:       250,
				CliffBackoffMs:          500,
				VirtualWallEnabled:      true,
				VirtualWallBackoffSpeed: 250,
				VirtualWallBackoffMs:    500,
				TriggerCooldownMs:       800,
			},
		},
	}
	return cfg
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return DecodeConfig(data)
}

func DecodeConfig(data []byte) (*Config, error) {
	if err := ValidateConfigurationSchema(data); err != nil {
		return nil, err
	}
	var cfg Config
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("expected one JSON object")
	}
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func validateConfig(cfg *Config) error {
	if cfg.Name == "" {
		return errors.New("missing name")
	}
	normalizedColor, err := normalizeHexColor(cfg.Color)
	if err != nil {
		return err
	}
	cfg.Color = normalizedColor
	server, err := url.Parse(cfg.ServerURL)
	if err != nil || server.Hostname() == "" || (server.Scheme != "ws" && server.Scheme != "wss") || server.Path != "/rover" || server.RawQuery != "" || server.Fragment != "" {
		return errors.New("serverUrl must be ws://host[:port]/rover or wss://host[:port]/rover")
	}
	if cfg.Serial.Device == "" || cfg.Serial.Baud == 0 {
		return errors.New("serial device/baud required")
	}
	if cfg.Battery.Full == 0 {
		return errors.New("battery thresholds required")
	}
	if cfg.MaxWheelMMs <= 0 || cfg.MaxWheelMMs > 500 {
		return fmt.Errorf("maxWheelSpeed must be 1-500, got %d", cfg.MaxWheelMMs)
	}
	if cfg.PiGPIO.BRC.GPIOChip == "" {
		cfg.PiGPIO.BRC.GPIOChip = "gpiochip0"
	}
	if cfg.Media.RTSPPort <= 0 {
		cfg.Media.RTSPPort = 8554
	}
	if err := validateMediaConfig(&cfg.Media, cfg.ServerURL, cfg.Name); err != nil {
		return fmt.Errorf("media: %w", err)
	}
	if cfg.PiGPIO.Enabled {
		if err := validateServoConfig(&cfg.PiGPIO.CameraServo); err != nil {
			return fmt.Errorf("cameraServo: %w", err)
		}
		if err := validateGPIOToggleConfig(&cfg.PiGPIO.Headlight); err != nil {
			return fmt.Errorf("headlight: %w", err)
		}
		if err := validateGPIOToggleConfig(&cfg.PiGPIO.Laser); err != nil {
			return fmt.Errorf("laser: %w", err)
		}
		if cfg.PiGPIO.BRC.Enabled && (cfg.PiGPIO.BRC.GPIOPin < 0 || cfg.PiGPIO.BRC.PulseEvery.Duration <= 0 || cfg.PiGPIO.BRC.PulseWidth.Duration <= 0) {
			return errors.New("piGpio.brc: nonnegative pin and positive pulse durations required")
		}
	}
	if err := validateAudioRouting(cfg.Audio); err != nil {
		return err
	}
	validateAudioConfig(&cfg.Audio)
	validateHornConfig(&cfg.Horn)
	validateAutoSideBrushConfig(&cfg.AutoSideBrush)
	return nil
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
	if cfg.DefaultEngine == "" {
		cfg.DefaultEngine = "google"
	}
	if cfg.DefaultVoice == "" {
		cfg.DefaultVoice = "rms"
	}
	if cfg.DefaultPitch <= 0 {
		cfg.DefaultPitch = 50
	}
}

func validateMediaConfig(cfg *MediaConfig, serverURL string, roverName string) error {
	// Normalize shared settings before they become profile command variables.
	if cfg.RTSPPort <= 0 {
		cfg.RTSPPort = 8554
	}
	if err := validateVideoMediaConfig(&cfg.Video, serverURL, roverName, cfg.RTSPPort); err != nil {
		return fmt.Errorf("video: %w", err)
	}
	if err := validateAudioCaptureConfig(&cfg.AudioCapture, serverURL, roverName, cfg.RTSPPort); err != nil {
		return fmt.Errorf("audioCapture: %w", err)
	}
	if err := validateAudioPlaybackConfig(&cfg.AudioPlayback, serverURL, roverName, cfg.RTSPPort); err != nil {
		return fmt.Errorf("audioPlayback: %w", err)
	}
	return nil
}

func validateVideoMediaConfig(cfg *VideoMediaConfig, serverURL string, roverName string, rtspPort int) error {
	derived, err := derivePublishURL(serverURL, roverName, rtspPort)
	if err != nil {
		return fmt.Errorf("derive publishUrl: %w", err)
	}
	cfg.PublishURL = derived
	return nil
}

func validateAudioCaptureConfig(cfg *AudioCaptureConfig, serverURL string, roverName string, rtspPort int) error {
	derived, err := derivePublishURL(serverURL, roverName+"-audio", rtspPort)
	if err != nil {
		return fmt.Errorf("derive publishUrl: %w", err)
	}
	cfg.PublishURL = derived
	return nil
}

func validateAudioPlaybackConfig(cfg *AudioPlaybackConfig, serverURL string, roverName string, rtspPort int) error {
	derived, err := deriveReadURL(serverURL, roverName+"-fwd", rtspPort)
	if err != nil {
		return fmt.Errorf("derive forwardUrl: %w", err)
	}
	cfg.ForwardURL = derived
	return nil
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

func validateGPIOToggleConfig(cfg *GPIOToggleConfig) error {
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
	return deriveRTSPURL(serverURL, streamName, port)
}

func deriveReadURL(serverURL, streamName string, port int) (string, error) {
	return deriveRTSPURL(serverURL, streamName, port)
}

func deriveRTSPURL(serverURL, streamName string, port int) (string, error) {
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
		port = 8554
	}
	/*
		JoinHostPort handles both ordinary hostnames and bracketed IPv6 addresses. The rover name
		is a MediaMTX path, so it is escaped independently instead of interpolated into the host.
		RTSP distinguishes publishing from reading through protocol methods, which is why both
		directions intentionally use the same URL shape.
	*/
	escaped := url.PathEscape(streamName)
	return fmt.Sprintf("rtsp://%s/%s", net.JoinHostPort(host, strconv.Itoa(port)), escaped), nil
}

var hexColorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func normalizeHexColor(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	if !hexColorRe.MatchString(trimmed) {
		return "", fmt.Errorf("color must be #RRGGBB, got %q", raw)
	}
	return strings.ToUpper(trimmed), nil
}

// MediaMetadata adds derived endpoints only to the control hello.
func (cfg *Config) MediaMetadata() map[string]any {
	data, _ := json.Marshal(cfg.Media)
	var media map[string]any
	json.Unmarshal(data, &media)
	media["video"].(map[string]any)["publishUrl"] = cfg.Media.Video.PublishURL
	media["audioCapture"].(map[string]any)["publishUrl"] = cfg.Media.AudioCapture.PublishURL
	media["audioPlayback"].(map[string]any)["forwardUrl"] = cfg.Media.AudioPlayback.ForwardURL
	return media
}
