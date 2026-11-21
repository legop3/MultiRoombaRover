package roverd

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"time"
)

type BatteryState struct {
	Percent     *float64 `json:"percent"`
	Charging    *bool    `json:"charging"`
	Low         *bool    `json:"low"`
	Critical    *bool    `json:"critical"`
	NeedsCharge *bool    `json:"needsCharge"`
}

type undockOperation struct {
	speed                    int
	id                       string
	started, next, reversing time.Time
	stage                    int
	backoff                  bool
}

type roverRuntime struct {
	sample          SensorSample
	seen            time.Time
	waiting         time.Time
	needsCharge     bool
	seeking, assist bool
	operation       *undockOperation
}

func boolValue(v bool) *bool { return &v }

// One hardware observer owns recovery history and docking progress even while
// the control connection is down. Access is serialized with incoming commands.
func (c *WSClient) ObserveHardware(ctx context.Context, samples <-chan SensorSample) {
	// Retain low-battery recovery across daemon restarts, not merely reconnects.
	c.commandMu.Lock()
	if data, err := os.ReadFile("/var/lib/roverd/battery-needs-charge.json"); err == nil {
		_ = json.Unmarshal(data, &c.runtime.needsCharge)
	}
	c.commandMu.Unlock()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case sample := <-samples:
			c.commandMu.Lock()
			if c.stopping.Load() {
				c.commandMu.Unlock()
				continue
			}
			previous := c.runtime.sample
			hadSample := !c.runtime.seen.IsZero()
			c.runtime.sample, c.runtime.seen = sample, time.Now()
			docked := sample.ChargeSources&sourceHomeBase != 0
			if docked || (hadSample && previous.Mode == 1 && (sample.Mode == 2 || sample.Mode == 3)) {
				c.adapter.seeking.Store(false)
			}
			if c.runtime.operation == nil {
				c.runtime.seeking = c.adapter.seeking.Load()
			}
			if docked {
				c.runtime.seeking = false
			}
			if c.runtime.operation != nil {
				c.advanceUndock()
			} else if docked && hadSample && previous.ChargeSources&sourceHomeBase == 0 {
				// Contact ends manual motion; charging recovery runs only after stopping.
				_ = c.adapter.DriveDirect(0, 0)
				_ = c.adapter.MotorPWM(0, 0, 0)
				_ = c.adapter.StartOI()
				c.runtime.assist = false
			}
			if sample.ChargingState == 4 && docked {
				if c.runtime.waiting.IsZero() {
					c.runtime.waiting = time.Now()
				}
			} else {
				c.runtime.waiting = time.Time{}
			}
			previousNeedsCharge := c.runtime.needsCharge
			charge := float64(sample.Charge)
			warn, full := float64(c.cfg.Battery.Warn), float64(c.cfg.Battery.Full)
			if charge <= warn {
				c.runtime.needsCharge = true
			}
			// Preserve the existing recovery criterion, not a displayed 100% test.
			if docked && !c.runtime.waiting.IsZero() && time.Since(c.runtime.waiting) >= 5*time.Minute && full > warn && (charge-warn)/(full-warn) >= .01 {
				c.runtime.needsCharge = false
			}
			if previousNeedsCharge != c.runtime.needsCharge {
				data, _ := json.Marshal(c.runtime.needsCharge)
				path := "/var/lib/roverd/battery-needs-charge.json"
				if err := os.WriteFile(path+".new", data, 0600); err != nil {
					c.log.Printf("save battery recovery: %v", err)
				} else if err := os.Rename(path+".new", path); err != nil {
					c.log.Printf("save battery recovery: %v", err)
				}
			}
			c.publishHardwareState(true)
			// Do not let automatic charging interrupt a local undock sequence.
			if c.autoCharge != nil && c.runtime.operation == nil {
				c.autoCharge.processSample(sample)
			}
			c.commandMu.Unlock()
		case <-ticker.C:
			c.commandMu.Lock()
			if c.stopping.Load() {
				c.commandMu.Unlock()
				continue
			}
			if time.Since(c.runtime.seen) > 1500*time.Millisecond {
				c.runtime.waiting = time.Time{}
				if c.runtime.operation != nil {
					c.finishUndock("error", "Roomba telemetry unavailable")
				}
				c.publishHardwareState(false)
			} else if c.runtime.operation != nil && (time.Since(c.runtime.operation.started) > 4*time.Second || (!c.runtime.operation.reversing.IsZero() && time.Since(c.runtime.operation.reversing) > time.Second)) {
				c.finishUndock("error", "Undocking timed out")
			}
			c.commandMu.Unlock()
		}
	}
}

