package roverd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

const publisherEnvPath = "/var/lib/roverd/media.env"

func UpdatePublisherEnv(media MediaConfig) error {
	if media.Video.Enabled && media.Video.PublishURL == "" {
		return fmt.Errorf("media video publishUrl missing")
	}
	if media.AudioCapture.Enabled && media.AudioCapture.PublishURL == "" {
		return fmt.Errorf("media audioCapture publishUrl missing")
	}
	if media.AudioPlayback.Enabled && media.AudioPlayback.ForwardURL == "" {
		return fmt.Errorf("media audioPlayback forwardUrl missing")
	}
	if media.Video.Width <= 0 || media.Video.Height <= 0 || media.Video.FPS <= 0 || media.Video.Bitrate <= 0 {
		return fmt.Errorf("invalid media video dimensions/bitrate")
	}
	if err := os.MkdirAll(filepath.Dir(publisherEnvPath), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	/*
		The env file is intentionally verbose: every publisher receives concrete
		values instead of silently falling back to script-local defaults. That
		makes roverd.yaml the owner of media behavior while keeping the shell
		scripts as small pipeline launchers.
	*/
	fmt.Fprintf(&buf, "ROVERD_VIDEO_ENABLE=%d\n", boolToInt(media.Video.Enabled))
	fmt.Fprintf(&buf, "ROVERD_VIDEO_PUBLISHER=%s\n", media.Video.Publisher)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_PUBLISH_URL=%s\n", media.Video.PublishURL)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_DEVICE=%s\n", media.Video.Device)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_INPUT_FORMAT=%s\n", media.Video.InputFormat)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_WIDTH=%d\n", media.Video.Width)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_HEIGHT=%d\n", media.Video.Height)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_FPS=%d\n", media.Video.FPS)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_BITRATE=%d\n", media.Video.Bitrate)
	fmt.Fprintf(&buf, "ROVERD_VIDEO_INVERT=%d\n", boolToInt(media.Video.Inverted))
	fmt.Fprintf(&buf, "ROVERD_VIDEO_SENSOR_MODE=%s\n", media.Video.SensorMode)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_ENABLE=%d\n", boolToInt(media.AudioCapture.Enabled))
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_PUBLISH_URL=%s\n", media.AudioCapture.PublishURL)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_DEVICE=%s\n", media.AudioCapture.Device)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_SAMPLE_RATE=%d\n", media.AudioCapture.SampleRate)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_CHANNELS=%d\n", media.AudioCapture.Channels)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_CAPTURE_BITRATE=%d\n", media.AudioCapture.Bitrate)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_PLAYBACK_ENABLE=%d\n", boolToInt(media.AudioPlayback.Enabled))
	fmt.Fprintf(&buf, "ROVERD_AUDIO_PLAYBACK_FORWARD_URL=%s\n", media.AudioPlayback.ForwardURL)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_PLAYBACK_DEVICE=%s\n", media.AudioPlayback.Device)
	fmt.Fprintf(&buf, "ROVERD_AUDIO_PLAYBACK_NORMALIZE=%d\n", boolToInt(media.AudioPlayback.Normalize))
	fmt.Fprintf(&buf, "ROVERD_AUDIO_PLAYBACK_NORMALIZE_FILTER=%s\n", media.AudioPlayback.NormalizeFilter)
	if err := os.WriteFile(publisherEnvPath, buf.Bytes(), 0o640); err != nil {
		return err
	}
	return nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
