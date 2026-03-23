package roverd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"sync"
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
	horn         *HornSynth
	nightVision  *NightVisionLight
	log          *log.Logger
	recoverMu    sync.Mutex
	recovering   bool
	ttsQueue     chan *ttsPayload
	lastAux      motorPWMPayload
	autoSideOn   bool
	connMu       sync.Mutex
	connected    bool
	disconnectT  *time.Timer
	rebootT      *time.Timer
	seekIssued   bool
	rebootIssued bool
	audioLevels  AudioLevels
	audioMu      sync.RWMutex
}

func NewWSClient(cfg *Config, adapter *SerialAdapter, frames <-chan []byte, events chan RoverEvent, media *MediaSupervisor, servo *CameraServo, nightVision *NightVisionLight, logger *log.Logger) *WSClient {
	var ttsQueue chan *ttsPayload
	if cfg.Audio.TTSEnabled {
		ttsQueue = make(chan *ttsPayload, 2)
	}
	var horn *HornSynth
	if cfg.Horn.Enabled {
		horn = NewHornSynth(cfg.Horn, logger)
	}
	client := &WSClient{
		cfg:          cfg,
		adapter:      adapter,
		sensorFrames: frames,
		events:       events,
		media:        media,
		servo:        servo,
		horn:         horn,
		nightVision:  nightVision,
		log:          logger,
		ttsQueue:     ttsQueue,
		audioLevels: AudioLevels{
			HornGain:    1.0,
			TTSGain:     1.0,
			ForwardGain: 1.0,
		},
	}
	client.applyAudioLevelsToMixer(client.audioLevels)
	return client
}

