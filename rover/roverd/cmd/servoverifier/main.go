package main

import (
	"flag"
	"log"
	"time"

	rpio "github.com/stianeikeland/go-rpio/v4"
)

func main() {
	var (
		pinNum    = flag.Int("pin", 19, "BCM pin connected to the servo signal line")
		freqHz    = flag.Int("freq", 50, "Servo PWM frequency in Hz")
		cycleLen  = flag.Int("cycle", 20000, "PWM cycle length (counts per period)")
		minPulse  = flag.Int("min", 900, "Minimum pulse width in microseconds")
		maxPulse  = flag.Int("max", 2100, "Maximum pulse width in microseconds")
		stepPulse = flag.Int("step", 100, "Pulse width increment in microseconds when sweeping")
		sweeps    = flag.Int("sweeps", 2, "How many full min→max→min sweeps to perform")
		pause     = flag.Duration("pause", 150*time.Millisecond, "Delay between pulse adjustments")
		holdPulse = flag.Int("hold", 0, "Pulse width to hold before exiting (0 = midpoint of min/max)")
	)
	flag.Parse()

	if *freqHz <= 0 || *cycleLen <= 0 {
		log.Fatalf("invalid freq (%d) or cycle (%d)", *freqHz, *cycleLen)
	}
	if *minPulse <= 0 || *maxPulse <= 0 || *minPulse >= *maxPulse {
		log.Fatalf("invalid min/max pulses (%d/%d)", *minPulse, *maxPulse)
	}
	if *stepPulse <= 0 {
		log.Fatalf("step must be > 0 (got %d)", *stepPulse)
	}
	if *pause <= 0 {
		log.Fatalf("pause must be > 0 (got %s)", pause)
	}
	if *sweeps < 0 {
		log.Fatalf("sweeps must be >= 0 (got %d)", *sweeps)
	}

	if err := rpio.Open(); err != nil {
		log.Fatalf("open gpio: %v", err)
	}
	defer rpio.Close()

	pin := rpio.Pin(*pinNum)
	pin.Mode(rpio.Pwm)

	targetClock := *freqHz * *cycleLen
	pin.Freq(targetClock)
	log.Printf("Configured PWM pin %d at %d Hz (clock=%d Hz, cycle=%d)", *pinNum, *freqHz, targetClock, *cycleLen)

	setPulse := func(us int) {
		clamped := clamp(us, *minPulse, *maxPulse)
		pin.DutyCycle(uint32(clamped), uint32(*cycleLen))
		log.Printf("pulse -> %dµs", clamped)
	}

	mid := (*minPulse + *maxPulse) / 2
	setPulse(mid)

	runSweep := func() {
		for pulse := *minPulse; pulse <= *maxPulse; pulse += *stepPulse {
			setPulse(pulse)
			time.Sleep(*pause)
		}
		for pulse := *maxPulse - *stepPulse; pulse >= *minPulse; pulse -= *stepPulse {
			setPulse(pulse)
			time.Sleep(*pause)
		}
	}

	for i := 0; i < *sweeps; i++ {
		log.Printf("Sweep %d/%d", i+1, *sweeps)
		runSweep()
	}

	finalPulse := *holdPulse
	if finalPulse <= 0 {
		finalPulse = mid
	}
	setPulse(finalPulse)
	log.Printf("Holding at %dµs", clamp(finalPulse, *minPulse, *maxPulse))
	log.Print("Servo verification complete")
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
