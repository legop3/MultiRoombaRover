package main

import (
	"bufio"
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const twoPi = 2 * math.Pi

func main() {
	var (
		device   = flag.String("device", "", "ALSA device (empty = default)")
		rate     = flag.Int("rate", 48000, "Sample rate in Hz")
		channels = flag.Int("channels", 1, "Number of audio channels")
		duration = flag.Duration("duration", 2*time.Second, "Total horn duration")
		freqsRaw = flag.String("freqs", "440,550,660", "Comma-separated frequencies in Hz")
		volume   = flag.Float64("volume", 0.25, "Output volume 0.0-1.0")
		attack   = flag.Duration("attack", 20*time.Millisecond, "Attack time")
		release  = flag.Duration("release", 60*time.Millisecond, "Release time")
	)
	flag.Parse()

	if *rate <= 0 {
		log.Fatalf("rate must be > 0 (got %d)", *rate)
	}
	if *channels <= 0 {
		log.Fatalf("channels must be > 0 (got %d)", *channels)
	}
	if *duration <= 0 {
		log.Fatalf("duration must be > 0 (got %s)", *duration)
	}
	if *volume <= 0 || *volume > 1.0 {
		log.Fatalf("volume must be within (0,1] (got %.3f)", *volume)
	}
	if *attack < 0 || *release < 0 {
		log.Fatalf("attack/release must be >= 0")
	}

	freqs, err := parseFreqs(*freqsRaw)
	if err != nil {
		log.Fatalf("parse freqs: %v", err)
	}
	if len(freqs) == 0 {
		log.Fatal("no frequencies provided")
	}

	if *attack+*release > *duration {
		log.Fatalf("attack+release must be <= duration (%s + %s > %s)", *attack, *release, *duration)
	}

	args := []string{"-q", "-f", "S16_LE", "-c", fmt.Sprintf("%d", *channels), "-r", fmt.Sprintf("%d", *rate), "-t", "raw"}
	if *device != "" {
		args = append(args, "-D", *device)
	}
	cmd := exec.Command("aplay", args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatalf("aplay stdin: %v", err)
	}
	if err := cmd.Start(); err != nil {
		log.Fatalf("start aplay: %v", err)
	}

	writer := bufio.NewWriterSize(stdin, 32*1024)
	if err := synthChord(writer, freqs, *rate, *channels, *duration, *volume, *attack, *release); err != nil {
		_ = stdin.Close()
		_ = cmd.Wait()
		log.Fatalf("synth: %v", err)
	}
	if err := writer.Flush(); err != nil {
		_ = stdin.Close()
		_ = cmd.Wait()
		log.Fatalf("flush: %v", err)
	}
	if err := stdin.Close(); err != nil {
		_ = cmd.Wait()
		log.Fatalf("close stdin: %v", err)
	}
	if err := cmd.Wait(); err != nil {
		log.Fatalf("aplay failed: %v", err)
	}
	log.Print("Horn verification complete")
}

func parseFreqs(raw string) ([]float64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	parts := strings.Split(trimmed, ",")
	freqs := make([]float64, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		value, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid freq %q", part)
		}
		if value <= 0 {
			return nil, fmt.Errorf("freq must be > 0 (got %.3f)", value)
		}
		freqs = append(freqs, value)
	}
	return freqs, nil
}

func synthChord(writer *bufio.Writer, freqs []float64, rate, channels int, duration time.Duration, volume float64, attack, release time.Duration) error {
	totalFrames := int(float64(rate) * duration.Seconds())
	if totalFrames <= 0 {
		return fmt.Errorf("duration too short")
	}

	phase := make([]float64, len(freqs))
	increment := make([]float64, len(freqs))
	for i, f := range freqs {
		increment[i] = twoPi * f / float64(rate)
	}

	attackFrames := int(float64(rate) * attack.Seconds())
	releaseFrames := int(float64(rate) * release.Seconds())
	steadyFrames := totalFrames - attackFrames - releaseFrames

	framesPerChunk := 512
	buf := make([]byte, framesPerChunk*channels*2)
	sampleIndex := 0
	scale := volume / float64(len(freqs))

	for framesLeft := totalFrames; framesLeft > 0; {
		framesNow := framesPerChunk
		if framesLeft < framesNow {
			framesNow = framesLeft
		}
		for i := 0; i < framesNow; i++ {
			env := envelope(sampleIndex, attackFrames, steadyFrames, releaseFrames)
			sample := 0.0
			for j := range freqs {
				sample += sawFromPhase(phase[j])
				phase[j] += increment[j]
				if phase[j] > twoPi {
					phase[j] -= twoPi
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
		if _, err := writer.Write(buf[:framesNow*channels*2]); err != nil {
			return err
		}
		framesLeft -= framesNow
	}
	return nil
}

func envelope(sampleIndex, attackFrames, steadyFrames, releaseFrames int) float64 {
	if attackFrames > 0 && sampleIndex < attackFrames {
		return float64(sampleIndex) / float64(attackFrames)
	}
	if releaseFrames > 0 && sampleIndex >= attackFrames+steadyFrames {
		relIndex := sampleIndex - (attackFrames + steadyFrames)
		return float64(releaseFrames-relIndex) / float64(releaseFrames)
	}
	return 1.0
}

func sawFromPhase(phase float64) float64 {
	return 2.0*(phase/twoPi) - 1.0
}
