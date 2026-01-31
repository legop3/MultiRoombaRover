package roverd

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	hornAttack  = 20 * time.Millisecond
	hornRelease = 60 * time.Millisecond
)

type HornSynth struct {
	cfg HornConfig
	log *log.Logger

	mu     sync.Mutex
	stop   chan struct{}
	active bool
	proc   *exec.Cmd
}

func NewHornSynth(cfg HornConfig, logger *log.Logger) *HornSynth {
	return &HornSynth{
		cfg: cfg,
		log: logger,
	}
}

func (h *HornSynth) HandlePayload(payload *hornPayload) error {
	if payload == nil {
		return fmt.Errorf("horn payload required")
	}
	action := strings.ToLower(strings.TrimSpace(payload.Action))
	switch action {
	case "start", "on", "honk":
		waveform := strings.ToLower(strings.TrimSpace(payload.Waveform))
		if waveform != "sine" && waveform != "saw" {
			waveform = "saw"
		}
		freqs := sanitizeHornFreqs(payload.Freqs)
		if len(freqs) == 0 {
			h.Stop()
			return nil
		}
		return h.Start(waveform, freqs)
	case "stop", "off":
		h.Stop()
		return nil
	default:
		return fmt.Errorf("unsupported horn action: %s", payload.Action)
	}
}

func (h *HornSynth) Start(waveform string, freqs []float64) error {
	h.mu.Lock()
	if h.active {
		h.mu.Unlock()
		return nil
	}
	stop := make(chan struct{})
	h.stop = stop
	h.active = true
	h.mu.Unlock()

	go h.run(waveform, freqs, stop)
	return nil
}

func (h *HornSynth) Stop() {
	h.mu.Lock()
	if !h.active {
		h.mu.Unlock()
		return
	}
	stop := h.stop
	proc := h.proc
	h.stop = nil
	h.proc = nil
	h.active = false
	h.mu.Unlock()

	if stop != nil {
		close(stop)
	}
	if proc != nil && proc.Process != nil {
		_ = proc.Process.Kill()
	}
}

func (h *HornSynth) run(waveform string, freqs []float64, stop <-chan struct{}) {
	rate := h.cfg.SampleRate
	if rate <= 0 {
		rate = 48000
	}
	channels := h.cfg.Channels
	if channels <= 0 {
		channels = 1
	}
	volume := h.cfg.Volume
	if volume <= 0 {
		volume = 0.25
	}
	if volume > 1 {
		volume = 1
	}

	args := []string{"-q", "-f", "S16_LE", "-c", fmt.Sprintf("%d", channels), "-r", fmt.Sprintf("%d", rate), "-t", "raw"}
	if h.cfg.Device != "" {
		args = append(args, "-D", h.cfg.Device)
	}
	cmd := exec.Command("aplay", args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		h.log.Printf("horn: aplay stdin failed: %v", err)
		return
	}
	if err := cmd.Start(); err != nil {
		h.log.Printf("horn: aplay start failed: %v", err)
		_ = stdin.Close()
		return
	}

	h.mu.Lock()
	if h.active {
		h.proc = cmd
	}
	h.mu.Unlock()

	writer := bufio.NewWriterSize(stdin, 32*1024)
	if err := h.synthLoop(writer, waveform, freqs, rate, channels, volume, stop); err != nil {
		h.log.Printf("horn: synth failed: %v", err)
	}
	_ = writer.Flush()
	_ = stdin.Close()
	if err := cmd.Wait(); err != nil {
		h.log.Printf("horn: aplay exit: %v", err)
	}

	h.mu.Lock()
	if h.proc == cmd {
		h.proc = nil
	}
	h.mu.Unlock()
}

func (h *HornSynth) synthLoop(writer *bufio.Writer, waveform string, freqs []float64, rate, channels int, volume float64, stop <-chan struct{}) error {
	phase := make([]float64, len(freqs))
	increment := make([]float64, len(freqs))
	for i, f := range freqs {
		increment[i] = 2 * math.Pi * f / float64(rate)
	}
	attackFrames := int(float64(rate) * hornAttack.Seconds())
	releaseFrames := int(float64(rate) * hornRelease.Seconds())
	framesPerChunk := 512
	buf := make([]byte, framesPerChunk*channels*2)
	scale := volume / float64(len(freqs))
	if waveform == "sine" {
		scale *= h.cfg.SineGain
	} else {
		scale *= h.cfg.SawGain
	}

	stopRequested := false
	releaseStart := -1
	sampleIndex := 0

	for {
		if !stopRequested {
			select {
			case <-stop:
				stopRequested = true
				releaseStart = sampleIndex
			default:
			}
		}
		for i := 0; i < framesPerChunk; i++ {
			env := 1.0
			if attackFrames > 0 && sampleIndex < attackFrames {
				env = float64(sampleIndex) / float64(attackFrames)
			} else if stopRequested && releaseFrames > 0 {
				relIndex := sampleIndex - releaseStart
				if relIndex >= releaseFrames {
					return nil
				}
				env = float64(releaseFrames-relIndex) / float64(releaseFrames)
			} else if stopRequested {
				return nil
			}

			sample := 0.0
			for j := range freqs {
				switch waveform {
				case "sine":
					sample += math.Sin(phase[j])
				default:
					sample += sawFromPhase(phase[j])
				}
				phase[j] += increment[j]
				if phase[j] > 2*math.Pi {
					phase[j] -= 2 * math.Pi
				}
			}
			sample *= scale * env
			if sample > 1.0 {
				sample = 1.0
			} else if sample < -1.0 {
				sample = -1.0
			}
			intSample := int16(sample * math.MaxInt16)
			offset := i * channels * 2
			for ch := 0; ch < channels; ch++ {
				binary.LittleEndian.PutUint16(buf[offset+ch*2:], uint16(intSample))
			}
			sampleIndex++
		}
		if _, err := writer.Write(buf); err != nil {
			return err
		}
	}
}

func sanitizeHornFreqs(freqs []float64) []float64 {
	if len(freqs) == 0 {
		return nil
	}
	out := make([]float64, 0, 4)
	for _, f := range freqs {
		if len(out) >= 4 {
			break
		}
		if f <= 0 {
			continue
		}
		out = append(out, f)
	}
	return out
}

func sawFromPhase(phase float64) float64 {
	return 2.0*(phase/(2*math.Pi)) - 1.0
}
