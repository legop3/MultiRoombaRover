package roverd

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func (c *WSClient) handleTTSPayload(ctx context.Context, payload *ttsPayload) error {
	if payload == nil {
		return fmt.Errorf("tts payload required")
	}
	if !c.cfg.Audio.TTSEnabled {
		return fmt.Errorf("tts disabled on rover")
	}
	if payload.Speak == false {
		return nil
	}
	text := strings.TrimSpace(payload.Text)
	if text == "" {
		return fmt.Errorf("tts text required")
	}
	if len([]rune(text)) > 512 {
		text = string([]rune(text)[:512])
	}

	engine := strings.ToLower(strings.TrimSpace(payload.Engine))
	if engine == "" {
		engine = strings.ToLower(strings.TrimSpace(c.cfg.Audio.DefaultEngine))
	}
	if engine == "" {
		engine = "flite"
	}

	voice := strings.TrimSpace(payload.Voice)
	if voice == "" {
		voice = strings.TrimSpace(c.cfg.Audio.DefaultVoice)
	}
	pitch := payload.Pitch
	if pitch <= 0 {
		pitch = c.cfg.Audio.DefaultPitch
	}
	pitch = clampInt(pitch, 0, 99)

	runCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	switch engine {
	case "espeak", "e":
		args := []string{}
		if pitch > 0 {
			args = append(args, "-p", fmt.Sprintf("%d", pitch))
		}
		args = append(args, text)
		cmd = exec.CommandContext(runCtx, "espeak", args...)
	case "flite", "f":
		args := []string{}
		if voice != "" {
			args = append(args, "-voice", voice)
		}
		args = append(args, "-t", text)
		cmd = exec.CommandContext(runCtx, "flite", args...)
	default:
		return fmt.Errorf("unsupported tts engine: %s", engine)
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tts exec failed: %w (%s)", err, string(out))
	}
	return nil
}
