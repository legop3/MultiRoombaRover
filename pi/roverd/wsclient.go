package roverd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"nhooyr.io/websocket"
)

type WSClient struct {
	cfg          *Config
	adapter      *SerialAdapter
	sensorFrames <-chan []byte
	events       <-chan RoverEvent
	media        *MediaSupervisor
	servo        *CameraServo
	log          *log.Logger
}

func NewWSClient(cfg *Config, adapter *SerialAdapter, frames <-chan []byte, events <-chan RoverEvent, media *MediaSupervisor, servo *CameraServo, logger *log.Logger) *WSClient {
	return &WSClient{
		cfg:          cfg,
		adapter:      adapter,
		sensorFrames: frames,
		events:       events,
		media:        media,
		servo:        servo,
		log:          logger,
	}
}

func (c *WSClient) Run(ctx context.Context) error {
	conn, _, err := websocket.Dial(ctx, c.cfg.ServerURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusInternalError, "closed")

	if err := c.sendHello(ctx, conn); err != nil {
		return err
	}
	if err := c.ensureSensorStream(); err != nil {
		c.log.Printf("sensor stream init failed: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- c.readLoop(ctx, conn)
	}()
	go c.forwardSensors(ctx, conn)
	go c.forwardEvents(ctx, conn)

	select {
	case <-ctx.Done():
		conn.Close(websocket.StatusNormalClosure, "context done")
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func (c *WSClient) sendHello(ctx context.Context, conn *websocket.Conn) error {
	msg := helloMessage{
		Type:          "hello",
		Name:          c.cfg.Name,
		Battery:       c.cfg.Battery,
		MaxWheelSpeed: c.cfg.MaxWheelMMs,
		Media:         c.cfg.Media,
		CameraServo:   c.cfg.CameraServo,
	}
	return writeJSON(ctx, conn, msg)
}

func (c *WSClient) readLoop(ctx context.Context, conn *websocket.Conn) error {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var msg inboundMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			c.log.Printf("invalid command: %v", err)
			continue
		}
		if msg.ID == "" {
			continue
		}
		status := "ok"
		cmdErr := c.dispatch(ctx, &msg)
		if cmdErr != nil {
			status = "error"
		}
		ack := ackMessage{
			Type:   "ack",
			ID:     msg.ID,
			Status: status,
		}
		if cmdErr != nil {
			ack.Error = cmdErr.Error()
		}
		if err := writeJSON(ctx, conn, ack); err != nil {
			return err
		}
	}
}

func (c *WSClient) dispatch(ctx context.Context, msg *inboundMessage) error {
	switch {
	case msg.DriveDirect != nil:
		left := clamp(msg.DriveDirect.Left, -c.cfg.MaxWheelMMs, c.cfg.MaxWheelMMs)
		right := clamp(msg.DriveDirect.Right, -c.cfg.MaxWheelMMs, c.cfg.MaxWheelMMs)
		return c.adapter.DriveDirect(left, right)
	case msg.MotorPWM != nil:
		main := clamp(msg.MotorPWM.Main, -127, 127)
		side := clamp(msg.MotorPWM.Side, -127, 127)
		vac := clamp(msg.MotorPWM.Vacuum, 0, 127)
		return c.adapter.MotorPWM(main, side, vac)
	case msg.SensorStream != nil:
		if msg.SensorStream.Enable {
			if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
				return err
			}
			return c.adapter.PauseSensorStream(false)
		}
		return c.adapter.PauseSensorStream(true)
	case msg.Raw != "" && len(msg.Raw) > 0:
		buf, err := base64.StdEncoding.DecodeString(msg.Raw)
		if err != nil {
			return fmt.Errorf("raw decode: %w", err)
		}
		if err := c.adapter.SendRaw(buf); err != nil {
			return err
		}
		if len(buf) > 0 && isModeOpcode(buf[0]) {
			return c.ensureSensorStream()
		}
		return nil
	case msg.Media != nil:
		if c.media == nil {
			return fmt.Errorf("media supervisor disabled")
		}
		return c.media.HandleAction(ctx, msg.Media.Action)
	case msg.Servo != nil:
		if c.servo == nil {
			return fmt.Errorf("camera servo disabled")
		}
		return c.handleServoCommand(msg.Servo)
	default:
		return fmt.Errorf("unsupported command type: %s", msg.Type)
	}
}

func (c *WSClient) handleServoCommand(payload *servoPayload) error {
	switch {
	case payload.Angle != nil:
		return c.servo.SetAngle(*payload.Angle)
	case payload.Nudge != nil:
		return c.servo.Nudge(*payload.Nudge)
	case payload.PulseUs != nil:
		return c.servo.SetPulseWidth(*payload.PulseUs)
	default:
		return fmt.Errorf("servo command requires angle, nudge, or pulseUs")
	}
}

func (c *WSClient) forwardSensors(ctx context.Context, conn *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-c.sensorFrames:
			msg := sensorMessage{
				Type:      "sensor",
				Timestamp: time.Now().UnixMilli(),
				Data:      base64.StdEncoding.EncodeToString(frame),
			}
			if err := writeJSON(ctx, conn, msg); err != nil {
				c.log.Printf("sensor send failed: %v", err)
				return
			}
		}
	}
}

func (c *WSClient) forwardEvents(ctx context.Context, conn *websocket.Conn) {
	if c.events == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-c.events:
			if evt.Type == "" {
				evt.Type = "event"
			}
			if err := writeJSON(ctx, conn, evt); err != nil {
				c.log.Printf("event send failed: %v", err)
				return
			}
		}
	}
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func (c *WSClient) ensureSensorStream() error {
	if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
		return err
	}
	return c.adapter.PauseSensorStream(false)
}

func isModeOpcode(op byte) bool {
	switch op {
	case 128, 131, 132:
		return true
	default:
		return false
	}
}
