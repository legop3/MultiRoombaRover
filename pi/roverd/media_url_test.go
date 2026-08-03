package roverd

// Pins URL derivation. The point of deriving is that a rover config names the rover and the
// server once, and every stream URL on every transport follows - so the cases that matter are
// "nothing configured produces working URLs" and "the three paths get three distinct streams".

import (
	"strings"
	"testing"
)

func mediaConfigForTest() MediaConfig {
	return MediaConfig{
		Video:         VideoMediaConfig{Enabled: true},
		AudioCapture:  AudioCaptureConfig{Enabled: true},
		AudioPlayback: AudioPlaybackConfig{Enabled: true},
	}
}

func TestDerivesEveryURLFromTheRoverName(t *testing.T) {
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "roomba-alpha"); err != nil {
		t.Fatalf("validate: %v", err)
	}

	// The three paths must land on three DIFFERENT streams. Collapsing any two would make a
	// rover play its own microphone out of its speaker, or publish video over the audio path.
	checks := []struct {
		name, got, wantContains string
	}{
		{"video rtsp", cfg.Video.RTSPURL, "rtsp://media.example:8554/roomba-alpha"},
		{"video whip", cfg.Video.WHIPURL, "http://media.example:8889/roomba-alpha/whip"},
		{"video srt", cfg.Video.PublishURL, "r=roomba-alpha,m=publish"},
		{"mic rtsp", cfg.AudioCapture.RTSPURL, "rtsp://media.example:8554/roomba-alpha-audio"},
		{"mic whip", cfg.AudioCapture.WHIPURL, "http://media.example:8889/roomba-alpha-audio/whip"},
		{"mic srt", cfg.AudioCapture.PublishURL, "r=roomba-alpha-audio,m=publish"},
		{"speaker rtsp", cfg.AudioPlayback.RTSPURL, "rtsp://media.example:8554/roomba-alpha-fwd"},
		{"speaker srt", cfg.AudioPlayback.ForwardURL, "r=roomba-alpha-fwd,m=request"},
	}
	for _, c := range checks {
		if !strings.Contains(c.got, c.wantContains) {
			t.Errorf("%s: got %q, want it to contain %q", c.name, c.got, c.wantContains)
		}
	}
}

func TestSpeakerPathHasNoWhipURL(t *testing.T) {
	// The rover is a READER on the forward path and WHIP is a publish protocol, so there is no
	// whipUrl to derive. Asserted so nobody "completes the set" by adding one.
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "roomba-alpha"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if cfg.AudioPlayback.Transport == "whip" {
		t.Fatal("whip must not be selectable on the speaker path")
	}
}

func TestExplicitURLsOverrideDerivation(t *testing.T) {
	cfg := mediaConfigForTest()
	cfg.Video.RTSPURL = "rtsp://somewhere-else:1234/custom"
	cfg.AudioCapture.WHIPURL = "http://other:5678/custom/whip"
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "roomba-alpha"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if cfg.Video.RTSPURL != "rtsp://somewhere-else:1234/custom" {
		t.Fatalf("explicit video rtspUrl was overwritten: %q", cfg.Video.RTSPURL)
	}
	if cfg.AudioCapture.WHIPURL != "http://other:5678/custom/whip" {
		t.Fatalf("explicit mic whipUrl was overwritten: %q", cfg.AudioCapture.WHIPURL)
	}
	// The ones not set explicitly are still derived.
	if !strings.Contains(cfg.Video.WHIPURL, "roomba-alpha/whip") {
		t.Fatalf("video whipUrl should still be derived, got %q", cfg.Video.WHIPURL)
	}
}

