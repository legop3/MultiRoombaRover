package roverd

import (
	"fmt"
	"math"
	"os/exec"
)

type AudioLevels struct {
	HornGain    float64
	TTSGain     float64
	ForwardGain float64
}

func clampAudioGain(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 4 {
		return 4
	}
	return v
}

func normalizeAudioLevels(v AudioLevels) AudioLevels {
	v.HornGain = clampAudioGain(v.HornGain)
	v.TTSGain = clampAudioGain(v.TTSGain)
	v.ForwardGain = clampAudioGain(v.ForwardGain)
	return v
}

func (c *WSClient) getAudioLevels() AudioLevels {
	c.audioMu.RLock()
	defer c.audioMu.RUnlock()
	return c.audioLevels
}

func (c *WSClient) setAudioLevels(next AudioLevels) {
	normalized := normalizeAudioLevels(next)
	c.audioMu.Lock()
	c.audioLevels = normalized
	c.audioMu.Unlock()
	c.applyAudioLevelsToMixer(normalized)
}

func (c *WSClient) handleAudioLevels(payload *audioLevelsPayload) error {
	if payload == nil {
		return nil
	}
	levels := c.getAudioLevels()
	if payload.HornGain != nil {
		levels.HornGain = clampAudioGain(*payload.HornGain)
	}
	if payload.TTSGain != nil {
		levels.TTSGain = clampAudioGain(*payload.TTSGain)
	}
	if payload.ForwardGain != nil {
		levels.ForwardGain = clampAudioGain(*payload.ForwardGain)
	}
	c.setAudioLevels(levels)
	return nil
}

func (c *WSClient) applyAudioLevelsToMixer(levels AudioLevels) {
	c.applyMixerGain("HornMaster", levels.HornGain)
	c.applyMixerGain("TTSMaster", levels.TTSGain)
	c.applyMixerGain("ForwardMaster", levels.ForwardGain)
}

func (c *WSClient) applyMixerGain(control string, gain float64) {
	normalized := clampAudioGain(gain)
	if normalized <= 0 {
		out, err := exec.Command("amixer", "-q", "-c", "0", "sset", control, "0%").CombinedOutput()
		if err != nil {
			c.log.Printf("audio-levels: amixer mute %s failed: %v (%s)", control, err, string(out))
		}
		return
	}

	// Convert linear gain to dB, matching softvol max_dB=12.0 in /etc/asound.conf.
	db := 20.0 * math.Log10(normalized)
	if db > 12.0 {
		db = 12.0
	}
	if db < -60.0 {
		db = -60.0
	}

	dbArg := fmt.Sprintf("%.2fdB", db)
	out, err := exec.Command("amixer", "-q", "-c", "0", "sset", control, dbArg).CombinedOutput()
	if err != nil {
		c.log.Printf("audio-levels: amixer set %s=%s failed: %v (%s)", control, dbArg, err, string(out))
	}
}