func (c *WSClient) publishHardwareState(valid bool) {
	c.stateMu.Lock()
	old, _ := json.Marshal(c.roverState)
	s := &c.roverState
	if !valid {
		s.DrivingMode, s.Docked, s.Docking = nil, nil, nil
		s.Battery = BatteryState{}
	} else {
		sample := c.runtime.sample
		s.DrivingMode = boolValue(sample.Mode == 2 || sample.Mode == 3)
		s.Docked = boolValue(sample.ChargeSources&sourceHomeBase != 0)
		s.Docking = boolValue(c.runtime.seeking)
		charge, full, warn, urgent := float64(sample.Charge), float64(c.cfg.Battery.Full), float64(c.cfg.Battery.Warn), float64(c.cfg.Battery.Urgent)
		var percent *float64
		value := 0.0
		if full > warn && warn > urgent {
			if charge <= warn {
				value = 10 * (charge - urgent) / (warn - urgent)
			} else {
				value = 10 + 90*(charge-warn)/(full-warn)
			}
			value = math.Round(math.Max(0, math.Min(100, value)))
			percent = &value
		} else if sample.Capacity > 0 {
			value = math.Round(math.Min(100, charge/float64(sample.Capacity)*100))
			percent = &value
		}
		s.Battery = BatteryState{Percent: percent, Charging: boolValue(isCharging(sample.ChargingState)), Low: boolValue(charge <= warn), Critical: boolValue(charge <= urgent), NeedsCharge: boolValue(c.runtime.needsCharge)}
	}
	next, _ := json.Marshal(s)
	c.stateMu.Unlock()
	if string(old) != string(next) {
		select {
		case c.stateChanged <- struct{}{}:
		default:
		}
	}
}

func (c *WSClient) dockingCommand(msg *inboundMessage) error {
	if msg.Type == "cancelDocking" {
		if c.runtime.operation != nil {
			c.finishUndock("cancelled", "Docking cancelled")
		}
		c.runtime.seeking, c.runtime.assist = false, false
		if err := c.adapter.StartOI(); err != nil {
			return err
		}
		if c.runtime.sample.ChargeSources&sourceHomeBase == 0 && time.Since(c.runtime.seen) < 1500*time.Millisecond {
			if err := c.adapter.SendRaw([]byte{132}); err != nil {
				return err
			}
		}
		if err := c.adapter.MotorPWM(0, 0, 0); err != nil {
			return err
		}
		return c.adapter.DriveDirect(0, 0)
	}
	if c.runtime.operation != nil {
		return fmt.Errorf("undocking is already in progress")
	}
	if time.Since(c.runtime.seen) > 1500*time.Millisecond {
		return fmt.Errorf("waiting for Roomba telemetry")
	}
	switch msg.Type {
	case "autoDock":
		if c.runtime.seeking || c.runtime.sample.ChargeSources&sourceHomeBase != 0 {
			return nil
		}
		if err := c.adapter.SeekDock(); err != nil {
			return err
		}
		c.runtime.seeking = true
	case "dockAssist":
		c.runtime.assist = true
		c.runtime.seeking = false
		if err := c.adapter.DriveDirect(0, 0); err != nil {
			return err
		}
		if err := c.adapter.SendRaw([]byte{132}); err != nil {
			return err
		}
	case "undock":
		c.runtime.assist, c.runtime.seeking = false, false
		if err := c.adapter.DriveDirect(0, 0); err != nil {
			return err
		}
		if err := c.adapter.StartOI(); err != nil {
			return err
		}
		speed := c.cfg.MaxWheelMMs
		if msg.Speed != nil {
			speed = clamp(*msg.Speed, 1, c.cfg.MaxWheelMMs)
		}
		c.runtime.operation = &undockOperation{speed: speed, id: msg.ID, started: time.Now(), next: time.Now().Add(100 * time.Millisecond), backoff: msg.Backoff == nil || *msg.Backoff}
	}
	c.publishHardwareState(true)
	return nil
}

func (c *WSClient) advanceUndock() {
	op := c.runtime.operation
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
		err = c.adapter.SendRaw([]byte{132})
		op.stage = 2
		op.next = time.Now().Add(300 * time.Millisecond)
	default:
		if c.runtime.sample.Mode != 3 {
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
	op := c.runtime.operation
	if op == nil {
		return
	}
	c.runtime.operation = nil
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
