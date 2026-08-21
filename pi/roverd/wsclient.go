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
	headlight    *GPIOToggle
	laser        *GPIOToggle
	log          *log.Logger
	console      *ConsoleNotifier
	recoverMu    sync.Mutex
	recovering   bool
	watchdogMu   sync.Mutex
	watchdogOpen bool
	watchdogOK   bool
	ttsQueue     chan *ttsPayload
	chromeTTS    *chromeTTSDaemon
	lastAux      motorPWMPayload
	autoSideOn   bool
	connMu       sync.Mutex
	connected    bool
	disconnectT  *time.Timer
	rebootT      *time.Timer
	seekIssued   bool
	rebootIssued bool
	updateIssued bool
	audioLevels  AudioLevels
	audioMu      sync.RWMutex
}

func NewWSClient(cfg *Config, adapter *SerialAdapter, frames <-chan []byte, events chan RoverEvent, media *MediaSupervisor, servo *CameraServo, headlight *GPIOToggle, laser *GPIOToggle, logger *log.Logger, console *ConsoleNotifier) *WSClient {
	var ttsQueue chan *ttsPayload
	if cfg.Audio.TTSEnabled {
		ttsQueue = make(chan *ttsPayload, 2)
	}
	var chromeTTS *chromeTTSDaemon
	if cfg.Audio.TTSEnabled {
		chromeTTS = NewChromeTTSDaemon(logger)
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
		headlight:    headlight,
		laser:        laser,
		log:          logger,
		console:      console,
		ttsQueue:     ttsQueue,
		chromeTTS:    chromeTTS,
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
	if c.chromeTTS != nil {
		defer c.chromeTTS.Shutdown()
	}

	if err := c.sendHello(ctx, conn); err != nil {
		return err
	}
	if err := c.ensureSensorStream(); err != nil {
		c.log.Printf("sensor stream init failed: %v", err)
	}

	errCh := make(chan error, 2)
	c.startTTSWorker(ctx)
	c.warmChromeTTS(ctx)
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
	go c.forwardHostStats(ctx, conn)

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
		Description:   c.cfg.Description,
		Color:         c.cfg.Color,
		Battery:       c.cfg.Battery,
		MaxWheelSpeed: c.cfg.MaxWheelMMs,
		Media:         c.cfg.Media,
		CameraServo:   c.cfg.CameraServo,
		Audio:         c.cfg.Audio,
		Horn:          c.cfg.Horn,
		Headlight:     c.cfg.Headlight,
		Laser:         c.cfg.Laser,
		Private:       c.cfg.Private,
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
	case msg.Headlight != nil:
		return c.handleToggleCommand("headlight", c.headlight, msg.Headlight)
	case msg.Laser != nil:
		return c.handleToggleCommand("laser", c.laser, msg.Laser)
	case msg.Song != nil:
		slot := 0
		if msg.Song.Slot != nil {
			slot = clampInt(*msg.Song.Slot, 0, 4)
		}
		return c.adapter.PlaySong(slot, msg.Song.Notes)
	case msg.Reboot != nil || msg.Type == "reboot":
		return c.handleRebootCommand(msg.Reboot)
	case msg.Update != nil || msg.Type == "update":
		return c.handleUpdateCommand()
	default:
		return fmt.Errorf("unsupported command type: %s", msg.Type)
	}
}

func (c *WSClient) handleToggleCommand(name string, toggle *GPIOToggle, payload *togglePayload) error {
	if toggle == nil {
		return fmt.Errorf("%s disabled", name)
	}
	if err := toggle.HandleAction(payload.Action); err != nil {
		return err
	}
	// Event names and payload keys use logical device names. GPIO polarity has
	// already been handled inside GPIOToggle, so the server only sees whether
	// the headlight or laser should be considered on.
	c.emitEvent(fmt.Sprintf("%s.state", name), map[string]any{
		fmt.Sprintf("%sOn", name): toggle.On(),
	})
	return nil
}