func TestPortsAreConfigurableForAContiguousBlock(t *testing.T) {
	// A VPS that only grants a contiguous port range cannot use MediaMTX's scattered defaults,
	// so the derived URLs have to follow the configured ports.
	cfg := mediaConfigForTest()
	cfg.PublishPort = 15944
	cfg.RTSPPort = 15941
	cfg.WHIPPort = 15939
	if err := validateMediaConfig(&cfg, "http://vps.example:8080", "rover-1"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if !strings.Contains(cfg.Video.RTSPURL, ":15941/rover-1") {
		t.Fatalf("rtsp port not honoured: %q", cfg.Video.RTSPURL)
	}
	if !strings.Contains(cfg.Video.WHIPURL, ":15939/rover-1/whip") {
		t.Fatalf("whip port not honoured: %q", cfg.Video.WHIPURL)
	}
	if !strings.Contains(cfg.Video.PublishURL, ":15944?") {
		t.Fatalf("srt port not honoured: %q", cfg.Video.PublishURL)
	}
}

func TestPortDefaultsMatchMediaMtx(t *testing.T) {
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "r"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if cfg.RTSPPort != 8554 || cfg.WHIPPort != 8889 || cfg.PublishPort != 9000 {
		t.Fatalf("unexpected defaults: rtsp=%d whip=%d srt=%d", cfg.RTSPPort, cfg.WHIPPort, cfg.PublishPort)
	}
}

func TestTransportDefaultsToRtsp(t *testing.T) {
	// RTSP is the default because it is the fastest transport every current rover can run, and
	// derivation means it needs no per-rover configuration to work.
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "r"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	for name, got := range map[string]string{
		"video":   cfg.Video.Transport,
		"mic":     cfg.AudioCapture.Transport,
		"speaker": cfg.AudioPlayback.Transport,
	} {
		if got != "rtsp" {
			t.Errorf("%s transport: got %q, want rtsp", name, got)
		}
	}
}

func TestMpegtsIsTheKnobThatRestoresOldBehaviour(t *testing.T) {
	cfg := mediaConfigForTest()
	cfg.Video.Transport = "mpegts"
	cfg.AudioCapture.Transport = "srt"
	cfg.AudioPlayback.Transport = "mpegts"
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "r"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if cfg.Video.Transport != "mpegts" || cfg.AudioPlayback.Transport != "mpegts" {
		t.Fatalf("explicit mpegts not preserved: video=%q speaker=%q", cfg.Video.Transport, cfg.AudioPlayback.Transport)
	}
	if cfg.AudioCapture.Transport != "srt" {
		t.Fatalf("srt alias not preserved: %q", cfg.AudioCapture.Transport)
	}
}

func TestUnknownTransportFallsBackToRtsp(t *testing.T) {
	// A typo resolves to the default rather than stopping the rover publishing.
	cfg := mediaConfigForTest()
	cfg.Video.Transport = "banana"
	// whip is not selectable on the speaker path, so it must land on rtsp there too.
	cfg.AudioPlayback.Transport = "whip"
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "r"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if cfg.Video.Transport != "rtsp" {
		t.Fatalf("video: got %q, want rtsp", cfg.Video.Transport)
	}
	if cfg.AudioPlayback.Transport != "rtsp" {
		t.Fatalf("speaker: got %q, want rtsp", cfg.AudioPlayback.Transport)
	}
}

func TestRoverNameIsEscapedInDerivedURLs(t *testing.T) {
	// Rover names come from config and are not guaranteed URL-safe.
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "http://media.example:8080", "rover one"); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if strings.Contains(cfg.Video.RTSPURL, "rover one") {
		t.Fatalf("space not escaped: %q", cfg.Video.RTSPURL)
	}
	if !strings.Contains(cfg.Video.RTSPURL, "rover%20one") {
		t.Fatalf("expected percent-encoding, got %q", cfg.Video.RTSPURL)
	}
}

func TestDerivationFailsLoudlyOnAServerURLWithNoHost(t *testing.T) {
	cfg := mediaConfigForTest()
	if err := validateMediaConfig(&cfg, "not-a-url", "rover-1"); err == nil {
		t.Fatal("expected an error for a serverUrl with no host")
	}
}
