package roverd

type helloMessage struct {
	Type          string            `json:"type"`
	Name          string            `json:"name"`
	Description   string            `json:"description,omitempty"`
	Color         string            `json:"color,omitempty"`
	Battery       BatteryConfig     `json:"battery"`
	MaxWheelSpeed int               `json:"maxWheelSpeed"`
	Media         MediaConfig       `json:"media"`
	CameraServo   CameraServoConfig `json:"cameraServo"`
	Audio         AudioConfig       `json:"audio"`
	Horn          HornConfig        `json:"horn"`
	NightVision   NightVisionConfig `json:"nightVision"`
	Private       PrivateConfig     `json:"private"`
}

type sensorMessage struct {
	Type      string `json:"type"`
	Timestamp int64  `json:"ts"`
	Data      string `json:"data"`
}

type inboundMessage struct {
	Type         string               `json:"type"`
	ID           string               `json:"id"`
	DriveDirect  *driveDirectPayload  `json:"driveDirect,omitempty"`
	MotorPWM     *motorPWMPayload     `json:"motorPwm,omitempty"`
	Raw          string               `json:"raw,omitempty"`
	SensorStream *sensorStreamPayload `json:"sensorStream,omitempty"`
	Media        *mediaCommand        `json:"media,omitempty"`
	Servo        *servoPayload        `json:"servo,omitempty"`
	TTS          *ttsPayload          `json:"tts,omitempty"`
	Horn         *hornPayload         `json:"horn,omitempty"`
	AudioLevels  *audioLevelsPayload  `json:"audioLevels,omitempty"`
	NightVision  *nightVisionPayload  `json:"nightVision,omitempty"`
	Song         *songPayload         `json:"song,omitempty"`
	Reboot       *rebootPayload       `json:"reboot,omitempty"`
}

type driveDirectPayload struct {
	Left  int `json:"left"`
	Right int `json:"right"`
}

type motorPWMPayload struct {
	Main   int `json:"main"`
	Side   int `json:"side"`
	Vacuum int `json:"vacuum"`
}

type sensorStreamPayload struct {
	Enable bool `json:"enable"`
}

type mediaCommand struct {
	Action string `json:"action"`
}

type servoPayload struct {
	Angle   *float64 `json:"angle,omitempty"`
	Nudge   *float64 `json:"nudge,omitempty"`
	PulseUs *int     `json:"pulseUs,omitempty"`
}

type ttsPayload struct {
	Text   string `json:"text"`
	Engine string `json:"engine,omitempty"`
	Voice  string `json:"voice,omitempty"`
	Pitch  int    `json:"pitch,omitempty"`
	Speak  bool   `json:"speak,omitempty"`
}

type hornPayload struct {
	Action   string    `json:"action"`
	Waveform string    `json:"waveform,omitempty"`
	Freqs    []float64 `json:"freqs,omitempty"`
}

type audioLevelsPayload struct {
	HornGain    *float64 `json:"hornGain,omitempty"`
	TTSGain     *float64 `json:"ttsGain,omitempty"`
	ForwardGain *float64 `json:"forwardGain,omitempty"`
}

type nightVisionPayload struct {
	Action string `json:"action"`
}

type songPayload struct {
	Slot  *int       `json:"slot,omitempty"`
	Notes []songNote `json:"notes"`
	Loop  bool       `json:"loop,omitempty"`
}

type songNote struct {
	Note     int `json:"note"`
	Duration int `json:"duration"`
}

type rebootPayload struct {
	DelayMs int `json:"delayMs,omitempty"`
}

type ackMessage struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}