func (c *WSClient) stopMotionForSystemCommand(reason string) error {
	// System-level commands can restart the process or the whole Pi. Stopping
	// both wheel and auxiliary motors first leaves the Roomba in a predictable
	// state before roverd hands control to systemd or the update helper.
	if err := c.adapter.DriveDirect(0, 0); err != nil {
		return fmt.Errorf("stop drive before %s: %w", reason, err)
	}
	if err := c.adapter.MotorPWM(0, 0, 0); err != nil {
		return fmt.Errorf("stop aux motors before %s: %w", reason, err)
	}
	if err := c.adapter.StartOI(); err != nil {
		return fmt.Errorf("enter passive mode before %s: %w", reason, err)
	}
	return nil
}

func (c *WSClient) handleRebootCommand(payload *rebootPayload) error {
	if err := c.stopMotionForSystemCommand("reboot"); err != nil {
		return err
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
		c.console.Notify("Remote reboot requested. Rebooting the rover now.")
		c.log.Printf("rebooting pi after remote reboot command")
		cmd := exec.Command("systemctl", "reboot")
		if err := cmd.Start(); err != nil {
			c.log.Printf("reboot command failed: %v", err)
		}
	}()

	return nil
}

func (c *WSClient) handleUpdateCommand() error {
	if err := c.stopMotionForSystemCommand("self-update"); err != nil {
		return err
	}

	c.connMu.Lock()
	if c.updateIssued {
		c.connMu.Unlock()
		return fmt.Errorf("update already pending")
	}
	c.updateIssued = true
	c.connMu.Unlock()

	c.emitEvent("system.updateStarting", map[string]any{
		"source": "remoteCommand",
	})
	c.console.Notify("Remote software update requested. roverd will restart if the update succeeds.")

	// The helper is launched asynchronously because a successful update may
	// restart roverd before this websocket command could stream progress back to
	// the server. sudo is intentionally limited by /etc/sudoers.d/roverd-self-update
	// to one root-owned helper with no caller-controlled arguments.
	cmd := exec.Command("sudo", "-n", "/usr/local/sbin/roverd-self-update")
	if err := cmd.Start(); err != nil {
		c.connMu.Lock()
		c.updateIssued = false
		c.connMu.Unlock()
		return fmt.Errorf("start self-update helper: %w", err)
	}
	if err := cmd.Process.Release(); err != nil {
		c.log.Printf("release self-update helper process handle failed: %v", err)
	}

	c.log.Printf("started roverd self-update helper with pid %d", cmd.Process.Pid)
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

func (c *WSClient) warmChromeTTS(ctx context.Context) {
	if c.chromeTTS == nil {
		return
	}
	go func() {
		if err := c.chromeTTS.Start(ctx); err != nil {
			c.log.Printf("chromegtts warmup failed: %v", err)
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
			// A real sensor frame is the authoritative end of a watchdog
			// episode. Successfully sending the OI restart commands alone does
			// not prove that the Roomba resumed producing sensor data.
			c.closeSensorWatchdogEpisode()
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

func (c *WSClient) forwardHostStats(ctx context.Context, conn *websocket.Conn) {
	var previousNetworkSample *networkRateSample

	send := func() bool {
		// Host stats are collected on demand so each outbound message describes
		// the current Pi state. Collection failures are encoded into the stats
		// payload, which keeps this telemetry path from closing the rover socket.
		stats := CollectHostStats(ctx)
		// Throughput is derived here because this loop owns the ordered, periodic
		// samples for one connection. CollectHostStats stays independent, while a
		// reconnect automatically receives a clean counter baseline.
		previousNetworkSample = applyNetworkThroughput(stats.WiFi, previousNetworkSample)
		msg := hostStatsMessage{
			Type:      "hostStats",
			Timestamp: time.Now().UnixMilli(),
			Stats:     stats,
		}
		if err := writeJSON(ctx, conn, msg); err != nil {
			c.log.Printf("host stats send failed: %v", err)
			return false
		}
		return true
	}

	// Send once immediately so a newly connected rover can populate the UI
	// without waiting for the first ticker interval.
	if !send() {
		return
	}

	ticker := time.NewTicker(hostStatsInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !send() {
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
	wasConnected := c.connected
	c.connected = true
	c.seekIssued = false
	c.rebootIssued = false
	c.updateIssued = false
	if c.disconnectT != nil {
		c.disconnectT.Stop()
		c.disconnectT = nil
	}
	if c.rebootT != nil {
		c.rebootT.Stop()
		c.rebootT = nil
	}
	c.connMu.Unlock()

	// Only print on a state transition. Run is retried indefinitely, and a
	// message on every successful internal operation would quickly bury the
	// useful lifecycle history at the login prompt.
	if !wasConnected {
		c.console.Notify("Control server connected.")
	}
}

func (c *WSClient) markDisconnected() {
	c.connMu.Lock()
	wasConnected := c.connected
	c.connected = false
	if c.disconnectT == nil {
		c.disconnectT = time.AfterFunc(disconnectSeekDelay, c.handleDisconnectTimeout)
	}
	if c.rebootT == nil {
		c.rebootT = time.AfterFunc(disconnectRebootDelay, c.handleRebootTimeout)
	}
	c.connMu.Unlock()

	// Initial dial failures are already represented by the startup message and
	// journal retry logs. The prominent disconnect alert is reserved for losing
	// a connection that was actually established.
	if wasConnected {
		c.console.Notify("Control server connection lost. Automatic dock seek in 1 minute; rover reboot in 6 minutes if the connection is not restored.")
	}
}

func (c *WSClient) handleDisconnectTimeout() {
	c.connMu.Lock()
	if c.connected || c.seekIssued {
		c.connMu.Unlock()
		return
	}
	c.seekIssued = true
	c.connMu.Unlock()

	c.console.Notify("Control server has been disconnected for 1 minute. Seeking the dock now.")
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

	c.console.Notify("Control server has been disconnected for 6 minutes. Rebooting the rover now.")
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
	if c.openSensorWatchdogEpisode() {
		c.console.Notify(fmt.Sprintf("Sensor watchdog is restarting the Roomba sensor stream after %.1f seconds without data.", idleFor.Seconds()))
	}

	if err := c.adapter.StartOI(); err != nil {
		c.log.Printf("watchdog start OI failed: %v", err)
		c.emitEvent("sensorWatchdog.error", map[string]any{"error": err.Error()})
		// Unlike the restart notice, every concrete command failure is useful
		// diagnostic information and may change between recovery attempts.
		c.console.Notify(fmt.Sprintf("Sensor watchdog recovery failed while starting the Roomba OI: %v", err))
		return
	}
	if cmdPause > 0 {
		time.Sleep(cmdPause)
	}

	if err := c.adapter.StartSensorStream(defaultStreamPackets); err != nil {
		c.log.Printf("watchdog start stream failed: %v", err)
		c.emitEvent("sensorWatchdog.error", map[string]any{"error": err.Error()})
		c.console.Notify(fmt.Sprintf("Sensor watchdog recovery failed while starting the sensor stream: %v", err))
		return
	}

	c.emitEvent("sensorWatchdog.ok", map[string]any{
		"idleMs": idleFor.Milliseconds(),
	})
	if c.markSensorWatchdogCommandsOK() {
		// Match the existing sensorWatchdog.ok contract precisely: this says
		// the recovery commands succeeded, not that a new frame has arrived.
		c.console.Notify("Sensor watchdog successfully sent the sensor-stream restart commands.")
	}
}

// openSensorWatchdogEpisode reports whether this is the first recovery attempt
// since sensor frames stopped. The watchdog can retry every few seconds, so
// tracking the outage as one episode keeps the login console readable.
func (c *WSClient) openSensorWatchdogEpisode() bool {
	c.watchdogMu.Lock()
	defer c.watchdogMu.Unlock()

	if c.watchdogOpen {
		return false
	}
	c.watchdogOpen = true
	c.watchdogOK = false
	return true
}

// markSensorWatchdogCommandsOK suppresses duplicate success notices while the
// rover is still waiting for a real frame to close the current outage.
func (c *WSClient) markSensorWatchdogCommandsOK() bool {
	c.watchdogMu.Lock()
	defer c.watchdogMu.Unlock()

	if c.watchdogOK {
		return false
	}
	c.watchdogOK = true
	return true
}

func (c *WSClient) closeSensorWatchdogEpisode() {
	c.watchdogMu.Lock()
	c.watchdogOpen = false
	c.watchdogOK = false
	c.watchdogMu.Unlock()
}

func isModeOpcode(op byte) bool {
	switch op {
	case 128, 131, 132:
		return true
	default:
		return false
	}
}
