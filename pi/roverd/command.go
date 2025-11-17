package roverd

type helloMessage struct {
	Type          string        `json:"type"`
	Name          string        `json:"name"`
	Battery       BatteryConfig `json:"battery"`
	MaxWheelSpeed int           `json:"maxWheelSpeed"`
	Media         MediaConfig   `json:"media"`
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

type ackMessage struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}
