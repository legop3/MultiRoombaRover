package roverd

import (
	"fmt"
	"math"
	"time"
)

type undockOperation struct {
	speed                    int
	id                       string
	started, next, reversing time.Time
	stage                    int
	backoff                  bool
}

// Docking state is separate from the roverState snapshot sent to the server.
// All controller entry points run under commandMu, alongside drive commands.
type dockingController struct {
	sample             SensorSample
	seen               bool
	dockHold           bool
	contactDockPending bool
	seeking, assist    bool
	operation          *undockOperation
}

func (c *WSClient) observeDocking(sample SensorSample) {
	d := &c.docking
	previous, hadSample := d.sample, d.seen
	elapsed := sample.Timestamp - previous.Timestamp
	// The old controller received the 50 ms network sensor stream. Preserve
	// that cadence locally instead of running successive actions on every
	// serial packet (or draining queued packets as though time had passed).
	if hadSample && elapsed < sensorThrottleMinimum.Milliseconds() {
		return
	}
	d.sample, d.seen = sample, true
	docked := sample.ChargeSources&sourceHomeBase != 0
	if docked || (hadSample && previous.Mode == oiModePassive && (sample.Mode == oiModeSafe || sample.Mode == oiModeFull)) {
		c.adapter.seeking.Store(false)
	}
	if d.operation == nil {
		d.seeking = c.adapter.seeking.Load()
	}
	if docked {
		d.seeking = false
	}
	if d.operation != nil {
		c.checkDockingDeadline()
		if d.operation != nil {
			c.advanceUndock()
		}
		return
	}
	if !docked {
		d.contactDockPending = false
		if hadSample && previous.ChargeSources&sourceHomeBase != 0 && d.assist {
			c.dockBeep(1, 6, 72)
		}
		return
	}
	// Losing contact must not release held controls. Each new contact still
	// issues a fresh stop, just as the old server's contact-edge handler did.
	d.dockHold = true
	if !hadSample || previous.ChargeSources&sourceHomeBase == 0 {
		if err := c.stopAtDock(); err != nil {
			c.log.Printf("dock contact stop: %v", err)
			return
		}
		d.contactDockPending = true
	} else if d.contactDockPending && !isCharging(sample.ChargingState) && dockingWheelsStopped(previous, sample) {
		if err := c.adapter.SeekDock(); err != nil {
			c.log.Printf("dock charging request: %v", err)
		} else {
			d.contactDockPending = false
		}
	}
	if isCharging(sample.ChargingState) {
		d.contactDockPending = false
		c.setDockAssist(false, true)
	}
}

func dockingWheelsStopped(previous, sample SensorSample) bool {
	elapsed := sample.Timestamp - previous.Timestamp
	if elapsed <= 0 || elapsed > 1500 {
		return false
	}
	// Match the server's rounded encoder-derived mm/s, including 16-bit wrap.
	// A requested speed of zero is not evidence that either wheel has stopped.
	mmPerCount := math.Pi * 72 / 508.8
	left := float64(int16(sample.LeftEncoder-previous.LeftEncoder)) * mmPerCount * 1000 / float64(elapsed)
	right := float64(int16(sample.RightEncoder-previous.RightEncoder)) * mmPerCount * 1000 / float64(elapsed)
	return math.Floor(left+0.5) == 0 && math.Floor(right+0.5) == 0
}

func (c *WSClient) checkDockingDeadline() {
	op := c.docking.operation
	if op == nil {
		return
	}
	if time.Since(c.runtime.seen) > 1500*time.Millisecond {
		c.finishUndock("error", "Roomba telemetry unavailable")
	} else if time.Since(op.started) >= 4*time.Second || (!op.reversing.IsZero() && time.Since(op.reversing) >= time.Second) {
		c.finishUndock("error", "Undocking timed out")
	}
}

func (c *WSClient) dockingCommand(msg *inboundMessage) error {
	defer func() { c.publishHardwareState(time.Since(c.runtime.seen) <= 1500*time.Millisecond) }()
	if msg.Type == "cancelDocking" {
		if c.docking.operation != nil {
			c.finishUndock("cancelled", "Docking cancelled")
		}
		if err := c.adapter.DriveDirect(0, 0); err != nil {
			return err
		}
		c.setDockAssist(false)
		return nil
	}
	if c.docking.operation != nil {
		return fmt.Errorf("undocking is already in progress")
	}
	if time.Since(c.runtime.seen) > 1500*time.Millisecond {
		return fmt.Errorf("waiting for Roomba telemetry")
	}
	switch msg.Type {
	case "autoDock":
		c.setDockAssist(false)
		if c.docking.dockHold || c.docking.seeking || c.runtime.sample.ChargeSources&sourceHomeBase != 0 {
			return nil
		}
		if err := c.adapter.SeekDock(); err != nil {
			return err
		}
		c.docking.seeking = true
	case "dockAssist":
		// Assistance cannot improve an already-established dock contact.
		if c.docking.dockHold || c.runtime.sample.ChargeSources&sourceHomeBase != 0 || c.docking.assist {
			return nil
		}
		c.docking.seeking = false
		c.docking.contactDockPending = false
		if err := c.adapter.DriveDirect(0, 0); err != nil {
			return err
		}
		c.setDockAssist(true)
	case "undock":
		if err := c.adapter.DriveDirect(0, 0); err != nil {
			return err
		}
		c.setDockAssist(false)
		c.dockCamera(0)
		c.docking.seeking = false
		if err := c.setOIMode(128); err != nil {
			return err
		}
		speed := c.cfg.MaxWheelMMs
		if msg.Speed != nil {
			speed = clamp(*msg.Speed, 1, c.cfg.MaxWheelMMs)
		}
		c.log.Printf("undock starting: backoff=%v speed=%d mode=%d sources=%d", msg.Backoff == nil || *msg.Backoff, speed, c.runtime.sample.Mode, c.runtime.sample.ChargeSources)
		c.docking.dockHold = false
		c.docking.contactDockPending = false
		c.docking.operation = &undockOperation{speed: speed, id: msg.ID, started: time.Now(), next: time.Now().Add(100 * time.Millisecond), backoff: msg.Backoff == nil || *msg.Backoff}
	}
	return nil
}

