package roverd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

const publisherEnvPath = "/var/lib/roverd/video.env"

func UpdatePublisherEnv(media MediaConfig, audio AudioConfig) error {
	if media.PublishURL == "" {
		return fmt.Errorf("media publishUrl missing")
	}
	if media.VideoWidth <= 0 || media.VideoHeight <= 0 || media.VideoFPS <= 0 || media.VideoBitrate <= 0 {
		return fmt.Errorf("invalid media dimensions/bitrate")
	}
	if err := os.MkdirAll(filepath.Dir(publisherEnvPath), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "PUBLISH_URL=%s\n", media.PublishURL)
	fmt.Fprintf(&buf, "VIDEO_WIDTH=%d\n", media.VideoWidth)
	fmt.Fprintf(&buf, "VIDEO_HEIGHT=%d\n", media.VideoHeight)
	fmt.Fprintf(&buf, "VIDEO_FPS=%d\n", media.VideoFPS)
	fmt.Fprintf(&buf, "VIDEO_BITRATE=%d\n", media.VideoBitrate)
	audioDevice := audio.CaptureDevice
	if audioDevice == "" {
		audioDevice = "hw:0,0"
	}
	if audio.SampleRate <= 0 {
		audio.SampleRate = 48000
	}
	if audio.Channels <= 0 {
		audio.Channels = 2
	}
	fmt.Fprintf(&buf, "AUDIO_ENABLE=%d\n", boolToInt(audio.CaptureEnabled))
	fmt.Fprintf(&buf, "AUDIO_DEVICE=%s\n", audioDevice)
	fmt.Fprintf(&buf, "AUDIO_RATE=%d\n", audio.SampleRate)
	fmt.Fprintf(&buf, "AUDIO_CHANNELS=%d\n", audio.Channels)
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
