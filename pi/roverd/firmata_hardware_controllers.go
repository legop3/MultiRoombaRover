package roverd

import (
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"time"
)

// FirmataCameraServo preserves the established logical camera movement model
// while replacing only the final physical write. The ESP32 receives ordinary
// Firmata servo configuration and angle messages, regardless of rover host.
type FirmataCameraServo struct {
	cfg          CameraServoConfig
	client       *FirmataClient
	pin          byte
	peripheralID string
	mu           sync.Mutex
	currentAngle float64
	desiredAngle float64
	lastMove     time.Time
	moving       bool
	stopCh       chan struct{}
	closed       bool
}

func newFirmataCameraServo(peripheral *managedPeripheral, declaration PeripheralCameraServo, logger *log.Logger) (*FirmataCameraServo, error) {
	cfg := CameraServoConfig{
		Enabled:       true,
		Pin:           declaration.Pin,
		FreqHz:        50,
		CycleLen:      20000,
		MinPulseUs:    declaration.MinimumPulseMicroseconds,
		MaxPulseUs:    declaration.MaximumPulseMicroseconds,
		MinAngle:      declaration.MinimumAngleDegrees,
		MaxAngle:      declaration.MaximumAngleDegrees,
		HomeAngle:     declaration.HomeAngleDegrees,
		NudgeDegrees:  declaration.NudgeDegrees,
		AllowRawPulse: declaration.AllowRawPulse,
		Invert:        declaration.Inverted,
	}
	servo := &FirmataCameraServo{
		cfg:          cfg,
		client:       peripheral.client,
		pin:          byte(declaration.Pin),
		peripheralID: peripheral.metadata.ID,
		stopCh:       make(chan struct{}),
	}

	// SERVO_CONFIG establishes the peripheral-owned pulse calibration before
	// selecting servo mode. This is standard Firmata, not a rover extension.
	if err := servo.client.ConfigureServo(servo.pin, cfg.MinPulseUs, cfg.MaxPulseUs); err != nil {
		return nil, fmt.Errorf("configure Firmata servo: %w", err)
	}
	if err := servo.client.SetPinMode(servo.pin, FirmataPinModeServo); err != nil {
		return nil, fmt.Errorf("select Firmata servo mode: %w", err)
	}
	if err := servo.setAngleLocked(cfg.HomeAngle); err != nil {
		return nil, err
	}
	logger.Printf("camera servo using ESP32 %s pin %d (%.1f..%.1f deg)", peripheral.metadata.ID, declaration.Pin, cfg.MinAngle, cfg.MaxAngle)
	return servo, nil
}

func (servo *FirmataCameraServo) SetAngle(angle float64) error {
	servo.mu.Lock()
	defer servo.mu.Unlock()
	return servo.setAngleLocked(angle)
}

func (servo *FirmataCameraServo) setAngleLocked(angle float64) error {
	if servo.closed {
		return errorsNewControllerClosed("camera servo")
	}
	servo.desiredAngle = clampFloat(angle, servo.cfg.MinAngle, servo.cfg.MaxAngle)
	limited := servo.rateLimitAngleLocked(servo.desiredAngle)
	if err := servo.writeAngleLocked(limited); err != nil {
		return err
	}
	servo.currentAngle = limited
	if math.Abs(limited-servo.desiredAngle) > servoAngleEpsilon {
		servo.startMoveLoopLocked()
	}
	return nil
}

func (servo *FirmataCameraServo) Nudge(delta float64) error {
	servo.mu.Lock()
	defer servo.mu.Unlock()
	if delta == 0 {
		delta = servo.cfg.NudgeDegrees
	}
	return servo.setAngleLocked(servo.currentAngle + delta)
}

func (servo *FirmataCameraServo) SetPulseWidth(micros int) error {
	servo.mu.Lock()
	defer servo.mu.Unlock()
	if !servo.cfg.AllowRawPulse {
		return fmt.Errorf("raw pulse commands disabled")
	}
	if micros <= 0 {
		return fmt.Errorf("pulse width must be > 0")
	}
	pulse := clampInt(micros, servo.cfg.MinPulseUs, servo.cfg.MaxPulseUs)
	return servo.setAngleLocked(servo.pulseToAngle(pulse))
}

func (servo *FirmataCameraServo) CurrentAngle() float64 {
	servo.mu.Lock()
	defer servo.mu.Unlock()
	return servo.currentAngle
}

func (servo *FirmataCameraServo) Configuration() CameraServoConfig {
	return servo.cfg
}

func (servo *FirmataCameraServo) BackendDescription() string {
	return "ESP32 " + servo.peripheralID
}

func (servo *FirmataCameraServo) Close() {
	servo.mu.Lock()
	defer servo.mu.Unlock()
	if servo.closed {
		return
	}
	// Returning home matches the native Pi implementation. Any write failure is
	// ignored during shutdown because the serial connection may already be gone.
	_ = servo.writeAngleLocked(servo.cfg.HomeAngle)
	close(servo.stopCh)
	servo.closed = true
}

func (servo *FirmataCameraServo) writeAngleLocked(angle float64) error {
	rangeDegrees := servo.cfg.MaxAngle - servo.cfg.MinAngle
	normalized := (angle - servo.cfg.MinAngle) / rangeDegrees
	normalized = math.Max(0, math.Min(1, normalized))
	if servo.cfg.Invert {
		normalized = 1 - normalized
	}
	// Standard Firmata servo values are positions from 0 through 180. Pulse
	// calibration was already supplied through SERVO_CONFIG above.
	position := int(math.Round(normalized * 180))
	return servo.client.ExtendedAnalog(servo.pin, position)
}