func (c *WSClient) Run(ctx context.Context) error {
	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	conn, _, err := websocket.Dial(dialCtx, c.cfg.ServerURL, nil)
	cancel()
	if err != nil {
		c.markDisconnected()
		return err
	}
	c.markConnected()
	defer conn.Close(websocket.StatusInternalError, "closed")
	defer c.markDisconnected()

	if err := c.sendHello(ctx, conn); err != nil {
		return err
	}
	if err := c.ensureSensorStream(); err != nil {
		c.log.Printf("sensor stream init failed: %v", err)
	}

	errCh := make(chan error, 2)
	c.startTTSWorker(ctx)
	go func() {
		errCh <- c.readLoop(ctx, conn)
	}()
	go func() {
		if err := c.keepalive(ctx, conn); err != nil {
			errCh <- err
		}
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
		Color:         c.cfg.Color,
		Battery:       c.cfg.Battery,
		MaxWheelSpeed: c.cfg.MaxWheelMMs,
		Media:         c.cfg.Media,
		CameraServo:   c.cfg.CameraServo,
		Audio:         c.cfg.Audio,
		Horn:          c.cfg.Horn,
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
		if err := c.adapter.DriveDirect(left, right); err != nil {
			return err
		}
		c.applyAutoSideBrush(left, right)
		return nil
	case msg.MotorPWM != nil:
		main := clamp(msg.MotorPWM.Main, -127, 127)
		side := clamp(msg.MotorPWM.Side, -127, 127)
		vac := clamp(msg.MotorPWM.Vacuum, 0, 127)
		c.lastAux = motorPWMPayload{Main: main, Side: side, Vacuum: vac}
		c.autoSideOn = false
		return c.adapter.MotorPWM(main, side, vac)
	case msg.SensorStream != nil:
		if msg.SensorStream.Enable {
			return c.adapter.StartSensorStream(defaultStreamPackets)
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
		return c.enqueueTTS(msg.TTS)
	case msg.Horn != nil:
		if c.horn == nil {
			return fmt.Errorf("horn disabled")
		}
		return c.horn.HandlePayload(msg.Horn)
	case msg.AudioLevels != nil:
		return c.handleAudioLevels(msg.AudioLevels)
	case msg.NightVision != nil:
		if c.nightVision == nil {
			return fmt.Errorf("night vision disabled")
		}
		if err := c.nightVision.HandleAction(msg.NightVision.Action); err != nil {
			return err
		}
		c.emitEvent("nightVision.state", map[string]any{
			"nightVisionOn": c.nightVision.NightVisionOn(),
		})
		return nil
	case msg.Song != nil:
		slot := 0
		if msg.Song.Slot != nil {
			slot = clampInt(*msg.Song.Slot, 0, 4)
		}
		return c.adapter.PlaySong(slot, msg.Song.Notes)
	case msg.Reboot != nil || msg.Type == "reboot":
		return c.handleRebootCommand(msg.Reboot)
	default:
		return fmt.Errorf("unsupported command type: %s", msg.Type)
	}
}

func (c *WSClient) handleRebootCommand(payload *rebootPayload) error {
	if err := c.adapter.DriveDirect(0, 0); err != nil {
		return fmt.Errorf("stop drive before reboot: %w", err)
	}
	if err := c.adapter.MotorPWM(0, 0, 0); err != nil {
		return fmt.Errorf("stop aux motors before reboot: %w", err)
	}
	if err := c.adapter.StartOI(); err != nil {
		return fmt.Errorf("enter passive mode before reboot: %w", err)
	}

	delay := 300 * time.Millisecond
	if payload != nil && payload.DelayMs > 0 {
		delay = time.Duration(clampInt(payload.DelayMs, 50, 5000)) * time.Millisecond
	}

	c.connMu.Lock()
	if c.rebootIssued {
		c.connMu.Unlock()
		return fmt.Errorf("reboot already pending")
	}
	c.rebootIssued = true
	c.connMu.Unlock()

	c.emitEvent("system.rebooting", map[string]any{
		"source":  "remoteCommand",
		"delayMs": delay.Milliseconds(),
	})

	go func() {
		time.Sleep(delay)
		c.log.Printf("rebooting pi after remote reboot command")
		cmd := exec.Command("systemctl", "reboot")
		if err := cmd.Start(); err != nil {
			c.log.Printf("reboot command failed: %v", err)
		}
	}()

	return nil
}

func (c *WSClient) applyAutoSideBrush(left, right int) {
	if c.cfg == nil || !c.cfg.AutoSideBrush.Enabled {
		if c.autoSideOn {
			c.autoSideOn = false
			if err := c.adapter.MotorPWM(c.lastAux.Main, c.lastAux.Side, c.lastAux.Vacuum); err != nil {
				c.log.Printf("auto side brush stop failed: %v", err)
			}
		}
		return
	}

	moving := left != 0 || right != 0
	if !moving {
		if c.autoSideOn {
			c.autoSideOn = false
			if err := c.adapter.MotorPWM(c.lastAux.Main, c.lastAux.Side, c.lastAux.Vacuum); err != nil {
				c.log.Printf("auto side brush stop failed: %v", err)
			}
		}
		return
	}

	if c.lastAux.Side != 0 {
		c.autoSideOn = false
		return
	}

	autoSpeed := clampInt(c.cfg.AutoSideBrush.Speed, -127, 127)
	if autoSpeed == 0 {
		c.autoSideOn = false
		return
	}
	if c.autoSideOn {
		return
	}

	if err := c.adapter.MotorPWM(c.lastAux.Main, autoSpeed, c.lastAux.Vacuum); err != nil {
		c.log.Printf("auto side brush start failed: %v", err)
		return
	}
	c.autoSideOn = true
}

func (c *WSClient) enqueueTTS(payload *ttsPayload) error {
	if c.ttsQueue == nil {
		return fmt.Errorf("tts disabled")
	}
	select {
	case c.ttsQueue <- payload:
		return nil
	default:
		return fmt.Errorf("tts busy")
	}
}

func (c *WSClient) startTTSWorker(ctx context.Context) {
	if c.ttsQueue == nil {
		return
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case payload := <-c.ttsQueue:
				if payload == nil {
					continue
				}
				if err := c.handleTTSPayload(ctx, payload); err != nil {
					c.log.Printf("tts failed: %v", err)
					c.emitEvent("tts.error", map[string]any{"error": err.Error()})
				}
			}
		}
	}()
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
	const (
		sensorSilenceTimeout   = 5 * time.Second
		sensorRecoveryCooldown = 3 * time.Second
		sensorCommandPause     = 50 * time.Millisecond
	)

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

			c.recoverSensorStream(idleFor, sensorCommandPause)
			lastRecovery = now
			resetTimer()
		case frame := <-c.sensorFrames:
			lastFrame = time.Now()
			resetTimer()
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
	if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
		return err
	}
	return nil
}

