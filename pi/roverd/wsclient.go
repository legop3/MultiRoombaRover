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
	events       chan RoverEvent
	media        *MediaSupervisor
	servo        *CameraServo
	nightVision  *NightVisionLight
	log          *log.Logger
}

const (
	sensorSilenceTimeout   = 5 * time.Second
	sensorRecoveryCooldown = 5 * time.Second
	sensorCommandPause     = 100 * time.Millisecond
)

func NewWSClient(cfg *Config, adapter *SerialAdapter, frames <-chan []byte, events chan RoverEvent, media *MediaSupervisor, servo *CameraServo, nightVision *NightVisionLight, logger *log.Logger) *WSClient {
	return &WSClient{
		cfg:          cfg,
		adapter:      adapter,
		sensorFrames: frames,
		events:       events,
		media:        media,
		servo:        servo,
		nightVision:  nightVision,
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
		Audio:         c.cfg.Audio,
		NightVision:   c.cfg.NightVision,
	}
	c.log.Printf("sending hello (camera servo enabled=%v pin=%d)", msg.CameraServo.Enabled, msg.CameraServo.Pin)
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
			return c.kickstartSensorStream(sensorCommandPause)
		}
		return nil
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
	case msg.TTS != nil:
		return c.handleTTSPayload(msg.TTS)
	case msg.NightVision != nil:
		if c.nightVision == nil {
			return fmt.Errorf("night vision disabled")
		}
		return c.nightVision.HandleAction(msg.NightVision.Action)
	case msg.Song != nil:
		slot := 0
		if msg.Song.Slot != nil {
			slot = clampInt(*msg.Song.Slot, 0, 4)
		}
		return c.adapter.PlaySong(slot, msg.Song.Notes)
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
	timer := time.NewTimer(sensorSilenceTimeout)
	defer timer.Stop()

	resetTimer := func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(sensorSilenceTimeout)
	}

	lastRecovery := time.Time{}
	lastFrame := time.Now()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			now := time.Now()
			if !lastRecovery.IsZero() && now.Sub(lastRecovery) < sensorRecoveryCooldown {
				resetTimer()
				continue
			}

			idleFor := now.Sub(lastFrame)
			if idleFor < 0 {
				idleFor = sensorSilenceTimeout
			}

			c.log.Printf("no sensor frames for %v; restarting OI and sensor stream", idleFor)
			c.recoverSensorStream(idleFor, sensorCommandPause)
			lastRecovery = now
			resetTimer()
		case frame := <-c.sensorFrames:
			resetTimer()
			lastFrame = time.Now()
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

func (c *WSClient) emitEvent(event string, data map[string]any) {
	if c.events == nil {
		return
	}
	select {
	case c.events <- RoverEvent{
		Type:  "event",
		Event: event,
		Ts:    time.Now().UnixMilli(),
		Data:  data,
	}:
	default:
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
	return c.kickstartSensorStream(sensorCommandPause)
}

func (c *WSClient) recoverSensorStream(idleFor time.Duration, cmdPause time.Duration) {
	c.emitEvent("sensorWatchdog.restart", map[string]any{
		"idleMs": idleFor.Milliseconds(),
	})

	if err := c.kickstartSensorStream(cmdPause); err != nil {
		c.log.Printf("sensor stream restart failed: %v", err)
		c.emitEvent("sensorWatchdog.streamRestart.error", map[string]any{"error": err.Error()})
		return
	}

	c.emitEvent("sensorWatchdog.streamRestart.ok", map[string]any{
		"idleMs": idleFor.Milliseconds(),
	})
}

func (c *WSClient) kickstartSensorStream(cmdPause time.Duration) error {
	if err := c.adapter.StartOI(); err != nil {
		return err
	}
	if cmdPause > 0 {
		time.Sleep(cmdPause)
	}
	if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
		return err
	}
	if cmdPause > 0 {
		time.Sleep(cmdPause)
	}
	return nil
}

func isModeOpcode(op byte) bool {
	switch op {
	case 128, 131, 132:
		return true
	default:
		return false
	}
}