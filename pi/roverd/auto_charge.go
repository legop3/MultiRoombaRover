package roverd

import (
	"context"
	"log"
	"time"
)

const (
	autoChargeTimeout  = 10 * time.Second
	autoChargeCooldown = 2 * time.Minute
	sourceHomeBase     = 1 << 1
)

type AutoChargeController struct {
	adapter       *SerialAdapter
	events        chan<- RoverEvent
	logger        *log.Logger
	timerStart    time.Time
	cooldownUntil time.Time
	lastState     byte
	lastSources   byte
}

func NewAutoChargeController(adapter *SerialAdapter, events chan<- RoverEvent, logger *log.Logger) *AutoChargeController {
	return &AutoChargeController{
		adapter: adapter,
		events:  events,
		logger:  logger,
	}
}

func (a *AutoChargeController) Run(ctx context.Context, samples <-chan SensorSample) {
	for {
		select {
		case <-ctx.Done():
			return
		case sample := <-samples:
			a.processSample(sample)
		}
	}
}

func (a *AutoChargeController) processSample(sample SensorSample) {
	now := time.Now()
	docked := sample.ChargeSources&sourceHomeBase != 0
	charging := isCharging(sample.ChargingState)

	if !docked || charging {
		if !a.timerStart.IsZero() {
			a.emitEvent("autoCharge.timerCleared", map[string]any{
				"durationMs": time.Since(a.timerStart).Milliseconds(),
			})
		}
		a.timerStart = time.Time{}
		a.lastState = sample.ChargingState
		a.lastSources = sample.ChargeSources
		return
	}

	// docked but not charging
	if a.cooldownUntil.After(now) {
		return
	}

	if a.timerStart.IsZero() {
		a.timerStart = now
		a.emitEvent("autoCharge.timerStarted", map[string]any{
			"chargingState": sample.ChargingState,
		})
		return
	}

	if now.Sub(a.timerStart) >= autoChargeTimeout {
		if err := a.adapter.SeekDock(); err != nil {
			a.emitEvent("autoCharge.seekDockError", map[string]any{"error": err.Error()})
		} else {
			a.emitEvent("autoCharge.seekDockIssued", map[string]any{
				"waitingMs": autoChargeTimeout.Milliseconds(),
			})
		}
		a.timerStart = time.Time{}
		a.cooldownUntil = now.Add(autoChargeCooldown)
	}
}

func isCharging(state byte) bool {
	switch state {
	case 1, 2, 3, 4:
		return true
	default:
		return false
	}
}

func (a *AutoChargeController) emitEvent(event string, data map[string]any) {
	if a.events == nil {
		return
	}
	select {
	case a.events <- RoverEvent{
		Type:  "event",
		Event: event,
		Ts:    time.Now().UnixMilli(),
		Data:  data,
	}:
	default:
	}
}
