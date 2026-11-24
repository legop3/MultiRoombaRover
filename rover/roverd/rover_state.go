package roverd

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"time"
)

// Preserve the values reported by the supported Roombas and the original
// server decoder. Shifting these down one leaves real Full (4) unrecognized.
const (
	oiModePassive byte = 2
	oiModeSafe    byte = 3
	oiModeFull    byte = 4
)

type BatteryState struct {
	Percent     *float64 `json:"percent"`
	Charging    *bool    `json:"charging"`
	Low         *bool    `json:"low"`
	Critical    *bool    `json:"critical"`
	NeedsCharge *bool    `json:"needsCharge"`
}

type roverRuntime struct {
	sample      SensorSample
	seen        time.Time
	waiting     time.Time
	needsCharge bool
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
			c.runtime.sample, c.runtime.seen = sample, time.Now()
			c.observeDocking(sample)
			docked := sample.ChargeSources&sourceHomeBase != 0
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
			if c.autoCharge != nil && c.docking.operation == nil {
				c.autoCharge.processSample(sample)
			}
			c.commandMu.Unlock()
		case <-ticker.C:
			c.commandMu.Lock()
			if c.stopping.Load() {
				c.commandMu.Unlock()
				continue
			}
			c.checkDockingDeadline()
			// Preparation and the reverse deadline must progress even if sensor
			// samples stop. Only fresh samples can confirm leaving the dock.
			if c.docking.operation != nil {
				c.advanceUndock()
			}
			if time.Since(c.runtime.seen) > 1500*time.Millisecond {
				c.runtime.waiting = time.Time{}
				c.publishHardwareState(false)
			}
			c.commandMu.Unlock()
		}
	}
}

func (c *WSClient) publishHardwareState(valid bool) {
	c.stateMu.Lock()
	old, _ := json.Marshal(c.roverState)
	s := &c.roverState
	s.DockingStatus = c.dockingSnapshot(valid)
	s.DockAssist = boolValue(c.docking.assist)
	if !valid {
		s.DrivingMode, s.Docked, s.Docking = nil, nil, nil
		s.Battery = BatteryState{}
	} else {
		sample := c.runtime.sample
		s.DrivingMode = boolValue(sample.Mode == oiModeSafe || sample.Mode == oiModeFull)
		s.Docked = boolValue(sample.ChargeSources&sourceHomeBase != 0)
		s.Docking = boolValue(c.observedSeeking())
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
