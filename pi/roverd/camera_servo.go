//go:build !dummy

package roverd

import (
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	rpio "github.com/stianeikeland/go-rpio/v4"
)

type CameraServo struct {
	cfg          CameraServoConfig
	logger       *log.Logger
	pin          rpio.Pin
	mu           sync.Mutex
	currentAngle float64
	desiredAngle float64
	lastMove     time.Time
	moving       bool
	stopCh       chan struct{}
	closed       bool
}

const maxServoDegPerSec = 60.0
const servoStepInterval = 20 * time.Millisecond
const servoAngleEpsilon = 0.01

func NewCameraServo(cfg CameraServoConfig, logger *log.Logger) (*CameraServo, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("camera servo disabled")
	}
	if err := rpio.Open(); err != nil {
		return nil, fmt.Errorf("open gpio: %w", err)
	}

	pin := rpio.Pin(cfg.Pin)
	pin.Mode(rpio.Pwm)
	targetClock := cfg.FreqHz * cfg.CycleLen
	pin.Freq(targetClock)

	servo := &CameraServo{
		cfg:    cfg,
		logger: logger,
		pin:    pin,
		stopCh: make(chan struct{}),
	}
	if err := servo.setAngleLocked(cfg.HomeAngle); err != nil {
		rpio.Close()
		return nil, err
	}
	logger.Printf("camera servo initialized on GPIO %d (%.1f..%.1f deg, %d..%d us, invert=%v)", cfg.Pin, cfg.MinAngle, cfg.MaxAngle, cfg.MinPulseUs, cfg.MaxPulseUs, cfg.Invert)
	return servo, nil
}

func (s *CameraServo) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.applyPulseLocked(s.angleToPulse(s.cfg.HomeAngle))
	rpio.Close()
	if s.stopCh != nil {
		close(s.stopCh)
		s.stopCh = nil
	}
	s.closed = true
}

func (s *CameraServo) SetAngle(angle float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.setAngleLocked(angle)
}

func (s *CameraServo) setAngleLocked(angle float64) error {
	if s.closed {
		return fmt.Errorf("servo closed")
	}
	clamped := clampFloat(angle, s.cfg.MinAngle, s.cfg.MaxAngle)
	s.desiredAngle = clamped
	limited := s.rateLimitAngleLocked(clamped)
	s.applyPulseLocked(s.angleToPulse(limited))
	s.currentAngle = limited
	if math.Abs(limited-s.desiredAngle) > servoAngleEpsilon {
		s.startMoveLoopLocked()
	}
	return nil
}

func (s *CameraServo) Nudge(delta float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if delta == 0 {
		delta = s.cfg.NudgeDegrees
	}
	target := s.currentAngle + delta
	return s.setAngleLocked(target)
}

func (s *CameraServo) SetPulseWidth(micros int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("servo closed")
	}
	if !s.cfg.AllowRawPulse {
		return fmt.Errorf("raw pulse commands disabled")
	}
	if micros <= 0 {
		return fmt.Errorf("pulse width must be > 0")
	}
	clampedPulse := clampInt(micros, s.cfg.MinPulseUs, s.cfg.MaxPulseUs)
	targetAngle := s.pulseToAngle(clampedPulse)
	s.desiredAngle = targetAngle
	limited := s.rateLimitAngleLocked(targetAngle)
	s.applyPulseLocked(s.angleToPulse(limited))
	s.currentAngle = limited
	if math.Abs(limited-s.desiredAngle) > servoAngleEpsilon {
		s.startMoveLoopLocked()
	}
	return nil
}

func (s *CameraServo) CurrentAngle() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentAngle
}

func (s *CameraServo) applyPulseLocked(micros int) {
	micros = clampInt(micros, s.cfg.MinPulseUs, s.cfg.MaxPulseUs)
	s.pin.DutyCycle(uint32(micros), uint32(s.cfg.CycleLen))
}

func (s *CameraServo) startMoveLoopLocked() {
	if s.moving || s.stopCh == nil {
		return
	}
	s.moving = true
	go func() {
		ticker := time.NewTicker(servoStepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.mu.Lock()
				if s.closed {
					s.moving = false
					s.mu.Unlock()
					return
				}
				if math.Abs(s.currentAngle-s.desiredAngle) <= servoAngleEpsilon {
					s.moving = false
					s.mu.Unlock()
					return
				}
				limited := s.rateLimitAngleLocked(s.desiredAngle)
				s.applyPulseLocked(s.angleToPulse(limited))
				s.currentAngle = limited
				s.mu.Unlock()
			case <-s.stopCh:
				return
			}
		}
	}()
}

func (s *CameraServo) rateLimitAngleLocked(target float64) float64 {
	now := time.Now()
	if s.lastMove.IsZero() {
		s.lastMove = now
		return target
	}
	elapsed := now.Sub(s.lastMove).Seconds()
	if elapsed <= 0 {
		s.lastMove = now
		return s.currentAngle
	}
	maxDelta := maxServoDegPerSec * elapsed
	delta := target - s.currentAngle
	if math.Abs(delta) <= maxDelta {
		s.lastMove = now
		return target
	}
	if delta > 0 {
		target = s.currentAngle + maxDelta
	} else {
		target = s.currentAngle - maxDelta
	}
	s.lastMove = now
	return target
}

func (s *CameraServo) angleToPulse(angle float64) int {
	totalRange := s.cfg.MaxAngle - s.cfg.MinAngle
	if totalRange == 0 {
		return s.cfg.MinPulseUs
	}
	norm := (angle - s.cfg.MinAngle) / totalRange
	norm = math.Max(0, math.Min(1, norm))
	if s.cfg.Invert {
		norm = 1 - norm
	}
	pulseRange := s.cfg.MaxPulseUs - s.cfg.MinPulseUs
	return s.cfg.MinPulseUs + int(math.Round(norm*float64(pulseRange)))
}

func (s *CameraServo) pulseToAngle(pulse int) float64 {
	pulseRange := s.cfg.MaxPulseUs - s.cfg.MinPulseUs
	if pulseRange == 0 {
		return s.cfg.MinAngle
	}
	norm := float64(pulse-s.cfg.MinPulseUs) / float64(pulseRange)
	norm = math.Max(0, math.Min(1, norm))
	if s.cfg.Invert {
		norm = 1 - norm
	}
	return s.cfg.MinAngle + norm*(s.cfg.MaxAngle-s.cfg.MinAngle)
}