func (c *WSClient) advanceUndock() {
	op := c.docking.operation
	if time.Now().Before(op.next) {
		return
	}
	var err error
	switch op.stage {
	case 0:
		err = c.adapter.SeekDock()
		op.stage = 1
		op.next = time.Now().Add(100 * time.Millisecond)
	case 1:
		err = c.setOIMode(132)
		op.stage = 2
		op.next = time.Now().Add(300 * time.Millisecond)
	default:
		if c.runtime.sample.Mode != oiModeFull {
			if !op.reversing.IsZero() {
				c.finishUndock("error", "Roomba left driving mode")
			}
			return
		}
		if !op.backoff || c.runtime.sample.ChargeSources&sourceHomeBase == 0 {
			c.finishUndock("ok", "")
			return
		}
		if op.reversing.IsZero() {
			op.reversing = time.Now()
			err = c.adapter.DriveDirect(-op.speed, -op.speed)
		}
	}
	if err != nil {
		c.finishUndock("error", err.Error())
	}
}

func (c *WSClient) finishUndock(status, message string) {
	op := c.docking.operation
	if op == nil {
		return
	}
	c.log.Printf("undock %s: %s (stage=%d mode=%d sources=%d)", status, message, op.stage, c.runtime.sample.Mode, c.runtime.sample.ChargeSources)
	c.docking.operation = nil
	c.docking.dockHold = status != "ok" || c.runtime.sample.ChargeSources&sourceHomeBase != 0
	c.adapter.seeking.Store(false)
	if err := c.adapter.DriveDirect(0, 0); err != nil {
		status = "error"
		message = err.Error()
	}
	select {
	case c.results <- ackMessage{Type: "commandResult", ID: op.id, Status: status, Error: message}:
	default:
	}
}

// The old raw mode-command path also restarted streaming. Local docking must
// preserve that side effect: its next step depends on fresh hardware samples.
func (c *WSClient) setOIMode(mode byte) error {
	if err := c.adapter.SendRaw([]byte{mode}); err != nil {
		return err
	}
	return c.ensureSensorStream()
}

func (c *WSClient) setDockAssist(enabled bool, quiet ...bool) {
	if c.docking.assist == enabled {
		return
	}
	c.docking.assist = enabled
	angle := 0.0
	if enabled && c.servo != nil {
		angle = c.servo.Configuration().MinAngle
	}
	c.dockCamera(angle)
	if len(quiet) == 0 || !quiet[0] {
		if enabled {
			c.dockBeep(0, 10, 76, 83)
		} else {
			c.dockBeep(0, 10, 83, 76)
		}
	}
}

func (c *WSClient) dockCamera(angle float64) {
	if c.servo != nil {
		if err := c.servo.SetAngle(angle); err != nil {
			c.log.Printf("dock assist camera: %v", err)
		}
	}
}

func (c *WSClient) limitAssistDrive(left, right int) (int, int) {
	if !c.docking.assist {
		return left, right
	}
	maximum := math.Max(math.Abs(float64(left)), math.Abs(float64(right)))
	if maximum <= 60 {
		return left, right
	}
	return int(math.Floor(float64(left)*60/maximum + 0.5)), int(math.Floor(float64(right)*60/maximum + 0.5))
}

func (c *WSClient) dockBeep(slot, duration int, notes ...int) {
	song := make([]songNote, len(notes))
	for i, note := range notes {
		song[i] = songNote{Note: note, Duration: duration}
	}
	if err := c.adapter.PlaySong(slot, song); err != nil {
		c.log.Printf("dock beep: %v", err)
	}
}

func (c *WSClient) stopAtDock() error {
	if err := c.adapter.DriveDirect(0, 0); err != nil {
		return err
	}
	if err := c.adapter.MotorPWM(0, 0, 0); err != nil {
		return err
	}
	c.lastAux = motorPWMPayload{}
	c.autoSideOn = false
	if c.docking.assist {
		c.dockBeep(1, 6, 84)
	}
	return nil
}
