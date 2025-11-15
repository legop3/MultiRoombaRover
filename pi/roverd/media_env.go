package roverd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

const publisherEnvPath = "/var/lib/roverd/video.env"

func UpdatePublisherEnv(cfg MediaConfig) error {
	if cfg.PublishURL == "" {
		return fmt.Errorf("media publishUrl missing")
	}
	if cfg.VideoWidth <= 0 || cfg.VideoHeight <= 0 || cfg.VideoFPS <= 0 || cfg.VideoBitrate <= 0 {
		return fmt.Errorf("invalid media dimensions/bitrate")
	}
	if err := os.MkdirAll(filepath.Dir(publisherEnvPath), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "PUBLISH_URL=%s\n", cfg.PublishURL)
	fmt.Fprintf(&buf, "VIDEO_WIDTH=%d\n", cfg.VideoWidth)
	fmt.Fprintf(&buf, "VIDEO_HEIGHT=%d\n", cfg.VideoHeight)
	fmt.Fprintf(&buf, "VIDEO_FPS=%d\n", cfg.VideoFPS)
	fmt.Fprintf(&buf, "VIDEO_BITRATE=%d\n", cfg.VideoBitrate)
	if err := os.WriteFile(publisherEnvPath, buf.Bytes(), 0o640); err != nil {
		return err
	}
	return nil
}
