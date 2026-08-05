package roverd

// These tests pin the network-agnostic RTSP contract. A rover provides its server URL and name
// once; all three media paths must then resolve to distinct, safely escaped MediaMTX paths.

import (
	"strings"
	"testing"
)

func TestMediaURLsDeriveFromServerURLAndRoverName(t *testing.T) {
	cfg := MediaConfig{
		Video:         VideoMediaConfig{Enabled: true},
		AudioCapture:  AudioCaptureConfig{Enabled: true},
		AudioPlayback: AudioPlaybackConfig{Enabled: true},
	}
	if err := validateMediaConfig(&cfg, "ws://control-server.local:8080/rover", "rover one"); err != nil {
		t.Fatalf("validate media config: %v", err)
	}

	wants := map[string]string{
		"video":   "rtsp://control-server.local:8554/rover%20one",
		"mic":     "rtsp://control-server.local:8554/rover%20one-audio",
		"speaker": "rtsp://control-server.local:8554/rover%20one-fwd",
	}
	got := map[string]string{
		"video":   cfg.Video.PublishURL,
		"mic":     cfg.AudioCapture.PublishURL,
		"speaker": cfg.AudioPlayback.ForwardURL,
	}
	for name, want := range wants {
		if got[name] != want {
			t.Errorf("%s URL: got %q, want %q", name, got[name], want)
		}
	}
	if cfg.RTSPPort != 8554 {
		t.Fatalf("RTSP port: got %d, want 8554", cfg.RTSPPort)
	}
}

func TestExplicitMediaPortAppliesToEveryRTSPPath(t *testing.T) {
	cfg := MediaConfig{
		RTSPPort:      10554,
		Video:         VideoMediaConfig{Enabled: true},
		AudioCapture:  AudioCaptureConfig{Enabled: true},
		AudioPlayback: AudioPlaybackConfig{Enabled: true},
	}
	if err := validateMediaConfig(&cfg, "ws://media.example/rover", "r1"); err != nil {
		t.Fatalf("validate media config: %v", err)
	}
	for name, value := range map[string]string{
		"video": cfg.Video.PublishURL, "mic": cfg.AudioCapture.PublishURL, "speaker": cfg.AudioPlayback.ForwardURL,
	} {
		if !strings.Contains(value, ":10554/") {
			t.Errorf("%s URL did not use configured port: %q", name, value)
		}
	}
}

func TestLegacyExplicitSRTURLsCannotKeepAnUpdatedRoverOnTheOldTransport(t *testing.T) {
	/*
		Deployed rover configs can still contain these former fields. Validation must replace
		them unconditionally so updating roverd is sufficient to move the whole media path.
	*/
	cfg := MediaConfig{
		Video:         VideoMediaConfig{Enabled: true, PublishURL: "srt://old/video"},
		AudioCapture:  AudioCaptureConfig{Enabled: true, PublishURL: "srt://old/audio"},
		AudioPlayback: AudioPlaybackConfig{Enabled: true, ForwardURL: "srt://old/forward"},
	}
	if err := validateMediaConfig(&cfg, "ws://new-server.local:8080/rover", "r1"); err != nil {
		t.Fatalf("validate media config: %v", err)
	}
	for name, value := range map[string]string{
		"video": cfg.Video.PublishURL, "mic": cfg.AudioCapture.PublishURL, "speaker": cfg.AudioPlayback.ForwardURL,
	} {
		if !strings.HasPrefix(value, "rtsp://new-server.local:8554/") {
			t.Errorf("%s retained an old transport URL: %q", name, value)
		}
	}
}
