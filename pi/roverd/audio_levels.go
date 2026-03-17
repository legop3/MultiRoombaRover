package roverd

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
	if c.horn != nil {
		c.horn.SetGlobalGain(normalized.HornGain)
	}
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
