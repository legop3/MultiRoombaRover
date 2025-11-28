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
	// Disable mic streaming; audio is handled locally for TTS only.
	fmt.Fprintf(&buf, "AUDIO_ENABLE=0\n")
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
