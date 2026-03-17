package roverd

import (
	"context"
	"fmt"
	"os"
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

	tmp, err := os.CreateTemp("", "roverd-tts-*.wav")
	if err != nil {
		return fmt.Errorf("tts temp file: %w", err)
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer os.Remove(tmpPath)

	if err := synthTTS(runCtx, engine, voice, pitch, text, tmpPath); err != nil {
		return err
	}
	if err := playTTSFile(runCtx, tmpPath, c.cfg.Audio.PlaybackDevice, c.getAudioLevels().TTSGain); err != nil {
		return err
	}
	return nil
}

func synthTTS(ctx context.Context, engine, voice string, pitch int, text, outputWavPath string) error {
	var cmd *exec.Cmd
	switch engine {
	case "espeak", "e":
		args := []string{"-w", outputWavPath}
		if pitch > 0 {
			args = append(args, "-p", fmt.Sprintf("%d", pitch))
		}
		args = append(args, text)
		cmd = exec.CommandContext(ctx, "espeak", args...)
	case "flite", "f":
		args := []string{}
		if voice != "" {
			args = append(args, "-voice", voice)
		}
		args = append(args, "-t", text, "-o", outputWavPath)
		cmd = exec.CommandContext(ctx, "flite", args...)
	default:
		return fmt.Errorf("unsupported tts engine: %s", engine)
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tts synth failed: %w (%s)", err, string(out))
	}
	return nil
}

func playTTSFile(ctx context.Context, wavPath, playbackDevice string, gain float64) error {
	if playbackDevice == "" {
		playbackDevice = "default"
	}
	gain = clampAudioGain(gain)
	if gain == 0 {
		// Mute is an explicit value users may choose.
		return nil
	}

	args := []string{
		"-hide_banner",
		"-loglevel", "warning",
		"-i", wavPath,
		"-af", fmt.Sprintf("aresample=16000,volume=%g", gain),
		"-ac", "1",
		"-ar", "16000",
		"-f", "alsa",
		playbackDevice,
	}
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tts playback failed: %w (%s)", err, string(out))
	}
	return nil
}