func (servo *FirmataCameraServo) pulseToAngle(pulse int) float64 {
	normalized := float64(pulse-servo.cfg.MinPulseUs) / float64(servo.cfg.MaxPulseUs-servo.cfg.MinPulseUs)
	if servo.cfg.Invert {
		normalized = 1 - normalized
	}
	return servo.cfg.MinAngle + normalized*(servo.cfg.MaxAngle-servo.cfg.MinAngle)
}

func (servo *FirmataCameraServo) rateLimitAngleLocked(target float64) float64 {
	now := time.Now()
	if servo.lastMove.IsZero() {
		servo.lastMove = now
	}
	elapsed := now.Sub(servo.lastMove).Seconds()
	if elapsed > servoStepInterval.Seconds() {
		elapsed = servoStepInterval.Seconds()
	}
	maximumDelta := maxServoDegPerSec * elapsed
	delta := target - servo.currentAngle
	if math.Abs(delta) <= maximumDelta {
		servo.lastMove = now
		return target
	}
	servo.lastMove = now
	if delta > 0 {
		return servo.currentAngle + maximumDelta
	}
	return servo.currentAngle - maximumDelta
}

func (servo *FirmataCameraServo) startMoveLoopLocked() {
	if servo.moving || servo.closed {
		return
	}
	servo.moving = true
	go func() {
		ticker := time.NewTicker(servoStepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				servo.mu.Lock()
				if servo.closed || math.Abs(servo.currentAngle-servo.desiredAngle) <= servoAngleEpsilon {
					servo.moving = false
					servo.mu.Unlock()
					return
				}
				limited := servo.rateLimitAngleLocked(servo.desiredAngle)
				if err := servo.writeAngleLocked(limited); err != nil {
					// A failed serial write makes further automatic steps pointless.
					// The next user command returns the connection error normally.
					servo.moving = false
					servo.mu.Unlock()
					return
				}
				servo.currentAngle = limited
				servo.mu.Unlock()
			case <-servo.stopCh:
				return
			}
		}
	}()
}

// FirmataToggle owns logical state exactly like GPIOToggle but sends the final
// electrical level through Firmata's standard digital-pin command.
type FirmataToggle struct {
	cfg          GPIOToggleConfig
	name         string
	client       *FirmataClient
	pin          byte
	peripheralID string
	mu           sync.Mutex
	on           bool
	closed       bool
}

func newFirmataToggle(name string, peripheral *managedPeripheral, declaration PeripheralDigitalRole, logger *log.Logger) (*FirmataToggle, error) {
	cfg := GPIOToggleConfig{Enabled: true, GPIOPin: declaration.Pin, InitialOn: declaration.InitiallyOn, ActiveLow: declaration.ActiveLow}
	toggle := &FirmataToggle{
		cfg:          cfg,
		name:         name,
		client:       peripheral.client,
		pin:          byte(declaration.Pin),
		peripheralID: peripheral.metadata.ID,
		on:           cfg.InitialOn,
	}
	if err := toggle.client.SetPinMode(toggle.pin, FirmataPinModeOutput); err != nil {
		return nil, fmt.Errorf("select Firmata output mode: %w", err)
	}
	if err := toggle.writeLocked(toggle.on); err != nil {
		return nil, fmt.Errorf("initialize Firmata output: %w", err)
	}
	logger.Printf("%s using ESP32 %s pin %d (initial=%v activeLow=%v)", name, peripheral.metadata.ID, declaration.Pin, cfg.InitialOn, cfg.ActiveLow)
	return toggle, nil
}

func (toggle *FirmataToggle) HandleAction(action string) error {
	toggle.mu.Lock()
	defer toggle.mu.Unlock()
	if toggle.closed {
		return errorsNewControllerClosed(toggle.name)
	}
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "", "toggle":
		return toggle.setLocked(!toggle.on)
	case "on":
		return toggle.setLocked(true)
	case "off":
		return toggle.setLocked(false)
	default:
		return fmt.Errorf("unknown action %q", action)
	}
}

func (toggle *FirmataToggle) setLocked(on bool) error {
	if err := toggle.writeLocked(on); err != nil {
		return err
	}
	toggle.on = on
	return nil
}

func (toggle *FirmataToggle) writeLocked(on bool) error {
	physicalHigh := on
	if toggle.cfg.ActiveLow {
		physicalHigh = !physicalHigh
	}
	return toggle.client.SetDigitalPin(toggle.pin, physicalHigh)
}

func (toggle *FirmataToggle) On() bool {
	toggle.mu.Lock()
	defer toggle.mu.Unlock()
	return toggle.on
}

func (toggle *FirmataToggle) Configuration() GPIOToggleConfig {
	return toggle.cfg
}

func (toggle *FirmataToggle) BackendDescription() string {
	return "ESP32 " + toggle.peripheralID
}

func (toggle *FirmataToggle) Close() {
	toggle.mu.Lock()
	defer toggle.mu.Unlock()
	toggle.closed = true
}

func errorsNewControllerClosed(name string) error {
	return fmt.Errorf("%s controller closed", name)
}