const disconnectSeekDelay = time.Minute
const disconnectRebootDelay = 6 * time.Minute
const dialTimeout = 10 * time.Second
const pingInterval = 15 * time.Second
const pingTimeout = 5 * time.Second

func (c *WSClient) keepalive(ctx context.Context, conn *websocket.Conn) error {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (c *WSClient) markConnected() {
	c.connMu.Lock()
	c.connected = true
	c.seekIssued = false
	c.rebootIssued = false
	if c.disconnectT != nil {
		c.disconnectT.Stop()
		c.disconnectT = nil
	}
	if c.rebootT != nil {
		c.rebootT.Stop()
		c.rebootT = nil
	}
	c.connMu.Unlock()
}

func (c *WSClient) markDisconnected() {
	c.connMu.Lock()
	if c.connected {
		c.connected = false
	}
	if c.disconnectT == nil {
		c.disconnectT = time.AfterFunc(disconnectSeekDelay, c.handleDisconnectTimeout)
	}
	if c.rebootT == nil {
		c.rebootT = time.AfterFunc(disconnectRebootDelay, c.handleRebootTimeout)
	}
	c.connMu.Unlock()
}

func (c *WSClient) handleDisconnectTimeout() {
	c.connMu.Lock()
	if c.connected || c.seekIssued {
		c.connMu.Unlock()
		return
	}
	c.seekIssued = true
	c.connMu.Unlock()

	if err := c.adapter.SeekDock(); err != nil {
		c.log.Printf("seek dock on disconnect failed: %v", err)
		return
	}
	c.log.Printf("seek dock issued after websocket disconnect")
}

func (c *WSClient) handleRebootTimeout() {
	c.connMu.Lock()
	if c.connected || c.rebootIssued {
		c.connMu.Unlock()
		return
	}
	c.rebootIssued = true
	c.connMu.Unlock()

	c.log.Printf("rebooting pi after prolonged websocket disconnect")
	cmd := exec.Command("systemctl", "reboot")
	if err := cmd.Start(); err != nil {
		c.log.Printf("reboot command failed: %v", err)
	}
}

func (c *WSClient) recoverSensorStream(idleFor time.Duration, cmdPause time.Duration) {
	c.recoverMu.Lock()
	if c.recovering {
		c.recoverMu.Unlock()
		return
	}
	c.recovering = true
	c.recoverMu.Unlock()

	defer func() {
		c.recoverMu.Lock()
		c.recovering = false
		c.recoverMu.Unlock()
	}()

	c.emitEvent("sensorWatchdog.restart", map[string]any{
		"idleMs": idleFor.Milliseconds(),
	})

	if err := c.adapter.StartOI(); err != nil {
		c.log.Printf("watchdog start OI failed: %v", err)
		c.emitEvent("sensorWatchdog.error", map[string]any{"error": err.Error()})
		return
	}
	if cmdPause > 0 {
		time.Sleep(cmdPause)
	}

	if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
		c.log.Printf("watchdog start stream failed: %v", err)
		c.emitEvent("sensorWatchdog.error", map[string]any{"error": err.Error()})
		return
	}

	c.emitEvent("sensorWatchdog.ok", map[string]any{
		"idleMs": idleFor.Milliseconds(),
	})
}

func isModeOpcode(op byte) bool {
	switch op {
	case 128, 131, 132:
		return true
	default:
		return false
	}
}
